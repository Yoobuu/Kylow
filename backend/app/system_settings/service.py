from __future__ import annotations

from typing import Dict, Iterable, Optional

from sqlmodel import Session, select

from app.system_settings.models import SystemSettings

SYSTEM_SETTINGS_FIELDS: Iterable[str] = (
    "warmup_enabled",
    "notif_sched_enabled",
    "hyperv_enabled",
    "vmware_enabled",
    "ovirt_enabled",
    "cedia_enabled",
    "azure_enabled",
    "hyperv_refresh_interval_minutes",
    "hyperv_winrm_https_enabled",
    "hyperv_winrm_http_enabled",
    "vmware_refresh_interval_minutes",
    "vmware_hosts_refresh_interval_minutes",
    "ovirt_refresh_interval_minutes",
    "ovirt_hosts_refresh_interval_minutes",
    "ovirt_host_vm_count_mode",
    "cedia_refresh_interval_minutes",
    "azure_refresh_interval_minutes",
)


def load_system_settings(session: Session) -> Optional[SystemSettings]:
    return session.exec(select(SystemSettings).order_by(SystemSettings.id)).first()


def load_or_create_system_settings(
    session: Session,
    *,
    defaults: Dict[str, object],
) -> SystemSettings:
    row = load_system_settings(session)
    if row is not None:
        return row
    row = SystemSettings()
    for field in SYSTEM_SETTINGS_FIELDS:
        if field in defaults:
            setattr(row, field, defaults[field])
    session.add(row)
    session.commit()
    session.refresh(row)
    return row


def extract_overrides(row: Optional[SystemSettings]) -> Dict[str, object]:
    if row is None:
        return {}
    overrides: Dict[str, object] = {}
    for field in SYSTEM_SETTINGS_FIELDS:
        value = getattr(row, field, None)
        if value is not None:
            overrides[field] = value
    return overrides
