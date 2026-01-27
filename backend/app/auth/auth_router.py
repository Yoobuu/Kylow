import logging
from threading import Lock

from cachetools import TTLCache
from fastapi import APIRouter, Depends, HTTPException, status
from passlib.hash import bcrypt
from pydantic import BaseModel, Field
from sqlmodel import Session, select

from app.audit.service import log_audit
from app.auth.jwt_handler import create_access_token
from app.auth.password_policy import check_password_policy
from app.auth.user_model import User
from app.db import get_session
from app.dependencies import (
    AuditRequestContext,
    get_current_user,
    get_request_audit_context,
)
from app.permissions.service import user_effective_permissions
from app.settings import settings

router = APIRouter()
logger = logging.getLogger(__name__)

_LOGIN_FAILURES = TTLCache(maxsize=10000, ttl=settings.auth_login_rate_limit_window_sec)
_LOGIN_FAILURES_LOCK = Lock()


def _login_rate_key(username: str, ip: str | None) -> str:
    return f"{(ip or 'unknown')}::{username.lower()}"


def _is_rate_limited(key: str) -> bool:
    with _LOGIN_FAILURES_LOCK:
        return _LOGIN_FAILURES.get(key, 0) >= settings.auth_login_rate_limit_max


def _record_login_failure(key: str) -> None:
    with _LOGIN_FAILURES_LOCK:
        _LOGIN_FAILURES[key] = int(_LOGIN_FAILURES.get(key, 0)) + 1


def _clear_login_failures(key: str) -> None:
    with _LOGIN_FAILURES_LOCK:
        _LOGIN_FAILURES.pop(key, None)


class LoginRequest(BaseModel):
    """Payload con credenciales de acceso."""

    username: str = Field(min_length=1, max_length=128)
    password: str = Field(min_length=1, max_length=256)


class TokenUser(BaseModel):
    """InformaciA3n simplificada del usuario autenticado."""

    id: int
    username: str


class TokenResponse(BaseModel):
    """Respuesta del endpoint de login con token y datos bA�sicos del usuario."""

    access_token: str
    token_type: str = "bearer"
    user: TokenUser
    require_password_change: bool
    permissions: list[str]


class ChangePasswordRequest(BaseModel):
    """Payload para cambio de contraseA�a por el propio usuario."""

    old_password: str = Field(min_length=1, max_length=256)
    new_password: str = Field(min_length=1, max_length=256)


def _build_token_response(user: User, session: Session) -> TokenResponse:
    permissions = sorted(user_effective_permissions(user, session))
    token_payload = {
        "sub": str(user.id),
        "username": user.username,
        "perms": permissions,
    }
    token = create_access_token(token_payload)
    return TokenResponse(
        access_token=token,
        user=TokenUser(id=user.id, username=user.username),
        require_password_change=user.must_change_password,
        permissions=permissions,
    )


@router.post("/login", response_model=TokenResponse)
def login(
    request: LoginRequest,
    session: Session = Depends(get_session),
    audit_ctx: AuditRequestContext = Depends(get_request_audit_context),
):
    """
    1. Busca al usuario por username.
    2. Verifica contraseA�a usando bcrypt.
    3. Emite un JWT con id, role y username en el payload.
    """
    username = request.username.strip()
    statement = select(User).where(User.username == username)
    user = session.exec(statement).first()

    rate_key = _login_rate_key(username, audit_ctx.ip)
    if _is_rate_limited(rate_key):
        log_audit(
            session,
            actor={"username": username},
            action="auth.login.rate_limited",
            target_type="user",
            target_id=username,
            meta={"reason": "rate_limited"},
            ip=audit_ctx.ip,
            ua=audit_ctx.user_agent,
            corr=audit_ctx.correlation_id,
        )
        session.commit()
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Demasiados intentos, intenta mas tarde",
        )

    logger.info("Login attempt for user '%s'", username)

    if not user or not bcrypt.verify(request.password, user.hashed_password):
        _record_login_failure(rate_key)
        logger.warning("Login failed for user '%s'", username)
        log_audit(
            session,
            actor={"username": username},
            action="auth.login.failed",
            target_type="user",
            target_id=str(user.id) if user else username,
            meta={"reason": "invalid_credentials"},
            ip=audit_ctx.ip,
            ua=audit_ctx.user_agent,
            corr=audit_ctx.correlation_id,
        )
        session.commit()
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Credenciales invA�lidas",
        )

    _clear_login_failures(rate_key)
    logger.info("Login succeeded for user '%s'", username)
    log_audit(
        session,
        actor=user,
        action="auth.login.success",
        target_type="user",
        target_id=str(user.id),
        meta={"username": user.username},
        ip=audit_ctx.ip,
        ua=audit_ctx.user_agent,
        corr=audit_ctx.correlation_id,
    )
    session.commit()

    return _build_token_response(user, session)


@router.get("/me")
def read_me(
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    return {
        "id": current_user.id,
        "username": current_user.username,
        "must_change_password": current_user.must_change_password,
        "permissions": sorted(user_effective_permissions(current_user, session)),
    }


@router.post("/change-password", response_model=TokenResponse)
def change_password(
    request: ChangePasswordRequest,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
    audit_ctx: AuditRequestContext = Depends(get_request_audit_context),
):
    policy_errors = check_password_policy(
        request.new_password,
        min_length=settings.password_min_length,
        require_classes=settings.password_require_classes,
    )
    if policy_errors:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"error": "password_policy", "messages": policy_errors},
        )

    user = session.get(User, current_user.id)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="usuario no encontrado",
        )

    if not bcrypt.verify(request.old_password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="old_password incorrecto",
        )

    user.hashed_password = bcrypt.hash(request.new_password)
    user.mark_password_changed()

    session.add(user)
    log_audit(
        session,
        actor=user,
        action="auth.change_password",
        target_type="user",
        target_id=str(user.id),
        meta={"mode": "self_service"},
        ip=audit_ctx.ip,
        ua=audit_ctx.user_agent,
        corr=audit_ctx.correlation_id,
    )
    session.commit()
    session.refresh(user)

    return _build_token_response(user, session)
