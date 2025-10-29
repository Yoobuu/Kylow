"""Services for interacting with VMware vCenter (REST + SOAP helpers)."""

from __future__ import annotations

import logging
import os
import ssl
from threading import Lock
from typing import Dict, Iterable, List, Optional, Tuple

import requests
import urllib3
from cachetools import TTLCache
from fastapi import HTTPException
from pyVim.connect import Disconnect, SmartConnect  # SOAP client
from pyVmomi import vim  # vSphere SDK types

from app.config import VCENTER_HOST, VCENTER_PASS, VCENTER_USER
from app.vms.vm_models import VMBase, VMDetail

logger = logging.getLogger(__name__)

# ───────────────────────────────────────────────────────────────────────
# Configuración global y mapeos
# ───────────────────────────────────────────────────────────────────────
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

# Mapa de versiones VMX → descripción humana
COMPAT_MAP = {
    "VMX_03": "ESXi 2.5 and later (VM version 3)",
    # ... (otros mapeos intermedios) ...
    "VMX_21": "ESXi 8.0 U2 and later (VM version 21)",
}


class ThreadSafeTTLCache:
    """Wrap TTLCache with a lock to make cache operations thread-safe."""

    def __init__(self, *, maxsize: int, ttl: int) -> None:
        self._cache = TTLCache(maxsize=maxsize, ttl=ttl)
        self._lock = Lock()

    def __contains__(self, key: str) -> bool:
        with self._lock:
            return key in self._cache

    def __getitem__(self, key: str):
        with self._lock:
            return self._cache[key]

    def __setitem__(self, key: str, value) -> None:
        with self._lock:
            self._cache[key] = value

    def get(self, key: str, default=None):
        with self._lock:
            return self._cache.get(key, default)

    def setdefault(self, key: str, default):
        with self._lock:
            return self._cache.setdefault(key, default)

    def clear(self) -> None:
        with self._lock:
            self._cache.clear()


# CACHÉS de datos para evitar llamadas repetidas
vm_cache = ThreadSafeTTLCache(maxsize=1, ttl=300)        # listado de VMs
identity_cache = ThreadSafeTTLCache(maxsize=1000, ttl=300)  # guest identity
network_cache = ThreadSafeTTLCache(maxsize=2000, ttl=300)   # nombres de red individuales
net_list_cache = ThreadSafeTTLCache(maxsize=1, ttl=300)     # mapeo completo de redes
host_cache = ThreadSafeTTLCache(maxsize=200, ttl=300)       # nombres de host
placement_cache = ThreadSafeTTLCache(maxsize=2000, ttl=300)  # host y cluster (SOAP)

# ───────────────────────────────────────────────────────────────────────
# Utilidades de configuración / estado
# ───────────────────────────────────────────────────────────────────────


def reset_caches() -> None:
    """Clear all caches to keep startup deterministic and avoid stale data."""
    for cache in (vm_cache, identity_cache, network_cache, net_list_cache, host_cache, placement_cache):
        cache.clear()


def _resolve_vcenter_settings() -> Dict[str, Optional[str]]:
    """Fetch vCenter configuration from environment, preserving current behaviour."""
    host = os.getenv("VCENTER_HOST", VCENTER_HOST)
    user = os.getenv("VCENTER_USER", VCENTER_USER)
    password = os.getenv("VCENTER_PASS", VCENTER_PASS)
    sanitized_host = (host or "").replace("https://", "").replace("http://", "")
    return {
        "host": host,
        "user": user,
        "password": password,
        "soap_host": sanitized_host,
    }


def validate_vcenter_configuration() -> List[str]:
    """Return a list of issues if essential vCenter credentials are missing."""
    settings = _resolve_vcenter_settings()
    issues: List[str] = []

    if not settings["host"]:
        issues.append("VCENTER_HOST is not configured")
    if settings["host"] and not settings["soap_host"]:
        issues.append("VCENTER_HOST normalizes to an empty host")
    if not settings["user"]:
        issues.append("VCENTER_USER is not configured")
    if not settings["password"]:
        issues.append("VCENTER_PASS is not configured")

    return issues


# ───────────────────────────────────────────────────────────────────────
# SOAP helpers
# ───────────────────────────────────────────────────────────────────────


def _soap_connect():
    """
    Crea una conexión no verificada al vCenter via pyVmomi
    y devuelve el ServiceInstance y su Content.
    """
    settings = _resolve_vcenter_settings()
    if not settings["soap_host"] or not settings["user"] or not settings["password"]:
        raise RuntimeError("Incomplete vCenter SOAP configuration")

    ctx = ssl._create_unverified_context()
    si = SmartConnect(
        host=settings["soap_host"],
        user=settings["user"],
        pwd=settings["password"],
        port=443,
        sslContext=ctx,
    )
    return si, si.RetrieveContent()


