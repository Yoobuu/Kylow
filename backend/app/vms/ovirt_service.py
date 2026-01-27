from __future__ import annotations

import logging
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from datetime import datetime, timezone
from threading import Lock
from typing import Any, Dict, List, Optional, Tuple

import requests
from fastapi import HTTPException

from app.settings import settings
from app.vms.vm_models import VMBase, VMDetail
from app.vms.vm_service import infer_environment, ThreadSafeTTLCache

logger = logging.getLogger(__name__)

_VM_CACHE = ThreadSafeTTLCache(maxsize=1, ttl=300)
_DETAIL_CACHE = ThreadSafeTTLCache(maxsize=256, ttl=30)
_PERF_CACHE = ThreadSafeTTLCache(maxsize=512, ttl=30)
_TOKEN_LOCK = Lock()
_TOKEN_VALUE: Optional[str] = None
_TOKEN_EXPIRES_AT = 0.0
_TOKEN_TTL_MARGIN = 60
_MAX_WORKERS = 6
_PERF_METRICS = [
    "cpu_usage_pct",
    "mem_usage_pct",
    "mem_active_mib",
    "mem_consumed_mib",
    "disk_read_kbps",
    "disk_write_kbps",
    "disk_used_kb",
    "iops_read",
    "iops_write",
    "lat_read_ms",
    "lat_write_ms",
]


def _safe_int(value: Any) -> Optional[int]:
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _safe_float(value: Any) -> Optional[float]:
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _resolve_ovirt_settings() -> Dict[str, Optional[str]]:
    if settings.test_mode:
        return {"base_url": None, "user": None, "password": None, "test_mode": True}
    return {
        "base_url": settings.ovirt_base_url,
        "user": settings.ovirt_user,
        "password": settings.ovirt_pass,
    }


def _ensure_https(url: Optional[str]) -> None:
    if not url:
        return


def _ovirt_tls_verify():
    return settings.ovirt_ca_bundle or False


def validate_ovirt_configuration() -> List[str]:
    if settings.test_mode:
        return []
    ovirt_cfg = _resolve_ovirt_settings()
    issues: List[str] = []
    if not ovirt_cfg.get("base_url"):
        issues.append("OVIRT_BASE_URL is not configured")
    if not ovirt_cfg.get("user"):
        issues.append("OVIRT_USER is not configured")
    if not ovirt_cfg.get("password"):
        issues.append("OVIRT_PASS is not configured")
    return issues


def _build_headers() -> Dict[str, str]:
    return {
        "Accept": "application/json",
        "Version": "4",
        "All-Content": "true",
    }


def _map_power_state(raw: Optional[str]) -> str:
    value = (raw or "").strip().lower()
    if value in {"up", "powering_up", "migrating", "reboot_in_progress", "saving_state"}:
        return "POWERED_ON"
    if value in {"down", "powering_down", "powering_off"}:
        return "POWERED_OFF"
    if value in {"suspended", "paused"}:
        return "SUSPENDED"
    if not value:
        return "unknown"
    return value.upper()


def _extract_name(payload: Any) -> str:
    if isinstance(payload, dict):
        name = payload.get("name")
        return name if isinstance(name, str) else ""
    return ""


def _extract_id(payload: Any) -> Optional[str]:
    if isinstance(payload, dict):
        value = payload.get("id")
        if isinstance(value, str) and value:
            return value
        href = payload.get("href")
        if isinstance(href, str) and href:
            return href.rstrip("/").split("/")[-1]
    return None


def _cpu_count(payload: Dict[str, Any]) -> int:
    cpu = payload.get("cpu") or {}
    topology = cpu.get("topology") or {}
    cores = _safe_int(topology.get("cores"))
    sockets = _safe_int(topology.get("sockets"))
    if cores and sockets:
        return cores * sockets
    return _safe_int(cpu.get("cores")) or 0


def _memory_mib(payload: Dict[str, Any]) -> int:
    mem_bytes = _safe_int(payload.get("memory"))
    if not mem_bytes:
        return 0
    return int(mem_bytes / (1024 * 1024))


