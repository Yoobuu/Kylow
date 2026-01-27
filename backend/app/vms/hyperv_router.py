from __future__ import annotations

import logging
import re
from concurrent.futures import ThreadPoolExecutor, as_completed, Future, TimeoutError as FuturesTimeout
from datetime import datetime, timedelta
from pathlib import Path as FsPath
import threading
import time
from typing import List, Optional, Dict

from cachetools import TTLCache
from fastapi import APIRouter, Depends, HTTPException, Query, Path as PathParam, Response, Request
from fastapi.responses import JSONResponse
from sqlmodel import Session
from pydantic import BaseModel, Field

from app.audit.service import log_audit
from app.auth.user_model import User
from app.db import get_session
from app.dependencies import require_permission, get_current_user, AuditRequestContext, get_request_audit_context
from app.permissions.models import PermissionCode
from app.providers.hyperv.remote import HostUnreachableError, RemoteCreds, run_power_action
from app.providers.hyperv.schema import VMRecord, VMRecordDetail, VMRecordSummary, VMRecordDeep
from app.vms.hyperv_service import collect_hyperv_inventory_for_host, collect_hyperv_host_info
from app.vms.hyperv_host_models import HyperVHostSummary
from app.vms.hyperv_power_service import hyperv_power_action
from app.vms.hyperv_jobs import (
    HostHealthStore,
    HostJobState,
    HostJobStatus,
    JobStatus,
    JobStore,
    ScopeKey,
    ScopeName,
    SnapshotHostStatus,
    SnapshotHostState,
    SnapshotPayload,
    SnapshotStore,
)
from app.settings import settings

router = APIRouter(prefix="/api/hyperv", tags=["hyperv"])
logger = logging.getLogger(__name__)

CACHE_TTL = settings.hyperv_cache_ttl
_BATCH_CACHE = TTLCache(maxsize=32, ttl=CACHE_TTL)
_JOB_STORE = JobStore()
_SNAPSHOT_STORE = SnapshotStore()
_HEALTH_STORE = HostHealthStore()
_GLOBAL_HOST_LOCKS: Dict[str, threading.RLock] = {}
_GLOBAL_LOCKS_LOCK = threading.RLock()
_GLOBAL_CONCURRENCY = threading.Semaphore(settings.hyperv_job_max_global)
MAX_CONCURRENCY_PER_SCOPE = settings.hyperv_job_max_per_scope
HOST_TIMEOUT_SECONDS = settings.hyperv_job_host_timeout
JOB_MAX_DURATION_SECONDS = settings.hyperv_job_max_duration
_SCHEDULER_CV = threading.Condition()
_SCHEDULER_STARTED = False
_SCHEDULER_STOP = False
_WARMUP_STARTED = False
_WARMUP_STOP = False
_LAST_VMS_HOSTS: List[str] = []


_REQUIRE_SUPERADMIN = require_permission(PermissionCode.JOBS_TRIGGER)


HYPERV_INVENTORY_READ_TIMEOUT = settings.hyperv_inventory_read_timeout
HYPERV_INVENTORY_RETRIES = settings.hyperv_inventory_retries
HYPERV_INVENTORY_BACKOFF_SEC = settings.hyperv_inventory_backoff_sec
HYPERV_CONNECT_TIMEOUT = settings.hyperv_connect_timeout
HYPERV_POWER_READ_TIMEOUT = settings.hyperv_power_read_timeout
REFRESH_INTERVAL_MINUTES = settings.hyperv_refresh_interval_minutes
HOSTS_JOB_TIMEOUT_SECONDS = settings.hyperv_hosts_job_host_timeout

# Ruta al script PowerShell (puedes overridear con HYPERV_PS_PATH)
# Usamos Path(__file__) para anclar la ruta al propio módulo sin depender del cwd.
# parents[2] sube dos niveles: app/vms/hyperv_router.py -> app/vms -> app.
DEFAULT_PS_PATH = (
    FsPath(__file__).resolve().parents[2] / "scripts" / "collect_hyperv_inventory.ps1"
).resolve()


def _load_ps_content() -> str:
    ps_path = settings.hyperv_ps_path or DEFAULT_PS_PATH
    try:
        with open(ps_path, "r", encoding="utf-8") as fh:
            return fh.read()
    except FileNotFoundError:
        logger.error("Hyper-V PowerShell script not found at '%s'", ps_path)
    raise HTTPException(
        status_code=500,
        detail=f"No se encontró el script PowerShell en '{ps_path}'. "
        f"Define HYPERV_PS_PATH o crea el archivo.",
    )


def _sanitize_error_message(value: Optional[str]) -> Optional[str]:
    if not value:
        return None
    msg = str(value).strip()
    if not msg:
        return None
    msg = re.sub(
        r"Authorization:\s*Bearer\s+\S+",
        "Authorization: Bearer [redacted]",
        msg,
        flags=re.IGNORECASE,
    )
    msg = re.sub(r"Bearer\s+[A-Za-z0-9\-_.]+", "Bearer [redacted]", msg)
    if len(msg) > 200:
        msg = f"{msg[:200]}..."
    return msg


