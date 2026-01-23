from __future__ import annotations

import argparse
from collections import Counter
from datetime import datetime, timezone
from typing import Any, Dict, Iterable, List, Tuple

from app.settings import settings
from app.vms import ovirt_service
from app.vms.ovirt_router import _SNAPSHOT_STORE, _scope_key


def _safe_list(payload: Any, key: str) -> List[Dict[str, Any]]:
    if not isinstance(payload, dict):
        return []
    items = payload.get(key, [])
    return [item for item in items if isinstance(item, dict)]


def _vm_power_state(vm: Dict[str, Any]) -> str:
    if "power_state" in vm and isinstance(vm.get("power_state"), str):
        return str(vm.get("power_state") or "unknown")
    return ovirt_service._map_power_state(vm.get("status"))


def _cluster_name(vm: Dict[str, Any], clusters_by_id: Dict[str, str]) -> str:
    if isinstance(vm.get("cluster"), str):
        return str(vm.get("cluster") or "")
    cluster_id = ovirt_service._extract_id(vm.get("cluster"))
    if cluster_id and cluster_id in clusters_by_id:
        return clusters_by_id[cluster_id]
    return ovirt_service._extract_name(vm.get("cluster"))


def _host_name(host_id: str, hosts_by_id: Dict[str, str]) -> str:
    return hosts_by_id.get(host_id, "")


def _resolve_host(
    vm: Dict[str, Any],
    hosts_by_id: Dict[str, str],
    hosts_by_name: Dict[str, str],
) -> Tuple[Optional[str], str]:
    host = vm.get("host")
    if isinstance(host, dict):
        host_id = ovirt_service._extract_id(host)
        name = ovirt_service._extract_name(host)
        if host_id and not name:
            name = hosts_by_id.get(host_id, "")
        return host_id, name
    if isinstance(host, str):
        name = host
        host_id = hosts_by_name.get(host.strip().lower())
        return host_id, name
    return None, ""


def _summarize_vms(
    vms: Iterable[Dict[str, Any]],
    *,
    hosts_by_id: Dict[str, str],
    clusters_by_id: Dict[str, str],
) -> Tuple[Dict[str, Any], List[Dict[str, Any]], Dict[str, int]]:
    total = 0
    powered_on = 0
    powered_off = 0
    with_host = 0
    without_host = 0
    missing_host_examples: List[Dict[str, Any]] = []
    group_by_host = Counter()

    for vm in vms:
        if not isinstance(vm, dict):
            continue
        total += 1
        power_state = _vm_power_state(vm)
        if power_state == "POWERED_ON":
            powered_on += 1
        else:
            powered_off += 1
        host_id, host_name = _resolve_host(
            vm, hosts_by_id=hosts_by_id, hosts_by_name={v.lower(): k for k, v in hosts_by_id.items()}
        )
        if host_id:
            with_host += 1
            group_by_host[host_id] += 1
        else:
            without_host += 1
            if len(missing_host_examples) < 10:
                missing_host_examples.append(
                    {
                        "id": vm.get("id"),
                        "name": vm.get("name"),
                        "power_state": power_state,
                        "cluster": _cluster_name(vm, clusters_by_id),
                        "host": host_name,
                    }
                )

    summary = {
        "total_vms_in_snapshot": total,
        "total_vms_powered_on": powered_on,
        "total_vms_powered_off": powered_off,
        "total_vms_with_host_id_present": with_host,
        "total_vms_without_host_id": without_host,
    }
    return summary, missing_host_examples, dict(group_by_host)


def _load_ovirt_maps(client: ovirt_service._OvirtClient) -> Tuple[Dict[str, str], Dict[str, str]]:
    hosts_payload = client.get_json("/hosts?max=2000", allow_fail=True) or {}
    clusters_payload = client.get_json("/clusters?max=2000", allow_fail=True) or {}
    hosts = _safe_list(hosts_payload, "host")
    clusters = _safe_list(clusters_payload, "cluster")
    hosts_by_id = {str(item.get("id")): str(item.get("name")) for item in hosts if item.get("id") and item.get("name")}
    clusters_by_id = {
        str(item.get("id")): str(item.get("name")) for item in clusters if item.get("id") and item.get("name")
    }
    return hosts_by_id, clusters_by_id


def _print_section(title: str) -> None:
    print("")
    print(f"== {title} ==")


def _print_summary(summary: Dict[str, Any]) -> None:
    for key in [
        "total_vms_in_snapshot",
        "total_vms_powered_on",
        "total_vms_powered_off",
        "total_vms_with_host_id_present",
        "total_vms_without_host_id",
    ]:
        print(f"{key}: {summary.get(key)}")


def _print_group_by_host(group_by: Dict[str, int], hosts_by_id: Dict[str, str]) -> None:
    for host_id, count in sorted(group_by.items(), key=lambda item: item[1], reverse=True):
        host_name = _host_name(host_id, hosts_by_id)
        suffix = f" ({host_name})" if host_name else ""
        print(f"{host_id}: {count}{suffix}")


def main() -> int:
    parser = argparse.ArgumentParser(description="Debug oVirt placement vs snapshot.")
    parser.add_argument("--limit", type=int, default=10, help="Max examples for VMs without host.")
    args = parser.parse_args()

    if not settings.ovirt_base_url or not settings.ovirt_user or not settings.ovirt_pass:
        print("oVirt is not configured (missing OVIRT_BASE_URL/OVIRT_USER/OVIRT_PASS).")
        return 1

    client = ovirt_service._OvirtClient(settings.ovirt_base_url)
    hosts_by_id, clusters_by_id = _load_ovirt_maps(client)

    _print_section("Direct oVirt API /vms?max=2000")
    payload = client.get_json("/vms?max=2000", allow_fail=True) or {}
    vms = _safe_list(payload, "vm")
    summary, missing_host_examples, group_by_host = _summarize_vms(
        vms, hosts_by_id=hosts_by_id, clusters_by_id=clusters_by_id
    )
    _print_summary(summary)
    print("generated_at_utc:", datetime.now(timezone.utc).isoformat())
    _print_section("group_by_host_id (direct oVirt)")
    _print_group_by_host(group_by_host, hosts_by_id)

    _print_section("VMs without host_id (first examples)")
    for item in missing_host_examples[: args.limit]:
        print(item)

    _print_section("Snapshot /api/ovirt/snapshot (store)")
    snapshot = _SNAPSHOT_STORE.get_snapshot(_scope_key())
    if snapshot is None:
        print("snapshot: none")
        return 0
    data = snapshot.data or {}
    snap_vms = []
    if isinstance(data, dict):
        snap_vms = data.get("ovirt", []) or []
    elif isinstance(data, list):
        snap_vms = data
    snap_summary, snap_missing, snap_group_by = _summarize_vms(
        snap_vms, hosts_by_id=hosts_by_id, clusters_by_id=clusters_by_id
    )
    _print_summary(snap_summary)
    _print_section("group_by_host_id (snapshot)")
    _print_group_by_host(snap_group_by, hosts_by_id)
    _print_section("VMs without host_id (snapshot examples)")
    for item in snap_missing[: args.limit]:
        print(item)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
