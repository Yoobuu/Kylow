from __future__ import annotations

import logging
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Any, Dict, List, Optional, Tuple

from fastapi import HTTPException

from app.hosts.host_models import HostSummary, HostDetail, HostDeep
from app.settings import settings
from app.vms.ovirt_service import _OvirtClient
from app.vms.vm_service import ThreadSafeTTLCache

logger = logging.getLogger(__name__)

_SUMMARY_CACHE = ThreadSafeTTLCache(maxsize=4, ttl=30)
_DETAIL_CACHE = ThreadSafeTTLCache(maxsize=64, ttl=120)
_DEEP_CACHE = ThreadSafeTTLCache(maxsize=32, ttl=600)
_MAX_WORKERS = 6


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


def _extract_id(payload: Any) -> Optional[str]:
    if isinstance(payload, dict):
        value = payload.get("id")
        if isinstance(value, str) and value:
            return value
        href = payload.get("href")
        if isinstance(href, str) and href:
            return href.rstrip("/").split("/")[-1]
    return None


def _extract_name(payload: Any) -> str:
    if isinstance(payload, dict):
        name = payload.get("name")
        return name if isinstance(name, str) else ""
    return ""


def _unwrap_host_payload(payload: Optional[dict]) -> Optional[dict]:
    if not payload or not isinstance(payload, dict):
        return None
    nested = payload.get("host")
    if isinstance(nested, dict):
        return nested
    return payload


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


def _clamp_pct(value: Optional[float]) -> Optional[float]:
    if value is None:
        return None
    if value < 0:
        return 0.0
    if value > 100:
        return 100.0
    return value


def _cpu_cores(payload: Dict[str, Any]) -> int:
    cpu = payload.get("cpu") or {}
    topology = cpu.get("topology") or {}
    cores = _safe_int(topology.get("cores"))
    sockets = _safe_int(topology.get("sockets"))
    if cores and sockets:
        return cores * sockets
    return _safe_int(cpu.get("cores")) or 0


def _memory_total_mb(payload: Dict[str, Any]) -> int:
    mem_value = _safe_int(payload.get("memory"))
    if not mem_value:
        return 0
    if mem_value >= 1_000_000_000:
        return int(mem_value / (1024 * 1024))
    return int(mem_value)


def _memory_bytes(payload: Dict[str, Any]) -> Optional[int]:
    mem_value = _safe_int(payload.get("memory"))
    if mem_value is None:
        return None
    if mem_value >= 1_000_000_000:
        return mem_value
    return int(mem_value) * 1024 * 1024


def _map_states(status: Optional[str]) -> Tuple[str, str]:
    value = (status or "").strip().lower()
    if value == "up":
        return "connected", "poweredOn"
    return "disconnected", "poweredOff"


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


def _load_network_label(network_id: str, cache: Dict[str, str], client: _OvirtClient) -> str:
    if not network_id:
        return ""
    cached = cache.get(network_id)
    if cached is not None:
        return cached
    payload = client.get_json(f"/networks/{network_id}", allow_fail=True) or {}
    name = payload.get("name") if isinstance(payload, dict) else None
    label = str(name or network_id)
    vlan = payload.get("vlan") if isinstance(payload, dict) else None
    vlan_id = None
    if isinstance(vlan, dict):
        vlan_id = vlan.get("id") or vlan.get("tag") or vlan.get("name")
    if vlan_id:
        label = f"{label} (VLAN {vlan_id})"
    cache[network_id] = label
    return label


def _count_vms_by_host_runtime(client: _OvirtClient) -> Dict[str, int]:
    payload = client.get_json("/vms?max=2000", allow_fail=True)
    if not payload:
        return {}
    vms = payload.get("vm", []) if isinstance(payload, dict) else []
    counts: Dict[str, int] = {}
    for vm in vms or []:
        if not isinstance(vm, dict):
            continue
        host_id = _extract_id(vm.get("host"))
        if host_id:
            counts[host_id] = counts.get(host_id, 0) + 1
    return counts


def _count_vms_by_cluster(client: _OvirtClient) -> Dict[str, int]:
    payload = client.get_json("/vms?max=2000", allow_fail=True)
    if not payload:
        return {}
    vms = payload.get("vm", []) if isinstance(payload, dict) else []
    counts: Dict[str, int] = {}
    for vm in vms or []:
        if not isinstance(vm, dict):
            continue
        cluster_id = _extract_id(vm.get("cluster"))
        if cluster_id:
            counts[cluster_id] = counts.get(cluster_id, 0) + 1
    return counts


