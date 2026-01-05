import time
from typing import Dict, Any

from .base import CollectorResult


class VMetaDataCollector:
    name = "vMetaData"
    offline = True

    def run_for_host(self, host: str, client, contract: Dict[str, Any], config, context: Dict[str, Any] = None) -> CollectorResult:
        start = time.time()
        sheet_rows = {}
        columns = contract.get("sheets", {}).get("vMetaData", {}).get("columns", [])

        row = {}
        for col in columns:
            if col == "RVTools major version":
                row[col] = "HyperVExporter"
            elif col == "RVTools version":
                row[col] = "1.0"
            elif col == "xlsx creation datetime":
                row[col] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
            elif col == "Server":
                row[col] = "Hyper-V Exporter"
            else:
                row[col] = ""

        sheet_rows["vMetaData"] = [row]

        duration_ms = round((time.time() - start) * 1000, 2)
        coverage = {
            "status": "success",
            "duration_ms": duration_ms,
            "error_short": "",
            "rows_per_sheet": {"vMetaData": 1},
            "strategy": "offline"
        }
        return CollectorResult(sheet_rows=sheet_rows, coverage=coverage)
