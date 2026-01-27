import logging
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Path, Query
from fastapi.responses import JSONResponse
from sqlmodel import Session

from app.audit.service import log_audit
from app.auth.user_model import User
from app.db import get_session
from app.dependencies import (
    AuditRequestContext,
    get_request_audit_context,
    require_permission,
)
from app.permissions.models import PermissionCode
from app.utils.text import normalize_text
from app.vms.vm_models import VMBase, VMDetail
from app.vms.vm_perf_service import get_vm_perf_summary
from app.vms.vm_service import get_vm_detail, get_vms, power_action

router = APIRouter()
logger = logging.getLogger(__name__)


@router.get("/vms", response_model=List[VMBase])
def list_vms(
    name: Optional[str] = Query(None, description="Filtrar por nombre parcial"),
    environment: Optional[str] = Query(None, description="Filtrar por ambiente"),
    refresh: bool = Query(False, description="Forzar refresco del inventario de VMware"),
    current_user: User = Depends(require_permission(PermissionCode.VMS_VIEW)),
    session: Session = Depends(get_session),
    audit_ctx: AuditRequestContext = Depends(get_request_audit_context),
):
    logger.info(
        "GET /api/vms requested by '%s' (refresh=%s)",
        current_user.username,
        refresh,
    )

    log_audit(
        session,
        actor=current_user,
        action="vms.view",
        target_type="vms",
        target_id="list",
        meta={"name": name, "environment": environment, "refresh": refresh},
        ip=audit_ctx.ip,
        ua=audit_ctx.user_agent,
        corr=audit_ctx.correlation_id,
    )
    session.commit()

    try:
        vms = get_vms(refresh=refresh)
    except Exception:
        logger.exception("Error while retrieving VMs")
        raise HTTPException(status_code=500, detail="Error interno al obtener VMs")

    if name:
        vms = [vm for vm in vms if name.lower() in vm.name.lower()]
    if environment:
        target_env = normalize_text(environment)
        vms = [
            vm
            for vm in vms
            if normalize_text(vm.environment) == target_env
        ]
    return vms


@router.post("/vms/{vm_id}/power/{action}")
def vm_power_action(
    vm_id: str = Path(..., description="ID de la VM"),
    action: str = Path(..., description="Accion: start, stop o reset"),
    current_user: User = Depends(require_permission(PermissionCode.VMS_POWER)),
    session: Session = Depends(get_session),
    audit_ctx: AuditRequestContext = Depends(get_request_audit_context),
):
    if action not in {"start", "stop", "reset"}:
        return JSONResponse(status_code=400, content={"error": "Accion no valida"})

    logger.info(
        "Power action '%s' requested for VM '%s' by '%s'",
        action,
        vm_id,
        current_user.username,
    )
    result = power_action(vm_id, action)
    log_audit(
        session,
        actor=current_user,
        action="vms.power_action",
        target_type="vm",
        target_id=vm_id,
        meta={"action": action},
        ip=audit_ctx.ip,
        ua=audit_ctx.user_agent,
        corr=audit_ctx.correlation_id,
    )
    session.commit()
    return result


@router.get("/vms/{vm_id}/perf")
def vm_perf_summary(
    vm_id: str = Path(..., description="ID de la VM"),
    window: int = Query(60, ge=20, le=1800, description="Ventana en segundos para recopilar metricas (20-1800)."),
    idle_to_zero: bool = Query(
        False,
        description="Si es true, rellena con 0 los contadores de disco sin actividad en la ventana."
    ),
    by_disk: bool = Query(
        False,
        description="Incluye metricas por disco (instancias individuales)."
    ),
    current_user: User = Depends(require_permission(PermissionCode.VMS_VIEW)),
    session: Session = Depends(get_session),
    audit_ctx: AuditRequestContext = Depends(get_request_audit_context),
):
    logger.debug(
        "Fetching perf metrics for VM '%s' requested by '%s' (window=%s, idle_to_zero=%s, by_disk=%s)",
        vm_id,
        current_user.username,
        window,
        idle_to_zero,
        by_disk,
    )
    log_audit(
        session,
        actor=current_user,
        action="vms.perf.view",
        target_type="vm",
        target_id=vm_id,
        meta={"window": window, "idle_to_zero": idle_to_zero, "by_disk": by_disk},
        ip=audit_ctx.ip,
        ua=audit_ctx.user_agent,
        corr=audit_ctx.correlation_id,
    )
    session.commit()
    return get_vm_perf_summary(
        vm_id,
        window_seconds=window,
        idle_to_zero=idle_to_zero,
        by_disk=by_disk,
    )

@router.get("/vms/{vm_id}", response_model=VMDetail)
def vm_detail(
    vm_id: str = Path(..., description="ID de la VM"),
    current_user: User = Depends(require_permission(PermissionCode.VMS_VIEW)),
    session: Session = Depends(get_session),
    audit_ctx: AuditRequestContext = Depends(get_request_audit_context),
):
    safe_id = vm_id.replace("_", "-")
    logger.debug(
        "Fetching detail for VM '%s' (normalized '%s') requested by '%s'",
        vm_id,
        safe_id,
        current_user.username,
    )
    log_audit(
        session,
        actor=current_user,
        action="vms.detail.view",
        target_type="vm",
        target_id=vm_id,
        meta={"normalized_id": safe_id},
        ip=audit_ctx.ip,
        ua=audit_ctx.user_agent,
        corr=audit_ctx.correlation_id,
    )
    session.commit()
    return get_vm_detail(safe_id)
