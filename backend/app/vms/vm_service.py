"""Services for interacting with VMware vCenter (REST + SOAP helpers)."""

from __future__ import annotations

import logging
import ssl
from datetime import datetime, timezone
from dataclasses import dataclass
from threading import Lock
from typing import Dict, Iterable, List, Optional

import requests
from cachetools import TTLCache
from fastapi import HTTPException
from pyVim.connect import Disconnect, SmartConnect  # SOAP client
from pyVmomi import vim  # vSphere SDK types

from app.config import VCENTER_HOST, VCENTER_PASS, VCENTER_USER
from app.settings import settings
from app.vms.vm_models import VMBase, VMDetail
logger = logging.getLogger(__name__)

# ───────────────────────────────────────────────────────────────────────
# Configuración global y mapeos
# ───────────────────────────────────────────────────────────────────────

# Mapa de versiones VMX → descripción humana
COMPAT_MAP = {
    "VMX_03": "ESXi 2.5 and later (VM version 3)",
    # ... (otros mapeos intermedios) ...
    "VMX_21": "ESXi 8.0 U2 and later (VM version 21)",
}


@dataclass(frozen=True)
class PlacementInfo:
    host: str
    cluster: str
    cpu_usage_pct: Optional[float] = None
    ram_demand_mib: Optional[int] = None
    ram_usage_pct: Optional[float] = None

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
placement_cache = ThreadSafeTTLCache(maxsize=2000, ttl=300)  # host/cluster + quickstats (SOAP)

# ───────────────────────────────────────────────────────────────────────
# Utilidades de configuración / estado
# ───────────────────────────────────────────────────────────────────────


def reset_caches() -> None:
    """Clear all caches to keep startup deterministic and avoid stale data."""
    for cache in (vm_cache, identity_cache, network_cache, net_list_cache, host_cache, placement_cache):
        cache.clear()


def _resolve_vcenter_settings() -> Dict[str, Optional[str]]:
    """Fetch vCenter configuration from environment, preserving current behaviour."""
    if settings.test_mode:
        return {"host": None, "user": None, "password": None, "soap_host": None, "test_mode": True}
    host = settings.vcenter_host or VCENTER_HOST
    user = settings.vcenter_user or VCENTER_USER
    password = settings.vcenter_pass or VCENTER_PASS
    sanitized_host = (host or "").replace("https://", "").replace("http://", "")
    return {
        "host": host,
        "user": user,
        "password": password,
        "soap_host": sanitized_host,
    }


def _ensure_https(url: str | None, *, name: str) -> None:
    # Legacy mode: do not enforce HTTPS for external integrations.
    if not url:
        return


def _vcenter_tls_verify():
    return settings.vcenter_ca_bundle or False


def _vcenter_ssl_context() -> ssl.SSLContext:
    if settings.vcenter_ca_bundle:
        ctx = ssl.create_default_context()
        ctx.check_hostname = True
        ctx.load_verify_locations(settings.vcenter_ca_bundle)
        return ctx
    ctx = ssl._create_unverified_context()
    ctx.check_hostname = False
    return ctx


def validate_vcenter_configuration() -> List[str]:
    """Return a list of issues if essential vCenter credentials are missing."""
    if settings.test_mode:
        return []
    vcenter_cfg = _resolve_vcenter_settings()
    issues: List[str] = []

    if not vcenter_cfg["host"]:
        issues.append("VCENTER_HOST is not configured")
    if vcenter_cfg["host"] and not vcenter_cfg["soap_host"]:
        issues.append("VCENTER_HOST normalizes to an empty host")
    if not vcenter_cfg["user"]:
        issues.append("VCENTER_USER is not configured")
    if not vcenter_cfg["password"]:
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
    if settings.test_mode:
        return None, None
    vcenter_cfg = _resolve_vcenter_settings()
    if not vcenter_cfg["soap_host"] or not vcenter_cfg["user"] or not vcenter_cfg["password"]:
        raise RuntimeError("Incomplete vCenter SOAP configuration")

    _ensure_https(vcenter_cfg["host"], name="VCENTER_HOST")
    ctx = _vcenter_ssl_context()
    si = SmartConnect(
        host=vcenter_cfg["soap_host"],
        user=vcenter_cfg["user"],
        pwd=vcenter_cfg["password"],
        port=443,
        sslContext=ctx,
    )
    return si, si.RetrieveContent()