def _build_inventory_creds(host: str) -> RemoteCreds:
    return RemoteCreds(
        host=host,
        username=settings.hyperv_user,
        password=settings.hyperv_pass,
        transport=settings.hyperv_transport,
        winrm_https_enabled=settings.hyperv_winrm_https_enabled,
        winrm_http_enabled=settings.hyperv_winrm_http_enabled,
        use_winrm=True,
        ca_trust_path=settings.hyperv_ca_bundle,
        connect_timeout=HYPERV_CONNECT_TIMEOUT,
        read_timeout=HYPERV_INVENTORY_READ_TIMEOUT,
        retries=HYPERV_INVENTORY_RETRIES,
        backoff_sec=HYPERV_INVENTORY_BACKOFF_SEC,
    )


def _build_power_creds(host: str) -> RemoteCreds:
    return RemoteCreds(
        host=host,
        username=settings.hyperv_user,
        password=settings.hyperv_pass,
        transport=settings.hyperv_transport,
        winrm_https_enabled=settings.hyperv_winrm_https_enabled,
        winrm_http_enabled=settings.hyperv_winrm_http_enabled,
        use_winrm=True,
        ca_trust_path=settings.hyperv_ca_bundle,
        connect_timeout=HYPERV_CONNECT_TIMEOUT,
        read_timeout=HYPERV_POWER_READ_TIMEOUT,
        retries=0,
    )


def get_creds(
    host: Optional[str] = Query(
        default=None,
        description="Hostname/FQDN/IP del host Hyper-V (si se omite, usa HYPERV_HOST del entorno).",
    )
) -> RemoteCreds:
    resolved_host = host or (settings.hyperv_host or "")
    if not resolved_host:
        raise HTTPException(400, "Define HYPERV_HOST en el entorno o pasa ?host= en la URL.")
    return _build_inventory_creds(resolved_host)


def _normalize_level(level: str, allowed: set[str]) -> str:
    lvl = (level or "summary").lower()
    if lvl not in allowed:
        raise HTTPException(status_code=400, detail=f"Nivel no soportado. Usa uno de: {', '.join(sorted(allowed))}")
    return lvl


def _parse_scope(raw: str) -> ScopeName:
    try:
        return ScopeName(raw.lower())
    except Exception:
        raise HTTPException(status_code=400, detail="Scope no soportado, usa vms|hosts")


def _raise_hyperv_operational_error(exc: Exception, *, host: str) -> None:
    msg = str(exc) or exc.__class__.__name__
    lowered = msg.lower()
    status_code = 504 if ("timeout" in lowered or "timed out" in lowered) else 502
    logger.warning("Hyper-V operational error for host '%s': %s", host, msg)
    raise HTTPException(status_code=status_code, detail=msg)


def _build_host_status_payload(
    *,
    provider: str,
    host_list: list[str],
    results: dict[str, object],
    errors: dict[str, dict],
) -> dict:
    summary = {"ok": 0, "unreachable": 0, "failed": 0}
    hosts_payload = []
    for host in host_list:
        if host in results:
            hosts_payload.append({"host": host, "status": "ok", "data": results[host]})
            summary["ok"] += 1
            continue
        err = errors.get(host)
        if err:
            status = err.get("status") or "failed"
            entry = {"host": host, "status": status}
            if err.get("error"):
                entry["error"] = err["error"]
            hosts_payload.append(entry)
            if status == "unreachable":
                summary["unreachable"] += 1
            else:
                summary["failed"] += 1
            continue
        hosts_payload.append({"host": host, "status": "failed"})
        summary["failed"] += 1
    ok = summary["ok"] > 0
    return {
        "ok": ok,
        "provider": provider,
        "hosts": hosts_payload,
        "summary": summary,
    }


def _unreachable_response(host: str, *, error: str | None = None) -> JSONResponse:
    msg = _sanitize_error_message(error) or "unreachable"
    payload = _build_host_status_payload(
        provider="hyperv",
        host_list=[host],
        results={},
        errors={host: {"status": "unreachable", "error": msg}},
    )
    return JSONResponse(status_code=200, content=payload)


@router.get("/vms", response_model=List[VMRecordDetail])
def list_hyperv_vms(
    refresh: bool = Query(False, description="Forzar refresco desde los hosts, ignorando cache"),
    level: str = Query("summary", description="Nivel de detalle: summary, detail o deep"),
    creds: RemoteCreds = Depends(get_creds),
    current_user: User = Depends(require_permission(PermissionCode.JOBS_TRIGGER)),
    session: Session = Depends(get_session),
    audit_ctx: AuditRequestContext = Depends(get_request_audit_context),
):
    lvl = _normalize_level(level, {"summary", "detail", "deep"})
    ps_content = _load_ps_content()
    log_audit(
        session,
        actor=current_user,
        action="hyperv.vms.view",
        target_type="hyperv",
        target_id=creds.host,
        meta={"level": lvl, "refresh": refresh},
        ip=audit_ctx.ip,
        ua=audit_ctx.user_agent,
        corr=audit_ctx.correlation_id,
    )
    session.commit()
    try:
        items = collect_hyperv_inventory_for_host(
            creds,
            ps_content=ps_content,
            level=lvl,
            use_cache=not refresh,
        )
        return items
    except HostUnreachableError as exc:
        return _unreachable_response(creds.host, error=str(exc))
    except Exception as exc:
        _raise_hyperv_operational_error(exc, host=creds.host)


