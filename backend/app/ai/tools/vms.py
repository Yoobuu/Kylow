from __future__ import annotations

import logging
from typing import Dict, List, Optional

from sqlmodel import Session

from app.ai.normalizers import (
    normalize_azure_vm,
    normalize_cedia_vm,
    normalize_hyperv_vm,
    normalize_ovirt_vm,
    normalize_vmware_vm,
)
from app.ai.schemas import AIVm, VmFilters
from app.ai.snapshots.query import flatten_vms_snapshot, get_latest_snapshot, snapshot_meta
from app.ai.tools.hyperv_utils import build_creds, load_ps_content, resolve_hosts
from app.azure import service as azure_service
from app.cedia import service as cedia_service
from app.permissions.models import PermissionCode
from app.permissions.service import user_has_permission
from app.settings import settings
from app.vms import hyperv_service, ovirt_service, vm_service
from app.vms.vmware_jobs.models import ScopeName

logger = logging.getLogger(__name__)


def _normalize_provider(value: str) -> str:
    return value.strip().lower()


def _normalize_provider_list(values: Optional[List[str]]) -> List[str]:
    if not values:
        return []
    out: List[str] = []
    for value in values:
        if not value:
            continue
        normalized = _normalize_provider(value)
        if normalized == "kvm":
            normalized = "ovirt"
        out.append(normalized)
    return list(dict.fromkeys(out))


def _apply_vm_filters(vms: List[AIVm], filters: VmFilters, *, apply_limit: bool = True) -> List[AIVm]:
    def contains(value: Optional[str], needle: Optional[str]) -> bool:
        if not needle:
            return True
        if not value:
            return False
        return needle.lower() in value.lower()

    filtered: List[AIVm] = []
    for vm in vms:
        if filters.env and vm.env not in filters.env:
            continue
        if filters.power_state and (vm.power_state or "").lower() != filters.power_state.lower():
            continue
        if filters.ram_min_mib is not None and (vm.memory_size_MiB or 0) < filters.ram_min_mib:
            continue
        if filters.ram_max_mib is not None and (vm.memory_size_MiB or 0) > filters.ram_max_mib:
            continue
        if filters.cpu_min is not None and (vm.cpu_count or 0) < filters.cpu_min:
            continue
        if filters.cpu_max is not None and (vm.cpu_count or 0) > filters.cpu_max:
            continue
        if filters.vlan_id is not None and filters.vlan_id not in (vm.vlans or []):
            continue
        if not contains(vm.name, filters.name_contains):
            continue
        if not contains(vm.host, filters.host_contains):
            continue
        if not contains(vm.cluster, filters.cluster_contains):
            continue
        if filters.ip_contains:
            match = any(filters.ip_contains in ip for ip in vm.ip_addresses or [])
            if not match:
                continue
        filtered.append(vm)

    if filters.sort == "ram_desc":
        filtered.sort(key=lambda item: item.memory_size_MiB or 0, reverse=True)
    elif filters.sort == "cpu_desc":
        filtered.sort(key=lambda item: item.cpu_count or 0, reverse=True)
    elif filters.sort == "cpu_usage_desc":
        filtered.sort(key=lambda item: item.cpu_usage_pct or 0, reverse=True)
    elif filters.sort == "ram_usage_desc":
        filtered.sort(key=lambda item: item.ram_usage_pct or 0, reverse=True)
    elif filters.sort == "name_desc":
        filtered.sort(key=lambda item: item.name or "", reverse=True)
    elif filters.sort == "name_asc":
        filtered.sort(key=lambda item: item.name or "")

    if not apply_limit:
        return filtered
    return filtered[: filters.limit]


def _note(notes: Optional[List[Dict[str, object]]], provider: str, message: str) -> None:
    if notes is None:
        return
    notes.append({"provider": provider, "note": message})


def _note_snapshot(notes: Optional[List[Dict[str, object]]], provider: str, payload: object) -> None:
    if notes is None or payload is None:
        return
    try:
        notes.append({"provider": provider, "snapshot": snapshot_meta(payload)})
    except Exception:
        return