def _assign_cluster_counts_to_hosts(
    hosts: List[Dict[str, Any]],
    cluster_counts: Dict[str, int],
) -> Dict[str, int]:
    results: Dict[str, int] = {}
    for host in hosts:
        host_id = host.get("id")
        if not host_id:
            continue
        cluster_id = host.get("cluster_id")
        results[str(host_id)] = cluster_counts.get(str(cluster_id), 0) if cluster_id else 0
    return results


def _collect_vms_for_host(client: _OvirtClient, host_id: str) -> List[Dict[str, Any]]:
    payload = client.get_json("/vms?max=2000", allow_fail=True)
    if not payload:
        return []
    vms = payload.get("vm", []) if isinstance(payload, dict) else []
    results: List[Dict[str, Any]] = []
    for vm in vms or []:
        if not isinstance(vm, dict):
            continue
        vm_host = _extract_id(vm.get("host"))
        if not vm_host or vm_host != host_id:
            continue
        status = str(vm.get("status") or "").lower()
        power_state = "poweredOn" if status == "up" else "poweredOff"
        results.append(
            {
                "name": vm.get("name"),
                "moid": vm.get("id"),
                "power_state": power_state,
            }
        )
    return results


def _parse_host_version(payload: Dict[str, Any]) -> Tuple[str, str]:
    version = ""
    build = ""
    version_payload = payload.get("version")
    if isinstance(version_payload, dict):
        version = version_payload.get("full_version") or version_payload.get("version") or ""
        build = version_payload.get("build") or ""
    if not version:
        os_payload = payload.get("os")
        if isinstance(os_payload, dict):
            version = os_payload.get("version") or os_payload.get("type") or ""
    return str(version or ""), str(build or "")


def _fetch_host_stats(client: _OvirtClient, host_id: str, cpu_cores: int) -> Dict[str, Optional[float]]:
    payload = client.get_json(f"/hosts/{host_id}/statistics?max=2000", allow_fail=True)
    stats = _extract_stats(payload)
    cpu_total = stats.get("cpu.current.total")
    mem_used = stats.get("memory.used")

    cpu_pct = None
    if cpu_total is not None:
        cpu_pct = cpu_total
        if cpu_total > 100 and cpu_cores > 0:
            cpu_pct = cpu_total / cpu_cores
        cpu_pct = _clamp_pct(cpu_pct)

    mem_used_mb = 0
    if mem_used is not None:
        mem_used_mb = int(mem_used / (1024 * 1024))

    return {"cpu_usage_pct": cpu_pct, "memory_used_mb": mem_used_mb}


def _build_pnics(nics_payload: Optional[dict]) -> List[Dict[str, Any]]:
    if not nics_payload or not isinstance(nics_payload, dict):
        return []
    nics = nics_payload.get("nic", [])
    if not isinstance(nics, list):
        return []
    results: List[Dict[str, Any]] = []
    for nic in nics or []:
        if not isinstance(nic, dict):
            continue
        mac = None
        mac_payload = nic.get("mac")
        if isinstance(mac_payload, dict):
            mac = mac_payload.get("address")
        speed = nic.get("speed")
        if isinstance(speed, dict):
            speed = speed.get("speed")
        results.append(
            {
                "name": nic.get("name"),
                "mac": mac,
                "link_speed_mbps": _safe_int(speed),
                "driver": nic.get("driver"),
            }
        )
    return results