def _parse_hosts_env(raw: str | None) -> list[str]:
    """Parse comma/semicolon-separated hostnames into a unique, lowercased, sorted list."""
    if not raw:
        return []
    cleaned = []
    for h in raw.replace(";", ",").split(","):
        h_norm = h.strip().lower()
        if h_norm:
            cleaned.append(h_norm)
    return sorted(set(cleaned))


def _resolve_host_list(query_hosts: str | None) -> list[str]:
    if query_hosts:
        return _parse_hosts_env(query_hosts)
    if settings.hyperv_hosts:
        return list(settings.hyperv_hosts)
    single = (settings.hyperv_host or "").strip().lower()
    return [single] if single else []


def _remember_vms_hosts(hosts: list[str]) -> None:
    global _LAST_VMS_HOSTS
    if hosts:
        _LAST_VMS_HOSTS = list(hosts)


def _get_last_vms_hosts() -> list[str]:
    return list(_LAST_VMS_HOSTS)


class RefreshRequest(BaseModel):
    scope: ScopeName
    hosts: List[str] = Field(default_factory=list)
    level: str = "summary"
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
            t = threading.Thread(target=_scheduler_loop, name="hyperv-job-scheduler", daemon=True)
            t.start()
            _SCHEDULER_STARTED = True
        _SCHEDULER_CV.notify_all()


def _kick_warmup() -> None:
    global _WARMUP_STARTED
    if _WARMUP_STARTED:
        return
    t = threading.Thread(target=_warmup_loop, name="hyperv-warmup", daemon=True)
    t.start()
    _WARMUP_STARTED = True
    logger.info("Hyper-V warmup thread started")


@router.get("/vms/batch")
def list_hyperv_vms_batch(
    hosts: str | None = Query(
        default=None,
        description="Lista de hosts separada por comas (overridea HYPERV_HOSTS).",
    ),
    max_workers: int = Query(4, ge=1, le=16, description="Paralelismo de consultas"),
    refresh: bool = Query(False, description="Forzar refresco y omitir cache"),
    level: str = Query("summary", description="Nivel soportado solo summary en batch"),
    current_user: User = Depends(require_permission(PermissionCode.JOBS_TRIGGER)),
    session: Session = Depends(get_session),
    audit_ctx: AuditRequestContext = Depends(get_request_audit_context),
):
    lvl = _normalize_level(level, {"summary"})
    # 1) resolver lista de hosts
    host_list = _resolve_host_list(hosts)
    if not host_list:
        raise HTTPException(400, "No hay hosts. Define HYPERV_HOSTS en .env o pasa ?hosts=...")
    log_audit(
        session,
        actor=current_user,
        action="hyperv.vms.batch.view",
        target_type="hyperv",
        target_id="batch",
        meta={
            "hosts": host_list,
            "level": lvl,
            "refresh": refresh,
            "max_workers": max_workers,
        },
        ip=audit_ctx.ip,
        ua=audit_ctx.user_agent,
        corr=audit_ctx.correlation_id,
    )
    session.commit()

    cache_key = (tuple(sorted(host_list)), lvl)
    if not refresh and cache_key in _BATCH_CACHE:
        return _BATCH_CACHE[cache_key]

    # 2) script PS
    ps_content = _load_ps_content()

    # 3) función worker por host
    def _work(h: str):
        creds = _build_inventory_creds(h)
        items = collect_hyperv_inventory_for_host(
            creds, ps_content=ps_content, use_cache=not refresh, level=lvl
        )
        # devolvemos lista ya validada (VMRecord -> dict)
        return h, [i.model_dump() for i in items]

    results: dict[str, list[dict]] = {}
    errors: dict[str, str] = {}
    errors_detail: dict[str, dict] = {}

    # 4) ejecución paralela (controlada)
    with ThreadPoolExecutor(max_workers=max_workers) as ex:
        fut_map = {ex.submit(_work, h): h for h in host_list}
        for fut in as_completed(fut_map):
            h = fut_map[fut]
            try:
                host, data = fut.result()
                results[host] = data
            except Exception as e:
                logger.warning("Error collecting Hyper-V inventory for host '%s': %s", h, e)
                err_msg = _sanitize_error_message(str(e)) or "error"
                status = "unreachable" if isinstance(e, HostUnreachableError) else "failed"
                errors[h] = err_msg
                errors_detail[h] = {"status": status, "error": err_msg}

    status_payload = _build_host_status_payload(
        provider="hyperv",
        host_list=host_list,
        results=results,
        errors=errors_detail,
    )

    payload = {
        **status_payload,
        "all_ok": len(errors) == 0,
        "total_hosts": len(host_list),
        "hosts_ok": list(results.keys()),
        "hosts_error": errors,
        "total_vms": sum(len(v) for v in results.values()),
        "results": results,  # dict {host: [VMRecord...]}
    }
    _BATCH_CACHE[cache_key] = payload
    return payload