def _build_placement_map() -> Dict[str, Tuple[str, str]]:
    """Load host/cluster information for all VMs in a single SOAP pass."""
    results: Dict[str, Tuple[str, str]] = {}
    try:
        si, content = _soap_connect()
    except Exception as exc:  # pragma: no cover - defensive
        logger.warning("Unable to build placement map via SOAP: %s", exc)
        return results

    view = None
    try:
        view = content.viewManager.CreateContainerView(content.rootFolder, [vim.VirtualMachine], True)
        for vm in view.view:
            host_name = "<sin datos host>"
            cluster_name = "<sin datos cluster>"
            host_obj = getattr(vm.summary.runtime, "host", None)
            cluster_obj = getattr(host_obj, "parent", None) if host_obj else None
            if host_obj and getattr(host_obj, "name", None):
                host_name = host_obj.name
            if cluster_obj and getattr(cluster_obj, "name", None):
                cluster_name = cluster_obj.name
            results[vm._moId] = (host_name, cluster_name)
    except Exception as exc:  # pragma: no cover - defensive
        logger.exception("Failed to build placement view")
    finally:
        if view is not None:
            try:
                view.Destroy()
            except Exception:  # pragma: no cover - defensive
                logger.debug("Error destroying SOAP view", exc_info=True)
        try:
            Disconnect(si)
        except Exception:  # pragma: no cover - defensive
            logger.debug("Error disconnecting SOAP session", exc_info=True)

    return results


def get_host_cluster_soap(vm_id: str) -> Tuple[str, str]:
    """
    Obtiene el nombre del host y cluster que hospedan la VM.
    Utiliza pyVmomi (SOAP) y cache para mejorar rendimiento.
    """
    if vm_id in placement_cache:
        return placement_cache[vm_id]

    placement_map = _build_placement_map()
    for key, value in placement_map.items():
        placement_cache[key] = value

    return placement_cache.get(vm_id, ("<sin datos host>", "<sin datos cluster>"))


# ───────────────────────────────────────────────────────────────────────
# REST helpers
# ───────────────────────────────────────────────────────────────────────


def get_session_token() -> str:
    """
    Autentica contra la API REST de vCenter para obtener un token de sesión.
    Lanza HTTPException en caso de fallo.
    """
    settings = _resolve_vcenter_settings()
    if not settings["host"] or not settings["user"] or not settings["password"]:
        raise HTTPException(status_code=500, detail="Configuración de vCenter incompleta")

    try:
        response = requests.post(
            f"{settings['host']}/rest/com/vmware/cis/session",
            auth=(settings["user"], settings["password"]),
            verify=False,
            timeout=5,
        )
        response.raise_for_status()
        return response.json()["value"]
    except Exception as exc:
        logger.exception("Failed to obtain vCenter session token")
        code = getattr(exc, "response", None) and exc.response.status_code or 500
        raise HTTPException(status_code=code, detail=f"Auth failed: {exc}")


def infer_environment(name: str) -> str:
    """
    Inferencia de entorno (test, producción, sandbox, desarrollo)
    a partir del prefijo del nombre de la VM.
    """
    p = (name or "").upper()
    if p.startswith("T-"):
        return "test"
    if p.startswith("P-"):
        return "producción"
    if p.startswith("S"):
        return "sandbox"
    if p.startswith("D-"):
        return "desarrollo"
    return "desconocido"


def _network_endpoint(path: str) -> str:
    settings = _resolve_vcenter_settings()
    return f"{settings['host']}{path}"


def load_network_map(headers: dict) -> Dict[str, str]:
    """
    Carga el mapeo completo de IDs de red → nombres legibles.
    Utiliza cache para evitar llamadas REST repetidas.
    """
    cached = net_list_cache.get("net_map")
    if cached is not None:
        return cached

    try:
        response = requests.get(
            _network_endpoint("/rest/vcenter/network"),
            headers=headers,
            verify=False,
            timeout=10,
        )
        response.raise_for_status()
        mapping = {item["network"]: item["name"] for item in response.json().get("value", [])}
    except Exception as exc:
        logger.debug("load_network_map fail → %s", exc)
        mapping = {}

    net_list_cache["net_map"] = mapping
    return mapping


def get_network_name(network_id: str, headers: dict) -> str:
    """
    Consulta el nombre de una red específica por su ID via REST,
    con caching local para mejorar rendimiento.
    """
    if network_id in network_cache:
        return network_cache[network_id]
    try:
        response = requests.get(
            _network_endpoint(f"/rest/vcenter/network/{network_id}"),
            headers=headers,
            verify=False,
            timeout=5,
        )
        response.raise_for_status()
        name = response.json().get("value", {}).get("name", "<sin nombre>")
    except Exception as exc:
        logger.debug("get_network_name %s fail → %s", network_id, exc)
        name = "<error>"
    network_cache[network_id] = name
    return name