def get_hosts_summary(*, refresh: bool = False) -> List[HostSummary]:
    if not refresh and "hosts" in _SUMMARY_CACHE:
        return _SUMMARY_CACHE["hosts"]
    if settings.test_mode:
        return []
    if not settings.ovirt_base_url or not settings.ovirt_user or not settings.ovirt_pass:
        raise HTTPException(status_code=500, detail="Configuracion de oVirt incompleta")

    client = _OvirtClient(settings.ovirt_base_url)
    try:
        payload = client.get_json("/hosts?max=2000", timeout=15, allow_fail=False) or {}
    except HTTPException as exc:
        raise HTTPException(status_code=502, detail="Error consultando oVirt") from exc

    hosts = payload.get("host", []) if isinstance(payload, dict) else []
    clusters_by_id = _load_clusters_map(client)

    base_hosts: List[Dict[str, Any]] = []
    for host in hosts or []:
        if not isinstance(host, dict):
            continue
        host_id = host.get("id") or ""
        name = host.get("name") or ""
        connection_state, power_state = _map_states(host.get("status"))
        cpu_cores = _cpu_cores(host)
        memory_total_mb = _memory_total_mb(host)
        cluster_payload = host.get("cluster")
        cluster_id = _extract_id(cluster_payload) or ""
        cluster_name = _extract_name(cluster_payload)
        if not cluster_name:
            if cluster_id:
                cluster_name = clusters_by_id.get(cluster_id, "")
        version, build = _parse_host_version(host)
        base_hosts.append(
            {
                "id": str(host_id),
                "name": str(name),
                "connection_state": connection_state,
                "power_state": power_state,
                "cpu_cores": cpu_cores,
                "memory_total_mb": memory_total_mb,
                "cluster": cluster_name,
                "cluster_id": cluster_id,
                "version": version,
                "build": build,
            }
        )

    count_mode = (settings.ovirt_host_vm_count_mode or "runtime").strip().lower()
    if count_mode == "cluster":
        cluster_counts = _count_vms_by_cluster(client)
        vms_by_host = _assign_cluster_counts_to_hosts(base_hosts, cluster_counts)
    else:
        if count_mode != "runtime":
            logger.warning("Unknown ovirt_host_vm_count_mode=%r; falling back to runtime", count_mode)
        logger.info(
            "oVirt host VM count mode=runtime; total_vms reflects running VMs with host.id present"
        )
        vms_by_host = _count_vms_by_host_runtime(client)

    stats_map: Dict[str, Dict[str, Optional[float]]] = {}
    if base_hosts:
        max_workers = min(_MAX_WORKERS, len(base_hosts))
        if max_workers <= 1:
            for item in base_hosts:
                host_id = item["id"]
                if not host_id:
                    continue
                stats_map[host_id] = _fetch_host_stats(client, host_id, item["cpu_cores"])
        else:
            with ThreadPoolExecutor(max_workers=max_workers) as ex:
                futs = {
                    ex.submit(
                        _fetch_host_stats,
                        _OvirtClient(settings.ovirt_base_url),
                        item["id"],
                        item["cpu_cores"],
                    ): item["id"]
                    for item in base_hosts
                    if item.get("id")
                }
                for fut in as_completed(futs):
                    host_id = futs[fut]
                    try:
                        stats_map[host_id] = fut.result()
                    except Exception as exc:
                        logger.debug("oVirt host stats failed for %s: %s", host_id, exc)

    results: List[HostSummary] = []
    for item in base_hosts:
        host_id = item["id"]
        stats = stats_map.get(host_id) or {}
        cpu_pct = stats.get("cpu_usage_pct")
        cpu_cores = item["cpu_cores"] or 0
        total_mhz = cpu_cores * 1000
        # Synthetic MHz derived from percent to match VMware UI expectations.
        if cpu_pct is None or cpu_cores <= 0:
            overall_cpu_usage_mhz = 0
        else:
            overall_cpu_usage_mhz = int(round(total_mhz * (cpu_pct / 100.0)))
        memory_used_mb = stats.get("memory_used_mb")
        if memory_used_mb is None:
            memory_used_mb = 0
        results.append(
            HostSummary(
                id=host_id,
                name=item["name"],
                connection_state=item["connection_state"],
                power_state=item["power_state"],
                cluster=item["cluster"],
                cpu_cores=cpu_cores,
                cpu_threads=None,
                memory_total_mb=item["memory_total_mb"] or 0,
                overall_cpu_usage_mhz=overall_cpu_usage_mhz,
                overall_memory_usage_mb=int(memory_used_mb),
                version=item["version"],
                build=item["build"],
                total_vms=vms_by_host.get(host_id, 0),
            )
        )

    _SUMMARY_CACHE["hosts"] = results
    return results