@router.get("/vms/{hvhost}", response_model=List[VMRecordDetail])
def list_hyperv_vms_by_host(
    hvhost: str,
    level: str = Query("summary", description="Nivel de detalle: summary o detail"),
    refresh: bool = Query(False, description="Forzar refresco desde el host"),
    current_user: User = Depends(require_permission(PermissionCode.JOBS_TRIGGER)),
    session: Session = Depends(get_session),
    audit_ctx: AuditRequestContext = Depends(get_request_audit_context),
):
    lvl = _normalize_level(level, {"summary", "detail"})
    ps_content = _load_ps_content()
    creds = _build_inventory_creds(hvhost)
    log_audit(
        session,
        actor=current_user,
        action="hyperv.vms.host.view",
        target_type="hyperv",
        target_id=hvhost,
        meta={"level": lvl, "refresh": refresh},
        ip=audit_ctx.ip,
        ua=audit_ctx.user_agent,
        corr=audit_ctx.correlation_id,
    )
    session.commit()
    try:
        items = collect_hyperv_inventory_for_host(
            creds,
            ps_content=ps_content,
            level=lvl,
            use_cache=not refresh,
        )
        return items
    except HostUnreachableError as exc:
        return _unreachable_response(hvhost, error=str(exc))
    except Exception as exc:
        _raise_hyperv_operational_error(exc, host=hvhost)


@router.post("/vms/{hvhost}/{vm_name}/power/{action}")
def hyperv_vm_power_action(
    hvhost: str = PathParam(..., description="Host Hyper-V objetivo"),
    vm_name: str = PathParam(..., description="Nombre EXACTO de la VM tal como aparece en Hyper-V"),
    action: str = PathParam(..., description="Acción: start, stop o reset"),
    refresh: bool = Query(False, description="Forzar refresco de inventario antes de actuar"),
    _user: User = Depends(require_permission(PermissionCode.HYPERV_POWER)),
    session: Session = Depends(get_session),
    audit_ctx: AuditRequestContext = Depends(get_request_audit_context),
):
    """
    Ejecuta una acción de energía ('start', 'stop', 'reset') sobre una VM específica
    en el host indicado. Solo se permite si la VM es sandbox.
    """

    if action not in {"start", "stop", "reset"}:
        raise HTTPException(status_code=400, detail="Acción no válida")

    # Construimos las credenciales RemoteCreds para este host
    creds = _build_inventory_creds(hvhost)

    # Reutilizamos el mismo script PowerShell que se usa para inventario,
    # porque hyperv_power_action necesita inventario fresco para validar sandbox.
    ps_content = _load_ps_content()

    try:
        result = hyperv_power_action(
            creds=creds,
            vm_name=vm_name,
            action=action,
            ps_content_inventory=ps_content,
            use_cache=not refresh,
        )
        log_audit(
            session,
            actor=_user,
            action="hyperv.power_action",
            target_type="vm",
            target_id=vm_name,
            meta={"host": hvhost, "action": action},
            ip=audit_ctx.ip,
            ua=audit_ctx.user_agent,
            corr=audit_ctx.correlation_id,
        )
        session.commit()
        return result
    except HTTPException as exc:
        if str(exc.detail).strip().lower() == "unreachable":
            return _unreachable_response(hvhost, error=str(exc.detail))
        _raise_hyperv_operational_error(exc, host=hvhost)
    except HostUnreachableError as exc:
        return _unreachable_response(hvhost, error=str(exc))
    except Exception as exc:
        _raise_hyperv_operational_error(exc, host=hvhost)


def _build_detail_creds(host: str) -> RemoteCreds:
    """Credenciales para consultas puntuales (detail) con timeout corto."""
    return RemoteCreds(
        host=host,
        username=settings.hyperv_user,
        password=settings.hyperv_pass,
        transport=settings.hyperv_transport,
        winrm_https_enabled=settings.hyperv_winrm_https_enabled,
        winrm_http_enabled=settings.hyperv_winrm_http_enabled,
        use_winrm=True,
        ca_trust_path=settings.hyperv_ca_bundle,
        connect_timeout=HYPERV_CONNECT_TIMEOUT,
        read_timeout=settings.hyperv_detail_timeout,
        retries=0, # Sin reintentos para feedback rápido
        backoff_sec=0,
    )

@router.get("/vms/{hvhost}/{vm_name}/detail", response_model=VMRecordDetail)
def hyperv_vm_detail(
    hvhost: str,
    vm_name: str,
    refresh: bool = Query(False, description="Forzar refresco"),
    current_user: User = Depends(require_permission(PermissionCode.JOBS_TRIGGER)),
    session: Session = Depends(get_session),
    audit_ctx: AuditRequestContext = Depends(get_request_audit_context),
):
    ps_content = _load_ps_content()
    # Usamos timeout corto para no colgar la UI si el host está muerto
    creds = _build_detail_creds(hvhost)
    log_audit(
        session,
        actor=current_user,
        action="hyperv.vm.detail.view",
        target_type="vm",
        target_id=vm_name,
        meta={"host": hvhost, "refresh": refresh},
        ip=audit_ctx.ip,
        ua=audit_ctx.user_agent,
        corr=audit_ctx.correlation_id,
    )
    session.commit()
    try:
        records = collect_hyperv_inventory_for_host(
            creds,
            ps_content=ps_content,
            level="detail",
            vm_name=vm_name,
            use_cache=not refresh,
        )
    except HostUnreachableError as exc:
        return _unreachable_response(hvhost, error=str(exc))
    except Exception as exc:
        _raise_hyperv_operational_error(exc, host=hvhost)
    for rec in records:
        if rec.Name == vm_name:
            return rec
    raise HTTPException(status_code=404, detail="VM no encontrada")


