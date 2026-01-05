from __future__ import annotations

from typing import Dict, Iterable, Optional

from sqlmodel import Session, select

from app.system_settings.models import SystemSettings

SYSTEM_SETTINGS_FIELDS: Iterable[str] = (
    "warmup_enabled",
    "notif_sched_enabled",
    "hyperv_enabled",
    "vmware_enabled",
    "cedia_enabled",
    "hyperv_refresh_interval_minutes",
    "vmware_refresh_interval_minutes",
    "vmware_hosts_refresh_interval_minutes",
    "cedia_refresh_interval_minutes",
)


def load_system_settings(session: Session) -> Optional[SystemSettings]:
    return session.exec(select(SystemSettings).order_by(SystemSettings.id)).first()


def extract_overrides(row: Optional[SystemSettings]) -> Dict[str, object]:
    if row is None:
        return {}
    overrides: Dict[str, object] = {}
    for field in SYSTEM_SETTINGS_FIELDS:
        value = getattr(row, field, None)
        if value is not None:
            overrides[field] = value
    return overrides
