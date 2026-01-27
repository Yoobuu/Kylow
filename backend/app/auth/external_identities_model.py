from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional
from uuid import uuid4

from sqlalchemy import UniqueConstraint
from sqlmodel import Field, SQLModel


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class ExternalIdentity(SQLModel, table=True):
    __tablename__ = "external_identities"
    __table_args__ = (
        UniqueConstraint(
            "provider",
            "tenant_id",
            "external_oid",
            name="uq_external_identities_provider_tenant_oid",
        ),
    )

    id: str = Field(default_factory=lambda: str(uuid4()), primary_key=True)
    provider: str = Field(default="microsoft", max_length=32, index=True)
    tenant_id: str = Field(max_length=64, index=True)
    external_oid: str = Field(max_length=128, index=True)
    email: Optional[str] = Field(default=None, max_length=320, index=True)
    user_id: Optional[int] = Field(default=None, foreign_key="user.id", index=True)
    status: str = Field(default="pending", max_length=16, index=True)
    created_at: datetime = Field(default_factory=utcnow, nullable=False)
    updated_at: datetime = Field(default_factory=utcnow, nullable=False)

