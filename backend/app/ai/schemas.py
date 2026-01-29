from __future__ import annotations

from datetime import datetime
from typing import Dict, List, Optional

from pydantic import BaseModel, Field, field_validator


class AiChatRequest(BaseModel):
    conversation_id: Optional[str] = None
    message: str
    ui_context: Optional[Dict[str, object]] = None


class AiChatResponse(BaseModel):
    conversation_id: str
    answer_text: str
    entities: List[Dict[str, object]]
    actions: List[Dict[str, object]]
    meta: Optional[Dict[str, object]] = None


class AIVm(BaseModel):
    provider: str
    env: str
    id: str
    name: str
    power_state: Optional[str] = None
    cpu_count: Optional[int] = None
    cpu_usage_pct: Optional[float] = None
    memory_size_MiB: Optional[int] = None
    ram_usage_pct: Optional[float] = None
    ram_demand_mib: Optional[int] = None
    guest_os: Optional[str] = None
    host: Optional[str] = None
    cluster: Optional[str] = None
    networks: List[str] = Field(default_factory=list)
    ip_addresses: List[str] = Field(default_factory=list)
    vlans: List[int] = Field(default_factory=list)
    raw_refs: Optional[Dict[str, object]] = None


class AIHost(BaseModel):
    provider: str
    env: str
    id: str
    name: str
    state: Optional[str] = None


class AINotification(BaseModel):
    id: int
    provider: Optional[str] = None
    env: Optional[str] = None
    severity: Optional[str] = None
    status: Optional[str] = None
    metric: Optional[str] = None
    resource_type: Optional[str] = None
    resource_id: Optional[str] = None
    message: str
    timestamp: Optional[datetime] = None


class VmFilters(BaseModel):
    provider: Optional[List[str]] = None
    env: Optional[List[str]] = None
    name_contains: Optional[str] = None
    power_state: Optional[str] = None
    ram_min_mib: Optional[int] = Field(default=None, ge=0)
    ram_max_mib: Optional[int] = Field(default=None, ge=0)
    cpu_min: Optional[int] = Field(default=None, ge=0)
    cpu_max: Optional[int] = Field(default=None, ge=0)
    vlan_id: Optional[int] = Field(default=None, ge=0)
    host_contains: Optional[str] = None
    cluster_contains: Optional[str] = None
    ip_contains: Optional[str] = None
    limit: int = 20
    sort: Optional[str] = None

    @field_validator("limit")
    @classmethod
    def _cap_limit(cls, value: int) -> int:
        if value < 1:
            return 1
        if value > 50:
            return 50
        return value


class HostFilters(BaseModel):
    provider: Optional[List[str]] = None
    env: Optional[List[str]] = None
    name_contains: Optional[str] = None
    state: Optional[str] = None
    cluster_contains: Optional[str] = None
    limit: int = 20
    sort: Optional[str] = None

    @field_validator("limit")
    @classmethod
    def _cap_limit(cls, value: int) -> int:
        if value < 1:
            return 1
        if value > 50:
            return 50
        return value


class NotificationFilters(BaseModel):
    provider: Optional[List[str]] = None
    env: Optional[List[str]] = None
    severity: Optional[str] = None
    status: Optional[str] = None
    metric: Optional[str] = None
    resource_type: Optional[str] = None
    limit: int = 20
    sort: Optional[str] = None

    @field_validator("limit")
    @classmethod
    def _cap_limit(cls, value: int) -> int:
        if value < 1:
            return 1
        if value > 50:
            return 50
        return value
