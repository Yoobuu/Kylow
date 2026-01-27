from __future__ import annotations

from typing import List

from fastapi import APIRouter, Depends, Query
from sqlmodel import Session

from app.audit.service import log_audit
from app.auth.user_model import User
from app.azure import service as azure_service
from app.azure.models import AzureVMRecord
from app.db import get_session
from app.dependencies import AuditRequestContext, get_request_audit_context, require_permission
from app.permissions.models import PermissionCode

router = APIRouter(prefix="/api/azure", tags=["azure"])


@router.get("/vms", response_model=List[AzureVMRecord])
def azure_list_vms(
    include_power_state: bool = Query(
        False,
        description="Si es true, consulta instanceView para powerState por VM",
    ),
    current_user: User = Depends(require_permission(PermissionCode.AZURE_VIEW)),
    session: Session = Depends(get_session),
    audit_ctx: AuditRequestContext = Depends(get_request_audit_context),
):
    log_audit(
        session,
        actor=current_user,
        action="azure.vms.view",
        target_type="vms",
        target_id="list",
        meta={"include_power_state": include_power_state},
        ip=audit_ctx.ip,
        ua=audit_ctx.user_agent,
        corr=audit_ctx.correlation_id,
    )
    session.commit()
    return azure_service.list_azure_vms(include_power_state=include_power_state)