def _build_placement_map() -> Dict[str, PlacementInfo]:
    """Load host/cluster and quickstat information for all VMs in a single SOAP pass."""
    if settings.test_mode:
        return {}
    results: Dict[str, PlacementInfo] = {}
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

            cpu_usage_pct: Optional[float] = None
            ram_demand_mib: Optional[int] = None
            ram_usage_pct: Optional[float] = None

            try:
                summary = getattr(vm, "summary", None)
                runtime_info = getattr(summary, "runtime", None) if summary else None
                config_info = getattr(summary, "config", None) if summary else None
                quick_stats = getattr(summary, "quickStats", None) if summary else None

                if quick_stats:
                    guest_mem = getattr(quick_stats, "guestMemoryUsage", None)
                    if isinstance(guest_mem, (int, float)):
                        ram_demand_mib = int(guest_mem)

                    total_mem = getattr(config_info, "memorySizeMB", None) if config_info else None
                    if isinstance(guest_mem, (int, float)) and isinstance(total_mem, (int, float)) and total_mem > 0:
                        ram_usage_pct = round((float(guest_mem) / float(total_mem)) * 100.0, 2)

                    cpu_usage_mhz = getattr(quick_stats, "overallCpuUsage", None)
                    max_cpu_mhz = getattr(runtime_info, "maxCpuUsage", None) if runtime_info else None
                    if (
                        isinstance(cpu_usage_mhz, (int, float))
                        and isinstance(max_cpu_mhz, (int, float))
                        and max_cpu_mhz > 0
                    ):
                        cpu_usage_pct = round((float(cpu_usage_mhz) / float(max_cpu_mhz)) * 100.0, 2)
            except Exception:  # pragma: no cover - defensive
                logger.debug("Unable to compute quickstats for VM %s", getattr(vm, "_moId", "?"), exc_info=True)

            results[vm._moId] = PlacementInfo(
                host=host_name,
                cluster=cluster_name,
                cpu_usage_pct=cpu_usage_pct,
                ram_demand_mib=ram_demand_mib,
                ram_usage_pct=ram_usage_pct,
            )
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


def _normalize_placement(value) -> PlacementInfo:
    if isinstance(value, PlacementInfo):
        return value
    if isinstance(value, tuple) and len(value) >= 2:
        host, cluster = value[0], value[1]
        return PlacementInfo(host=host, cluster=cluster)
    if isinstance(value, dict):
        return PlacementInfo(
            host=value.get("host", "<sin datos host>"),
            cluster=value.get("cluster", "<sin datos cluster>"),
            cpu_usage_pct=value.get("cpu_usage_pct"),
            ram_demand_mib=value.get("ram_demand_mib"),
            ram_usage_pct=value.get("ram_usage_pct"),
        )
    return PlacementInfo("<sin datos host>", "<sin datos cluster>")


def get_host_cluster_soap(vm_id: str) -> PlacementInfo:
    """
    Obtiene host/cluster y quickstats básicos para la VM solicitada.
    Utiliza pyVmomi (SOAP) y cache para mejorar rendimiento.
    """
    cached = placement_cache.get(vm_id)
    if cached is not None:
        return _normalize_placement(cached)

    placement_map = _build_placement_map()
    for key, value in placement_map.items():
        placement_cache[key] = value

    cached = placement_cache.get(vm_id)
    return _normalize_placement(cached)


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
    _ensure_https(settings["host"], name="VCENTER_HOST")

    try:
        response = requests.post(
            f"{settings['host']}/rest/com/vmware/cis/session",
            auth=(settings["user"], settings["password"]),
            verify=_vcenter_tls_verify(),
            timeout=5,
        )
        response.raise_for_status()
        return response.json()["value"]
    except Exception as exc:
        logger.exception("Failed to obtain vCenter session token")
        code = getattr(exc, "response", None) and exc.response.status_code or 500
        raise HTTPException(status_code=code, detail="Auth failed")


def get_hosts_raw() -> dict:
    """
    Recupera la respuesta cruda del endpoint REST /rest/vcenter/host.
    No aplica transformaciones ni filtrados; reutiliza la sesión actual.
    """
    token = get_session_token()
    headers = {"vmware-api-session-id": token}

    response = requests.get(
        _network_endpoint("/rest/vcenter/host"),
        headers=headers,
        verify=_vcenter_tls_verify(),
        timeout=10,
    )
    response.raise_for_status()
    return response.json()


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
    _ensure_https(settings["host"], name="VCENTER_HOST")
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
            verify=_vcenter_tls_verify(),
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
            verify=_vcenter_tls_verify(),
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
            verify=_vcenter_tls_verify(),
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
            gib = capacity / (1024 ** 3)
            if gib.is_integer():
                disk_sizes.append(f"{int(gib)} GiB")
            else:
                disk_sizes.append(f"{gib:.2f} GiB")
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
            verify=_vcenter_tls_verify(),
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


def _normalize_boot_type(value: Optional[str]) -> Optional[str]:
    if value is None:
        return None
    upper = str(value).strip().upper()
    if not upper:
        return None
    if upper in {"EFI", "UEFI"}:
        return "UEFI"
    if upper in {"BIOS", "LEGACY", "LEGACY_BIOS"}:
        return "BIOS"
    return upper


def _infer_generation_from_boot(boot_type: Optional[str]) -> Optional[str]:
    if not boot_type:
        return None
    upper = str(boot_type).strip().upper()
    if not upper:
        return None
    if upper == "UEFI":
        return "2"
    if upper == "BIOS":
        return "1"
    return None


# ───────────────────────────────────────────────────────────────────────
# Servicios públicos
# ───────────────────────────────────────────────────────────────────────


