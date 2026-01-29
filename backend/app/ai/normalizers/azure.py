from __future__ import annotations

from typing import Any, Dict

from app.ai.schemas import AIVm


def normalize_azure_vm(raw: Any) -> AIVm:
    if raw is None:
        payload = {}
    elif hasattr(raw, "model_dump"):
        payload: Dict[str, Any] = raw.model_dump()
    elif isinstance(raw, dict):
        payload = dict(raw)
    else:
        payload = {}

    tags = payload.get("tags")
    if not isinstance(tags, dict):
        tags = {}
    env = payload.get("environment") or tags.get("env")
    if not env:
        env = "UNKNOWN"
    if isinstance(env, str) and env.strip().lower() in {"desconocido", "unknown"}:
        env = "UNKNOWN"

    return AIVm(
        provider="azure",
        env=str(env),
        id=str(payload.get("id") or ""),
        name=str(payload.get("name") or ""),
        power_state=payload.get("power_state") or payload.get("powerState"),
        cpu_count=payload.get("cpu_count") or payload.get("cpuCount"),
        cpu_usage_pct=payload.get("cpu_usage_pct") or payload.get("cpuUsagePct"),
        memory_size_MiB=payload.get("memory_size_MiB")
        or payload.get("memory_size_mib")
        or payload.get("memorySizeMiB"),
        ram_usage_pct=payload.get("ram_usage_pct") or payload.get("ramUsagePct"),
        ram_demand_mib=payload.get("ram_demand_mib") or payload.get("ramDemandMiB"),
        guest_os=payload.get("guest_os") or payload.get("os_type") or payload.get("osType"),
        host=payload.get("resource_group") or payload.get("host"),
        cluster=payload.get("location") or payload.get("cluster"),
        networks=list(payload.get("networks") or []),
        ip_addresses=list(payload.get("ip_addresses") or []),
        vlans=[],
        raw_refs=None,
    )
