from __future__ import annotations

import logging
from typing import Literal, Tuple

from fastapi import HTTPException

from app.providers.hyperv.schema import VMRecord
from app.providers.hyperv.remote import RemoteCreds, run_power_action
from app.vms.hyperv_service import collect_hyperv_inventory_for_host
from app.vms.vm_service import infer_environment
from app.providers.hyperv import hosts as hv_hosts  # SANDBOX / TEST / PROD

logger = logging.getLogger("hyperv.power")

AllowedAction = Literal["start", "stop", "reset"]


def _is_sandbox_vm(vm: VMRecord) -> bool:
    """
    Devuelve True solo si la VM es sandbox.
    Condiciones:
    1. infer_environment(vm.Name) == "sandbox"
    2. vm.HVHost esta listado en hv_hosts.SANDBOX
    """
    env_by_name = infer_environment(vm.Name)
    host_ok = vm.HVHost in getattr(hv_hosts, "SANDBOX", [])
    return (env_by_name == "sandbox") and host_ok


def _pick_vm(vms: list[VMRecord], vm_name: str) -> VMRecord:
    """
    Busca coincidencia exacta por nombre de VM dentro de la lista vms.
    Lanza HTTP 404 si no encuentra coincidencia exacta.
    """
    for rec in vms:
        if rec.Name == vm_name:
            return rec
    raise HTTPException(status_code=404, detail=f"VM '{vm_name}' no encontrada en este host")


def _do_power_action(creds: RemoteCreds, vm_name: str, action: AllowedAction) -> Tuple[bool, str]:
    """
    Ejecuta la accion real sobre la VM en Hyper-V via WinRM.
    Usa run_power_action, igual que el endpoint /lab/power.
    Devuelve (ok, msg).
    """
    ok, msg = run_power_action(creds, vm_name, action)
    logger.info(
        "Power action '%s' on VM '%s' at host '%s': ok=%s msg=%s",
        action, vm_name, creds.host, ok, msg
    )
    return ok, msg


def hyperv_power_action(
    creds: RemoteCreds,
    vm_name: str,
    action: AllowedAction,
    ps_content_inventory: str,
    use_cache: bool = True,
) -> dict:
    """
    Flujo completo:
    1. Obtener inventario del host (para descubrir la VM objetivo).
    2. Ubicar la VM por nombre exacto.
    3. Ejecutar la accion de energia.
    4. Devolver respuesta JSON.
    """
    # 1) inventario
    vm_list = collect_hyperv_inventory_for_host(
        creds,
        ps_content=ps_content_inventory,
        use_cache=use_cache,
    )

    # 2) seleccionar VM
    target_vm = _pick_vm(vm_list, vm_name)

    # 3) ejecutar accion
    ok, msg = _do_power_action(creds, target_vm.Name, action)

    # 4) respuesta
    if not ok:
        raise HTTPException(status_code=500, detail=msg)

    logger.info(
        "Accion '%s' aceptada para VM '%s' en host '%s'",
        action, target_vm.Name, target_vm.HVHost
    )

    return {
        "vm": target_vm.Name,
        "host": target_vm.HVHost,
        "action": action,
        "status": "accepted",
        "message": msg,
    }