def get_vms(*, refresh: bool = False) -> List[VMBase]:
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
    if refresh:
        vm_cache.clear()
    elif "vms" in vm_cache:
        return vm_cache["vms"]

    token = get_session_token()
    headers = {"vmware-api-session-id": token}
    net_map = load_network_map(headers)

    response = requests.get(
        _network_endpoint("/rest/vcenter/vm"),
        headers=headers,
        verify=_vcenter_tls_verify(),
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
            verify=_vcenter_tls_verify(),
            timeout=5,
        )
        summary_data = summary_resp.json().get("value", {}) if summary_resp.status_code == 200 else {}
        guest_os = summary_data.get("guest_OS")

        hardware_resp = requests.get(
            _network_endpoint(f"/rest/vcenter/vm/{vm_id}/hardware"),
            headers=headers,
            verify=_vcenter_tls_verify(),
            timeout=5,
        )
        hardware_data = hardware_resp.json().get("value", {}) if hardware_resp.status_code == 200 else {}

        compat_code = hardware_data.get("version", "<sin datos>")
        compat_human = COMPAT_MAP.get(compat_code, compat_code)

        boot_type: Optional[str] = None
        compat_generation: Optional[str] = None
        try:
            boot_resp = requests.get(
                _network_endpoint(f"/rest/vcenter/vm/{vm_id}/hardware/boot"),
                headers=headers,
                verify=_vcenter_tls_verify(),
                timeout=5,
            )
            if boot_resp.status_code == 200:
                boot_value = boot_resp.json().get("value", {})
                boot_type = _normalize_boot_type(boot_value.get("type"))
                compat_generation = _infer_generation_from_boot(boot_type)
        except Exception as exc:  # pragma: no cover - defensivo
            logger.debug("VM %s: boot info fetch failed → %s", vm_id, exc)

        placement = get_host_cluster_soap(vm_id)
        host_name = placement.host
        cluster_name = placement.cluster

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
                cpu_usage_pct=placement.cpu_usage_pct,
                ram_demand_mib=placement.ram_demand_mib,
                ram_usage_pct=placement.ram_usage_pct,
                compat_generation=compat_generation or boot_type,
                boot_type=boot_type,
            )
        )

    vm_cache["vms"] = out
    return out


def fetch_vmware_snapshot(*, refresh: bool = False) -> List[Dict[str, object]]:
    """
    Provide a lightweight snapshot of VMware metrics using the same data as the inventory UI.
    """
    observed_at = datetime.now(timezone.utc)
    vms = get_vms(refresh=refresh)
    snapshot: List[Dict[str, object]] = []
    for vm in vms:
        snapshot.append(
            {
                "vm_name": vm.name,
                "vm_id": vm.id,
                "cpu_pct": vm.cpu_usage_pct,
                "ram_pct": vm.ram_usage_pct,
                "env": vm.environment,
                "at": observed_at,
            }
        )
    return snapshot


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
        verify=_vcenter_tls_verify(),
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
        verify=_vcenter_tls_verify(),
        timeout=10,
    )
    if summary_resp.status_code != 200:
        raise HTTPException(status_code=summary_resp.status_code, detail=summary_resp.text)
    summary = summary_resp.json().get("value", {})

    hardware_resp = requests.get(
        _network_endpoint(f"/rest/vcenter/vm/{vm_id}/hardware"),
        headers=headers,
        verify=_vcenter_tls_verify(),
        timeout=5,
    )
    hardware = hardware_resp.json().get("value", {}) if hardware_resp.status_code == 200 else {}

    compat_code = hardware.get("version", "<sin datos>")
    compat_human = COMPAT_MAP.get(compat_code, compat_code)
    boot_type: Optional[str] = None
    compat_generation: Optional[str] = None
    try:
        boot_resp = requests.get(
            _network_endpoint(f"/rest/vcenter/vm/{vm_id}/hardware/boot"),
            headers=headers,
            verify=_vcenter_tls_verify(),
            timeout=5,
        )
        if boot_resp.status_code == 200:
            boot_value = boot_resp.json().get("value", {})
            boot_type = _normalize_boot_type(boot_value.get("type"))
            compat_generation = _infer_generation_from_boot(boot_type)
    except Exception as exc:  # pragma: no cover - defensivo
        logger.debug("VM %s detalle: boot info fetch failed → %s", vm_id, exc)

    name = summary.get("name", vm_id)
    env = infer_environment(name)
    power_state = summary.get("power_state", "unknown")

    cpu = summary.get("cpu", {})
    mem = summary.get("memory", {})
    cpu_c = cpu.get("count", 0) if isinstance(cpu, dict) else summary.get("cpu_count", 0)
    mem_c = mem.get("size_MiB", 0) if isinstance(mem, dict) else summary.get("memory_size_MiB", 0)

    net_map = load_network_map(headers)
    placement = get_host_cluster_soap(vm_id)
    host_name = placement.host
    cluster_name = placement.cluster

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
        cpu_usage_pct=placement.cpu_usage_pct,
        ram_demand_mib=placement.ram_demand_mib,
        ram_usage_pct=placement.ram_usage_pct,
        compat_generation=compat_generation or boot_type,
        boot_type=boot_type,
    )
