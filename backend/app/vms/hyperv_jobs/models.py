from __future__ import annotations

import copy
import uuid
from dataclasses import dataclass
from datetime import datetime
from enum import Enum
from typing import Dict, List, Optional, Tuple

from pydantic import BaseModel, Field


class ScopeName(str, Enum):
    VMS = "vms"
    HOSTS = "hosts"


def _normalize_hosts(hosts: List[str]) -> Tuple[str, ...]:
    # normaliza trim + lower y deduplica ordenando alfabeticamente para que sea determinista
    normalized = { (h or "").strip().lower() for h in hosts if (h or "").strip() }
    return tuple(sorted(normalized))


@dataclass(frozen=True)
class ScopeKey:
    scope: ScopeName
    hosts: Tuple[str, ...]
    level: str = "summary"

    @classmethod
    def from_parts(cls, scope: ScopeName, hosts: List[str], level: str = "summary") -> "ScopeKey":
        return cls(scope=scope, hosts=_normalize_hosts(hosts), level=level.lower() or "summary")


class HostJobState(str, Enum):
    PENDING = "pending"
    RUNNING = "running"
    OK = "ok"
    ERROR = "error"
    TIMEOUT = "timeout_host"
    SKIPPED_COOLDOWN = "skipped_cooldown"


class SnapshotHostState(str, Enum):
    OK = "ok"
    ERROR = "error"
    TIMEOUT = "timeout_host"
    PENDING = "pending"
    SKIPPED_COOLDOWN = "skipped_cooldown"
    STALE = "stale_snapshot"


class HostJobStatus(BaseModel):
    state: HostJobState = HostJobState.PENDING
    attempt: int = 0
    last_started_at: Optional[datetime] = None
    last_finished_at: Optional[datetime] = None
    last_error: Optional[str] = None
    cooldown_until: Optional[datetime] = None

    def copy(self) -> "HostJobStatus":
        return copy.deepcopy(self)


class SnapshotHostStatus(BaseModel):
    state: SnapshotHostState
    last_success_at: Optional[datetime] = None
    last_error_at: Optional[datetime] = None
    cooldown_until: Optional[datetime] = None
    last_job_id: Optional[str] = None
    last_error_type: Optional[str] = None
    last_error_message: Optional[str] = None

    def copy(self) -> "SnapshotHostStatus":
        return copy.deepcopy(self)


class JobProgress(BaseModel):
    total_hosts: int = 0
    done: int = 0
    error: int = 0
    pending: int = 0
    skipped: int = 0

    def copy(self) -> "JobProgress":
        return copy.deepcopy(self)


class JobStatus(BaseModel):
    job_id: str = Field(default_factory=lambda: uuid.uuid4().hex)
    scope: ScopeName
    hosts: List[str]
    level: str = "summary"
    status: str = "pending"
    created_at: datetime = Field(default_factory=datetime.utcnow)
    started_at: Optional[datetime] = None
    finished_at: Optional[datetime] = None
    last_heartbeat_at: Optional[datetime] = None
    cooldown_until: Optional[datetime] = None
    progress: JobProgress = Field(default_factory=JobProgress)
    hosts_status: Dict[str, HostJobStatus] = Field(default_factory=dict)
    snapshot_key: Optional[str] = None
    message: Optional[str] = None

    def copy(self) -> "JobStatus":
        return copy.deepcopy(self)


class SnapshotPayload(BaseModel):
    scope: ScopeName
    hosts: List[str]
    level: str = "summary"
    generated_at: datetime = Field(default_factory=datetime.utcnow)
    source: Optional[str] = None
    expires_at: Optional[datetime] = None
    stale: bool = False
    stale_reason: Optional[str] = None
    total_hosts: int = 0
    hosts_status: Dict[str, SnapshotHostStatus] = Field(default_factory=dict)
    summary: Dict[str, int] = Field(default_factory=dict)
    data: object = None  # Sera dict host -> lista VM o lista de hosts

    def copy(self) -> "SnapshotPayload":
        return copy.deepcopy(self)
