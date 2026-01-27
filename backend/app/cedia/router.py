from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlmodel import Session

from app.audit.service import log_audit
from app.auth.user_model import User
from app.db import get_session
from app.dependencies import AuditRequestContext, get_request_audit_context, require_permission
from app.permissions.models import PermissionCode
from app.cedia import service as cedia_service

router = APIRouter(prefix="/api/cedia", tags=["cedia"])


@router.get("/login")
def cedia_login(
    current_user: User = Depends(require_permission(PermissionCode.CEDIA_VIEW)),
    session: Session = Depends(get_session),
    audit_ctx: AuditRequestContext = Depends(get_request_audit_context),
):
    """Obtiene un token nuevo de CEDIA."""
    log_audit(
        session,
        actor=current_user,
        action="cedia.login.view",
        target_type="cedia",
        target_id="login",
        meta=None,
        ip=audit_ctx.ip,
        ua=audit_ctx.user_agent,
        corr=audit_ctx.correlation_id,
    )
    session.commit()
    return cedia_service.login()


@router.get("/vms")
def cedia_list_vms(
    current_user: User = Depends(require_permission(PermissionCode.CEDIA_VIEW)),
    session: Session = Depends(get_session),
    audit_ctx: AuditRequestContext = Depends(get_request_audit_context),
):
    """Listado de VMs en CEDIA."""
    log_audit(
        session,
        actor=current_user,
        action="cedia.vms.view",
        target_type="vms",
        target_id="list",
        meta=None,
        ip=audit_ctx.ip,
        ua=audit_ctx.user_agent,
        corr=audit_ctx.correlation_id,
    )
    session.commit()
    return cedia_service.list_vms()


@router.get("/vms/{vm_id}")
def cedia_vm_detail(
    vm_id: str,
    current_user: User = Depends(require_permission(PermissionCode.CEDIA_VIEW)),
    session: Session = Depends(get_session),
    audit_ctx: AuditRequestContext = Depends(get_request_audit_context),
):
    """Detalle completo de una VM en CEDIA."""
    log_audit(
        session,
        actor=current_user,
        action="cedia.vm.detail.view",
        target_type="vm",
        target_id=vm_id,
        meta=None,
        ip=audit_ctx.ip,
        ua=audit_ctx.user_agent,
        corr=audit_ctx.correlation_id,
    )
    session.commit()
    return cedia_service.get_vm_detail(vm_id)


@router.get("/vms/{vm_id}/metrics")
def cedia_vm_metrics(
    vm_id: str,
    current_user: User = Depends(require_permission(PermissionCode.CEDIA_VIEW)),
    session: Session = Depends(get_session),
    audit_ctx: AuditRequestContext = Depends(get_request_audit_context),
):
    """Métricas actuales de una VM en CEDIA."""
    log_audit(
        session,
        actor=current_user,
        action="cedia.vm.metrics.view",
        target_type="vm",
        target_id=vm_id,
        meta=None,
        ip=audit_ctx.ip,
        ua=audit_ctx.user_agent,
        corr=audit_ctx.correlation_id,
    )
    session.commit()
    return cedia_service.get_vm_metrics(vm_id)
