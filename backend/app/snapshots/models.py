from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import Column, JSON, UniqueConstraint
from sqlmodel import Field, SQLModel


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class SnapshotRecord(SQLModel, table=True):
    __tablename__ = "snapshots"
    __table_args__ = (
        UniqueConstraint("provider", "scope", "hosts_key", "level", name="uq_snapshots_provider_scope_hosts_level"),
    )

    id: Optional[int] = Field(default=None, primary_key=True)
    provider: str = Field(index=True)
    scope: str = Field(index=True)
    hosts_key: str = Field(index=True)
    level: str = Field(index=True)
    payload: dict = Field(sa_column=Column(JSON(none_as_null=True), nullable=False))
    created_at: datetime = Field(default_factory=utcnow, nullable=False)
    updated_at: datetime = Field(default_factory=utcnow, nullable=False)
