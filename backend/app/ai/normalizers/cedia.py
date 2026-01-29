from __future__ import annotations

from typing import Any, Dict, List, Optional

from app.ai.schemas import AIVm


def _extract_id(payload: Dict[str, Any]) -> str:
    value = payload.get("id") or payload.get("_normalizedId")
    if value:
        return str(value)
    href = payload.get("href")
    if isinstance(href, str) and href:
        return href.rstrip("/").split("/")[-1]
    return ""


def _extract_ip_list(value: Any) -> List[str]:
    if not value:
        return []
    if isinstance(value, list):
        return [str(item) for item in value if item is not None]
    if isinstance(value, str):
        parts = [p.strip() for p in value.replace(";", ",").split(",") if p.strip()]
        return parts
    return [str(value)]


def _extract_networks(detail: Any) -> List[str]:
    if not detail:
        return []
    networks: List[str] = []
    if isinstance(detail, dict):
        section = detail.get("networkConnectionSection") or detail.get("NetworkConnectionSection")
        if isinstance(section, dict):
            conns = section.get("networkConnection") or section.get("NetworkConnection")
            if isinstance(conns, list):
                for conn in conns:
                    if isinstance(conn, dict):
                        name = conn.get("network") or conn.get("networkName")
                        if name:
                            networks.append(str(name))
    return networks


def _as_int(value: Any) -> Optional[int]:
    if value is None:
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _as_float(value: Any) -> Optional[float]:
    if value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def normalize_cedia_vm(raw: Any) -> AIVm:
    if isinstance(raw, dict):
        payload: Dict[str, Any] = dict(raw)
    else:
        payload = {}

    name = payload.get("name") or payload.get("Name") or ""
    env = payload.get("orgName") or payload.get("environment")
    if not env:
        env = "UNKNOWN"
    if isinstance(env, str) and env.strip().lower() in {"desconocido", "unknown"}:
        env = "UNKNOWN"

    missing_fields: List[str] = []
    for field in ("id", "name", "status", "numberOfCpus", "memoryMB"):
        if payload.get(field) in (None, "", []):
            missing_fields.append(field)

    metrics = {
        "cpu_pct": _as_float(payload.get("cpu_pct")),
        "mem_pct": _as_float(payload.get("mem_pct")),
        "cpu_mhz": _as_float(payload.get("cpu_mhz")),
        "disk_used_kb_total": _as_float(payload.get("disk_used_kb_total")),
        "disk_provisioned_kb_total": _as_float(payload.get("disk_provisioned_kb_total")),
        "disks": payload.get("disks"),
        "metrics_updated_at": payload.get("metrics_updated_at"),
    }
    metrics = {k: v for k, v in metrics.items() if v is not None}
    raw_refs: Dict[str, Any] = {}
    if metrics:
        raw_refs["metrics"] = metrics
    if missing_fields:
        raw_refs["missing_fields"] = missing_fields

    return AIVm(
        provider="cedia",
        env=str(env),
        id=_extract_id(payload),
        name=str(name),
        power_state=payload.get("status") or payload.get("power_state"),
        cpu_count=_as_int(payload.get("numberOfCpus")),
        cpu_usage_pct=_as_float(payload.get("cpu_pct")) or _as_float(payload.get("cpuPct")),
        memory_size_MiB=_as_int(payload.get("memoryMB")),
        ram_usage_pct=_as_float(payload.get("mem_pct")) or _as_float(payload.get("memPct")),
        guest_os=payload.get("detectedGuestOs") or payload.get("guestOs") or payload.get("guest_os"),
        host=payload.get("vdcName") or payload.get("host"),
        cluster=payload.get("containerName") or payload.get("vdcName") or payload.get("cluster"),
        networks=_extract_networks(payload),
        ip_addresses=_extract_ip_list(payload.get("ipAddress")),
        vlans=[],
        raw_refs=raw_refs or None,
    )