def _collect_snapshot_vms(
    filters: VmFilters,
    *,
    user,
    session: Session,
    notes: Optional[List[Dict[str, object]]] = None,
) -> List[AIVm]:
    providers = _normalize_provider_list(filters.provider)
    if not providers:
        providers = ["vmware", "ovirt", "hyperv", "azure", "cedia"]

    results: List[AIVm] = []
    scope = ScopeName.VMS.value
    default_level = "summary"

    for provider in providers:
        try:
            if provider == "vmware":
                if not user_has_permission(user, PermissionCode.VMS_VIEW, session):
                    _note(notes, provider, "sin permiso")
                    continue
                if not settings.vmware_enabled or not settings.vmware_configured:
                    _note(notes, provider, "provider deshabilitado o sin configurar")
                    continue
                payload = get_latest_snapshot(provider="vmware", scope=scope, level=default_level)
                if payload is None:
                    _note(notes, provider, "snapshot no disponible")
                    continue
                _note_snapshot(notes, provider, payload)
                raw_list = flatten_vms_snapshot(payload)
                results.extend([normalize_vmware_vm(item) for item in raw_list if item is not None])
                continue

            if provider == "ovirt":
                if not user_has_permission(user, PermissionCode.VMS_VIEW, session):
                    _note(notes, provider, "sin permiso")
                    continue
                if not settings.ovirt_enabled or not settings.ovirt_configured:
                    _note(notes, provider, "provider deshabilitado o sin configurar")
                    continue
                payload = get_latest_snapshot(provider="ovirt", scope=scope, level=default_level)
                if payload is None:
                    _note(notes, provider, "snapshot no disponible")
                    continue
                _note_snapshot(notes, provider, payload)
                raw_list = flatten_vms_snapshot(payload)
                results.extend([normalize_ovirt_vm(item) for item in raw_list if item is not None])
                continue

            if provider == "azure":
                if not user_has_permission(user, PermissionCode.AZURE_VIEW, session):
                    _note(notes, provider, "sin permiso")
                    continue
                if not settings.azure_enabled or not settings.azure_configured:
                    _note(notes, provider, "provider deshabilitado o sin configurar")
                    continue
                payload = get_latest_snapshot(provider="azure", scope=scope, level=default_level)
                if payload is None:
                    _note(notes, provider, "snapshot no disponible")
                    continue
                _note_snapshot(notes, provider, payload)
                raw_list = flatten_vms_snapshot(payload)
                results.extend([normalize_azure_vm(item) for item in raw_list if item is not None])
                continue

            if provider == "cedia":
                if not user_has_permission(user, PermissionCode.CEDIA_VIEW, session):
                    _note(notes, provider, "sin permiso")
                    continue
                if not settings.cedia_enabled or not settings.cedia_configured:
                    _note(notes, provider, "provider deshabilitado o sin configurar")
                    continue
                payload = get_latest_snapshot(provider="cedia", scope=scope, level=default_level)
                if payload is None:
                    _note(notes, provider, "snapshot no disponible")
                    continue
                _note_snapshot(notes, provider, payload)
                raw_list = flatten_vms_snapshot(payload)
                normalized = [normalize_cedia_vm(item) for item in raw_list if item is not None]
                results.extend(normalized)
                missing = False
                for vm in normalized:
                    raw_refs = vm.raw_refs if isinstance(vm.raw_refs, dict) else {}
                    missing_fields = raw_refs.get("missing_fields")
                    if isinstance(missing_fields, list) and any(
                        field in {"numberOfCpus", "memoryMB"} for field in missing_fields
                    ):
                        missing = True
                        break
                if missing:
                    _note(notes, provider, "campos CPU/memoria no presentes en algunos registros")
                continue

            if provider == "hyperv":
                if not user_has_permission(user, PermissionCode.HYPERV_VIEW, session):
                    _note(notes, provider, "sin permiso")
                    continue
                if not settings.hyperv_enabled or not settings.hyperv_configured:
                    _note(notes, provider, "provider deshabilitado o sin configurar")
                    continue
                payload = get_latest_snapshot(provider="hyperv", scope=scope, level=default_level)
                if payload is None:
                    _note(notes, provider, "snapshot no disponible")
                    continue
                _note_snapshot(notes, provider, payload)
                raw_list = flatten_vms_snapshot(payload)
                results.extend([normalize_hyperv_vm(item) for item in raw_list if item is not None])
                continue

            _note(notes, provider, "provider no soportado")
        except Exception as exc:
            logger.exception("snapshot list_vms provider %s failed", provider)
            _note(notes, provider, f"error: {exc}")
            continue

    return results