@router.get("/vms/{hvhost}/{vm_name}/deep", response_model=VMRecordDeep)
def hyperv_vm_deep(
    hvhost: str,
    vm_name: str,
    refresh: bool = Query(False, description="Forzar refresco"),
    current_user: User = Depends(require_permission(PermissionCode.JOBS_TRIGGER)),
    session: Session = Depends(get_session),
    audit_ctx: AuditRequestContext = Depends(get_request_audit_context),
):
    ps_content = _load_ps_content()
    creds = _build_inventory_creds(hvhost)
    log_audit(
        session,
        actor=current_user,
        action="hyperv.vm.deep.view",
        target_type="vm",
        target_id=vm_name,
        meta={"host": hvhost, "refresh": refresh},
        ip=audit_ctx.ip,
        ua=audit_ctx.user_agent,
        corr=audit_ctx.correlation_id,
    )
    session.commit()
    try:
        records = collect_hyperv_inventory_for_host(
            creds,
            ps_content=ps_content,
            level="deep",
            vm_name=vm_name,
            use_cache=not refresh,
        )
    except HostUnreachableError as exc:
        return _unreachable_response(hvhost, error=str(exc))
    except Exception as exc:
        _raise_hyperv_operational_error(exc, host=hvhost)
    for rec in records:
        if rec.Name == vm_name:
            return rec
    raise HTTPException(status_code=404, detail="VM no encontrada")


@router.get("/config")
def hyperv_config(
    current_user: User = Depends(require_permission(PermissionCode.HYPERV_VIEW)),
    session: Session = Depends(get_session),
    audit_ctx: AuditRequestContext = Depends(get_request_audit_context),
):
    """
    Devuelve hosts configurados sin disparar WinRM.
    """
    hosts = _resolve_host_list(None)
    log_audit(
        session,
        actor=current_user,
        action="hyperv.config.view",
        target_type="hyperv",
        target_id="config",
        meta={"hosts": hosts},
        ip=audit_ctx.ip,
        ua=audit_ctx.user_agent,
        corr=audit_ctx.correlation_id,
    )
    session.commit()
    return {
        "hosts": hosts,
        "refresh_interval_min": REFRESH_INTERVAL_MINUTES,
        "caps": {
            "scopes": ["vms", "hosts"],
            "levels": ["summary"],
            "min_refresh_minutes": REFRESH_INTERVAL_MINUTES,
        },
    }


# Lanzar warmup al importar router


@router.get("/snapshot")
def get_hyperv_snapshot(
    scope: str = Query(..., description="Scope: vms|hosts"),
    hosts: str | None = Query(None, description="Lista de hosts separada por comas"),
    level: str = Query("summary", description="Nivel de detalle, solo summary"),
    session: Session = Depends(get_session),
    audit_ctx: AuditRequestContext = Depends(get_request_audit_context),
):
    if not settings.hyperv_enabled or not settings.hyperv_configured:
        log_audit(
            session,
            actor=None,
            action="hyperv.snapshot.view",
            target_type="snapshot",
            target_id="hyperv",
            meta={
                "available": False,
                "reason": "disabled_or_unconfigured",
                "scope": scope,
                "hosts": hosts,
                "level": level,
            },
            ip=audit_ctx.ip,
            ua=audit_ctx.user_agent,
            corr=audit_ctx.correlation_id,
        )
        session.commit()
        return Response(status_code=204)
    scope_name = _parse_scope(scope)
    lvl = _normalize_level(level, {"summary", "detail"})
    if hosts:
        host_list = _parse_hosts_env(hosts)
    else:
        host_list = settings.hyperv_hosts_configured
    if not host_list:
        raise HTTPException(status_code=400, detail="Debe especificar ?hosts=host1,host2")
    scope_key = ScopeKey.from_parts(scope_name, host_list, lvl)
    snap = _SNAPSHOT_STORE.get_snapshot(scope_key)
    if snap is None:
        log_audit(
            session,
            actor=None,
            action="hyperv.snapshot.view",
            target_type="snapshot",
            target_id="hyperv",
            meta={
                "available": False,
                "reason": "empty",
                "scope": scope_name.value,
                "hosts": host_list,
                "level": lvl,
            },
            ip=audit_ctx.ip,
            ua=audit_ctx.user_agent,
            corr=audit_ctx.correlation_id,
        )
        session.commit()
        return Response(status_code=204)
    log_audit(
        session,
        actor=None,
        action="hyperv.snapshot.view",
        target_type="snapshot",
        target_id="hyperv",
        meta={
            "available": True,
            "scope": scope_name.value,
            "hosts": host_list,
            "level": lvl,
        },
        ip=audit_ctx.ip,
        ua=audit_ctx.user_agent,
        corr=audit_ctx.correlation_id,
    )
    session.commit()
    return snap


@router.get("/jobs/{job_id}")
def get_hyperv_job(
    job_id: str,
    current_user: User = Depends(require_permission(PermissionCode.HYPERV_VIEW)),
    session: Session = Depends(get_session),
    audit_ctx: AuditRequestContext = Depends(get_request_audit_context),
):
    job = _JOB_STORE.get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job no encontrado")
    log_audit(
        session,
        actor=current_user,
        action="hyperv.job.view",
        target_type="job",
        target_id=job_id,
        meta={"scope": getattr(job, "scope", None)},
        ip=audit_ctx.ip,
        ua=audit_ctx.user_agent,
        corr=audit_ctx.correlation_id,
    )
    session.commit()
    return job


