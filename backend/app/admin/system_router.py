from __future__ import annotations

import logging
import os
import signal
import socket
import threading
import time
from typing import Optional
from urllib.parse import urlparse

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlmodel import Session

from app.audit.service import log_audit
from app.auth.user_model import User
from app.azure.arm_client import AzureArmClient
from app.cedia import service as cedia_service
from app.db import get_engine
from app.dependencies import AuditRequestContext, get_request_audit_context, require_permission
from app.permissions.models import PermissionCode
from app.providers.hyperv.remote import RemoteCreds, _probe_winrm_endpoint
from app.settings import settings
from app.system_state import is_restarting, set_restarting
from app.vms import ovirt_service, vm_service

router = APIRouter(prefix="/api/admin/system", tags=["system"])
logger = logging.getLogger(__name__)


class RestartRequest(BaseModel):
    confirm: str


def _trim_error(value: object, limit: int = 180) -> str:
    text = str(value or "").strip()
    if not text:
        return "error_desconocido"
    if len(text) > limit:
        return f"{text[:limit]}..."
    return text


def _detail_from_http(exc: HTTPException) -> str:
    detail = getattr(exc, "detail", None)
    if isinstance(detail, dict):
        return _trim_error(detail.get("detail") or detail.get("message") or detail)
    return _trim_error(detail or exc)


def _parse_host_port(raw: Optional[str], default_port: int) -> tuple[Optional[str], Optional[int]]:
    if not raw:
        return None, None
    value = raw.strip()
    if not value:
        return None, None
    candidate = value if "://" in value else f"https://{value}"
    parsed = urlparse(candidate)
    host = parsed.hostname or value
    if not host:
        return None, None
    if parsed.port:
        return host, parsed.port
    if parsed.scheme == "http":
        return host, 80
    if parsed.scheme == "https":
        return host, 443
    return host, default_port


def _tcp_check(host: Optional[str], port: Optional[int], timeout_sec: float = 2.5) -> dict:
    if not host or not port:
        return {"state": "skipped", "error": "host_no_configurado"}
    try:
        with socket.create_connection((host, port), timeout=timeout_sec):
            return {"state": "ok", "error": None}
    except Exception as exc:
        return {"state": "error", "error": _trim_error(exc)}


def _auth_check(fn) -> dict:
    try:
        fn()
        return {"state": "ok", "error": None}
    except HTTPException as exc:
        return {"state": "error", "error": _detail_from_http(exc)}
    except Exception as exc:
        return {"state": "error", "error": _trim_error(exc)}


def _build_provider_entry(key: str, label: str, *, enabled: bool, configured: bool, missing: list[str]) -> dict:
    return {
        "key": key,
        "label": label,
        "enabled": enabled,
        "configured": configured,
        "missing": missing,
        "targets": [],
    }


def _restart_worker(actor: User, ctx: AuditRequestContext) -> None:
    time.sleep(0.75)
    try:
        with Session(get_engine()) as session:
            log_audit(
                session,
                actor=actor,
                action="system.restart",
                target_type="system",
                target_id="backend",
                meta={"reason": "manual"},
                ip=ctx.ip,
                ua=ctx.user_agent,
                corr=ctx.correlation_id,
            )
            session.commit()
    except Exception as exc:
        logger.exception("Failed to audit system restart: %s", exc)
    pid = os.getpid()
    logger.warning("Restarting now pid=%s", pid)
    # If no supervisor/reloader is present, the process will exit without respawn.
    try:
        os.kill(pid, signal.SIGTERM)
    finally:
        time.sleep(0.25)
        os._exit(0)


@router.post("/restart", status_code=status.HTTP_202_ACCEPTED)
def restart_system(
    payload: RestartRequest,
    current_user: User = Depends(require_permission(PermissionCode.SYSTEM_RESTART)),
    ctx: AuditRequestContext = Depends(get_request_audit_context),
):
    if payload.confirm != "RESTART":
        raise HTTPException(status_code=400, detail="Confirmación inválida")
    if is_restarting():
        return {"status": "accepted", "message": "Restart already scheduled"}
    set_restarting(True)
    logger.warning(
        "Restart scheduled by user=%s id=%s pid=%s",
        current_user.username,
        current_user.id,
        os.getpid(),
    )
    threading.Thread(target=_restart_worker, args=(current_user, ctx), daemon=True).start()
    return {"status": "accepted", "message": "Restart scheduled"}


