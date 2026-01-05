from __future__ import annotations

import logging
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta
from typing import Dict

from fastapi import APIRouter, Depends, HTTPException, Response, Request
from sqlmodel import Session
from pydantic import BaseModel

from app.auth.user_model import User
from app.dependencies import require_permission, get_current_user
from app.db import get_session
from app.permissions.models import PermissionCode
from app.hosts import host_service
from app.vms import vm_service
from app.settings import settings
from app.hosts.vmware_host_jobs import (
    HostHealthStore,
    HostJobState,
    HostJobStatus,
    JobStatus,
    JobStore,
    ScopeKey,
    ScopeName,
    SnapshotHostStatus,
    SnapshotHostState,
    SnapshotStore,
)

router = APIRouter(prefix="/api/vmware/hosts", tags=["vmware-hosts"])
logger = logging.getLogger(__name__)

VMWARE_HOST_KEY = "vmware"

_JOB_STORE = JobStore()
_SNAPSHOT_STORE = SnapshotStore()
_HEALTH_STORE = HostHealthStore()
_GLOBAL_HOST_LOCKS: Dict[str, threading.RLock] = {}
_GLOBAL_LOCKS_LOCK = threading.RLock()
_GLOBAL_CONCURRENCY = threading.Semaphore(settings.vmware_job_max_global)
MAX_CONCURRENCY_PER_SCOPE = settings.vmware_job_max_per_scope
HOST_TIMEOUT_SECONDS = settings.vmware_hosts_job_host_timeout
JOB_MAX_DURATION_SECONDS = settings.vmware_hosts_job_max_duration
REFRESH_INTERVAL_MINUTES = settings.vmware_hosts_refresh_interval_minutes
_SCHEDULER_CV = threading.Condition()
_SCHEDULER_STARTED = False
_SCHEDULER_STOP = False
_WARMUP_STARTED = False
_WARMUP_STOP = False

_REQUIRE_SUPERADMIN = require_permission(PermissionCode.JOBS_TRIGGER)


class RefreshRequest(BaseModel):
    force: bool = False


def _get_host_lock(host: str) -> threading.RLock:
    h = host.lower()
    with _GLOBAL_LOCKS_LOCK:
        lock = _GLOBAL_HOST_LOCKS.get(h)
        if lock is None:
            lock = threading.RLock()
            _GLOBAL_HOST_LOCKS[h] = lock
        return lock


def _kick_scheduler() -> None:
    global _SCHEDULER_STARTED
    with _SCHEDULER_CV:
        if not _SCHEDULER_STARTED:
            t = threading.Thread(
                target=_scheduler_loop, name="vmware-host-job-scheduler", daemon=True
            )
            t.start()
            _SCHEDULER_STARTED = True
        _SCHEDULER_CV.notify_all()


def _kick_warmup() -> None:
    global _WARMUP_STARTED
    if _WARMUP_STARTED:
        return
    t = threading.Thread(target=_warmup_loop, name="vmware-host-warmup", daemon=True)
    t.start()
    _WARMUP_STARTED = True
    logger.info("VMware hosts warmup thread started")


def _scope_key() -> ScopeKey:
    return ScopeKey.from_parts(ScopeName.HOSTS, [VMWARE_HOST_KEY], "summary")


def _get_existing_host_data(scope_key: ScopeKey, host: str):
    snap = _SNAPSHOT_STORE.get_snapshot(scope_key)
    if not snap:
        return None
    if isinstance(snap.data, dict):
        return snap.data.get(host)
    if isinstance(snap.data, list):
        for item in snap.data:
            name = getattr(item, "host", None) or getattr(item, "name", None)
            if name and str(name).lower() == host.lower():
                return item
            if isinstance(item, dict):
                n = item.get("host") or item.get("name")
                if n and str(n).lower() == host.lower():
                    return item
    return None


def _job_deadline(start: datetime) -> datetime:
    return start + timedelta(seconds=JOB_MAX_DURATION_SECONDS)