@router.post("/refresh")
def trigger_hyperv_refresh(
    payload: RefreshRequest,
    request: Request,
    session: Session = Depends(get_session),
):
    if not settings.hyperv_enabled:
        raise HTTPException(status_code=409, detail="Provider disabled")
    if not settings.hyperv_configured:
        raise HTTPException(
            status_code=409,
            detail={"detail": "Provider not configured", "missing": settings.hyperv_missing_envs},
        )
    auth_header = request.headers.get("Authorization")
    if not auth_header:
        raise HTTPException(status_code=401, detail="Not authenticated")
    scheme, _, token = auth_header.partition(" ")
    if scheme.lower() != "bearer" or not token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    current_user = get_current_user(token=token, session=session, request=request)
    _REQUIRE_SUPERADMIN(current_user=current_user, session=session)
    scope_name = payload.scope
    lvl = _normalize_level(payload.level, {"summary", "detail"})
    raw_hosts = payload.hosts or settings.hyperv_hosts_configured
    host_list = _parse_hosts_env(",".join(raw_hosts)) if raw_hosts else []
    if not host_list:
        raise HTTPException(status_code=400, detail="Debe especificar al menos un host")

    if scope_name == ScopeName.VMS:
        _remember_vms_hosts(host_list)

    scope_key = ScopeKey.from_parts(scope_name, host_list, lvl)

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
                scope=scope_name,
                hosts=list(scope_key.hosts),
                level=lvl,
                status="succeeded",
                message="cooldown_active",
                snapshot_key=f"{scope_name.value}:{','.join(scope_key.hosts)}",
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
            target = _run_job_scope_hosts if job.scope == ScopeName.HOSTS else _run_job_scope_vms
            threading.Thread(
                target=target,
                args=(job,),
                daemon=True,
                name=f"hyperv-job-{job.job_id[:6]}",
            ).start()
        time.sleep(0.1)


def _job_deadline(start: datetime) -> datetime:
    return start + timedelta(seconds=JOB_MAX_DURATION_SECONDS)


def _get_existing_host_data(scope_key: ScopeKey, host: str):
    snap = _SNAPSHOT_STORE.get_snapshot(scope_key)
    if not snap:
        return None
    if snap.scope == ScopeName.HOSTS and isinstance(snap.data, list):
        for item in snap.data:
            name = getattr(item, "host", None) or getattr(item, "name", None)
            if name and str(name).lower() == host.lower():
                return item
            if isinstance(item, dict):
                n = item.get("host") or item.get("name")
                if n and str(n).lower() == host.lower():
                    return item
    if snap.scope == ScopeName.VMS and isinstance(snap.data, dict):
        return snap.data.get(host)
    return None


def _run_job_scope_vms(job: JobStatus) -> None:
    """
    Runner de jobs scope=vms (summary).
    """
    try:
        _run_job_scope_vms_inner(job)
    finally:
        _GLOBAL_CONCURRENCY.release()


def _run_job_scope_vms_inner(job: JobStatus) -> None:
    scope_key = ScopeKey.from_parts(job.scope, job.hosts, job.level)
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
        snap = _SNAPSHOT_STORE.init_snapshot(scope_key)

    ps_content = _load_ps_content()
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
                creds = _build_inventory_creds(host)
                level = (job.level or "summary").lower()
                if level not in {"summary", "detail"}:
                    level = "summary"
                items = collect_hyperv_inventory_for_host(
                    creds,
                    ps_content=ps_content,
                    use_cache=False,
                    level=level,
                )
                data = [i.model_dump() for i in items]
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
                if isinstance(exc, HostUnreachableError):
                    logger.warning("Hyper-V host unreachable during job: %s", host)
                    error_msg = "unreachable"
                    error_type = "unreachable"
                else:
                    error_msg = str(exc)
                    error_type = exc.__class__.__name__
                hosts_error_this_job += 1
                _HEALTH_STORE.record_failure(host, error_type=error_type, error_message=error_msg)
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


def _run_job_scope_hosts(job: JobStatus) -> None:
    """
    Runner de jobs scope=hosts (fase 1).
    """
    try:
        _run_job_scope_hosts_inner(job)
    finally:
        _GLOBAL_CONCURRENCY.release()


