from __future__ import annotations

from typing import Any, Dict

from app.ai.schemas import AIVm


def normalize_vmware_vm(raw: Any) -> AIVm:
    if hasattr(raw, "model_dump"):
        payload: Dict[str, Any] = raw.model_dump()
    elif isinstance(raw, dict):
        payload = dict(raw)
    else:
        payload = {}

    env = payload.get("environment") or "UNKNOWN"
    if isinstance(env, str) and env.strip().lower() in {"desconocido", "unknown"}:
        env = "UNKNOWN"
    return AIVm(
        provider="vmware",
        env=str(env),
        id=str(payload.get("id") or ""),
        name=str(payload.get("name") or ""),
        power_state=payload.get("power_state"),
        cpu_count=payload.get("cpu_count"),
        cpu_usage_pct=payload.get("cpu_usage_pct"),
        memory_size_MiB=payload.get("memory_size_MiB"),
        ram_usage_pct=payload.get("ram_usage_pct"),
        ram_demand_mib=payload.get("ram_demand_mib"),
        guest_os=payload.get("guest_os"),
        host=payload.get("host"),
        cluster=payload.get("cluster"),
        networks=list(payload.get("networks") or []),
        ip_addresses=list(payload.get("ip_addresses") or []),
        vlans=[],
        raw_refs=None,
    )
