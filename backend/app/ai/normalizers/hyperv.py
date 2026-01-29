from __future__ import annotations

from typing import Any, Dict, Iterable, List, Optional

from app.ai.schemas import AIVm


def _classify_env(value: Optional[str]) -> Optional[str]:
    if not value:
        return None
    cleaned = str(value).strip().upper()
    if not cleaned:
        return None
    tokens = [token for token in cleaned.replace("-", " ").replace("_", " ").split() if token]
    for token in tokens:
        first = token[:1]
        if first == "S":
            return "sandbox"
        if first == "T":
            return "test"
        if first == "P":
            return "produccion"
        if first == "D":
            return "desarrollo"
    return None


def _infer_env(payload: Dict[str, Any]) -> str:
    for key in ("Name", "name"):
        env = _classify_env(payload.get(key))
        if env:
            return env
    for key in ("Cluster", "cluster"):
        env = _classify_env(payload.get(key))
        if env:
            return env
    for key in ("HVHost", "host"):
        env = _classify_env(payload.get(key))
        if env:
            return env
    return "UNKNOWN"


def _as_list(value: Any) -> List[str]:
    if value is None:
        return []
    if isinstance(value, list):
        return [str(item) for item in value if item is not None]
    return [str(value)]


def _as_vlan_list(value: Any) -> List[int]:
    out: List[int] = []
    if isinstance(value, list):
        candidates = value
    else:
        candidates = [value]
    for item in candidates:
        try:
            if item is None:
                continue
            out.append(int(item))
        except (TypeError, ValueError):
            continue
    return out


def normalize_hyperv_vm(raw: Any) -> AIVm:
    payload: Dict[str, Any]
    if hasattr(raw, "model_dump"):
        payload = raw.model_dump()
    elif isinstance(raw, dict):
        payload = dict(raw)
    else:
        payload = {}

    name = payload.get("Name") or payload.get("name") or payload.get("VMName") or ""
    host = payload.get("HVHost") or payload.get("host")
    vm_id = payload.get("VMId") or payload.get("Id") or payload.get("id")
    if not vm_id and name:
        vm_id = f"{name}::{host or ''}"

    env = _infer_env(payload)
    if isinstance(env, str) and env.strip().lower() in {"desconocido", "unknown"}:
        env = "UNKNOWN"
    return AIVm(
        provider="hyperv",
        env=env,
        id=str(vm_id or ""),
        name=str(name),
        power_state=payload.get("State") or payload.get("power_state") or payload.get("state"),
        cpu_count=payload.get("vCPU") or payload.get("CPU") or payload.get("cpu_count"),
        cpu_usage_pct=payload.get("CPU_UsagePct") or payload.get("cpu_usage_pct"),
        memory_size_MiB=payload.get("RAM_MiB") or payload.get("memory_size_MiB"),
        ram_usage_pct=payload.get("RAM_UsagePct") or payload.get("ram_usage_pct"),
        ram_demand_mib=payload.get("RAM_Demand_MiB") or payload.get("ram_demand_mib"),
        guest_os=payload.get("OS") or payload.get("guest_os"),
        host=host,
        cluster=payload.get("Cluster") or payload.get("cluster"),
        networks=_as_list(payload.get("Networks")),
        ip_addresses=_as_list(payload.get("IPv4")),
        vlans=_as_vlan_list(payload.get("VLAN_IDs")),
        raw_refs=None,
    )