def _run_job_scope_hosts_inner(job: JobStatus) -> None:
    """
    Lógica interna separada para garantizar release del slot global.
    """
    scope_key = ScopeKey.from_parts(job.scope, job.hosts, job.level)
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
        snap = _SNAPSHOT_STORE.init_snapshot(scope_key)

    ps_content = _load_ps_content()

    hosts_pending = list(scope_key.hosts)
    results: Dict[str, SnapshotHostStatus] = {}
    hosts_ok_this_job = 0
    hosts_error_this_job = 0

    def _worker(host: str):
        nonlocal results, hosts_ok_this_job, hosts_error_this_job
        now = datetime.utcnow()
        if now >= deadline:
            return ("expired", None, "job_expired", None)

        health = _HEALTH_STORE.get(host)
        existing_data = _get_existing_host_data(scope_key, host)

        if health.cooldown_until and health.cooldown_until > now:
            status = SnapshotHostStatus(
                state=SnapshotHostState.SKIPPED_COOLDOWN
                if health.last_success_at and (now - health.last_success_at) <= timedelta(minutes=REFRESH_INTERVAL_MINUTES)
                else SnapshotHostState.STALE,
                last_success_at=health.last_success_at,
                last_error_at=health.last_error_at,
                cooldown_until=health.cooldown_until,
                last_job_id=job.job_id,
                last_error_type=health.last_error_type,
                last_error_message=_sanitize_error_message(health.last_error_message),
            )
            data_for_store = existing_data if existing_data is not None else {"host": host}
            _SNAPSHOT_STORE.upsert_host(
                scope_key,
                host,
                data=data_for_store,
                status=status,
                generated_at=datetime.utcnow(),
            )
            return ("skipped", existing_data, "cooldown", status)

        lock = _get_host_lock(host)
        started = datetime.utcnow()
        state = SnapshotHostState.ERROR
        data = existing_data
        error_msg = None

        with lock:
            try:
                creds = _build_inventory_creds(host)
                info = collect_hyperv_host_info(
                    creds,
                    ps_content=ps_content,
                    use_cache=False,
                )
                data = info
                elapsed = (datetime.utcnow() - started).total_seconds()
                if elapsed > HOSTS_JOB_TIMEOUT_SECONDS:
                    state = SnapshotHostState.TIMEOUT
                    error_msg = "host_timeout_exceeded"
                    hosts_error_this_job += 1
                    _HEALTH_STORE.record_failure(host, error_type="timeout", error_message=error_msg)
                else:
                    state = SnapshotHostState.OK
                    hosts_ok_this_job += 1
                    _HEALTH_STORE.record_success(host)
            except Exception as exc:
                if isinstance(exc, HostUnreachableError):
                    logger.warning("Hyper-V host unreachable during job: %s", host)
                    error_msg = "unreachable"
                    error_type = "unreachable"
                else:
                    error_msg = str(exc)
                    error_type = exc.__class__.__name__
                hosts_error_this_job += 1
                _HEALTH_STORE.record_failure(host, error_type=error_type, error_message=error_msg)
                state = SnapshotHostState.ERROR
            finally:
                finished = datetime.utcnow()

        health_after = _HEALTH_STORE.get(host)
        if state == SnapshotHostState.ERROR and health_after.last_success_at:
            # conservar datos previos, marcar stale si viejo
            if (datetime.utcnow() - health_after.last_success_at) > timedelta(minutes=REFRESH_INTERVAL_MINUTES):
                state = SnapshotHostState.STALE

        status = SnapshotHostStatus(
            state=state,
            last_success_at=health_after.last_success_at,
            last_error_at=health_after.last_error_at,
            cooldown_until=health_after.cooldown_until,
            last_job_id=job.job_id,
            last_error_type=health_after.last_error_type,
            last_error_message=_sanitize_error_message(health_after.last_error_message),
        )
        data_for_store = data if data is not None else {"host": host}
        _SNAPSHOT_STORE.upsert_host(
            scope_key,
            host,
            data=data_for_store,
            status=status,
            generated_at=datetime.utcnow(),
        )
        # actualizar job
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
        return (state.value, data, error_msg, status)

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
        # evaluar si snapshot tiene data util
        snap_now = _SNAPSHOT_STORE.get_snapshot(scope_key)
        has_data = False
        if snap_now and isinstance(snap_now.data, list):
            has_data = len(snap_now.data) > 0
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
    _GLOBAL_CONCURRENCY.release()


def _should_warm(scope: ScopeName, level: str) -> bool:
    hosts = _resolve_host_list(None)
    if not hosts:
        return False
    scope_key = ScopeKey.from_parts(scope, hosts, level)
    snap = _SNAPSHOT_STORE.get_snapshot(scope_key)
    now = datetime.utcnow()
    if snap and (now - snap.generated_at) < timedelta(minutes=REFRESH_INTERVAL_MINUTES):
        return False
    active = _JOB_STORE.get_active_for_scope(scope_key)
    if active:
        return False
    return True


