from __future__ import annotations

from typing import List

from fastapi import APIRouter, Depends, Query

from app.azure import service as azure_service
from app.azure.models import AzureVMRecord
from app.dependencies import require_permission
from app.permissions.models import PermissionCode

router = APIRouter(prefix="/api/azure", tags=["azure"])


@router.get("/vms", response_model=List[AzureVMRecord], dependencies=[Depends(require_permission(PermissionCode.AZURE_VIEW))])
def azure_list_vms(
    include_power_state: bool = Query(
        False,
        description="Si es true, consulta instanceView para powerState por VM",
    ),
):
    return azure_service.list_azure_vms(include_power_state=include_power_state)