def fetch_guest_identity(vm_id: str, headers: dict) -> dict:
    """
    Obtiene información de identidad del guest OS via REST.
    Guarda en cache los resultados para reuso.
    """
    if vm_id in identity_cache:
        return identity_cache[vm_id]
    try:
        response = requests.get(
            _network_endpoint(f"/rest/vcenter/vm/{vm_id}/guest/identity"),
            headers=headers,
            verify=False,
            timeout=5,
        )
        value = response.json().get("value", {}) if response.status_code == 200 else {}
    except Exception as exc:  # pragma: no cover - defensive
        logger.debug("fetch_guest_identity %s failed: %s", vm_id, exc)
        value = {}
    identity_cache[vm_id] = value
    return value


def _extract_ip_list(identity_payload: dict) -> List[str]:
    ip_val = identity_payload.get("ip_address")
    if isinstance(ip_val, str):
        return [ip_val]
    if isinstance(ip_val, list):
        return [ip for ip in ip_val if isinstance(ip, str)]
    return []


def _extract_disk_sizes(disks_payload: Iterable[dict]) -> List[str]:
    disk_sizes: List[str] = []
    for disk in disks_payload:
        capacity = disk.get("value", {}).get("capacity")
        if isinstance(capacity, int):
            disk_sizes.append(f"{capacity // (1024**3)} GB")
    return disk_sizes


def _extract_nic_labels(nics_payload: Iterable[dict]) -> List[str]:
    labels: List[str] = []
    for nic in nics_payload:
        label = nic.get("value", {}).get("label")
        if label:
            labels.append(label)
    return labels


def _resolve_networks(
    vm_id: str,
    headers: dict,
    net_map: Dict[str, str],
    summary_nics: Iterable[dict],
) -> List[str]:
    networks: List[str] = []
    try:
        ether_resp = requests.get(
            _network_endpoint(f"/rest/vcenter/vm/{vm_id}/hardware/ethernet"),
            headers=headers,
            verify=False,
            timeout=5,
        )
        if ether_resp.status_code == 200:
            for nic in ether_resp.json().get("value", []):
                backing = nic.get("backing", {})
                if backing.get("network_name"):
                    networks.append(backing["network_name"])
                elif backing.get("network"):
                    nid = backing["network"]
                    networks.append(net_map.get(nid) or get_network_name(nid, headers))
    except Exception as exc:
        logger.debug("VM %s: ethernet fetch failed → %s", vm_id, exc)

    if networks:
        return networks

    for nic in summary_nics:
        backing = nic.get("value", {}).get("backing", {})
        if backing.get("network_name"):
            networks.append(backing["network_name"])
        elif backing.get("network"):
            nid = backing["network"]
            networks.append(net_map.get(nid) or get_network_name(nid, headers))

    return networks or ["<sin datos>"]


# ───────────────────────────────────────────────────────────────────────
# Servicios públicos
# ───────────────────────────────────────────────────────────────────────


def get_vms() -> List[VMBase]:
    """
    Recupera y construye la lista de máquinas virtuales:
      1. Autentica y obtiene token de sesión.
      2. Carga mapeo de redes.
      3. Llama al endpoint REST para listado de VMs.
      4. Por cada VM:
         - Consulta detalles básicos (hardware, guest OS).
         - Obtiene host y cluster por SOAP.
         - Extrae IPs, discos y NICs.
         - Resuelve nombres de redes primarias y fallback.
      5. Cachea el resultado completo.
    """
    if "vms" in vm_cache:
        return vm_cache["vms"]

    token = get_session_token()
    headers = {"vmware-api-session-id": token}
    net_map = load_network_map(headers)

    response = requests.get(
        _network_endpoint("/rest/vcenter/vm"),
        headers=headers,
        verify=False,
        timeout=10,
    )
    response.raise_for_status()

    out: List[VMBase] = []
    for vm in response.json().get("value", []):
        vm_id = vm["vm"]
        vm_name = vm["name"] or f"<sin nombre {vm_id}>"
        env = infer_environment(vm_name)

        summary_resp = requests.get(
            _network_endpoint(f"/rest/vcenter/vm/{vm_id}"),
            headers=headers,
            verify=False,
            timeout=5,
        )
        summary_data = summary_resp.json().get("value", {}) if summary_resp.status_code == 200 else {}
        guest_os = summary_data.get("guest_OS")

        hardware_resp = requests.get(
            _network_endpoint(f"/rest/vcenter/vm/{vm_id}/hardware"),
            headers=headers,
            verify=False,
            timeout=5,
        )
        hardware_data = hardware_resp.json().get("value", {}) if hardware_resp.status_code == 200 else {}

        compat_code = hardware_data.get("version", "<sin datos>")
        compat_human = COMPAT_MAP.get(compat_code, compat_code)

        host_name, cluster_name = get_host_cluster_soap(vm_id)

        ident = fetch_guest_identity(vm_id, headers)
        ips = _extract_ip_list(ident)

        disks = _extract_disk_sizes(summary_data.get("disks", []))
        nics = _extract_nic_labels(summary_data.get("nics", []))

        networks = _resolve_networks(vm_id, headers, net_map, summary_data.get("nics", []))

        out.append(
            VMBase(
                id=vm_id,
                name=vm_name,
                power_state=vm.get("power_state", "unknown"),
                cpu_count=vm.get("cpu_count", 0),
                memory_size_MiB=vm.get("memory_size_MiB", 0),
                environment=env,
                guest_os=guest_os,
                host=host_name,
                cluster=cluster_name,
                compatibility_code=compat_code,
                compatibility_human=compat_human,
                networks=networks,
                ip_addresses=ips,
                disks=disks,
                nics=nics,
            )
        )

    vm_cache["vms"] = out
    return out