@router.get("/diagnostics")
def get_system_diagnostics(
    _user: User = Depends(require_permission(PermissionCode.SYSTEM_SETTINGS_VIEW)),
):
    now_iso = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    providers: list[dict] = []

    # VMware (vCenter)
    vcenter_cfg = vm_service._resolve_vcenter_settings()  # reusa normalizacion existente
    vcenter_host, vcenter_port = _parse_host_port(vcenter_cfg.get("host"), 443)
    vmware_entry = _build_provider_entry(
        "vmware",
        "VMware",
        enabled=settings.vmware_enabled,
        configured=settings.vmware_configured,
        missing=settings.vmware_missing_envs or [],
    )
    vmware_target = {
        "id": f"{vcenter_host or 'sin-host'}:{vcenter_port or '-'}",
        "label": "vCenter",
        "host": vcenter_host,
        "port": vcenter_port,
        "connection": _tcp_check(vcenter_host, vcenter_port),
        "auth": {"state": "skipped", "error": "sin_conexion"},
    }
    if settings.vmware_enabled and settings.vmware_configured:
        if vmware_target["connection"]["state"] == "ok":
            vmware_target["auth"] = _auth_check(vm_service.get_session_token)
    else:
        vmware_target["auth"] = {"state": "skipped", "error": "provider_no_configurado"}
        if not settings.vmware_enabled:
            vmware_target["connection"] = {"state": "skipped", "error": "provider_deshabilitado"}
    vmware_entry["targets"].append(vmware_target)
    providers.append(vmware_entry)

    # KVM (oVirt)
    ovirt_host, ovirt_port = _parse_host_port(settings.ovirt_base_url, 443)
    ovirt_entry = _build_provider_entry(
        "ovirt",
        "KVM",
        enabled=settings.ovirt_enabled,
        configured=settings.ovirt_configured,
        missing=settings.ovirt_missing_envs or [],
    )
    ovirt_target = {
        "id": f"{ovirt_host or 'sin-host'}:{ovirt_port or '-'}",
        "label": "oVirt API",
        "host": ovirt_host,
        "port": ovirt_port,
        "connection": _tcp_check(ovirt_host, ovirt_port),
        "auth": {"state": "skipped", "error": "sin_conexion"},
    }
    if settings.ovirt_enabled and settings.ovirt_configured:
        if ovirt_target["connection"]["state"] == "ok":
            ovirt_target["auth"] = _auth_check(ovirt_service._request_sso_token)
    else:
        ovirt_target["auth"] = {"state": "skipped", "error": "provider_no_configurado"}
        if not settings.ovirt_enabled:
            ovirt_target["connection"] = {"state": "skipped", "error": "provider_deshabilitado"}
    ovirt_entry["targets"].append(ovirt_target)
    providers.append(ovirt_entry)

    # CEDIA
    cedia_host, cedia_port = _parse_host_port(settings.cedia_base, 443)
    cedia_entry = _build_provider_entry(
        "cedia",
        "CEDIA",
        enabled=settings.cedia_enabled,
        configured=settings.cedia_configured,
        missing=settings.cedia_missing_envs or [],
    )
    cedia_target = {
        "id": f"{cedia_host or 'sin-host'}:{cedia_port or '-'}",
        "label": "CEDIA API",
        "host": cedia_host,
        "port": cedia_port,
        "connection": _tcp_check(cedia_host, cedia_port),
        "auth": {"state": "skipped", "error": "sin_conexion"},
    }
    if settings.cedia_enabled and settings.cedia_configured:
        if cedia_target["connection"]["state"] == "ok":
            cedia_target["auth"] = _auth_check(cedia_service.login)
    else:
        cedia_target["auth"] = {"state": "skipped", "error": "provider_no_configurado"}
        if not settings.cedia_enabled:
            cedia_target["connection"] = {"state": "skipped", "error": "provider_deshabilitado"}
    cedia_entry["targets"].append(cedia_target)
    providers.append(cedia_entry)

    # Hyper-V
    hyperv_entry = _build_provider_entry(
        "hyperv",
        "Hyper-V",
        enabled=settings.hyperv_enabled,
        configured=settings.hyperv_configured,
        missing=settings.hyperv_missing_envs or [],
    )
    hyperv_hosts = settings.hyperv_hosts_configured
    ports: list[tuple[str, int, bool]] = []
    if settings.hyperv_winrm_https_enabled:
        ports.append(("https", 5986, bool(settings.hyperv_ca_bundle)))
    if settings.hyperv_winrm_http_enabled:
        ports.append(("http", 5985, False))
    if not ports:
        ports.append(("http", 5985, False))

    for host in hyperv_hosts or ["sin-host"]:
        for scheme, port, validate_tls in ports:
            connection = _tcp_check(host, port)
            auth_state = {"state": "skipped", "error": "sin_conexion"}
            if settings.hyperv_enabled and settings.hyperv_configured and connection["state"] == "ok":
                creds = RemoteCreds(
                    host=host,
                    username=settings.hyperv_user,
                    password=settings.hyperv_pass,
                    transport=settings.hyperv_transport or "ntlm",
                    winrm_https_enabled=settings.hyperv_winrm_https_enabled,
                    winrm_http_enabled=settings.hyperv_winrm_http_enabled,
                    connect_timeout=settings.hyperv_connect_timeout,
                    ca_trust_path=settings.hyperv_ca_bundle,
                )
                auth_state = _auth_check(
                    lambda: _probe_winrm_endpoint(
                        creds,
                        scheme=scheme,
                        port=port,
                        validate_tls=validate_tls,
                    )
                )
            elif not settings.hyperv_enabled:
                connection = {"state": "skipped", "error": "provider_deshabilitado"}
                auth_state = {"state": "skipped", "error": "provider_deshabilitado"}
            elif not settings.hyperv_configured:
                auth_state = {"state": "skipped", "error": "provider_no_configurado"}

            hyperv_entry["targets"].append(
                {
                    "id": f"{host}:{port}",
                    "label": f"{host} ({scheme.upper()}:{port})",
                    "host": host,
                    "port": port,
                    "connection": connection,
                    "auth": auth_state,
                }
            )
    providers.append(hyperv_entry)

    # Azure
    azure_entry = _build_provider_entry(
        "azure",
        "Azure",
        enabled=settings.azure_enabled,
        configured=settings.azure_configured,
        missing=settings.azure_missing_envs or [],
    )
    azure_api_host, azure_api_port = _parse_host_port(settings.azure_api_base, 443)
    oauth_host, oauth_port = _parse_host_port("https://login.microsoftonline.com", 443)

    oauth_target = {
        "id": f"{oauth_host or 'sin-host'}:{oauth_port or '-'}",
        "label": "Azure OAuth",
        "host": oauth_host,
        "port": oauth_port,
        "connection": _tcp_check(oauth_host, oauth_port),
        "auth": {"state": "skipped", "error": "sin_conexion"},
    }
    if settings.azure_enabled and settings.azure_configured:
        if oauth_target["connection"]["state"] == "ok":
            client = AzureArmClient()
            oauth_target["auth"] = _auth_check(client.get_token)
    else:
        oauth_target["auth"] = {"state": "skipped", "error": "provider_no_configurado"}
        if not settings.azure_enabled:
            oauth_target["connection"] = {"state": "skipped", "error": "provider_deshabilitado"}

    arm_target = {
        "id": f"{azure_api_host or 'sin-host'}:{azure_api_port or '-'}",
        "label": "Azure ARM",
        "host": azure_api_host,
        "port": azure_api_port,
        "connection": _tcp_check(azure_api_host, azure_api_port),
        "auth": {"state": "skipped", "error": "no_aplica"},
    }
    if not settings.azure_enabled:
        arm_target["connection"] = {"state": "skipped", "error": "provider_deshabilitado"}

    azure_entry["targets"].extend([oauth_target, arm_target])
    providers.append(azure_entry)

    return {"generated_at": now_iso, "providers": providers}
