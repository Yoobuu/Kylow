from __future__ import annotations

import copy
import json
import logging
import threading
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Dict, Optional

from fastapi.encoders import jsonable_encoder

from .models import (
    HostJobState,
    HostJobStatus,
    JobProgress,
    JobStatus,
    ScopeName,
    ScopeKey,
    SnapshotHostStatus,
    SnapshotHostState,
    SnapshotPayload,
)

MAX_ITEMS = 128  # limite basico para evitar crecimiento infinito
MAX_AGE_MINUTES = 24 * 60  # 24h de retencion
logger = logging.getLogger(__name__)


@dataclass
class HostHealthRecord:
    consecutive_failures: int = 0
    cooldown_until: Optional[datetime] = None
    last_success_at: Optional[datetime] = None
    last_error_at: Optional[datetime] = None
    last_error_type: Optional[str] = None
    last_error_message: Optional[str] = None

    def copy(self) -> "HostHealthRecord":
        return copy.deepcopy(self)


class HostHealthStore:
    """
    Trackea salud por host: fallas consecutivas, cooldown y ultimos exito/error.
    """

    def __init__(self) -> None:
        self._lock = threading.RLock()
        self._records: Dict[str, HostHealthRecord] = {}

    def get(self, host: str) -> HostHealthRecord:
        with self._lock:
            rec = self._records.get(host)
            if rec is None:
                rec = HostHealthRecord()
                self._records[host] = rec
            return rec.copy()

    def _compute_cooldown(self, failures: int) -> timedelta:
        # 10m, 20m, 40m, cap 120m
        minutes = min(10 * (2 ** (failures - 1)), 120)
        return timedelta(minutes=minutes)

    def record_success(self, host: str, when: Optional[datetime] = None) -> HostHealthRecord:
        with self._lock:
            rec = self._records.get(host) or HostHealthRecord()
            ts = when or datetime.utcnow()
            rec.consecutive_failures = 0
            rec.cooldown_until = None
            rec.last_success_at = ts
            rec.last_error_type = None
            rec.last_error_message = None
            self._records[host] = rec
            return rec.copy()

    def record_failure(
        self,
        host: str,
        *,
        when: Optional[datetime] = None,
        error_type: Optional[str] = None,
        error_message: Optional[str] = None,
    ) -> HostHealthRecord:
        with self._lock:
            rec = self._records.get(host) or HostHealthRecord()
            ts = when or datetime.utcnow()
            rec.consecutive_failures += 1
            rec.last_error_at = ts
            rec.last_error_type = error_type
            rec.last_error_message = error_message
            cooldown = self._compute_cooldown(rec.consecutive_failures)
            rec.cooldown_until = ts + cooldown
            self._records[host] = rec
            return rec.copy()

    def set_cooldown(self, host: str, cooldown_until: Optional[datetime]) -> HostHealthRecord:
        with self._lock:
            rec = self._records.get(host) or HostHealthRecord()
            rec.cooldown_until = cooldown_until
            self._records[host] = rec
            return rec.copy()