def _format_gib(size_bytes: Optional[int]) -> Optional[str]:
    if not size_bytes:
        return None
    gib = size_bytes / (1024 ** 3)
    if gib.is_integer():
        return f"{int(gib)} GiB"
    return f"{gib:.1f} GiB"


def _clamp_pct(value: Optional[float]) -> Optional[float]:
    if value is None:
        return None
    if value < 0:
        return 0.0
    if value > 100:
        return 100.0
    return value


def _unwrap_vm_payload(payload: Optional[dict]) -> Optional[dict]:
    if not payload or not isinstance(payload, dict):
        return None
    nested = payload.get("vm")
    if isinstance(nested, dict):
        return nested
    return payload


def _build_sso_url(base_url: str) -> str:
    base = base_url.rstrip("/")
    suffix = "/ovirt-engine/api"
    if base.endswith(suffix):
        return base[: -len(suffix)] + "/ovirt-engine/sso/oauth/token"
    if base.endswith("/api"):
        return base[: -len("/api")] + "/sso/oauth/token"
    return base + "/sso/oauth/token"


def _request_sso_token() -> tuple[str, int]:
    cfg = _resolve_ovirt_settings()
    if not cfg.get("base_url") or not cfg.get("user") or not cfg.get("password"):
        raise HTTPException(status_code=500, detail="Configuracion de oVirt incompleta")

    _ensure_https(cfg["base_url"])
    sso_url = _build_sso_url(cfg["base_url"])
    data = {
        "grant_type": "password",
        "username": cfg["user"],
        "password": cfg["password"],
        "scope": "ovirt-app-api",
    }
    try:
        response = requests.post(
            sso_url,
            data=data,
            headers={"Accept": "application/json"},
            verify=_ovirt_tls_verify(),
            timeout=10,
        )
        response.raise_for_status()
    except Exception as exc:
        logger.exception("oVirt SSO token request failed")
        code = getattr(exc, "response", None) and exc.response.status_code or 500
        raise HTTPException(status_code=code, detail="oVirt SSO auth failed") from exc

    payload = response.json() if response.headers.get("content-type", "").startswith("application/json") else {}
    token = payload.get("access_token")
    if not token:
        raise HTTPException(status_code=502, detail="oVirt SSO token missing in response")
    expires_in = payload.get("expires_in") or 300
    try:
        expires_in = int(expires_in)
    except (TypeError, ValueError):
        expires_in = 300
    return token, expires_in


def get_ovirt_token(*, force: bool = False) -> str:
    global _TOKEN_VALUE, _TOKEN_EXPIRES_AT
    now = time.time()
    with _TOKEN_LOCK:
        if not force and _TOKEN_VALUE and now < (_TOKEN_EXPIRES_AT - _TOKEN_TTL_MARGIN):
            return _TOKEN_VALUE
        token, expires_in = _request_sso_token()
        _TOKEN_VALUE = token
        _TOKEN_EXPIRES_AT = now + max(expires_in, _TOKEN_TTL_MARGIN)
        return _TOKEN_VALUE


class _OvirtClient:
    def __init__(self, base_url: str) -> None:
        self.base_url = base_url.rstrip("/")
        self.session = requests.Session()
        self.session.headers.update(_build_headers())

    def get_json(self, path: str, *, timeout: int = 10, allow_fail: bool = False) -> Optional[dict]:
        url = f"{self.base_url}{path}"
        token = get_ovirt_token()
        headers = {"Authorization": f"Bearer {token}"}
        try:
            _ensure_https(self.base_url)
            resp = self.session.get(url, headers=headers, verify=_ovirt_tls_verify(), timeout=timeout)
            if resp.status_code == 401:
                token = get_ovirt_token(force=True)
                headers = {"Authorization": f"Bearer {token}"}
                resp = self.session.get(url, headers=headers, verify=_ovirt_tls_verify(), timeout=timeout)
            resp.raise_for_status()
            if resp.headers.get("content-type", "").startswith("application/json"):
                return resp.json()
            return {}
        except Exception as exc:
            if allow_fail:
                logger.debug("oVirt request failed (%s): %s", path, exc)
                return None
            logger.exception("oVirt API request failed")
            code = getattr(exc, "response", None) and exc.response.status_code or 500
            raise HTTPException(status_code=code, detail="oVirt request failed") from exc


