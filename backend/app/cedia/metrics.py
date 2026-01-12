from __future__ import annotations

import re
from datetime import datetime
from typing import Any, Dict, List, Optional


_DISK_USED_RE = re.compile(r"^disk\\.used\\.latest\\.(\\d+)$")
_DISK_PROV_RE = re.compile(r"^disk\\.provisioned\\.latest\\.(\\d+)$")


def _as_float(value: Any) -> Optional[float]:
    if value is None:
        return None
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str):
        try:
            return float(value)
        except ValueError:
            return None
    if isinstance(value, dict) and "value" in value:
        return _as_float(value.get("value"))
    return None


def _extract_metric_items(payload: Any) -> List[dict]:
    if not isinstance(payload, dict):
        return []
    items = payload.get("metric")
    if isinstance(items, list):
        return [item for item in items if isinstance(item, dict)]
    series = payload.get("metricSeries")
    if isinstance(series, dict):
        entry = series.get("entry") or series.get("entries")
        if isinstance(entry, list):
            return [item for item in entry if isinstance(item, dict)]
    return []


def normalize_vcloud_metrics(payload: Any, *, now: Optional[datetime] = None) -> Dict[str, Any]:
    """
    Normalize vCloud metrics payload into a compact snapshot-friendly schema.
    Returns a dict with CPU/MEM percentages and disk usage/provisioned KB totals.
    """
    if not isinstance(payload, dict):
        return {}
    metrics_updated_at = now or datetime.utcnow()
    items = _extract_metric_items(payload)

    cpu_pct = None
    mem_pct = None
    cpu_mhz = None
    used_by_index: Dict[int, float] = {}
    prov_by_index: Dict[int, float] = {}
    used_total = 0.0
    prov_total = 0.0

    for item in items:
        name = item.get("name") or item.get("Name")
        if not name:
            continue
        value = _as_float(item.get("value") or item.get("Value"))
        if name == "cpu.usage.average":
            cpu_pct = value
        elif name == "mem.usage.average":
            mem_pct = value
        elif name == "cpu.usagemhz.average":
            cpu_mhz = value
        else:
            match_used = _DISK_USED_RE.match(name)
            if match_used and value is not None:
                idx = int(match_used.group(1))
                used_by_index[idx] = used_by_index.get(idx, 0.0) + value
                used_total += value
                continue
            match_prov = _DISK_PROV_RE.match(name)
            if match_prov and value is not None:
                idx = int(match_prov.group(1))
                prov_by_index[idx] = prov_by_index.get(idx, 0.0) + value
                prov_total += value

    disk_indexes = sorted(set(used_by_index) | set(prov_by_index))
    disks = []
    for idx in disk_indexes:
        disk = {"index": idx}
        if idx in used_by_index:
            disk["used_kb"] = used_by_index[idx]
        if idx in prov_by_index:
            disk["provisioned_kb"] = prov_by_index[idx]
        disks.append(disk)

    return {
        "cpu_pct": cpu_pct,
        "mem_pct": mem_pct,
        "cpu_mhz": cpu_mhz,
        "disks": disks,
        "disk_used_kb_total": used_total if used_total else None,
        "disk_provisioned_kb_total": prov_total if prov_total else None,
        "metrics_updated_at": metrics_updated_at,
    }