class JobStore:
    """
    Guarda estados de jobs en memoria con dedupe por ScopeKey.
    Implementa eviccion basica por max items y edad.
    """

    def __init__(self) -> None:
        self._lock = threading.RLock()
        self._jobs: Dict[str, JobStatus] = {}
        self._scope_index: Dict[ScopeKey, str] = {}

    def _prune_locked(self) -> None:
        if len(self._jobs) <= MAX_ITEMS:
            return
        cutoff = datetime.utcnow() - timedelta(minutes=MAX_AGE_MINUTES)
        # eliminar los mas viejos o completados primero
        to_delete = []
        for job_id, job in self._jobs.items():
            if job.created_at < cutoff or job.status not in {"pending", "running"}:
                to_delete.append(job_id)
        for job_id in to_delete:
            self._jobs.pop(job_id, None)
        # limpiar indices obsoletos
        for scope_key, job_id in list(self._scope_index.items()):
            if job_id not in self._jobs:
                self._scope_index.pop(scope_key, None)

    def _recompute_progress(self, job: JobStatus) -> None:
        totals = JobProgress(total_hosts=len(job.hosts_status))
        for status in job.hosts_status.values():
            if status.state == HostJobState.OK:
                totals.done += 1
            elif status.state in {HostJobState.ERROR, HostJobState.TIMEOUT}:
                totals.error += 1
            elif status.state == HostJobState.SKIPPED_COOLDOWN:
                totals.skipped += 1
            elif status.state in {HostJobState.PENDING, HostJobState.RUNNING}:
                totals.pending += 1
        job.progress = totals

    def get(self, job_id: str) -> Optional[JobStatus]:
        with self._lock:
            job = self._jobs.get(job_id)
            if not job:
                return None
            self._recompute_progress(job)
            return job.copy()

    def get_active_for_scope(self, scope_key: ScopeKey) -> Optional[JobStatus]:
        with self._lock:
            job_id = self._scope_index.get(scope_key)
            if not job_id:
                return None
            job = self._jobs.get(job_id)
            if job is None:
                self._scope_index.pop(scope_key, None)
                return None
            if job.status in {"pending", "running"}:
                self._recompute_progress(job)
                return job.copy()
            self._scope_index.pop(scope_key, None)
            return None

    def create_job(self, scope_key: ScopeKey) -> JobStatus:
        with self._lock:
            self._prune_locked()
            job = JobStatus(
                scope=scope_key.scope,
                hosts=list(scope_key.hosts),
                level=scope_key.level,
            )
            job.hosts_status = {
                host: HostJobStatus(state=HostJobState.PENDING) for host in scope_key.hosts
            }
            self._recompute_progress(job)
            self._jobs[job.job_id] = job
            self._scope_index[scope_key] = job.job_id
            return job.copy()

    def set_job(self, job: JobStatus) -> JobStatus:
        with self._lock:
            self._jobs[job.job_id] = job
            self._recompute_progress(job)
            return job.copy()

    def update_job(self, job_id: str, mutator) -> Optional[JobStatus]:
        """
        mutator recibe el JobStatus y puede mutarlo in-place. Devuelve copia del resultado.
        """
        with self._lock:
            job = self._jobs.get(job_id)
            if job is None:
                return None
            mutator(job)
            self._recompute_progress(job)
            self._jobs[job_id] = job
            return job.copy()

    def list_jobs_by_status(self, statuses: set[str]) -> list[JobStatus]:
        with self._lock:
            results = [job.copy() for job in self._jobs.values() if job.status in statuses]
        for job in results:
            self._recompute_progress(job)
        return results

    def mark_scope_finished(self, scope_key: ScopeKey, job: JobStatus) -> None:
        with self._lock:
            stored = self._jobs.get(job.job_id)
            if stored and stored.status in {"pending", "running"}:
                self._jobs[job.job_id] = job
            if scope_key in self._scope_index and self._scope_index[scope_key] == job.job_id:
                self._scope_index.pop(scope_key, None)
            self._recompute_progress(job)