@dataclass
class _EnrichmentCaches:
    vnicprofiles_by_id: Dict[str, Optional[dict]]
    networks_by_id: Dict[str, Optional[dict]]
    disks_by_id: Dict[str, Optional[dict]]
    hosts_by_id: Dict[str, str]
    clusters_by_id: Dict[str, str]
    lock: Lock


def _init_enrichment_caches(client: _OvirtClient) -> _EnrichmentCaches:
    return _EnrichmentCaches(
        vnicprofiles_by_id={},
        networks_by_id={},
        disks_by_id={},
        hosts_by_id=_load_hosts_map(client),
        clusters_by_id=_load_clusters_map(client),
        lock=Lock(),
    )


def _cache_lookup(cache: Dict[str, Optional[dict]], key: Optional[str], loader, lock: Lock) -> Optional[dict]:
    if not key:
        return None
    with lock:
        if key in cache:
            return cache[key]
    value = loader()
    with lock:
        cache[key] = value
    return value


def _load_hosts_map(client: _OvirtClient) -> Dict[str, str]:
    payload = client.get_json("/hosts?max=2000", allow_fail=True)
    if not payload:
        return {}
    hosts = payload.get("host", []) if isinstance(payload, dict) else []
    mapping: Dict[str, str] = {}
    for item in hosts or []:
        if not isinstance(item, dict):
            continue
        host_id = item.get("id")
        name = item.get("name")
        if host_id and name:
            mapping[str(host_id)] = str(name)
    return mapping


def _load_clusters_map(client: _OvirtClient) -> Dict[str, str]:
    payload = client.get_json("/clusters?max=2000", allow_fail=True)
    if not payload:
        return {}
    clusters = payload.get("cluster", []) if isinstance(payload, dict) else []
    mapping: Dict[str, str] = {}
    for item in clusters or []:
        if not isinstance(item, dict):
            continue
        cluster_id = item.get("id")
        name = item.get("name")
        if cluster_id and name:
            mapping[str(cluster_id)] = str(name)
    return mapping


def _extract_stat_value(stat: Dict[str, Any]) -> Optional[float]:
    values = stat.get("values") if isinstance(stat, dict) else None
    if isinstance(values, dict):
        value_list = values.get("value")
        if isinstance(value_list, list) and value_list:
            datum = value_list[0].get("datum") if isinstance(value_list[0], dict) else None
            return _safe_float(datum)
    return None


def _extract_stats(payload: Optional[dict]) -> Dict[str, Optional[float]]:
    if not payload or not isinstance(payload, dict):
        return {}
    stats = payload.get("statistic", [])
    if not isinstance(stats, list):
        return {}
    out: Dict[str, Optional[float]] = {}
    for stat in stats:
        if not isinstance(stat, dict):
            continue
        name = stat.get("name")
        if not name:
            continue
        out[str(name)] = _extract_stat_value(stat)
    return out


