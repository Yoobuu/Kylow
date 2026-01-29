from __future__ import annotations

from enum import Enum
from typing import Optional

from sqlmodel import Field, SQLModel


class PermissionCode(str, Enum):
    NOTIFICATIONS_VIEW = "notifications.view"
    NOTIFICATIONS_ACK = "notifications.ack"
    NOTIFICATIONS_CLEAR = "notifications.clear"
    AUDIT_VIEW = "audit.view"
    USERS_MANAGE = "users.manage"
    VMS_VIEW = "vms.view"
    VMS_POWER = "vms.power"
    HYPERV_VIEW = "hyperv.view"
    HYPERV_POWER = "hyperv.power"
    JOBS_TRIGGER = "jobs.trigger"
    CEDIA_VIEW = "cedia.view"
    AZURE_VIEW = "azure.view"
    SYSTEM_RESTART = "system.restart"
    SYSTEM_SETTINGS_VIEW = "system.settings.view"
    SYSTEM_SETTINGS_EDIT = "system.settings.edit"
    AI_CHAT = "ai.chat"


class Permission(SQLModel, table=True):
    """Catalog of atomic permissions."""

    __tablename__ = "permissions"

    code: str = Field(primary_key=True, index=True, max_length=64)
    name: str = Field(max_length=128)
    category: str = Field(max_length=64)
    description: Optional[str] = Field(default=None, max_length=256)


class UserPermission(SQLModel, table=True):
    """Per-user permission overrides (granted=True / False)."""

    __tablename__ = "user_permissions"

    user_id: int = Field(primary_key=True, foreign_key="user.id")
    permission_code: str = Field(primary_key=True, foreign_key="permissions.code", max_length=64)
    granted: bool = Field(default=True, nullable=False)
