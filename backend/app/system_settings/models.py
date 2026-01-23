from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional

from sqlmodel import Field, SQLModel


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class SystemSettings(SQLModel, table=True):
    __tablename__ = "system_settings"

    id: Optional[int] = Field(default=None, primary_key=True)
    warmup_enabled: Optional[bool] = Field(default=None)
    notif_sched_enabled: Optional[bool] = Field(default=None)

    hyperv_enabled: Optional[bool] = Field(default=None)
    vmware_enabled: Optional[bool] = Field(default=None)
    ovirt_enabled: Optional[bool] = Field(default=None)
    cedia_enabled: Optional[bool] = Field(default=None)
    azure_enabled: Optional[bool] = Field(default=None)

    hyperv_refresh_interval_minutes: Optional[int] = Field(default=None)
    vmware_refresh_interval_minutes: Optional[int] = Field(default=None)
    vmware_hosts_refresh_interval_minutes: Optional[int] = Field(default=None)
    ovirt_refresh_interval_minutes: Optional[int] = Field(default=None)
    ovirt_hosts_refresh_interval_minutes: Optional[int] = Field(default=None)
    ovirt_host_vm_count_mode: Optional[str] = Field(default=None)
    cedia_refresh_interval_minutes: Optional[int] = Field(default=None)
    azure_refresh_interval_minutes: Optional[int] = Field(default=None)

    updated_at: datetime = Field(default_factory=utcnow, nullable=False)
    updated_by_user_id: Optional[int] = Field(default=None, index=True)