def _build_vm_enrichment(
    *,
    client: _OvirtClient,
    vm_id: str,
    vm_min: Dict[str, Any],
    caches: _EnrichmentCaches,
) -> Dict[str, object]:
    networks: List[str] = []
    nics: List[str] = []
    disks: List[str] = []
    ip_addresses: List[str] = []
    cpu_usage_pct: Optional[float] = None
    ram_demand_mib: Optional[int] = None
    ram_usage_pct: Optional[float] = None

    try:
        nics_payload = client.get_json(f"/vms/{vm_id}/nics?max=2000", allow_fail=True) or {}
        nic_list = nics_payload.get("nic", []) if isinstance(nics_payload, dict) else []
        network_set = set()
        nic_labels = set()
        for nic in nic_list or []:
            if not isinstance(nic, dict):
                continue
            nic_name = nic.get("name")
            mac = None
            mac_payload = nic.get("mac")
            if isinstance(mac_payload, dict):
                mac = mac_payload.get("address")
            if nic_name and mac:
                nic_labels.add(f"{nic_name} ({mac})")
            elif mac:
                nic_labels.add(str(mac))
            elif nic_name:
                nic_labels.add(str(nic_name))

            vnic_profile_id = _extract_id(nic.get("vnic_profile"))
            if not vnic_profile_id:
                continue
            vnic_profile = _cache_lookup(
                caches.vnicprofiles_by_id,
                vnic_profile_id,
                lambda: client.get_json(f"/vnicprofiles/{vnic_profile_id}", allow_fail=True),
                caches.lock,
            )
            if not vnic_profile:
                continue
            network_id = _extract_id(vnic_profile.get("network"))
            if not network_id:
                continue
            network = _cache_lookup(
                caches.networks_by_id,
                network_id,
                lambda: client.get_json(f"/networks/{network_id}", allow_fail=True),
                caches.lock,
            )
            if not network:
                continue
            network_name = network.get("name") or network_id
            vlan = network.get("vlan")
            vlan_id = None
            if isinstance(vlan, dict):
                vlan_id = vlan.get("id") or vlan.get("tag") or vlan.get("name")
            if vlan_id:
                label = f"{network_name} (VLAN {vlan_id})"
            else:
                label = f"{network_name}"
            network_set.add(label)

        networks = sorted(network_set)
        nics = sorted(nic_labels)
    except Exception as exc:
        logger.debug("oVirt NIC enrichment failed for %s: %s", vm_id, exc)

    try:
        devices_payload = client.get_json(f"/vms/{vm_id}/reporteddevices?max=2000", allow_fail=True) or {}
        devices = devices_payload.get("reported_device", []) if isinstance(devices_payload, dict) else []
        ipv4_set = set()
        ipv6_set = set()
        for device in devices or []:
            if not isinstance(device, dict):
                continue
            ips_payload = device.get("ips")
            ip_list = ips_payload.get("ip") if isinstance(ips_payload, dict) else []
            for ip_item in ip_list or []:
                if not isinstance(ip_item, dict):
                    continue
                address = ip_item.get("address")
                if not address:
                    continue
                addr = str(address).strip()
                if "." in addr:
                    ipv4_set.add(addr)
                else:
                    if addr.lower().startswith("fe80:"):
                        continue
                    ipv6_set.add(addr)
        ip_addresses = sorted(ipv4_set) + sorted(ipv6_set)
    except Exception as exc:
        logger.debug("oVirt reporteddevices enrichment failed for %s: %s", vm_id, exc)

    try:
        attachments_payload = client.get_json(
            f"/vms/{vm_id}/diskattachments?max=2000",
            allow_fail=True,
        ) or {}
        attachments = attachments_payload.get("disk_attachment", []) if isinstance(attachments_payload, dict) else []
        disk_set = set()
        for att in attachments or []:
            if not isinstance(att, dict):
                continue
            disk_id = _extract_id(att.get("disk"))
            if not disk_id:
                continue
            disk = _cache_lookup(
                caches.disks_by_id,
                disk_id,
                lambda: client.get_json(f"/disks/{disk_id}", allow_fail=True),
                caches.lock,
            )
            if not disk:
                continue
            name = disk.get("name") or str(disk_id)[:8]
            size_bytes = _safe_int(disk.get("provisioned_size")) or _safe_int(disk.get("total_size"))
            size_str = _format_gib(size_bytes)
            if size_str:
                disk_set.add(f"{name} ({size_str})")
            else:
                disk_set.add(str(name))
        disks = sorted(disk_set)
    except Exception as exc:
        logger.debug("oVirt disk enrichment failed for %s: %s", vm_id, exc)

    try:
        stats_payload = client.get_json(f"/vms/{vm_id}/statistics?max=2000", allow_fail=True)
        stats = _extract_stats(stats_payload)
        cpu_total = stats.get("cpu.current.total")
        mem_used = stats.get("memory.used")
        mem_installed = stats.get("memory.installed")

        if mem_used is not None:
            ram_demand_mib = int(mem_used / (1024 * 1024))
        if mem_used is not None:
            denom = mem_installed
            if denom is None:
                denom = vm_min.get("memory_size_MiB")
                if denom:
                    denom = float(denom) * 1024 * 1024
            if denom and denom > 0:
                ram_usage_pct = (mem_used / denom) * 100.0
                ram_usage_pct = _clamp_pct(ram_usage_pct)

        if cpu_total is not None:
            cpu_pct = cpu_total
            if cpu_total > 100:
                cpu_count = vm_min.get("cpu_count") or 0
                if cpu_count > 0:
                    cpu_pct = cpu_total / cpu_count
                else:
                    cpu_pct = min(cpu_total, 100.0)
            cpu_usage_pct = _clamp_pct(cpu_pct)
    except Exception as exc:
        logger.debug("oVirt statistics enrichment failed for %s: %s", vm_id, exc)

    return {
        "networks": networks,
        "ip_addresses": ip_addresses,
        "disks": disks,
        "nics": nics,
        "cpu_usage_pct": cpu_usage_pct,
        "ram_demand_mib": ram_demand_mib,
        "ram_usage_pct": ram_usage_pct,
    }