def power_action(vm_id: str, action: str) -> dict:
    """
    Ejecuta una acción de energía (start/stop/reset) sobre una VM
    vía REST y retorna un mensaje de resultado o lanza error HTTP.
    """
    token = get_session_token()
    headers = {"vmware-api-session-id": token}

    response = requests.post(
        _network_endpoint(f"/rest/vcenter/vm/{vm_id}/power/{action}"),
        headers=headers,
        verify=False,
        timeout=5,
    )
    if response.status_code == 200:
        return {"message": f"Acción '{action}' ejecutada en VM {vm_id}"}
    raise HTTPException(status_code=response.status_code, detail=response.text)


def get_vm_detail(vm_id: str) -> VMDetail:
    """
    Construye y retorna un VMDetail completo:
      - Obtiene summary, hardware y guest identity.
      - Procesa CPU, memoria, discos, NICs y redes.
      - Incluye host/cluster por SOAP y detalle de guest OS.
    """
    token = get_session_token()
    headers = {"vmware-api-session-id": token}

    summary_resp = requests.get(
        _network_endpoint(f"/rest/vcenter/vm/{vm_id}"),
        headers=headers,
        verify=False,
        timeout=10,
    )
    if summary_resp.status_code != 200:
        raise HTTPException(status_code=summary_resp.status_code, detail=summary_resp.text)
    summary = summary_resp.json().get("value", {})

    hardware_resp = requests.get(
        _network_endpoint(f"/rest/vcenter/vm/{vm_id}/hardware"),
        headers=headers,
        verify=False,
        timeout=5,
    )
    hardware = hardware_resp.json().get("value", {}) if hardware_resp.status_code == 200 else {}

    compat_code = hardware.get("version", "<sin datos>")
    compat_human = COMPAT_MAP.get(compat_code, compat_code)

    name = summary.get("name", vm_id)
    env = infer_environment(name)
    power_state = summary.get("power_state", "unknown")

    cpu = summary.get("cpu", {})
    mem = summary.get("memory", {})
    cpu_c = cpu.get("count", 0) if isinstance(cpu, dict) else summary.get("cpu_count", 0)
    mem_c = mem.get("size_MiB", 0) if isinstance(mem, dict) else summary.get("memory_size_MiB", 0)

    net_map = load_network_map(headers)
    host_name, cluster_name = get_host_cluster_soap(vm_id)

    disks = _extract_disk_sizes(summary.get("disks", []))
    nics = _extract_nic_labels(summary.get("nics", []))
    networks = _resolve_networks(vm_id, headers, net_map, summary.get("nics", []))

    ident = fetch_guest_identity(vm_id, headers)
    full = ident.get("full_name")
    guest_os = (
        full.get("default_message") if isinstance(full, dict) else full
    ) or ident.get("name") or summary.get("guest_OS") or "Desconocido"

    ips = _extract_ip_list(ident)

    return VMDetail(
        id=vm_id,
        name=name,
        power_state=power_state,
        cpu_count=cpu_c,
        memory_size_MiB=mem_c,
        environment=env,
        guest_os=guest_os,
        host=host_name,
        cluster=cluster_name,
        compatibility_code=compat_code,
        compatibility_human=compat_human,
        networks=networks,
        ip_addresses=ips,
        disks=disks,
        nics=nics,
    )