def get_host_detail(host_id: str, *, refresh: bool = False) -> HostDetail:
    if not refresh and host_id in _DETAIL_CACHE:
        cached = _DETAIL_CACHE.get(host_id)
        if cached:
            return cached
    if settings.test_mode:
        payload = HostDetail(
            id=host_id,
            name=None,
            datacenter=None,
            cluster=None,
            hardware={},
            esxi={},
            quick_stats={},
            networking={},
            datastores=[],
            vms=[],
        )
        _DETAIL_CACHE[host_id] = payload
        return payload
    if not settings.ovirt_base_url or not settings.ovirt_user or not settings.ovirt_pass:
        raise HTTPException(status_code=500, detail="Configuracion de oVirt incompleta")

    client = _OvirtClient(settings.ovirt_base_url)
    try:
        payload = client.get_json(f"/hosts/{host_id}", timeout=15, allow_fail=False)
    except HTTPException as exc:
        if exc.status_code == 404:
            raise
        raise HTTPException(status_code=502, detail="Error consultando oVirt") from exc

    host = _unwrap_host_payload(payload)
    if not host:
        raise HTTPException(status_code=502, detail="Respuesta invalida de oVirt")

    clusters_by_id = _load_clusters_map(client)
    cluster_name = _extract_name(host.get("cluster"))
    if not cluster_name:
        cluster_id = _extract_id(host.get("cluster"))
        if cluster_id:
            cluster_name = clusters_by_id.get(cluster_id, "")

    cpu_cores = _cpu_cores(host)
    stats = _fetch_host_stats(client, host_id, cpu_cores)
    cpu_pct = stats.get("cpu_usage_pct")
    total_mhz = cpu_cores * 1000
    if cpu_pct is None or cpu_cores <= 0:
        overall_cpu_usage_mhz = 0
    else:
        overall_cpu_usage_mhz = int(round(total_mhz * (cpu_pct / 100.0)))
    memory_used_mb = stats.get("memory_used_mb") or 0

    memory_bytes = _memory_bytes(host)
    version, build = _parse_host_version(host)
    hardware_info = {
        "cpu_model": (host.get("cpu") or {}).get("name") if isinstance(host.get("cpu"), dict) else None,
        "cpu_pkgs": _safe_int(((host.get("cpu") or {}).get("topology") or {}).get("sockets")) if isinstance(host.get("cpu"), dict) else None,
        "cpu_cores": cpu_cores,
        "cpu_threads": None,
        "memory_size_bytes": memory_bytes,
        "server_model": (host.get("hardware_information") or {}).get("model") if isinstance(host.get("hardware_information"), dict) else None,
        "vendor": (host.get("hardware_information") or {}).get("manufacturer") if isinstance(host.get("hardware_information"), dict) else None,
    }

    quick_stats = {
        "overall_cpu_usage_mhz": overall_cpu_usage_mhz,
        "overall_memory_usage_mb": memory_used_mb,
        "uptime_seconds": _safe_int((host.get("statistics") or {}).get("elapsed.time")) if isinstance(host.get("statistics"), dict) else None,
        "power_policy": None,
    }

    nics_payload = client.get_json(f"/hosts/{host_id}/nics?max=2000", allow_fail=True)
    networking = {
        "pnics": _build_pnics(nics_payload),
        "vmkernel_nics": [],
        "vswitches": [],
        "dvswitches": [],
    }

    vms = _collect_vms_for_host(client, host_id)

    detail = HostDetail(
        id=str(host.get("id") or host_id),
        name=host.get("name"),
        datacenter=None,
        cluster=cluster_name or None,
        hardware=hardware_info,
        esxi={"product_name": "oVirt", "version": version, "build": build},
        quick_stats=quick_stats,
        networking=networking,
        datastores=[],
        vms=vms,
    )
    _DETAIL_CACHE[host_id] = detail
    return detail