def _build_vm_base_payload(vm: Dict[str, Any], hosts_by_id: Dict[str, str], clusters_by_id: Dict[str, str]) -> Dict[str, Any]:
    vm_id = vm.get("id") or ""
    vm_name = vm.get("name") or (f"<sin nombre {vm_id}>" if vm_id else "<sin nombre>")
    env = infer_environment(vm_name)
    guest_os = None
    os_info = vm.get("os")
    if isinstance(os_info, dict):
        guest_os = os_info.get("type") or os_info.get("name")
    elif isinstance(os_info, str):
        guest_os = os_info

    host_id = _extract_id(vm.get("host"))
    cluster_id = _extract_id(vm.get("cluster"))
    host_name = hosts_by_id.get(host_id or "", "") or _extract_name(vm.get("host"))
    cluster_name = clusters_by_id.get(cluster_id or "", "") or _extract_name(vm.get("cluster"))

    return {
        "id": str(vm_id),
        "name": str(vm_name),
        "power_state": _map_power_state(vm.get("status")),
        "cpu_count": _cpu_count(vm),
        "memory_size_MiB": _memory_mib(vm),
        "environment": env,
        "guest_os": guest_os,
        "host": host_name,
        "cluster": cluster_name,
        "compatibility_code": "",
        "compatibility_human": "",
        "networks": [],
        "ip_addresses": [],
        "disks": [],
        "nics": [],
        "cpu_usage_pct": None,
        "ram_demand_mib": None,
        "ram_usage_pct": None,
        "compat_generation": None,
        "boot_type": None,
    }


def _build_vm_detail_payload(
    vm: Dict[str, Any],
    client: _OvirtClient,
    caches: _EnrichmentCaches,
) -> Dict[str, Any]:
    base_payload = _build_vm_base_payload(vm, caches.hosts_by_id, caches.clusters_by_id)
    vm_id = base_payload.get("id") or ""
    if vm_id:
        enrichment = _build_vm_enrichment(
            client=client,
            vm_id=str(vm_id),
            vm_min=base_payload,
            caches=caches,
        )
        base_payload.update(enrichment)
    return base_payload


def _normalize_perf_window(window_seconds: int) -> int:
    if window_seconds < 20:
        return 20
    if window_seconds > 1800:
        return 1800
    return window_seconds


