# —————— Importaciones y configuración del router ——————
import logging
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Path, Query
from fastapi.responses import JSONResponse

from app.dependencies import get_current_user
from app.utils.text import normalize_text
from app.vms.vm_models import VMBase, VMDetail
from app.vms.vm_service import get_vm_detail, get_vms, power_action

router = APIRouter()
logger = logging.getLogger(__name__)

# —————— Endpoint: Listar VMs ——————
@router.get("/vms", response_model=List[VMBase])
def list_vms(
    name: Optional[str]        = Query(None, description="Filtrar por nombre parcial"),
    environment: Optional[str] = Query(None, description="Filtrar por ambiente"),
    current_user: str          = Depends(get_current_user),
):
    """
    Lista todas las máquinas virtuales disponibles.
    - Aplica filtros opcionales por nombre y entorno.
    - Requiere autenticación previa.
    - Maneja errores internos al obtener la lista de VMs.
    """
    logger.info("GET /api/vms requested by '%s'", current_user)

    try:
        vms = get_vms()
    except Exception as e:
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

# —————— Endpoint: Acciones de energía sobre una VM ——————
@router.post("/vms/{vm_id}/power/{action}")
def vm_power_action(
    vm_id: str        = Path(..., description="ID de la VM"),
    action: str       = Path(..., description="Acción: start, stop o reset"),
    current_user: str = Depends(get_current_user),
):
    """
    Ejecuta una acción de power (start, stop o reset) sobre la VM indicada.
    - Valida que la acción sea una de las permitidas.
    - Retorna una respuesta JSON con el resultado o un error 400 si la acción no es válida.
    """
    if action not in {"start", "stop", "reset"}:
        return JSONResponse(status_code=400, content={"error": "Acción no válida"})

    logger.info("Power action '%s' requested for VM '%s' by '%s'", action, vm_id, current_user)
    return power_action(vm_id, action)

# —————— Endpoint: Detalle de una VM ——————
@router.get("/vms/{vm_id}", response_model=VMDetail)
def vm_detail(
    vm_id: str        = Path(..., description="ID de la VM"),
    current_user: str = Depends(get_current_user),
):
    """
    Obtiene el detalle completo de una máquina virtual:
    - Reemplaza guiones bajos por medios para sanitizar el ID.
    - Devuelve todos los campos extendidos definidos en VMDetail.
    """
    safe_id = vm_id.replace("_", "-")
    logger.debug("Fetching detail for VM '%s' (normalized '%s')", vm_id, safe_id)
    return get_vm_detail(safe_id)
