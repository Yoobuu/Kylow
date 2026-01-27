from __future__ import annotations

from typing import Dict, List

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, field_validator
from sqlmodel import Session

from app.audit.service import log_audit
from app.auth.user_model import User
from app.db import get_session
from app.dependencies import AuditRequestContext, get_request_audit_context, require_permission
from app.permissions.models import Permission, PermissionCode
from app.permissions.service import (
    count_users_with_all_permissions,
    get_user_permissions_summary,
    list_permission_catalog,
    list_permission_codes,
    set_user_permission_overrides,
    user_effective_permissions,
    user_has_all_permissions,
)

router = APIRouter(prefix="/api/permissions", tags=["permissions"])


class PermissionRead(BaseModel):
    code: str
    name: str
    category: str
    description: str | None = None


class UserPermissionOverrideIn(BaseModel):
    code: PermissionCode
    granted: bool


class UpdateUserPermissionsRequest(BaseModel):
    overrides: List[UserPermissionOverrideIn] = []

    @field_validator("overrides")
    @classmethod
    def ensure_unique_codes(cls, overrides: List[UserPermissionOverrideIn]) -> List[UserPermissionOverrideIn]:
        seen = set()
        for item in overrides:
            code_val = item.code.value if hasattr(item.code, "value") else str(item.code)
            if code_val in seen:
                raise ValueError(f"Código de permiso duplicado: {code_val}")
            seen.add(code_val)
        return overrides


class UserPermissionsResponse(BaseModel):
    user_id: int
    overrides: List[Dict[str, object]]
    effective: List[str]


@router.get(
    "/",
    response_model=List[PermissionRead],
    dependencies=[Depends(require_permission(PermissionCode.USERS_MANAGE))],
)
def list_permissions(session: Session = Depends(get_session)):
    permissions = list_permission_catalog(session)
    return [
        PermissionRead(
            code=perm.code,
            name=perm.name,
            category=perm.category,
            description=perm.description,
        )
        for perm in permissions
    ]


@router.get(
    "/users/{user_id}",
    response_model=UserPermissionsResponse,
    dependencies=[Depends(require_permission(PermissionCode.USERS_MANAGE))],
)
def get_user_permissions(user_id: int, session: Session = Depends(get_session)):
    user = session.get(User, user_id)
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="usuario no encontrado")
    summary = get_user_permissions_summary(user, session)
    return summary


@router.put(
    "/users/{user_id}",
    response_model=UserPermissionsResponse,
    dependencies=[Depends(require_permission(PermissionCode.USERS_MANAGE))],
)
def update_user_permissions(
    user_id: int,
    payload: UpdateUserPermissionsRequest,
    session: Session = Depends(get_session),
    current_user: User = Depends(require_permission(PermissionCode.USERS_MANAGE)),
    audit_ctx: AuditRequestContext = Depends(get_request_audit_context),
):
    user = session.get(User, user_id)
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="usuario no encontrado")

    before_summary = get_user_permissions_summary(user, session)
    valid_codes = {code.value for code in PermissionCode}
    catalog_codes = list_permission_codes(session)
    overrides_map: Dict[str, bool] = {}

    for override in payload.overrides:
        code_val = override.code.value if hasattr(override.code, "value") else str(override.code)
        if code_val not in valid_codes or code_val not in catalog_codes:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"permiso inválido: {code_val}",
            )
        overrides_map[code_val] = bool(override.granted)

    if catalog_codes:
        current_full = count_users_with_all_permissions(session, catalog_codes)
        target_is_full = user_has_all_permissions(user, session, catalog_codes)
        proposed_effective = {code for code, granted in overrides_map.items() if granted}
        proposed_is_full = catalog_codes.issubset(proposed_effective)
        if target_is_full and not proposed_is_full and current_full <= 1:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="No puedes dejar al sistema sin usuarios con todos los permisos.",
            )

    set_user_permission_overrides(user.id, overrides_map, session)
    session.refresh(user)
    after_summary = get_user_permissions_summary(user, session)

    before_overrides = {item["code"]: item["granted"] for item in before_summary.get("overrides", [])}
    after_overrides = {item["code"]: item["granted"] for item in after_summary.get("overrides", [])}
    changes: Dict[str, Dict[str, object]] = {}
    for code in sorted(set(before_overrides) | set(after_overrides)):
        before_val = before_overrides.get(code, None)
        after_val = after_overrides.get(code, None)
        if before_val != after_val:
            changes[code] = {"from": before_val, "to": after_val}

    log_audit(
        session,
        actor=current_user,
        action="users.permissions.update",
        target_type="user",
        target_id=str(user.id),
        meta={
            "username": user.username,
            "changes": changes,
            "effective_before": before_summary.get("effective", []),
            "effective_after": after_summary.get("effective", []),
        },
        ip=audit_ctx.ip,
        ua=audit_ctx.user_agent,
        corr=audit_ctx.correlation_id,
    )
    session.commit()

    return after_summary