def fetch_ovirt_vms() -> List[VMBase]:
    if settings.test_mode:
        return []
    cfg = _resolve_ovirt_settings()
    if not cfg.get("base_url") or not cfg.get("user") or not cfg.get("password"):
        raise HTTPException(status_code=500, detail="Configuracion de oVirt incompleta")

    client = _OvirtClient(cfg["base_url"])
    payload = client.get_json("/vms?max=2000", timeout=15, allow_fail=False) or {}
    raw_vms = payload.get("vm", []) if isinstance(payload, dict) else []

    caches = _init_enrichment_caches(client)

    out: List[VMBase] = []
    vm_jobs: List[Tuple[Dict[str, Any], Dict[str, Any]]] = []
    for vm in raw_vms or []:
        if not isinstance(vm, dict):
            continue
        payload_base = _build_vm_base_payload(vm, caches.hosts_by_id, caches.clusters_by_id)
        vm_jobs.append((payload_base, vm))

    if not vm_jobs:
        return []

    def _worker(base_payload: Dict[str, Any], vm_raw: Dict[str, Any]) -> VMBase:
        vm_id = base_payload.get("id") or ""
        if not vm_id:
            return VMBase(**base_payload)
        client_local = _OvirtClient(cfg["base_url"])
        enrichment = _build_vm_enrichment(
            client=client_local,
            vm_id=str(vm_id),
            vm_min=base_payload,
            caches=caches,
        )
        base_payload.update(enrichment)
        return VMBase(**base_payload)

    max_workers = min(_MAX_WORKERS, len(vm_jobs))
    if max_workers <= 1:
        for payload_base, vm in vm_jobs:
            try:
                out.append(_worker(payload_base, vm))
            except Exception as exc:
                logger.debug("oVirt VM enrichment failed for %s: %s", payload_base.get("id"), exc)
                out.append(VMBase(**payload_base))
        return out

    with ThreadPoolExecutor(max_workers=max_workers) as ex:
        futs = {
            ex.submit(_worker, payload_base, vm): payload_base
            for payload_base, vm in vm_jobs
        }
        for fut in as_completed(futs):
            payload_base = futs[fut]
            try:
                out.append(fut.result())
            except Exception as exc:
                logger.debug("oVirt VM enrichment failed for %s: %s", payload_base.get("id"), exc)
                out.append(VMBase(**payload_base))

    return out


def get_ovirt_vms(*, refresh: bool = False) -> List[VMBase]:
    if refresh:
        _VM_CACHE.clear()
    elif "vms" in _VM_CACHE:
        return _VM_CACHE["vms"]
    vms = fetch_ovirt_vms()
    _VM_CACHE["vms"] = vms
    return vms


def get_ovirt_vm_detail(vm_id: str, *, refresh: bool = False) -> VMDetail:
    if settings.test_mode:
        raise HTTPException(status_code=404, detail="VM no encontrada")
    if refresh:
        _DETAIL_CACHE.clear()
    cached = _DETAIL_CACHE.get(vm_id)
    if cached is not None:
        return cached
    cfg = _resolve_ovirt_settings()
    if not cfg.get("base_url") or not cfg.get("user") or not cfg.get("password"):
        raise HTTPException(status_code=500, detail="Configuracion de oVirt incompleta")

    client = _OvirtClient(cfg["base_url"])
    try:
        payload = client.get_json(f"/vms/{vm_id}", timeout=15, allow_fail=False)
    except HTTPException as exc:
        if exc.status_code == 404:
            raise
        raise HTTPException(status_code=502, detail="Error consultando oVirt") from exc
    vm_payload = _unwrap_vm_payload(payload)
    if not vm_payload:
        raise HTTPException(status_code=502, detail="Respuesta invalida de oVirt")

    caches = _init_enrichment_caches(client)
    detail_payload = _build_vm_detail_payload(vm_payload, client, caches)
    detail = VMDetail(**detail_payload)
    _DETAIL_CACHE[vm_id] = detail
    return detail