@router.get("/snapshot")
def get_vmware_hosts_snapshot():
    if not settings.vmware_enabled or not settings.vmware_configured:
        return Response(status_code=204)
    scope_key = _scope_key()
    snap = _SNAPSHOT_STORE.get_snapshot(scope_key)
    if snap is None:
        return Response(status_code=204)
    return snap


@router.get("/jobs/{job_id}")
def get_vmware_hosts_job(
    job_id: str,
    _user: User = Depends(require_permission(PermissionCode.VMS_VIEW)),
):
    job = _JOB_STORE.get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job no encontrado")
    return job


@router.post("/refresh")
def trigger_vmware_hosts_refresh(
    payload: RefreshRequest,
    request: Request,
    session: Session = Depends(get_session),
):
    if not settings.vmware_enabled:
        raise HTTPException(status_code=409, detail="Provider disabled")
    if not settings.vmware_configured:
        raise HTTPException(
            status_code=409,
            detail={"detail": "Provider not configured", "missing": settings.vmware_missing_envs},
        )
    auth_header = request.headers.get("Authorization")
    if not auth_header:
        raise HTTPException(status_code=401, detail="Not authenticated")
    scheme, _, token = auth_header.partition(" ")
    if scheme.lower() != "bearer" or not token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    current_user = get_current_user(token=token, session=session)
    _REQUIRE_SUPERADMIN(current_user=current_user, session=session)
    scope_key = _scope_key()

    # dedupe: si hay job activo, devolverlo
    active = _JOB_STORE.get_active_for_scope(scope_key)
    if active:
        return active

    now = datetime.utcnow()
    snapshot = _SNAPSHOT_STORE.get_snapshot(scope_key)
    if not payload.force and snapshot:
        delta = now - snapshot.generated_at
        if delta < timedelta(minutes=REFRESH_INTERVAL_MINUTES):
            cooldown_until = snapshot.generated_at + timedelta(minutes=REFRESH_INTERVAL_MINUTES)
            # cooldown activo -> no crear job nuevo, devolvemos estado terminal amigable
            job = JobStatus(
                scope=scope_key.scope,
                hosts=list(scope_key.hosts),
                level=scope_key.level,
                status="succeeded",
                message="cooldown_active",
                snapshot_key=f"{scope_key.scope.value}:{','.join(scope_key.hosts)}",
                created_at=now,
                started_at=snapshot.generated_at,
                finished_at=snapshot.generated_at,
                last_heartbeat_at=now,
                cooldown_until=cooldown_until,
            )
            for h in scope_key.hosts:
                job.hosts_status[h] = job.hosts_status.get(h) or HostJobStatus(
                    state=HostJobState.OK,
                    last_finished_at=snapshot.generated_at,
                )
            job.progress.total_hosts = len(scope_key.hosts)
            job.progress.pending = 0
            job.progress.done = len(scope_key.hosts)
            return job

    job = _JOB_STORE.create_job(scope_key)
    _kick_scheduler()
    return job


def _scheduler_loop() -> None:
    """
    Hilo liviano que toma jobs pendientes y los arranca si hay cupo global.
    """
    while not _SCHEDULER_STOP:
        with _SCHEDULER_CV:
            pending_jobs = _JOB_STORE.list_jobs_by_status({"pending"})
            if not pending_jobs:
                _SCHEDULER_CV.wait(timeout=1.0)
                continue
        for job in pending_jobs:
            # Intento tomar un slot global sin bloquear para no saturar
            if not _GLOBAL_CONCURRENCY.acquire(blocking=False):
                break
            threading.Thread(
                target=_run_job_scope_hosts,
                args=(job,),
                daemon=True,
                name=f"vmware-host-job-{job.job_id[:6]}",
            ).start()
        time.sleep(0.1)


