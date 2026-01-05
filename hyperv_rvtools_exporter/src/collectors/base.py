from dataclasses import dataclass, field
from typing import Dict, List, Any, Protocol


@dataclass
class CollectorResult:
    sheet_rows: Dict[str, List[Dict[str, Any]]] = field(default_factory=dict)
    coverage: Dict[str, Any] = field(default_factory=dict)


class Collector(Protocol):
    name: str
    offline: bool

    def run_for_host(self, host: str, client, contract: Dict[str, Any], config, context: Dict[str, Any] = None) -> CollectorResult:
        ...


def is_empty(val: Any) -> bool:
    if val is None:
        return True
    if isinstance(val, str):
        if val.strip() == "":
            return True
        if val.strip().lower() in ("null", "none"):
            return True
    return False


def compute_fill_stats(sheet_rows: Dict[str, List[Dict[str, Any]]], contract: Dict[str, Any]) -> Dict[str, Any]:
    stats = {}
    for sheet, rows in (sheet_rows or {}).items():
        cols = contract.get("sheets", {}).get(sheet, {}).get("columns", [])
        attempted = len(rows)
        col_counts = {c: 0 for c in cols}
        filled_cells = 0
        total_cells = attempted * len(cols)
        for r in rows:
            for c in cols:
                if not is_empty(r.get(c, "")):
                    col_counts[c] += 1
                    filled_cells += 1
        fill_rate = round((filled_cells / total_cells * 100), 2) if total_cells else 0.0
        stats[sheet] = {
            "attempted_rows": attempted,
            "filled_cells": filled_cells,
            "fill_rate_pct": fill_rate,
            "columns_filled": col_counts
        }
    return stats
