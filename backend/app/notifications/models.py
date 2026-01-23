from __future__ import annotations

from datetime import datetime, timezone
from enum import Enum
from typing import Any, Dict, List, Optional

from sqlalchemy import Column, Index, JSON, desc
from sqlmodel import Field, SQLModel


def utcnow() -> datetime:
    """Return current UTC time with timezone info."""
    return datetime.now(timezone.utc)


class NotificationProvider(str, Enum):
    CEDIA = "cedia"
    HYPERV = "hyperv"
    OVIRT = "ovirt"
    VMWARE = "vmware"


class NotificationMetric(str, Enum):
    CPU = "cpu"
    RAM = "ram"
    DISK = "disk"


class NotificationStatus(str, Enum):
    OPEN = "open"
    ACK = "ack"
    CLEARED = "cleared"


DiskSample = Dict[str, Any]


class Notification(SQLModel, table=True):
    """Alert raised when VM metrics exceed configured thresholds."""

    __tablename__ = "notifications"
    __table_args__ = (
        Index("ix_notifications_status_at_desc", "status", desc("at")),
        Index("ix_notifications_provider_vm_name", "provider", "vm_name"),
        Index("ix_notifications_provider_metric_at", "provider", "metric", "at"),
    )

    id: Optional[int] = Field(default=None, primary_key=True)

    provider: NotificationProvider = Field(nullable=False)
    vm_id: Optional[str] = Field(default=None, max_length=128)
    vm_name: str = Field(max_length=255, nullable=False, index=True)

    metric: NotificationMetric = Field(nullable=False)
    value_pct: float = Field(nullable=False)
    threshold_pct: float = Field(default=85.0, nullable=False)

    disks_json: Optional[List[DiskSample]] = Field(
        default=None,
        sa_column=Column(JSON(none_as_null=True), nullable=True),
    )

    env: Optional[str] = Field(default=None, max_length=64, index=True)
    at: datetime = Field(nullable=False)

    status: NotificationStatus = Field(default=NotificationStatus.OPEN, nullable=False)
    ack_by: Optional[str] = Field(default=None, max_length=128)
    ack_at: Optional[datetime] = Field(default=None)
    cleared_at: Optional[datetime] = Field(default=None)
    archived: bool = Field(default=False, nullable=False)

    dedupe_key: str = Field(
        max_length=255,
        nullable=False,
        unique=True,
        index=True,
    )
    correlation_id: Optional[str] = Field(default=None, max_length=64)

    created_at: datetime = Field(default_factory=utcnow, nullable=False)
