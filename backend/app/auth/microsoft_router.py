from __future__ import annotations

import secrets
from datetime import datetime, timezone

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from passlib.hash import bcrypt
from pydantic import BaseModel
from sqlmodel import Session, select

from app.audit.service import log_audit
from app.auth.auth_router import _build_token_response
from app.auth.external_identities_model import ExternalIdentity
from app.auth.microsoft_token_validator import TokenValidationError, validate_id_token
from app.auth.user_model import User
from app.db import get_session
from app.dependencies import AuditRequestContext, get_request_audit_context
from app.settings import settings

router = APIRouter(prefix="/api/auth/microsoft", tags=["auth"])


class TokenExchangeRequest(BaseModel):
    id_token: str


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _error(status_code: int, code: str, message: str) -> JSONResponse:
    return JSONResponse(status_code=status_code, content={"code": code, "message": message})


@router.post("/token-exchange")
def token_exchange(
    payload: TokenExchangeRequest,
    session: Session = Depends(get_session),
    audit_ctx: AuditRequestContext = Depends(get_request_audit_context),
):
    if not settings.entra_login_client_id:
        log_audit(
            session,
            actor=None,
            action="auth.microsoft.login.failed",
            target_type="auth",
            target_id="microsoft",
            meta={"reason": "missing_client_id"},
            ip=audit_ctx.ip,
            ua=audit_ctx.user_agent,
            corr=audit_ctx.correlation_id,
        )
        session.commit()
        return _error(500, "invalid_token", "ENTRA_LOGIN_CLIENT_ID no configurado")

    try:
        token_data = validate_id_token(
            payload.id_token,
            tenant_id=settings.entra_login_tenant_id,
            client_id=settings.entra_login_client_id,
            allowed_tenants=settings.entra_allowed_tenants,
        )
    except TokenValidationError as exc:
        log_audit(
            session,
            actor=None,
            action="auth.microsoft.login.failed",
            target_type="auth",
            target_id="microsoft",
            meta={"reason": exc.code, "status_code": exc.status_code},
            ip=audit_ctx.ip,
            ua=audit_ctx.user_agent,
            corr=audit_ctx.correlation_id,
        )
        session.commit()
        return _error(exc.status_code, exc.code, exc.message)

    oid = token_data["oid"]
    tid = token_data["tid"]
    email = token_data.get("email")

    identity = session.exec(
        select(ExternalIdentity).where(
            ExternalIdentity.provider == "microsoft",
            ExternalIdentity.tenant_id == tid,
            ExternalIdentity.external_oid == oid,
        )
    ).first()

    if identity:
        if identity.status == "disabled":
            log_audit(
                session,
                actor={"username": identity.email},
                action="auth.microsoft.login.denied",
                target_type="external_identity",
                target_id=f"{tid}:{oid}",
                meta={"reason": "disabled", "provider": "microsoft", "tenant_id": tid},
                ip=audit_ctx.ip,
                ua=audit_ctx.user_agent,
                corr=audit_ctx.correlation_id,
            )
            session.commit()
            return _error(403, "disabled", "Cuenta deshabilitada")
        if identity.status == "pending":
            log_audit(
                session,
                actor={"username": identity.email},
                action="auth.microsoft.login.pending",
                target_type="external_identity",
                target_id=f"{tid}:{oid}",
                meta={"reason": "pending", "provider": "microsoft", "tenant_id": tid},
                ip=audit_ctx.ip,
                ua=audit_ctx.user_agent,
                corr=audit_ctx.correlation_id,
            )
            session.commit()
            return _error(403, "pending_access", "Acceso pendiente")
        if identity.status != "active":
            log_audit(
                session,
                actor={"username": identity.email},
                action="auth.microsoft.login.denied",
                target_type="external_identity",
                target_id=f"{tid}:{oid}",
                meta={"reason": "inactive", "provider": "microsoft", "tenant_id": tid},
                ip=audit_ctx.ip,
                ua=audit_ctx.user_agent,
                corr=audit_ctx.correlation_id,
            )
            session.commit()
            return _error(403, "pending_access", "Acceso pendiente")
        if not identity.user_id:
            log_audit(
                session,
                actor={"username": identity.email},
                action="auth.microsoft.login.denied",
                target_type="external_identity",
                target_id=f"{tid}:{oid}",
                meta={"reason": "missing_user", "provider": "microsoft", "tenant_id": tid},
                ip=audit_ctx.ip,
                ua=audit_ctx.user_agent,
                corr=audit_ctx.correlation_id,
            )
            session.commit()
            return _error(403, "pending_access", "Acceso pendiente")

        user = session.get(User, identity.user_id)
        if not user:
            log_audit(
                session,
                actor={"username": identity.email},
                action="auth.microsoft.login.denied",
                target_type="external_identity",
                target_id=f"{tid}:{oid}",
                meta={"reason": "user_not_found", "provider": "microsoft", "tenant_id": tid},
                ip=audit_ctx.ip,
                ua=audit_ctx.user_agent,
                corr=audit_ctx.correlation_id,
            )
            session.commit()
            return _error(403, "pending_access", "Acceso pendiente")

        if email and identity.email != email:
            identity.email = email
            identity.updated_at = _utcnow()
            session.add(identity)
            session.commit()

        log_audit(
            session,
            actor=user,
            action="auth.microsoft.login.success",
            target_type="user",
            target_id=str(user.id),
            meta={
                "provider": "microsoft",
                "tenant_id": tid,
                "external_oid": oid,
                "email": email,
            },
            ip=audit_ctx.ip,
            ua=audit_ctx.user_agent,
            corr=audit_ctx.correlation_id,
        )
        session.commit()
        return _build_token_response(user, session)

    if not email:
        log_audit(
            session,
            actor=None,
            action="auth.microsoft.login.denied",
            target_type="external_identity",
            target_id=f"{tid}:{oid}",
            meta={"reason": "missing_email", "provider": "microsoft", "tenant_id": tid},
            ip=audit_ctx.ip,
            ua=audit_ctx.user_agent,
            corr=audit_ctx.correlation_id,
        )
        session.commit()
        return _error(400, "invalid_token", "Email requerido")

    user = session.exec(select(User).where(User.username == email)).first()
    user_created = False
    if not user:
        random_password = secrets.token_urlsafe(32)
        user = User(
            username=email,
            hashed_password=bcrypt.hash(random_password),
        )
        user.mark_password_changed()
        session.add(user)
        session.flush()
        user_created = True

    identity = ExternalIdentity(
        provider="microsoft",
        tenant_id=tid,
        external_oid=oid,
        email=email,
        user_id=user.id,
        status="active",
        updated_at=_utcnow(),
    )
    session.add(identity)
    session.commit()
    log_audit(
        session,
        actor=user,
        action="auth.microsoft.login.success",
        target_type="user",
        target_id=str(user.id),
        meta={
            "provider": "microsoft",
            "tenant_id": tid,
            "external_oid": oid,
            "email": email,
            "linked": not user_created,
            "provisioned": user_created,
        },
        ip=audit_ctx.ip,
        ua=audit_ctx.user_agent,
        corr=audit_ctx.correlation_id,
    )
    session.commit()
    return _build_token_response(user, session)