def get_host_deep(host_id: str, *, refresh: bool = False) -> HostDeep:
    if not refresh and host_id in _DEEP_CACHE:
        cached = _DEEP_CACHE.get(host_id)
        if cached:
            return cached
    if settings.test_mode:
        payload = HostDeep(
            id=host_id,
            name=None,
            sensors=[],
            networking={},
            storage={},
            security={},
            profiles={},
            hardware={},
            runtime={},
            datastores=[],
            vms=[],
        )
        _DEEP_CACHE[host_id] = payload
        return payload
    if not settings.ovirt_base_url or not settings.ovirt_user or not settings.ovirt_pass:
        raise HTTPException(status_code=500, detail="Configuracion de oVirt incompleta")

    client = _OvirtClient(settings.ovirt_base_url)
    try:
        payload = client.get_json(f"/hosts/{host_id}", timeout=15, allow_fail=False)
    except HTTPException as exc:
        if exc.status_code == 404:
            raise
        raise HTTPException(status_code=502, detail="Error consultando oVirt") from exc

    host = _unwrap_host_payload(payload)
    if not host:
        raise HTTPException(status_code=502, detail="Respuesta invalida de oVirt")

    devices_payload = client.get_json(f"/hosts/{host_id}/devices?max=2000", allow_fail=True) or {}
    devices = devices_payload.get("device", []) if isinstance(devices_payload, dict) else []

    nics_payload = client.get_json(f"/hosts/{host_id}/nics?max=2000", allow_fail=True) or {}
    nics = nics_payload.get("nic", []) if isinstance(nics_payload, dict) else []

    network_cache: Dict[str, str] = {}
    nic_entries: List[Dict[str, Any]] = []

    def _build_nic_detail(nic: Dict[str, Any]) -> Dict[str, Any]:
        nic_id = nic.get("id")
        attachments_payload = client.get_json(
            f"/hosts/{host_id}/nics/{nic_id}/networkattachments?max=2000",
            allow_fail=True,
        ) or {}
        attachments = attachments_payload.get("network_attachment", []) if isinstance(attachments_payload, dict) else []
        enriched_attachments: List[Dict[str, Any]] = []
        for att in attachments or []:
            if not isinstance(att, dict):
                continue
            network_id = _extract_id(att.get("network"))
            network_label = _load_network_label(network_id or "", network_cache, client) if network_id else ""
            enriched_attachments.append(
                {
                    "id": att.get("id"),
                    "network_id": network_id,
                    "network": network_label,
                    "in_sync": att.get("in_sync"),
                }
            )

        lldp_payload = client.get_json(
            f"/hosts/{host_id}/nics/{nic_id}/linklayerdiscoveryprotocolelements?max=2000",
            allow_fail=True,
        ) or {}
        lldp = (
            lldp_payload.get("link_layer_discovery_protocol_element", [])
            if isinstance(lldp_payload, dict)
            else []
        )

        stats_payload = client.get_json(
            f"/hosts/{host_id}/nics/{nic_id}/statistics?max=2000",
            allow_fail=True,
        )
        stats = _extract_stats(stats_payload)

        mac = None
        mac_payload = nic.get("mac")
        if isinstance(mac_payload, dict):
            mac = mac_payload.get("address")
        speed = nic.get("speed")
        if isinstance(speed, dict):
            speed = speed.get("speed")

        return {
            "id": nic_id,
            "name": nic.get("name"),
            "mac": mac,
            "speed_mbps": _safe_int(speed),
            "status": nic.get("status"),
            "network_attachments": enriched_attachments,
            "lldp": lldp,
            "statistics": stats,
        }

    if nics:
        max_workers = min(_MAX_WORKERS, len(nics))
        if max_workers <= 1:
            for nic in nics:
                if isinstance(nic, dict):
                    nic_entries.append(_build_nic_detail(nic))
        else:
            with ThreadPoolExecutor(max_workers=max_workers) as ex:
                futs = {
                    ex.submit(_build_nic_detail, nic): nic
                    for nic in nics
                    if isinstance(nic, dict)
                }
                for fut in as_completed(futs):
                    try:
                        nic_entries.append(fut.result())
                    except Exception as exc:
                        logger.debug("oVirt host NIC enrichment failed: %s", exc)

    connection_state, power_state = _map_states(host.get("status"))
    vms = _collect_vms_for_host(client, host_id)
    deep = HostDeep(
        id=str(host.get("id") or host_id),
        name=host.get("name"),
        sensors=[],
        networking={"nics": nic_entries},
        storage={},
        security={},
        profiles={},
        hardware={
            "cpu": host.get("cpu"),
            "memory_bytes": _memory_bytes(host),
            "devices": devices,
        },
        runtime={
            "connection_state": connection_state,
            "power_state": power_state,
            "status": host.get("status"),
        },
        datastores=[],
        vms=vms,
    )
    _DEEP_CACHE[host_id] = deep
    return deep
