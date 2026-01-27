"""Dump exhaustivo de información de hosts ESXi (pyVmomi + REST)."""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any, Dict, List, Set

import requests
from dotenv import load_dotenv
from pyVim.connect import Disconnect
from pyVmomi import vim

# Asegura que el paquete app sea importable desde el script
BASE_DIR = Path(__file__).resolve().parents[1]
if str(BASE_DIR) not in sys.path:
    sys.path.insert(0, str(BASE_DIR))

# Carga variables de entorno (VCENTER_HOST, VCENTER_USER, VCENTER_PASS, etc.)
load_dotenv(BASE_DIR / ".env")

from app.vms.vm_service import (  # noqa: E402
    _network_endpoint,
    _soap_connect,
    _vcenter_tls_verify,
    get_session_token,
)


def _to_plain(obj: Any, *, depth: int = 0, max_depth: int = 6, seen: Set[int] | None = None) -> Any:
    if seen is None:
        seen = set()

    if obj is None or isinstance(obj, (bool, int, float, str)):
        return obj
    if isinstance(obj, bytes):
        return obj.decode(errors="replace")
    if depth >= max_depth:
        return str(obj)

    oid = id(obj)
    if oid in seen:
        return f"<circular {type(obj).__name__}>"
    seen.add(oid)

    if isinstance(obj, (list, tuple, set)):
        return [_to_plain(item, depth=depth + 1, max_depth=max_depth, seen=seen) for item in obj]
    if isinstance(obj, dict):
        return {
            _to_plain(key, depth=depth + 1, max_depth=max_depth, seen=seen): _to_plain(
                value, depth=depth + 1, max_depth=max_depth, seen=seen
            )
            for key, value in obj.items()
        }

    data = {}
    for key, value in vars(obj).items():
        if key.startswith("_"):
            continue
        try:
            data[key] = _to_plain(value, depth=depth + 1, max_depth=max_depth, seen=seen)
        except Exception as exc:  # pragma: no cover - defensivo
            data[key] = f"<error {exc}>"
    if not data:
        try:
            data["repr"] = str(obj)
        except Exception:
            data["repr"] = f"<unserializable {type(obj).__name__}>"
    return data


def _get_datacenter(host: vim.HostSystem) -> Dict[str, Any]:
    current = getattr(host, "parent", None)
    while current is not None:
        if isinstance(current, vim.Datacenter):
            return {
                "name": getattr(current, "name", None),
                "moid": getattr(current, "_moId", None),
            }
        current = getattr(current, "parent", None)
    return {}


def _get_cluster_info(host: vim.HostSystem) -> Dict[str, Any]:
    parent = getattr(host, "parent", None)
    if isinstance(parent, vim.ClusterComputeResource):
        return {
            "name": getattr(parent, "name", None),
            "moid": getattr(parent, "_moId", None),
            "configuration": _to_plain(getattr(parent, "configuration", None)),
            "configuration_ex": _to_plain(getattr(parent, "configurationEx", None)),
            "drs_enabled": getattr(getattr(parent, "configuration", None), "drsConfig", None)
            and getattr(getattr(parent.configuration, "drsConfig", None), "enabled", None),
            "ha_enabled": getattr(getattr(parent, "configuration", None), "dasConfig", None)
            and getattr(getattr(parent.configuration, "dasConfig", None), "enabled", None),
        }
    return {}


def _probe_rest_endpoints(headers: dict) -> Dict[str, Any]:
    endpoints = ["/rest/vcenter/host"]
    results: Dict[str, Any] = {}

    for path in endpoints:
        url = _network_endpoint(path)
        try:
            resp = requests.get(url, headers=headers, verify=_vcenter_tls_verify(), timeout=10)
            results[path] = {
                "status": resp.status_code,
                "payload": resp.json() if "application/json" in resp.headers.get("content-type", "") else resp.text,
            }
        except Exception as exc:  # pragma: no cover - defensivo
            results[path] = {"error": str(exc)}
    return results


