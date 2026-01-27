from __future__ import annotations

import logging
from typing import Any, Dict, Iterable, List, Optional

import requests
from fastapi import HTTPException
from pyVmomi import vim

from app.hosts.host_models import HostDeep, HostDetail, HostSummary
from app.vms.vm_service import (
    ThreadSafeTTLCache,
    _network_endpoint,
    _vcenter_tls_verify,
    _soap_connect,
    get_session_token,
)

logger = logging.getLogger(__name__)

# TTL caches
_SUMMARY_CACHE = ThreadSafeTTLCache(maxsize=4, ttl=30)
_DETAIL_CACHE = ThreadSafeTTLCache(maxsize=32, ttl=120)
_DEEP_CACHE = ThreadSafeTTLCache(maxsize=32, ttl=600)


def _safe_int(value: Any, divisor: Optional[int] = None) -> Optional[int]:
    try:
        num = int(value)
        if divisor:
            return int(num // divisor)
        return num
    except Exception:
        return None


def _safe_float(value: Any) -> Optional[float]:
    try:
        val = float(value)
        return val
    except Exception:
        return None


def _power_policy_data(policy: Any) -> Optional[Dict[str, Any]]:
    if policy is None:
        return None
    return {
        "key": getattr(policy, "key", None),
        "name": getattr(policy, "name", None),
        "short_name": getattr(policy, "shortName", None),
        "description": getattr(policy, "description", None),
    }


def _rest_host_map() -> Dict[str, dict]:
    try:
        token = get_session_token()
    except Exception:
        return {}

    headers = {"vmware-api-session-id": token}
    url = _network_endpoint("/rest/vcenter/host")
    try:
        resp = requests.get(url, headers=headers, verify=_vcenter_tls_verify(), timeout=10)
        resp.raise_for_status()
        data = resp.json().get("value", []) if resp.headers.get("content-type", "").startswith("application/json") else []
    except Exception as exc:
        logger.debug("REST host map failed: %s", exc)
        return {}

    mapping: Dict[str, dict] = {}
    for item in data:
        host_id = item.get("host")
        if host_id:
            mapping[host_id] = item
    return mapping


def _iter_hosts() -> Iterable[vim.HostSystem]:
    si, content = _soap_connect()
    view = None
    try:
        view = content.viewManager.CreateContainerView(content.rootFolder, [vim.HostSystem], True)
        for host in view.view:
            yield host
    finally:
        if view:
            try:
                view.Destroy()
            except Exception:
                logger.debug("Error destroying host view", exc_info=True)
        try:
            from pyVim.connect import Disconnect

            Disconnect(si)
        except Exception:
            logger.debug("Error disconnecting SOAP session", exc_info=True)


def _find_host(host_id: str) -> Optional[vim.HostSystem]:
    si, content = _soap_connect()
    view = None
    try:
        view = content.viewManager.CreateContainerView(content.rootFolder, [vim.HostSystem], True)
        for host in view.view:
            if getattr(host, "_moId", None) == host_id:
                return host
    finally:
        if view:
            try:
                view.Destroy()
            except Exception:
                logger.debug("Error destroying host view", exc_info=True)
        try:
            from pyVim.connect import Disconnect

            Disconnect(si)
        except Exception:
            logger.debug("Error disconnecting SOAP session", exc_info=True)
    return None


def _with_host(host_id: str, handler):
    si, content = _soap_connect()
    view = None
    try:
        view = content.viewManager.CreateContainerView(content.rootFolder, [vim.HostSystem], True)
        target = None
        for host in view.view:
            if getattr(host, "_moId", None) == host_id:
                target = host
                break
        if target is None:
            raise HTTPException(status_code=404, detail="Host no encontrado")
        return handler(target, content)
    finally:
        if view:
            try:
                view.Destroy()
            except Exception:
                logger.debug("Error destroying host view", exc_info=True)
        try:
            from pyVim.connect import Disconnect

            Disconnect(si)
        except Exception:
            logger.debug("Error disconnecting SOAP session", exc_info=True)


def _cluster_name(host: vim.HostSystem) -> Optional[str]:
    parent = getattr(host, "parent", None)
    if isinstance(parent, vim.ClusterComputeResource):
        return getattr(parent, "name", None)
    return None


def _datacenter_name(host: vim.HostSystem) -> Optional[str]:
    current = getattr(host, "parent", None)
    while current is not None:
        if isinstance(current, vim.Datacenter):
            return getattr(current, "name", None)
        current = getattr(current, "parent", None)
    return None


def _make_datastore_entry(ds) -> Dict[str, Any]:
    summary = getattr(ds, "summary", None)
    capacity = getattr(summary, "capacity", None) if summary else None
    free_space = getattr(summary, "freeSpace", None) if summary else None
    used = None
    if isinstance(capacity, (int, float)) and isinstance(free_space, (int, float)):
        used = capacity - free_space
    return {
        "name": getattr(ds, "name", None),
        "capacity": capacity,
        "free_space": free_space,
        "used": used,
        "type": getattr(summary, "type", None) if summary else None,
    }


def _pnics(host: vim.HostSystem) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    net = getattr(getattr(host, "config", None), "network", None)
    for nic in getattr(net, "pnic", []) or []:
        out.append(
            {
                "name": getattr(nic, "device", None),
                "mac": getattr(nic, "mac", None),
                "link_speed_mbps": getattr(getattr(nic, "linkSpeed", None), "speedMb", None),
                "driver": getattr(nic, "driver", None),
            }
        )
    return out


def _vmkernels(host: vim.HostSystem) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    net = getattr(getattr(host, "config", None), "network", None)
    for vmk in getattr(net, "vnic", []) or []:
        addr = getattr(getattr(vmk, "spec", None), "ip", None)
        portgroup = getattr(getattr(vmk, "spec", None), "portgroup", None)
        dvs_port = getattr(getattr(vmk, "spec", None), "distributedVirtualPort", None)
        services = getattr(getattr(vmk, "spec", None), "ipRouteSpec", None)
        out.append(
            {
                "name": getattr(vmk, "device", None),
                "mac": getattr(vmk, "mac", None),
                "mtu": getattr(getattr(vmk, "spec", None), "mtu", None),
                "ip": getattr(addr, "ipAddress", None) if addr else None,
                "prefix": getattr(addr, "subnetMask", None) if addr else None,
                "portgroup": portgroup,
                "dvport": _to_plain(dvs_port) if dvs_port else None,
                "services": _to_plain(services) if services else None,
            }
        )
    return out


def _switches(host: vim.HostSystem) -> Dict[str, List[Dict[str, Any]]]:
    net = getattr(getattr(host, "config", None), "network", None)
    vswitches = []
    for sw in getattr(net, "vswitch", []) or []:
        vswitches.append(
            {
                "name": getattr(sw, "name", None),
                "mtu": getattr(sw, "mtu", None),
            }
        )
    dvswitches = []
    for ps in getattr(net, "proxySwitch", []) or []:
        dvswitches.append(
            {
                "name": getattr(ps, "dvsName", None),
                "mtu": getattr(ps, "mtu", None),
            }
        )
    return {"vswitches": vswitches, "dvswitches": dvswitches}


def _vm_list(host: vim.HostSystem) -> List[Dict[str, Any]]:
    vms: List[Dict[str, Any]] = []
    for vm in getattr(host, "vm", []) or []:
        runtime = getattr(getattr(vm, "summary", None), "runtime", None)
        vms.append(
            {
                "name": getattr(vm, "name", None),
                "moid": getattr(vm, "_moId", None),
                "power_state": getattr(runtime, "powerState", None) if runtime else None,
            }
        )
    return vms


def _sensor_filter(sensors: Iterable[Any]) -> List[Dict[str, Any]]:
    interesting = []
    keywords = ("cpu", "temp", "system", "board", "power", "volt", "fan", "12", "5.", "3.3")
    skip_tokens = ("memory", "dynamicproperty", "dynamictype")
    for sensor in sensors or []:
        name = str(getattr(sensor, "name", "") or "").strip()
        lname = name.lower()
        if any(tok in lname for tok in skip_tokens):
            continue
        if not any(key in lname for key in keywords):
            continue
        interesting.append(
            {
                "name": name or getattr(sensor, "label", None),
                "health": getattr(sensor, "healthState", None) and getattr(sensor.healthState, "key", None),
                "status": getattr(sensor, "healthState", None) and getattr(sensor.healthState, "summary", None),
                "value": getattr(sensor, "currentReading", None),
                "unit": getattr(sensor, "unitModifier", None),
            }
        )
    return interesting


def _health_sensors(host: vim.HostSystem) -> List[Dict[str, Any]]:
    runtime = getattr(host, "runtime", None)
    health = getattr(runtime, "healthSystemRuntime", None) if runtime else None
    if not health:
        return []
    system_health = getattr(health, "systemHealthInfo", None)
    sensors = getattr(system_health, "numericSensorInfo", None) if system_health else None
    return _sensor_filter(sensors)


def get_hosts_summary(*, refresh: bool = False) -> List[HostSummary]:
    if not refresh and "hosts" in _SUMMARY_CACHE:
        return _SUMMARY_CACHE["hosts"]

    rest_map = _rest_host_map()
    hosts: List[HostSummary] = []
    try:
        for host in _iter_hosts():
            summary = getattr(host, "summary", None)
            runtime = getattr(summary, "runtime", None) if summary else None
            hardware = getattr(summary, "hardware", None) if summary else None
            config = getattr(summary, "config", None) if summary else None
            quick = getattr(summary, "quickStats", None) if summary else None
            host_id = getattr(host, "_moId", None)
            rest_info = rest_map.get(host_id, {})
            hosts.append(
                HostSummary(
                    id=host_id,
                    name=rest_info.get("name") or getattr(host, "name", None),
                    connection_state=rest_info.get("connection_state") or getattr(runtime, "connectionState", None),
                    power_state=rest_info.get("power_state") or getattr(runtime, "powerState", None),
                    cluster=_cluster_name(host),
                    cpu_cores=_safe_int(getattr(hardware, "numCpuCores", None)),
                    cpu_threads=_safe_int(getattr(hardware, "numCpuThreads", None)),
                    memory_total_mb=_safe_int(getattr(hardware, "memorySize", None), divisor=1024 * 1024),
                    overall_cpu_usage_mhz=_safe_int(getattr(quick, "overallCpuUsage", None)),
                    overall_memory_usage_mb=_safe_int(getattr(quick, "overallMemoryUsage", None)),
                    version=rest_info.get("version") or getattr(getattr(config, "product", None), "version", None),
                    build=rest_info.get("build") or getattr(getattr(config, "product", None), "build", None),
                    total_vms=len(getattr(host, "vm", []) or []),
                )
            )
    except Exception:
        logger.exception("Error fetching hosts summary")
        raise HTTPException(status_code=500, detail="Error al obtener hosts")

    _SUMMARY_CACHE["hosts"] = hosts
    return hosts


def _build_detail(host: vim.HostSystem) -> HostDetail:
    summary = getattr(host, "summary", None)
    hardware = getattr(summary, "hardware", None) if summary else None
    config = getattr(summary, "config", None) if summary else None
    quick = getattr(summary, "quickStats", None) if summary else None

    product = getattr(config, "product", None) if config else None
    hw_full = getattr(host, "hardware", None)
    sys_info = getattr(hw_full, "systemInfo", None) if hw_full else None
    power_info = getattr(getattr(host, "config", None), "powerSystemInfo", None)

    hardware_info = {
        "cpu_model": getattr(hardware, "cpuModel", None),
        "cpu_pkgs": _safe_int(getattr(hardware, "numCpuPkgs", None)),
        "cpu_cores": _safe_int(getattr(hardware, "numCpuCores", None)),
        "cpu_threads": _safe_int(getattr(hardware, "numCpuThreads", None)),
        "memory_size_bytes": _safe_int(getattr(hardware, "memorySize", None)),
        "server_model": getattr(sys_info, "model", None),
        "vendor": getattr(sys_info, "vendor", None),
    }

    esxi_info = {
        "product_name": getattr(product, "name", None),
        "full_name": getattr(product, "fullName", None),
        "version": getattr(product, "version", None),
        "build": getattr(product, "build", None),
    }

    quick_stats = {
        "overall_cpu_usage_mhz": _safe_int(getattr(quick, "overallCpuUsage", None)),
        "overall_memory_usage_mb": _safe_int(getattr(quick, "overallMemoryUsage", None)),
        "uptime_seconds": _safe_int(getattr(quick, "uptime", None)),
        "power_policy": _power_policy_data(getattr(power_info, "currentPolicy", None)),
    }

    switches = _switches(host)

    networking = {
        "pnics": _pnics(host),
        "vmkernel_nics": _vmkernels(host),
        "vswitches": switches.get("vswitches", []),
        "dvswitches": switches.get("dvswitches", []),
    }

    datastores = [_make_datastore_entry(ds) for ds in getattr(host, "datastore", []) or []]

    return HostDetail(
        id=getattr(host, "_moId", None),
        name=getattr(host, "name", None),
        datacenter=_datacenter_name(host),
        cluster=_cluster_name(host),
        hardware=hardware_info,
        esxi=esxi_info,
        quick_stats=quick_stats,
        networking=networking,
        datastores=datastores,
        vms=_vm_list(host),
    )


def _hba_entries(storage) -> List[Dict[str, Any]]:
    entries: List[Dict[str, Any]] = []
    for hba in getattr(storage, "hostBusAdapter", []) or []:
        entries.append(
            {
                "key": getattr(hba, "key", None),
                "device": getattr(hba, "device", None),
                "model": getattr(hba, "model", None),
                "driver": getattr(hba, "driver", None),
                "status": getattr(hba, "status", None),
                "pci": getattr(hba, "pci", None),
                "bus": getattr(hba, "bus", None),
                "type": hba.__class__.__name__,
            }
        )
    return entries


def _lun_entries(storage) -> List[Dict[str, Any]]:
    entries: List[Dict[str, Any]] = []
    for lun in getattr(storage, "scsiLun", []) or []:
        capacity = getattr(lun, "capacity", None)
        blocks = getattr(capacity, "block", None) if capacity else None
        block_size = getattr(capacity, "blockSize", None) if capacity else None
        capacity_bytes = None
        if isinstance(blocks, (int, float)) and isinstance(block_size, (int, float)):
            capacity_bytes = int(blocks) * int(block_size)
        entries.append(
            {
                "canonical_name": getattr(lun, "canonicalName", None),
                "uuid": getattr(lun, "uuid", None),
                "device_name": getattr(lun, "deviceName", None),
                "lun_type": getattr(lun, "lunType", None),
                "vendor": getattr(lun, "vendor", None),
                "model": getattr(lun, "model", None),
                "serial": getattr(lun, "serialNumber", None),
                "capacity_bytes": capacity_bytes,
                "block_size": block_size,
            }
        )
    return entries


def _multipath_entries(storage) -> List[Dict[str, Any]]:
    mp = getattr(storage, "multipathInfo", None)
    if not mp:
        return []
    entries: List[Dict[str, Any]] = []
    for entry in getattr(mp, "lun", []) or []:
        paths = getattr(entry, "path", []) or []
        entries.append(
            {
                "id": getattr(entry, "id", None),
                "policy": getattr(getattr(entry, "policy", None), "policy", None),
                "path_count": len(paths),
                "paths": [
                    {
                        "name": getattr(p, "name", None),
                        "state": getattr(p, "pathState", None),
                        "is_active": getattr(p, "isActive", None),
                    }
                    for p in paths
                ],
            }
        )
    return entries


def _networking_deep(host: vim.HostSystem) -> Dict[str, Any]:
    net = getattr(getattr(host, "config", None), "network", None)
    return {
        "pnics": _pnics(host),
        "vmknics": _to_plain(getattr(net, "vnic", None), max_depth=2) if net else [],
        "vswitch": [
            {
                "name": getattr(sw, "name", None),
                "mtu": getattr(sw, "mtu", None),
                "num_ports": getattr(sw, "numPorts", None),
                "used_ports": getattr(sw, "numPortsUsed", None),
            }
            for sw in getattr(net, "vswitch", []) or []
        ],
        "dvs_proxy_switch": [
            {
                "name": getattr(ps, "dvsName", None),
                "uuid": getattr(ps, "dvsUuid", None),
                "mtu": getattr(ps, "mtu", None),
                "num_ports": getattr(ps, "numPorts", None),
            }
            for ps in getattr(net, "proxySwitch", []) or []
        ],
        "portgroups": [
            {
                "name": getattr(pg, "spec", None) and getattr(pg.spec, "name", None),
                "vlan_id": getattr(pg, "spec", None) and getattr(pg.spec, "vlanId", None),
                "vswitch": getattr(pg, "spec", None) and getattr(pg.spec, "vswitchName", None),
            }
            for pg in getattr(net, "portgroup", []) or []
        ],
    }


def _runtime_summary(host: vim.HostSystem) -> Dict[str, Any]:
    runtime = getattr(host, "runtime", None)
    if not runtime:
        return {}
    health = getattr(runtime, "healthSystemRuntime", None)
    return {
        "connection_state": getattr(runtime, "connectionState", None),
        "power_state": getattr(runtime, "powerState", None),
        "in_maintenance": getattr(runtime, "inMaintenanceMode", None),
        "boot_time": getattr(runtime, "bootTime", None),
        "health_state": getattr(health, "systemHealthInfo", None)
        and getattr(getattr(health, "systemHealthInfo", None), "numericSensorInfo", None)
        and len(getattr(getattr(health, "systemHealthInfo", None), "numericSensorInfo", []))
        or None,
    }


def _security_summary(cfg, host: vim.HostSystem) -> Dict[str, Any]:
    firewall_info = _to_plain(
        getattr(getattr(getattr(host, "configManager", None), "firewallSystem", None), "firewallInfo", None),
        max_depth=2,
    )
    return {
        "lockdown_mode": getattr(cfg, "lockdownMode", None) if cfg else None,
        "secure_boot": getattr(getattr(cfg, "secureBoot", None), "enabled", None) if cfg else None,
        "tpm": _to_plain(getattr(cfg, "tpmAttestation", None), max_depth=2) if cfg else None,
        "certificate": _to_plain(getattr(cfg, "certificate", None), max_depth=2) if cfg else None,
        "firewall": firewall_info,
    }


def _hardware_deep(hw) -> Dict[str, Any]:
    return {
        "pci_devices": [
            {
                "id": getattr(p, "id", None),
                "class_name": getattr(p, "className", None),
                "vendor_name": getattr(p, "vendorName", None),
                "device_name": getattr(p, "deviceName", None),
                "subsystem": getattr(p, "subsystemId", None),
                "slot": getattr(p, "slotInfo", None)
                and getattr(getattr(p, "slotInfo", None), "pciSlotNumber", None),
            }
            for p in getattr(hw, "pciDevice", []) or []
        ],
        "numa": _to_plain(getattr(hw, "numaInfo", None), max_depth=2) if hw else None,
        "bios": _to_plain(getattr(hw, "biosInfo", None), max_depth=2) if hw else None,
        "oem": _to_plain(getattr(hw, "systemInfo", None), max_depth=2) if hw else None,
    }


def _collect_deep_sections(host: vim.HostSystem) -> Dict[str, Any]:
    hw = getattr(host, "hardware", None)
    cfg = getattr(host, "config", None)
    runtime = getattr(host, "runtime", None)
    network = getattr(cfg, "network", None) if cfg else None
    storage = getattr(cfg, "storageDevice", None) if cfg else None

    storage_deep = {
        "hbas": _hba_entries(storage),
        "luns": _lun_entries(storage),
        "multipath": _multipath_entries(storage),
        "datastores": [_make_datastore_entry(ds) for ds in getattr(host, "datastore", []) or []],
    }

    security = _security_summary(cfg, host)

    profiles = {
        "compliance": _to_plain(getattr(runtime, "profileCompliance", None), max_depth=2) if runtime else None,
        "profile": _to_plain(getattr(cfg, "profile", None), max_depth=2) if cfg else None,
    }

    vms_deep = []
    for vm in getattr(host, "vm", []) or []:
        runtime_vm = getattr(getattr(vm, "summary", None), "runtime", None)
        vms_deep.append(
            {
                "name": getattr(vm, "name", None),
                "moid": getattr(vm, "_moId", None),
                "power_state": getattr(runtime_vm, "powerState", None) if runtime_vm else None,
                "guest": getattr(getattr(vm, "summary", None), "guest", None)
                and getattr(getattr(vm.summary, "guest", None), "guestFullName", None),
            }
        )

    deep = {
        "sensors": _health_sensors(host),
        "hardware": _hardware_deep(hw) if hw else {},
        "runtime": _runtime_summary(host),
        "networking": _networking_deep(host),
        "storage": storage_deep,
        "security": security,
        "profiles": profiles,
        "datastores": storage_deep["datastores"],
        "vms": vms_deep,
    }
    return deep


def _to_plain(obj: Any, *, depth: int = 0, max_depth: int = 3) -> Any:
    if obj is None or isinstance(obj, (bool, int, float, str)):
        return obj
    if depth >= max_depth:
        try:
            return str(obj)
        except Exception:
            return None
    if isinstance(obj, list):
        return [_to_plain(item, depth=depth + 1, max_depth=max_depth) for item in obj]
    if isinstance(obj, tuple):
        return tuple(_to_plain(item, depth=depth + 1, max_depth=max_depth) for item in obj)
    if isinstance(obj, dict):
        return {key: _to_plain(value, depth=depth + 1, max_depth=max_depth) for key, value in obj.items()}
    try:
        data = vars(obj)
    except Exception:
        try:
            return str(obj)
        except Exception:
            return None
    return {
        key: _to_plain(value, depth=depth + 1, max_depth=max_depth)
        for key, value in data.items()
        if not str(key).startswith("_")
    }


def get_host_detail(host_id: str, *, refresh: bool = False) -> HostDetail:
    if not refresh and host_id in _DETAIL_CACHE:
        cached = _DETAIL_CACHE.get(host_id)
        if cached:
            return cached

    detail = _with_host(host_id, lambda host, _content: _build_detail(host))
    _DETAIL_CACHE[host_id] = detail
    return detail


def get_host_deep(host_id: str, *, refresh: bool = False) -> HostDeep:
    if not refresh and host_id in _DEEP_CACHE:
        cached = _DEEP_CACHE.get(host_id)
        if cached:
            return cached

    payload = _with_host(
        host_id,
        lambda host, _content: HostDeep(
            id=getattr(host, "_moId", None),
            name=getattr(host, "name", None),
            **_collect_deep_sections(host),
        ),
    )
    _DEEP_CACHE[host_id] = payload
    return payload