def _run_job_scope_hosts(job: JobStatus) -> None:
    """
    Runner de jobs scope=hosts (summary).
    """
    try:
        _run_job_scope_hosts_inner(job)
    finally:
        _GLOBAL_CONCURRENCY.release()


def _run_job_scope_hosts_inner(job: JobStatus) -> None:
    scope_key = _scope_key()
    start_ts = datetime.utcnow()
    deadline = _job_deadline(start_ts)

    def update_job(fn):
        return _JOB_STORE.update_job(job.job_id, fn)

    update_job(
        lambda j: (
            setattr(j, "status", "running"),
            setattr(j, "started_at", start_ts),
            setattr(j, "last_heartbeat_at", datetime.utcnow()),
        )
    )

    snap = _SNAPSHOT_STORE.get_snapshot(scope_key)
    if snap is None:
        _SNAPSHOT_STORE.init_snapshot(scope_key)

    hosts_pending = list(scope_key.hosts)
    hosts_ok_this_job = 0
    hosts_error_this_job = 0

    def _worker(host: str):
        nonlocal hosts_ok_this_job, hosts_error_this_job
        now = datetime.utcnow()
        if now >= deadline:
            return

        health = _HEALTH_STORE.get(host)
        existing_data = _get_existing_host_data(scope_key, host)

        if health.cooldown_until and health.cooldown_until > now:
            state = (
                SnapshotHostState.SKIPPED_COOLDOWN
                if health.last_success_at and (now - health.last_success_at) <= timedelta(minutes=REFRESH_INTERVAL_MINUTES)
                else SnapshotHostState.STALE
            )
            status = SnapshotHostStatus(
                state=state,
                last_success_at=health.last_success_at,
                last_error_at=health.last_error_at,
                cooldown_until=health.cooldown_until,
                last_job_id=job.job_id,
            )
            _SNAPSHOT_STORE.upsert_host(
                scope_key,
                host,
                data=existing_data,
                status=status,
                generated_at=datetime.utcnow(),
            )

            def mutator(j: JobStatus):
                hj = j.hosts_status.get(host) or HostJobStatus()
                hj.state = HostJobState.SKIPPED_COOLDOWN if state == SnapshotHostState.SKIPPED_COOLDOWN else HostJobState.ERROR
                hj.last_started_at = now
                hj.last_finished_at = now
                hj.attempt += 1
                hj.last_error = "cooldown_active"
                hj.cooldown_until = health.cooldown_until
                j.hosts_status[host] = hj
                j.last_heartbeat_at = datetime.utcnow()

            update_job(mutator)
            return

        lock = _get_host_lock(host)
        started = datetime.utcnow()
        state = SnapshotHostState.ERROR
        data = existing_data
        error_msg = None

        with lock:
            try:
                summary = host_service.get_hosts_summary(refresh=True)
                data = [item.model_dump() for item in summary]
                elapsed = (datetime.utcnow() - started).total_seconds()
                if elapsed > HOST_TIMEOUT_SECONDS:
                    state = SnapshotHostState.TIMEOUT
                    error_msg = "host_timeout_exceeded"
                    hosts_error_this_job += 1
                    _HEALTH_STORE.record_failure(host, error_type="timeout", error_message=error_msg)
                else:
                    state = SnapshotHostState.OK
                    hosts_ok_this_job += 1
                    _HEALTH_STORE.record_success(host)
            except Exception as exc:
                error_msg = str(exc)
                hosts_error_this_job += 1
                _HEALTH_STORE.record_failure(host, error_type=exc.__class__.__name__, error_message=error_msg)
                state = SnapshotHostState.ERROR
            finally:
                finished = datetime.utcnow()

        health_after = _HEALTH_STORE.get(host)
        if state == SnapshotHostState.ERROR and health_after.last_success_at:
            if (datetime.utcnow() - health_after.last_success_at) > timedelta(minutes=REFRESH_INTERVAL_MINUTES):
                state = SnapshotHostState.STALE

        status = SnapshotHostStatus(
            state=state,
            last_success_at=health_after.last_success_at,
            last_error_at=health_after.last_error_at,
            cooldown_until=health_after.cooldown_until,
            last_job_id=job.job_id,
        )
        _SNAPSHOT_STORE.upsert_host(
            scope_key,
            host,
            data=data,
            status=status,
            generated_at=datetime.utcnow(),
        )

        def mutator(j: JobStatus):
            hj = j.hosts_status.get(host) or HostJobStatus()
            hj.state = {
                SnapshotHostState.OK: HostJobState.OK,
                SnapshotHostState.ERROR: HostJobState.ERROR,
                SnapshotHostState.TIMEOUT: HostJobState.TIMEOUT,
                SnapshotHostState.SKIPPED_COOLDOWN: HostJobState.SKIPPED_COOLDOWN,
                SnapshotHostState.STALE: HostJobState.ERROR,
                SnapshotHostState.PENDING: HostJobState.PENDING,
            }[state]
            hj.last_started_at = started
            hj.last_finished_at = finished
            hj.attempt += 1
            hj.last_error = error_msg
            hj.cooldown_until = health_after.cooldown_until
            j.hosts_status[host] = hj
            j.last_heartbeat_at = datetime.utcnow()

        update_job(mutator)

    max_workers = max(1, min(MAX_CONCURRENCY_PER_SCOPE, len(hosts_pending)))
    with ThreadPoolExecutor(max_workers=max_workers) as ex:
        fut_map = {ex.submit(_worker, h): h for h in hosts_pending}
        for fut in as_completed(fut_map):
            h = fut_map[fut]
            try:
                fut.result()
            except Exception as exc:
                logger.warning("Host worker '%s' error: %s", h, exc)

    finished_ts = datetime.utcnow()
    final_status = "succeeded"
    message = None
    if finished_ts >= deadline:
        final_status = "expired"
        message = "job_max_duration_reached"
    elif hosts_ok_this_job == 0:
        snap_now = _SNAPSHOT_STORE.get_snapshot(scope_key)
        has_data = False
        if snap_now and isinstance(snap_now.data, dict):
            has_data = any(snap_now.data.values())
        final_status = "failed" if not has_data else "succeeded"
        if final_status == "succeeded":
            message = "partial"
    elif hosts_error_this_job > 0:
        message = "partial"

    def finalize(j: JobStatus):
        j.status = final_status
        j.finished_at = finished_ts
        j.last_heartbeat_at = datetime.utcnow()
        if j.started_at is None:
            j.started_at = start_ts
        j.message = message

    update_job(finalize)