def _collect_host_payload(host: vim.HostSystem, headers: dict) -> Dict[str, Any]:
    summary = getattr(host, "summary", None)
    hardware = getattr(summary, "hardware", None) if summary else None
    config = getattr(summary, "config", None) if summary else None
    quick = getattr(summary, "quickStats", None) if summary else None

    payload: Dict[str, Any] = {
        "name": getattr(host, "name", None),
        "moid": getattr(host, "_moId", None),
        "datacenter": _get_datacenter(host),
        "cluster": _get_cluster_info(host),
        "summary": _to_plain(summary),
        "hardware_summary": _to_plain(hardware),
        "config_summary": _to_plain(config),
        "quick_stats": _to_plain(quick),
        "hardware_full": _to_plain(getattr(host, "hardware", None)),
        "config_full": _to_plain(getattr(host, "config", None)),
        "runtime": _to_plain(getattr(host, "runtime", None)),
        "capability": _to_plain(getattr(host, "capability", None)),
        "network": _to_plain(getattr(getattr(host, "config", None), "network", None)),
        "storage": {
            "datastores": _to_plain(getattr(host, "datastore", None)),
            "storage_device": _to_plain(
                getattr(getattr(host, "config", None), "storageDevice", None)
            ),
            "file_system": _to_plain(
                getattr(getattr(getattr(host, "config", None), "fileSystemVolume", None), "mountInfo", None)
            ),
        },
        "services": _to_plain(getattr(getattr(host, "config", None), "service", None)),
        "advanced_options": _to_plain(getattr(getattr(host, "config", None), "option", None)),
        "firewall": _to_plain(
            getattr(getattr(getattr(host, "configManager", None), "firewallSystem", None), "firewallInfo", None)
        ),
        "security": {
            "lockdown_mode": getattr(getattr(host, "config", None), "lockdownMode", None),
            "secure_boot": getattr(getattr(getattr(host, "config", None), "secureBoot", None), "enabled", None)
            if getattr(host, "config", None)
            else None,
            "tpm": _to_plain(getattr(getattr(host, "config", None), "tpmAttestation", None)),
            "certificate": _to_plain(getattr(getattr(host, "config", None), "certificate", None)),
        },
        "health": _to_plain(getattr(getattr(host, "runtime", None), "healthSystemRuntime", None)),
        "power": _to_plain(getattr(getattr(host, "config", None), "powerSystemInfo", None)),
        "maintenance": {
            "in_maintenance": getattr(getattr(host, "runtime", None), "inMaintenanceMode", None),
            "connection_state": getattr(getattr(host, "runtime", None), "connectionState", None),
            "power_state": getattr(getattr(host, "runtime", None), "powerState", None),
        },
        "profiles": {
            "compliance": _to_plain(getattr(getattr(host, "runtime", None), "profileCompliance", None)),
            "profile": _to_plain(getattr(getattr(host, "config", None), "profile", None)),
        },
        "licensing": None,
        "vms": [
            {
                "name": getattr(vm, "name", None),
                "moid": getattr(vm, "_moId", None),
                "power_state": getattr(getattr(vm, "summary", None), "runtime", None)
                and getattr(getattr(vm.summary, "runtime", None), "powerState", None),
            }
            for vm in getattr(host, "vm", []) or []
        ],
        "rest_probes": _probe_rest_endpoints(headers),
    }

    return payload


def _fill_licensing(content: vim.ServiceInstanceContent, host_payload: Dict[str, Any]) -> None:
    try:
        license_mgr = getattr(content, "licenseManager", None)
        if license_mgr:
            assigned = license_mgr.QueryAssignedLicenses(entity=host_payload.get("moid"))
            host_payload["licensing"] = _to_plain(assigned)
    except Exception as exc:  # pragma: no cover - defensivo
        host_payload["licensing"] = {"error": str(exc)}


def main() -> int:
    si = None
    view = None
    try:
        token = get_session_token()
        headers = {"vmware-api-session-id": token}

        si, content = _soap_connect()
        view = content.viewManager.CreateContainerView(content.rootFolder, [vim.HostSystem], True)

        hosts_payload: List[Dict[str, Any]] = []
        for host in view.view:
            host_data = _collect_host_payload(host, headers)
            _fill_licensing(content, host_data)
            hosts_payload.append(host_data)

        print(json.dumps(hosts_payload, indent=2, ensure_ascii=False))
        return 0
    except Exception as exc:  # pragma: no cover - script manual
        print(f"[ERROR] {exc}")
        return 1
    finally:
        if view is not None:
            try:
                view.Destroy()
            except Exception:
                pass
        if si is not None:
            try:
                Disconnect(si)
            except Exception:
                pass


if __name__ == "__main__":  # pragma: no cover - entrada script
    raise SystemExit(main())