class SnapshotStore:
    """
    Guarda snapshots in-memory (no dispara VMware).
    Permite upsert por host para no perder data previa.
    """
    _PROVIDER = "vmware"

    def __init__(self) -> None:
        self._lock = threading.RLock()
        self._snapshots: Dict[ScopeKey, SnapshotPayload] = {}

    def _prune_locked(self) -> None:
        if len(self._snapshots) <= MAX_ITEMS:
            return
        cutoff = datetime.utcnow() - timedelta(minutes=MAX_AGE_MINUTES)
        for key, snap in list(self._snapshots.items()):
            if snap.generated_at < cutoff:
                self._snapshots.pop(key, None)

    def init_snapshot(self, scope_key: ScopeKey) -> SnapshotPayload:
        snap = SnapshotPayload(
            scope=scope_key.scope,
            hosts=list(scope_key.hosts),
            level=scope_key.level,
            total_hosts=len(scope_key.hosts),
            hosts_status={
                h: SnapshotHostStatus(state=SnapshotHostState.PENDING) for h in scope_key.hosts
            },
            data={} if scope_key.scope == ScopeName.VMS else [],
            summary={},
        )
        with self._lock:
            self._prune_locked()
            self._snapshots[scope_key] = snap
            result = snap.copy()
        self._persist_snapshot(
            self._PROVIDER,
            scope_key.scope,
            list(scope_key.hosts),
            scope_key.level,
            result,
        )
        return result

    def _scope_value(self, scope) -> str:
        return scope.value if hasattr(scope, "value") else str(scope)

    def _payload_to_json(self, payload) -> dict:
        if hasattr(payload, "model_dump"):
            return payload.model_dump(mode="json")
        if hasattr(payload, "json"):
            return json.loads(payload.json())
        return jsonable_encoder(payload)

    def _payload_to_snapshot(self, payload: dict) -> SnapshotPayload:
        if hasattr(SnapshotPayload, "model_validate"):
            return SnapshotPayload.model_validate(payload)
        return SnapshotPayload.parse_obj(payload)

    def _persist_snapshot(self, provider, scope, hosts, level, payload) -> None:
        scope_value = self._scope_value(scope)
        hosts_key = None
        session = None
        try:
            from app.db import get_engine
            from sqlmodel import Session
            from app.snapshots.service import upsert_snapshot, make_hosts_key

            payload_dict = self._payload_to_json(payload)
            hosts_key = make_hosts_key(list(hosts))
            session = Session(get_engine())
            upsert_snapshot(
                session,
                provider=provider,
                scope=scope_value,
                hosts_key=hosts_key,
                level=level,
                payload=payload_dict,
            )
            session.commit()
        except Exception as exc:
            if session is not None:
                try:
                    session.rollback()
                except Exception:
                    pass
            logger.exception(
                "Failed to persist VMware snapshot provider=%s scope=%s hosts_key=%s level=%s: %s",
                provider,
                scope_value,
                hosts_key,
                level,
                exc,
            )
        finally:
            if session is not None:
                session.close()

    def set_snapshot(self, scope_key: ScopeKey, snapshot: SnapshotPayload) -> SnapshotPayload:
        payload = snapshot.copy()
        payload.hosts = list(scope_key.hosts)
        with self._lock:
            self._prune_locked()
            self._snapshots[scope_key] = payload
            return payload.copy()

    def upsert_host(
        self,
        scope_key: ScopeKey,
        host: str,
        *,
        data,
        status: SnapshotHostStatus,
        generated_at: Optional[datetime] = None,
        summary: Optional[Dict[str, int]] = None,
        stale: Optional[bool] = None,
        stale_reason: Optional[str] = None,
    ) -> SnapshotPayload:
        with self._lock:
            self._prune_locked()
            snap = self._snapshots.get(scope_key)
            if snap is None:
                snap = SnapshotPayload(
                    scope=scope_key.scope,
                    hosts=list(scope_key.hosts),
                    level=scope_key.level,
                    total_hosts=len(scope_key.hosts),
                    hosts_status={
                        h: SnapshotHostStatus(state=SnapshotHostState.PENDING) for h in scope_key.hosts
                    },
                    data={} if scope_key.scope == ScopeName.VMS else [],
                    summary={},
                )
            snap.generated_at = generated_at or datetime.utcnow()
            if scope_key.scope == ScopeName.VMS:
                if not isinstance(snap.data, dict):
                    snap.data = {}
                snap.data[host] = data
            else:
                # para hosts scope, data es lista; reemplazamos/actualizamos el host en lista
                existing = snap.data if isinstance(snap.data, list) else []
                replaced = False
                for idx, item in enumerate(existing):
                    name = getattr(item, "host", None) or getattr(item, "name", None) or item.get("host") if isinstance(item, dict) else None
                    if name and name == host:
                        existing[idx] = data
                        replaced = True
                        break
                if not replaced:
                    existing.append(data)
                snap.data = existing
            snap.hosts_status[host] = status
            snap.total_hosts = len(scope_key.hosts)
            if summary is not None:
                snap.summary = summary
            if stale is not None:
                snap.stale = stale
            if stale_reason is not None:
                snap.stale_reason = stale_reason
            self._snapshots[scope_key] = snap
            result = snap.copy()
        self._persist_snapshot(
            self._PROVIDER,
            scope_key.scope,
            list(scope_key.hosts),
            scope_key.level,
            result,
        )
        return result

    def get_snapshot(self, scope_key: ScopeKey) -> Optional[SnapshotPayload]:
        with self._lock:
            snap = self._snapshots.get(scope_key)
            if snap:
                result = snap.copy()
                result.source = "memory"
                return result

        scope_value = self._scope_value(scope_key.scope)
        hosts_key = None
        try:
            from app.db import get_engine
            from sqlmodel import Session
            from app.snapshots.service import get_snapshot as get_snapshot_db, make_hosts_key

            hosts_key = make_hosts_key(list(scope_key.hosts))
            with Session(get_engine()) as session:
                payload = get_snapshot_db(
                    session,
                    provider=self._PROVIDER,
                    scope=scope_value,
                    hosts_key=hosts_key,
                    level=scope_key.level,
                )
            if payload is None:
                return None
            snapshot = self._payload_to_snapshot(payload)
            with self._lock:
                self._prune_locked()
                self._snapshots[scope_key] = snapshot
                result = snapshot.copy()
                result.source = "db"
                return result
        except Exception as exc:
            logger.exception(
                "Failed to load VMware snapshot from DB provider=%s scope=%s hosts_key=%s level=%s: %s",
                self._PROVIDER,
                scope_value,
                hosts_key,
                scope_key.level,
                exc,
            )
            return None