def get_ovirt_vm_perf(
    vm_id: str,
    *,
    window_seconds: int = 60,
    idle_to_zero: bool = False,
    by_disk: bool = False,
) -> Dict[str, Optional[float]]:
    window_seconds = _normalize_perf_window(window_seconds)
    cache_key = f"{vm_id}:{window_seconds}:{int(idle_to_zero)}:{int(by_disk)}"
    cached = _PERF_CACHE.get(cache_key)
    if cached is not None:
        return cached

    cfg = _resolve_ovirt_settings()
    if not cfg.get("base_url") or not cfg.get("user") or not cfg.get("password"):
        raise HTTPException(status_code=500, detail="Configuracion de oVirt incompleta")

    client = _OvirtClient(cfg["base_url"])
    try:
        payload = client.get_json(f"/vms/{vm_id}", timeout=15, allow_fail=False)
    except HTTPException as exc:
        if exc.status_code == 404:
            raise
        raise HTTPException(status_code=502, detail="Error consultando oVirt") from exc
    vm_payload = _unwrap_vm_payload(payload)
    if not vm_payload:
        raise HTTPException(status_code=502, detail="Respuesta invalida de oVirt")

    cpu_count = _cpu_count(vm_payload)
    memory_size_mib = _memory_mib(vm_payload)

    stats_payload = client.get_json(
        f"/vms/{vm_id}/statistics?max=2000",
        timeout=15,
        allow_fail=True,
    )
    stats = _extract_stats(stats_payload)

    summary: Dict[str, Optional[float]] = {key: None for key in _PERF_METRICS}
    summary["disk_capacity_kb_total"] = None
    summary["_interval_seconds"] = window_seconds
    summary["_collected_at"] = datetime.now(timezone.utc).isoformat()
    summary["missing_metrics"] = []
    summary["_sources"] = {key: "none" for key in _PERF_METRICS}
    summary["_metrics_available"] = False

    if stats:
        cpu_total = stats.get("cpu.current.total")
        mem_used = stats.get("memory.used")
        mem_installed = stats.get("memory.installed")

        if cpu_total is not None:
            cpu_pct = cpu_total
            if cpu_total > 100 and cpu_count > 0:
                cpu_pct = cpu_total / cpu_count
            cpu_pct = _clamp_pct(cpu_pct)
            if cpu_pct is not None:
                cpu_pct = round(cpu_pct, 2)
            summary["cpu_usage_pct"] = cpu_pct
            summary["_sources"]["cpu_usage_pct"] = "ovirt.statistics.cpu.current.total"

        if mem_used is not None:
            summary["mem_consumed_mib"] = int(mem_used / (1024 * 1024))
            summary["_sources"]["mem_consumed_mib"] = "ovirt.statistics.memory.used"

            if mem_installed is None and memory_size_mib:
                mem_installed = float(memory_size_mib) * 1024 * 1024
            if mem_installed and mem_installed > 0:
                mem_pct = (mem_used / mem_installed) * 100.0
                mem_pct = _clamp_pct(mem_pct)
                if mem_pct is not None:
                    mem_pct = round(mem_pct, 2)
                summary["mem_usage_pct"] = mem_pct
                summary["_sources"]["mem_usage_pct"] = "ovirt.statistics.memory.used/installed"

    missing_metrics = [key for key in _PERF_METRICS if summary[key] is None]
    summary["missing_metrics"] = sorted(missing_metrics)
    summary["_metrics_available"] = any(summary[key] is not None for key in _PERF_METRICS)

    if idle_to_zero:
        for key in ("disk_read_kbps", "disk_write_kbps", "disk_used_kb", "iops_read", "iops_write", "lat_read_ms", "lat_write_ms"):
            if summary[key] is None and key not in summary["missing_metrics"]:
                summary[key] = 0.0
                summary["_sources"][key] = "idle_zero"

    for key in summary["missing_metrics"]:
        summary["_sources"][key] = "missing_metric"

    if by_disk:
        summary["disks"] = []

    _PERF_CACHE[cache_key] = summary
    return summary