def list_vms(
    filters: VmFilters,
    *,
    user,
    session: Session,
    notes: Optional[List[Dict[str, object]]] = None,
) -> List[AIVm]:
    results = _collect_snapshot_vms(filters, user=user, session=session, notes=notes)
    filtered = _apply_vm_filters(results, filters, apply_limit=True)
    _note_env_mismatch(results, filtered, filters, notes)
    _note_cluster_mismatch(results, filtered, filters, notes)
    _note_missing_usage(filtered, filters, notes)
    return filtered


def _normalize_group_by(value: object) -> List[str]:
    if value is None:
        return []
    if isinstance(value, str):
        values = [value]
    elif isinstance(value, list):
        values = value
    else:
        return []
    normalized: List[str] = []
    aliases = {
        "power": "power_state",
        "powerstate": "power_state",
    }
    allowed = {"provider", "env", "power_state", "host", "cluster"}
    for item in values:
        if not item:
            continue
        key = str(item).strip().lower()
        key = aliases.get(key, key)
        if key in allowed:
            normalized.append(key)
    return list(dict.fromkeys(normalized))


def _group_value(vm: AIVm, field: str) -> Optional[str]:
    if field == "provider":
        return vm.provider
    if field == "env":
        return vm.env
    if field == "power_state":
        return vm.power_state
    if field == "host":
        return vm.host
    if field == "cluster":
        return vm.cluster
    return None


def count_vms(
    filters: VmFilters,
    group_by: object,
    *,
    user,
    session: Session,
    notes: Optional[List[Dict[str, object]]] = None,
) -> Dict[str, object]:
    vms = _collect_snapshot_vms(filters, user=user, session=session, notes=notes)
    filtered = _apply_vm_filters(vms, filters, apply_limit=False)
    _note_env_mismatch(vms, filtered, filters, notes)
    _note_cluster_mismatch(vms, filtered, filters, notes)
    group_fields = _normalize_group_by(group_by) or ["provider"]

    counts: Dict[tuple, int] = {}
    for vm in filtered:
        key = tuple(_group_value(vm, field) for field in group_fields)
        counts[key] = counts.get(key, 0) + 1

    groups: List[Dict[str, object]] = []
    for key, count in counts.items():
        entry = {field: key[idx] for idx, field in enumerate(group_fields)}
        entry["count"] = count
        groups.append(entry)
    groups.sort(key=lambda item: item.get("count", 0), reverse=True)

    return {"groups": groups, "count_total": len(filtered)}


def top_vms(
    filters: VmFilters,
    sort: Optional[str],
    limit: Optional[int],
    *,
    user,
    session: Session,
    notes: Optional[List[Dict[str, object]]] = None,
) -> List[AIVm]:
    payload = filters.model_dump()
    if sort:
        payload["sort"] = sort
    if limit is not None:
        try:
            payload["limit"] = max(1, min(int(limit), 50))
        except (TypeError, ValueError):
            payload["limit"] = filters.limit
    effective = VmFilters(**payload)
    vms = _collect_snapshot_vms(effective, user=user, session=session, notes=notes)
    filtered = _apply_vm_filters(vms, effective, apply_limit=True)
    _note_env_mismatch(vms, filtered, effective, notes)
    _note_cluster_mismatch(vms, filtered, effective, notes)
    _note_missing_usage(filtered, effective, notes)
    return filtered


def _note_env_mismatch(
    source: List[AIVm],
    filtered: List[AIVm],
    filters: VmFilters,
    notes: Optional[List[Dict[str, object]]],
) -> None:
    if notes is None or not filters.env or filtered:
        return
    env_counts: Dict[str, int] = {}
    for vm in source:
        if not vm.env:
            continue
        env_counts[vm.env] = env_counts.get(vm.env, 0) + 1
    if env_counts:
        notes.append({
            "note": "env_filter_empty",
            "available_envs": env_counts,
        })


def _note_cluster_mismatch(
    source: List[AIVm],
    filtered: List[AIVm],
    filters: VmFilters,
    notes: Optional[List[Dict[str, object]]],
) -> None:
    if notes is None or not filters.cluster_contains or filtered:
        return
    cluster_counts: Dict[str, int] = {}
    for vm in source:
        if not vm.cluster:
            continue
        cluster_counts[vm.cluster] = cluster_counts.get(vm.cluster, 0) + 1
    if cluster_counts:
        notes.append({
            "note": "cluster_filter_empty",
            "available_clusters": cluster_counts,
        })


