from __future__ import annotations

from typing import Dict, List, Set

from sqlmodel import Session, select

from app.auth.user_model import User
from app.permissions.models import Permission, PermissionCode, UserPermission

PERMISSION_DEFINITIONS: Dict[PermissionCode, Dict[str, str]] = {
    PermissionCode.NOTIFICATIONS_VIEW: {"name": "Ver notificaciones", "category": "notifications"},
    PermissionCode.NOTIFICATIONS_ACK: {"name": "Reconocer notificaciones", "category": "notifications"},
    PermissionCode.NOTIFICATIONS_CLEAR: {"name": "Limpiar notificaciones resueltas", "category": "notifications"},
    PermissionCode.AUDIT_VIEW: {"name": "Ver auditoría", "category": "audit"},
    PermissionCode.USERS_MANAGE: {"name": "Administrar usuarios", "category": "users"},
    PermissionCode.VMS_VIEW: {"name": "Ver inventario VMware", "category": "vmware"},
    PermissionCode.VMS_POWER: {"name": "Operar energía VMware", "category": "vmware"},
    PermissionCode.HYPERV_VIEW: {"name": "Ver inventario Hyper-V", "category": "hyperv"},
    PermissionCode.HYPERV_POWER: {"name": "Operar energía Hyper-V", "category": "hyperv"},
    PermissionCode.JOBS_TRIGGER: {"name": "Ejecutar jobs", "category": "jobs"},
    PermissionCode.CEDIA_VIEW: {"name": "Ver inventario CEDIA", "category": "cedia"},
    PermissionCode.AZURE_VIEW: {"name": "Ver inventario Azure", "category": "azure"},
    PermissionCode.SYSTEM_RESTART: {"name": "Reiniciar backend", "category": "system"},
    PermissionCode.SYSTEM_SETTINGS_VIEW: {"name": "Ver configuración del sistema", "category": "system"},
    PermissionCode.SYSTEM_SETTINGS_EDIT: {"name": "Editar configuración del sistema", "category": "system"},
}


def ensure_default_permissions(session: Session) -> None:
    """Seed the permission catalog idempotently."""

    rows = session.exec(select(Permission.code)).all()
    existing_codes = {row[0] if isinstance(row, tuple) else row for row in rows}
    for code, meta in PERMISSION_DEFINITIONS.items():
        if code.value not in existing_codes:
            session.add(
                Permission(
                    code=code.value,
                    name=meta["name"],
                    category=meta["category"],
                )
            )
    session.commit()

    session.commit()


def _collect_user_overrides(session: Session, user_id: int) -> Dict[str, bool]:
    rows = session.exec(
        select(UserPermission.permission_code, UserPermission.granted).where(UserPermission.user_id == user_id)
    ).all()
    return {code: granted for code, granted in rows}


def user_effective_permissions(user: User, session: Session) -> Set[str]:
    """
    Compute effective permissions for a user based solely on user_permissions.
    """
    overrides = _collect_user_overrides(session, user.id)
    return {code for code, granted in overrides.items() if granted}


def user_has_permission(user: User, permission: PermissionCode, session: Session) -> bool:
    effective = user_effective_permissions(user, session)
    return permission.value in effective


def list_permission_catalog(session: Session) -> List[Permission]:
    """Return all permissions available in the system."""
    return session.exec(select(Permission)).all()


def list_permission_codes(session: Session) -> Set[str]:
    """Return the set of all permission codes in the catalog."""
    rows = session.exec(select(Permission.code)).all()
    return {row[0] if isinstance(row, tuple) else row for row in rows}


def set_user_permission_overrides(
    user_id: int,
    overrides: Dict[str, bool],
    session: Session,
) -> None:
    """
    Replace the user's overrides with the provided mapping code->granted.
    """
    current = {
        row.permission_code: row
        for row in session.exec(
            select(UserPermission).where(UserPermission.user_id == user_id)
        ).all()
    }

    incoming_codes = set(overrides.keys())

    for code, granted in overrides.items():
        if code in current:
            row = current[code]
            row.granted = granted
            session.add(row)
        else:
            session.add(
                UserPermission(
                    user_id=user_id,
                    permission_code=code,
                    granted=granted,
                )
            )

    for code in set(current) - incoming_codes:
        session.delete(current[code])

    session.commit()


def get_user_permissions_summary(user: User, session: Session) -> Dict[str, object]:
    """Return breakdown of per-user overrides and effective permissions for a user."""
    overrides_map = _collect_user_overrides(session, user.id)
    effective = user_effective_permissions(user, session)

    return {
        "user_id": user.id,
        "overrides": [{"code": code, "granted": granted} for code, granted in overrides_map.items()],
        "effective": sorted(effective),
    }


def user_has_all_permissions(user: User, session: Session, all_codes: Set[str] | None = None) -> bool:
    """Return True if the user has all permissions in the catalog."""
    codes = all_codes or list_permission_codes(session)
    if not codes:
        return False
    effective = user_effective_permissions(user, session)
    return codes.issubset(effective)


def count_users_with_all_permissions(session: Session, all_codes: Set[str] | None = None) -> int:
    """Count users that currently have all catalog permissions."""
    codes = all_codes or list_permission_codes(session)
    if not codes:
        return 0
    users = session.exec(select(User)).all()
    return sum(1 for user in users if user_has_all_permissions(user, session, codes))