def _vmware_configured() -> bool:
    issues = vm_service.validate_vcenter_configuration()
    return not issues


def _should_warm() -> bool:
    if not _vmware_configured():
        return False
    scope_key = _scope_key()
    snap = _SNAPSHOT_STORE.get_snapshot(scope_key)
    now = datetime.utcnow()
    if snap and (now - snap.generated_at) < timedelta(minutes=REFRESH_INTERVAL_MINUTES):
        return False
    active = _JOB_STORE.get_active_for_scope(scope_key)
    if active:
        return False
    return True


def _warmup_loop() -> None:
    """
    Tarea interna periodica para asegurar que exista snapshot (hosts) sin requerir clicks.
    No depende de permisos HTTP.
    """
    interval = max(REFRESH_INTERVAL_MINUTES, 10)
    while not _WARMUP_STOP:
        try:
            if _should_warm():
                scope_key = _scope_key()
                logger.info("VMware hosts warmup: creando job para scope %s", scope_key.scope.value)
                _JOB_STORE.create_job(scope_key)
                _kick_scheduler()
        except Exception as exc:
            logger.warning("VMware hosts warmup loop error: %s", exc)
        time.sleep(interval * 60)


def _stop_warmup() -> None:
    global _WARMUP_STOP
    _WARMUP_STOP = True