def _should_warm_with_hosts(scope: ScopeName, level: str, hosts: list[str]) -> bool:
    if not hosts:
        return False
    scope_key = ScopeKey.from_parts(scope, hosts, level)
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
    Tarea interna periódica para asegurar que exista snapshot (vms y hosts) sin requerir clicks.
    No depende de permisos HTTP.
    """
    interval = max(REFRESH_INTERVAL_MINUTES, 10)
    while not _WARMUP_STOP:
        try:
            for scope in (ScopeName.VMS, ScopeName.HOSTS):
                if scope == ScopeName.VMS:
                    hosts = _resolve_host_list(None)
                    _remember_vms_hosts(hosts)
                else:
                    hosts = _get_last_vms_hosts()

                if _should_warm_with_hosts(scope, "summary", hosts):
                    scope_key = ScopeKey.from_parts(scope, hosts, "summary")
                    logger.info("Hyper-V warmup: creando job para scope %s hosts=%s", scope.value, hosts)
                    job = _JOB_STORE.create_job(scope_key)
                    _kick_scheduler()
        except Exception as exc:
            logger.warning("Hyper-V warmup loop error: %s", exc)
        time.sleep(interval * 60)


def _stop_warmup() -> None:
    global _WARMUP_STOP
    _WARMUP_STOP = True


@router.get("/hosts")
def list_hyperv_hosts(
    hosts: str | None = Query(
        default=None,
        description="Lista de hosts separada por comas (overridea HYPERV_HOSTS/HYPERV_HOST).",
    ),
    refresh: bool = Query(False, description="Forzar refresco (omite cache de host)"),
    max_workers: int = Query(4, ge=1, le=16, description="Paralelismo de consultas"),
    current_user: User = Depends(require_permission(PermissionCode.JOBS_TRIGGER)),
    session: Session = Depends(get_session),
    audit_ctx: AuditRequestContext = Depends(get_request_audit_context),
):
    host_list = _resolve_host_list(hosts)
    if not host_list:
        raise HTTPException(400, "No hay hosts. Define HYPERV_HOSTS o HYPERV_HOST en .env o pasa ?hosts=...")
    log_audit(
        session,
        actor=current_user,
        action="hyperv.hosts.view",
        target_type="hyperv",
        target_id="hosts",
        meta={"hosts": host_list, "refresh": refresh, "max_workers": max_workers},
        ip=audit_ctx.ip,
        ua=audit_ctx.user_agent,
        corr=audit_ctx.correlation_id,
    )
    session.commit()

    ps_content = _load_ps_content()

    results: List[HyperVHostSummary] = []
    errors: dict[str, str] = {}
    errors_detail: dict[str, dict] = {}

    def _work(h: str) -> HyperVHostSummary:
        creds = _build_inventory_creds(h)
        return collect_hyperv_host_info(creds, ps_content=ps_content, use_cache=not refresh)

    with ThreadPoolExecutor(max_workers=max_workers) as ex:
        fut_map = {ex.submit(_work, h): h for h in host_list}
        for fut in as_completed(fut_map):
            h = fut_map[fut]
            try:
                results.append(fut.result())
            except Exception as e:
                logger.warning("Error collecting Hyper-V host info for '%s': %s", h, e)
                err_msg = _sanitize_error_message(str(e)) or "error"
                status = "unreachable" if isinstance(e, HostUnreachableError) else "failed"
                errors[h] = err_msg
                errors_detail[h] = {"status": status, "error": err_msg}

    results_map = {r.host: r.model_dump() for r in results}
    status_payload = _build_host_status_payload(
        provider="hyperv",
        host_list=host_list,
        results=results_map,
        errors=errors_detail,
    )

    # Devolvemos parciales si hay errores, para no bloquear UI
    payload = {
        **status_payload,
        "all_ok": len(errors) == 0,
        "hosts_ok": [r.host for r in results],
        "hosts_error": errors,
        "results": [r.model_dump() for r in results],
    }
    return payload


@router.get("/hosts/{hvhost}", response_model=HyperVHostSummary)
def hyperv_host_detail(
    hvhost: str,
    refresh: bool = Query(False, description="Forzar refresco"),
    current_user: User = Depends(require_permission(PermissionCode.HYPERV_VIEW)),
    session: Session = Depends(get_session),
    audit_ctx: AuditRequestContext = Depends(get_request_audit_context),
):
    ps_content = _load_ps_content()
    creds = _build_inventory_creds(hvhost)
    try:
        log_audit(
            session,
            actor=current_user,
            action="hyperv.host.detail.view",
            target_type="host",
            target_id=hvhost,
            meta={"refresh": refresh},
            ip=audit_ctx.ip,
            ua=audit_ctx.user_agent,
            corr=audit_ctx.correlation_id,
        )
        session.commit()
        return collect_hyperv_host_info(
            creds,
            ps_content=ps_content,
            use_cache=not refresh,
        )
    except HostUnreachableError as exc:
        return _unreachable_response(hvhost, error=str(exc))
    except Exception as exc:
        logger.warning("Error collecting Hyper-V host info for '%s': %s", hvhost, exc)
        raise HTTPException(status_code=502, detail=str(exc))


@router.post("/lab/power")
def lab_power_action(
    hvhost: str,
    vm_name: str,
    action: str,
    _user: User = Depends(require_permission(PermissionCode.HYPERV_POWER)),
    session: Session = Depends(get_session),
    audit_ctx: AuditRequestContext = Depends(get_request_audit_context),
):
    """
    Endpoint TEMPORAL de laboratorio (solo local).
    Ejecuta start / stop / reset en la VM indicada.
    NO usa _is_sandbox_vm todavía, asumo que voy a pasar yo manualmente una sandbox segura.
    """
    action = action.lower().strip()
    if action not in {"start", "stop", "reset"}:
        raise HTTPException(status_code=400, detail="Acción no válida")

    creds = _build_power_creds(hvhost)

    ok, msg = run_power_action(creds, vm_name, action)
    log_audit(
        session,
        actor=_user,
        action="hyperv.lab_power_action",
        target_type="vm",
        target_id=vm_name,
        meta={"host": hvhost, "action": action, "ok": ok},
        ip=audit_ctx.ip,
        ua=audit_ctx.user_agent,
        corr=audit_ctx.correlation_id,
    )
    session.commit()
    if not ok:
        raise HTTPException(status_code=502, detail=msg)

    return {"ok": True, "message": msg}
