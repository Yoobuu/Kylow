from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional, Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, conint
from sqlmodel import Session

from app.audit.service import log_audit
from app.auth.user_model import User
from app.db import get_engine
from app.dependencies import AuditRequestContext, get_request_audit_context, require_permission
from app.permissions.models import PermissionCode
from app.settings import settings
from app.system_settings.models import SystemSettings
from app.system_settings.service import (
    SYSTEM_SETTINGS_FIELDS,
    extract_overrides,
    load_or_create_system_settings,
)

router = APIRouter(prefix="/api/admin/system", tags=["system"])


class SystemSettingsPayload(BaseModel):
    warmup_enabled: bool
    notif_sched_enabled: bool
    hyperv_enabled: bool
    vmware_enabled: bool
    ovirt_enabled: bool
    cedia_enabled: bool
    azure_enabled: bool
    hyperv_refresh_interval_minutes: conint(ge=10, le=4320)  # type: ignore[valid-type]
    vmware_refresh_interval_minutes: conint(ge=10, le=4320)  # type: ignore[valid-type]
    vmware_hosts_refresh_interval_minutes: conint(ge=10, le=4320)  # type: ignore[valid-type]
    ovirt_refresh_interval_minutes: conint(ge=10, le=4320)  # type: ignore[valid-type]
    ovirt_hosts_refresh_interval_minutes: conint(ge=10, le=4320)  # type: ignore[valid-type]
    ovirt_host_vm_count_mode: Literal["runtime", "cluster"]
    cedia_refresh_interval_minutes: conint(ge=10, le=4320)  # type: ignore[valid-type]
    azure_refresh_interval_minutes: conint(ge=10, le=4320)  # type: ignore[valid-type]


class SystemSettingsUpdate(BaseModel):
    warmup_enabled: Optional[bool] = None
    notif_sched_enabled: Optional[bool] = None
    hyperv_enabled: Optional[bool] = None
    vmware_enabled: Optional[bool] = None
    ovirt_enabled: Optional[bool] = None
    cedia_enabled: Optional[bool] = None
    azure_enabled: Optional[bool] = None
    hyperv_refresh_interval_minutes: Optional[conint(ge=10, le=4320)] = None  # type: ignore[valid-type]
    vmware_refresh_interval_minutes: Optional[conint(ge=10, le=4320)] = None  # type: ignore[valid-type]
    vmware_hosts_refresh_interval_minutes: Optional[conint(ge=10, le=4320)] = None  # type: ignore[valid-type]
    ovirt_refresh_interval_minutes: Optional[conint(ge=10, le=4320)] = None  # type: ignore[valid-type]
    ovirt_hosts_refresh_interval_minutes: Optional[conint(ge=10, le=4320)] = None  # type: ignore[valid-type]
    ovirt_host_vm_count_mode: Optional[Literal["runtime", "cluster"]] = None
    cedia_refresh_interval_minutes: Optional[conint(ge=10, le=4320)] = None  # type: ignore[valid-type]
    azure_refresh_interval_minutes: Optional[conint(ge=10, le=4320)] = None  # type: ignore[valid-type]


class SystemSettingsResponse(BaseModel):
    settings: SystemSettingsPayload
    requires_restart: bool


def _effective_settings(row: Optional[SystemSettings]) -> SystemSettingsPayload:
    overrides = extract_overrides(row)
    return SystemSettingsPayload(
        warmup_enabled=overrides.get("warmup_enabled", settings.warmup_enabled),
        notif_sched_enabled=overrides.get("notif_sched_enabled", settings.notif_sched_enabled),
        hyperv_enabled=overrides.get("hyperv_enabled", settings.hyperv_enabled),
        vmware_enabled=overrides.get("vmware_enabled", settings.vmware_enabled),
        ovirt_enabled=overrides.get("ovirt_enabled", settings.ovirt_enabled),
        cedia_enabled=overrides.get("cedia_enabled", settings.cedia_enabled),
        azure_enabled=overrides.get("azure_enabled", settings.azure_enabled),
        hyperv_refresh_interval_minutes=int(
            overrides.get("hyperv_refresh_interval_minutes", settings.hyperv_refresh_interval_minutes)
        ),
        vmware_refresh_interval_minutes=int(
            overrides.get("vmware_refresh_interval_minutes", settings.vmware_refresh_interval_minutes)
        ),
        vmware_hosts_refresh_interval_minutes=int(
            overrides.get(
                "vmware_hosts_refresh_interval_minutes",
                settings.vmware_hosts_refresh_interval_minutes,
            )
        ),
        ovirt_refresh_interval_minutes=int(
            overrides.get("ovirt_refresh_interval_minutes", settings.ovirt_refresh_interval_minutes)
        ),
        ovirt_hosts_refresh_interval_minutes=int(
            overrides.get("ovirt_hosts_refresh_interval_minutes", settings.ovirt_hosts_refresh_interval_minutes)
        ),
        ovirt_host_vm_count_mode=str(
            overrides.get("ovirt_host_vm_count_mode", settings.ovirt_host_vm_count_mode)
        ),
        cedia_refresh_interval_minutes=int(
            overrides.get("cedia_refresh_interval_minutes", settings.cedia_refresh_interval_minutes)
        ),
        azure_refresh_interval_minutes=int(
            overrides.get("azure_refresh_interval_minutes", settings.azure_refresh_interval_minutes)
        ),
    )


def _system_settings_defaults() -> dict[str, object]:
    defaults: dict[str, object] = {}
    for field in SYSTEM_SETTINGS_FIELDS:
        if hasattr(settings, field):
            defaults[field] = getattr(settings, field)
    return defaults


@router.get("/settings", response_model=SystemSettingsResponse)
def get_system_settings(
    _user: User = Depends(require_permission(PermissionCode.SYSTEM_SETTINGS_VIEW)),
):
    with Session(get_engine()) as session:
        row = load_or_create_system_settings(session, defaults=_system_settings_defaults())
    return {"settings": _effective_settings(row), "requires_restart": False}


@router.put("/settings")
def update_system_settings(
    payload: SystemSettingsUpdate,
    current_user: User = Depends(require_permission(PermissionCode.SYSTEM_SETTINGS_EDIT)),
    ctx: AuditRequestContext = Depends(get_request_audit_context),
):
    if hasattr(payload, "model_dump"):
        updates = payload.model_dump(exclude_unset=True)
    else:
        updates = payload.dict(exclude_unset=True)
    if not updates:
        raise HTTPException(status_code=400, detail="No settings provided")

    with Session(get_engine()) as session:
        row = load_or_create_system_settings(session, defaults=_system_settings_defaults())

        changes = {}
        for field, value in updates.items():
            previous = getattr(row, field, None)
            if previous != value:
                changes[field] = {"from": previous, "to": value}
                setattr(row, field, value)

        row.updated_at = datetime.now(timezone.utc)
        row.updated_by_user_id = current_user.id
        session.add(row)

        if changes:
            log_audit(
                session,
                actor=current_user,
                action="system.settings.update",
                target_type="system",
                target_id="settings",
                meta={"changes": changes},
                ip=ctx.ip,
                ua=ctx.user_agent,
                corr=ctx.correlation_id,
            )
        session.commit()

        return {
            "saved": True,
            "requires_restart": True,
            "settings": _effective_settings(row),
        }