def _note_missing_usage(
    items: List[AIVm],
    filters: VmFilters,
    notes: Optional[List[Dict[str, object]]],
) -> None:
    if notes is None:
        return
    if filters.sort not in {"cpu_usage_desc", "ram_usage_desc"}:
        return
    if filters.sort == "cpu_usage_desc":
        if not any(item.cpu_usage_pct is not None for item in items):
            notes.append({"note": "cpu_usage_unavailable"})
    if filters.sort == "ram_usage_desc":
        if not any(item.ram_usage_pct is not None for item in items):
            notes.append({"note": "ram_usage_unavailable"})


def get_vm_detail(
    provider: str,
    env: str,
    id: Optional[str] = None,
    selector: Optional[Dict[str, object]] = None,
    *,
    user,
    session: Session,
) -> AIVm:
    provider_norm = _normalize_provider(provider)

    if provider_norm == "vmware":
        if not user_has_permission(user, PermissionCode.VMS_VIEW, session):
            raise PermissionError("sin permiso")
        if not settings.vmware_enabled or not settings.vmware_configured:
            raise RuntimeError("provider deshabilitado o sin configurar")
        if not id:
            raise ValueError("VMware detail requiere id")
        vm = vm_service.get_vm_detail(id)
        return normalize_vmware_vm(vm)

    if provider_norm == "ovirt":
        if not user_has_permission(user, PermissionCode.VMS_VIEW, session):
            raise PermissionError("sin permiso")
        if not settings.ovirt_enabled or not settings.ovirt_configured:
            raise RuntimeError("provider deshabilitado o sin configurar")
        if not id:
            raise ValueError("oVirt detail requiere id")
        vm = ovirt_service.get_ovirt_vm_detail(id, refresh=False)
        return normalize_ovirt_vm(vm)

    if provider_norm == "azure":
        if not user_has_permission(user, PermissionCode.AZURE_VIEW, session):
            raise PermissionError("sin permiso")
        if not settings.azure_enabled or not settings.azure_configured:
            raise RuntimeError("provider deshabilitado o sin configurar")
        if not id:
            raise ValueError("Azure detail requiere id")
        vms = azure_service.list_azure_vms(include_power_state=False)
        for vm in vms:
            if getattr(vm, "id", None) == id:
                return normalize_azure_vm(vm)
        raise RuntimeError("Azure VM no encontrada")

    if provider_norm == "cedia":
        if not user_has_permission(user, PermissionCode.CEDIA_VIEW, session):
            raise PermissionError("sin permiso")
        if not settings.cedia_enabled or not settings.cedia_configured:
            raise RuntimeError("provider deshabilitado o sin configurar")
        if not id:
            raise ValueError("CEDIA detail requiere id")
        vm = cedia_service.get_vm_detail(id)
        return normalize_cedia_vm(vm)

    if provider_norm == "hyperv":
        if not user_has_permission(user, PermissionCode.HYPERV_VIEW, session):
            raise PermissionError("sin permiso")
        if not settings.hyperv_enabled or not settings.hyperv_configured:
            raise RuntimeError("provider deshabilitado o sin configurar")
        selector = selector or {}
        name = selector.get("name") or selector.get("vm_name")
        hv_host = selector.get("hv_host") or selector.get("host")
        if not id and name:
            id = f"{name}::{hv_host or ''}"
        hosts = resolve_hosts()
        if not hosts:
            raise RuntimeError("sin hosts configurados")
        ps_content = load_ps_content()
        target_hosts = [hv_host] if hv_host else hosts
        for host in target_hosts:
            if not host:
                continue
            creds = build_creds(host)
            items = hyperv_service.collect_hyperv_inventory_for_host(
                creds,
                ps_content=ps_content,
                level="detail",
                vm_name=name if name else None,
                use_cache=True,
            )
            if items:
                vm = normalize_hyperv_vm(items[0])
                vm.raw_refs = {"hv_host": host}
                return vm
        raise RuntimeError("Hyper-V VM no encontrada")

    raise ValueError(f"Provider '{provider_norm}' no soportado")
