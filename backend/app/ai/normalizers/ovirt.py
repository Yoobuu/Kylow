from __future__ import annotations

import re
from typing import Any, Dict, List

from app.ai.schemas import AIVm
from app.vms.vm_service import infer_environment

_VLAN_RE = re.compile(r"VLAN\s*(\d+)", re.IGNORECASE)


def _extract_vlans(networks: List[str]) -> List[int]:
    vlans: List[int] = []
    for entry in networks:
        match = _VLAN_RE.search(str(entry))
        if match:
            try:
                vlans.append(int(match.group(1)))
            except ValueError:
                continue
    return sorted(set(vlans))


def normalize_ovirt_vm(raw: Any) -> AIVm:
    if hasattr(raw, "model_dump"):
        payload: Dict[str, Any] = raw.model_dump()
    elif isinstance(raw, dict):
        payload = dict(raw)
    else:
        payload = {}

    networks = list(payload.get("networks") or [])
    name = payload.get("name") or ""
    env = payload.get("environment") or infer_environment(str(name))
    if isinstance(env, str) and env.strip().lower() in {"desconocido", "unknown"}:
        env = "UNKNOWN"

    return AIVm(
        provider="ovirt",
        env=str(env or "UNKNOWN"),
        id=str(payload.get("id") or ""),
        name=str(name),
        power_state=payload.get("power_state"),
        cpu_count=payload.get("cpu_count"),
        cpu_usage_pct=payload.get("cpu_usage_pct"),
        memory_size_MiB=payload.get("memory_size_MiB"),
        ram_usage_pct=payload.get("ram_usage_pct"),
        ram_demand_mib=payload.get("ram_demand_mib"),
        guest_os=payload.get("guest_os"),
        host=payload.get("host"),
        cluster=payload.get("cluster"),
        networks=networks,
        ip_addresses=list(payload.get("ip_addresses") or []),
        vlans=_extract_vlans(networks),
        raw_refs=None,
    )
