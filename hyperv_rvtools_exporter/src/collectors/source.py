import time
from typing import Dict, Any

from .base import CollectorResult


class VSourceCollector:
    name = "vSource"
    offline = True

    def run_for_host(self, host: str, client, contract: Dict[str, Any], config, context: Dict[str, Any] = None) -> CollectorResult:
        start = time.time()
        sheet_rows = {}
        columns = contract.get("sheets", {}).get("vSource", {}).get("columns", [])

        row = {}
        for col in columns:
            if col == "Name":
                row[col] = "Hyper-V Exporter"
            elif col == "OS type":
                row[col] = "Hyper-V (offline placeholder)"
            elif col == "API type":
                row[col] = "WinRM (not probed)"
            elif col == "API version":
                row[col] = ""
            elif col == "Version":
                row[col] = "1.0"
            elif col == "Patch level":
                row[col] = ""
            elif col == "Build":
                row[col] = ""
            elif col == "Fullname":
                row[col] = "Hyper-V Exporter (offline)"
            elif col == "Product name":
                row[col] = "Hyper-V"
            elif col == "Product version":
                row[col] = ""
            elif col == "Product line":
                row[col] = ""
            elif col == "Vendor":
                row[col] = "Microsoft"
            else:
                row[col] = ""

        sheet_rows["vSource"] = [row]

        duration_ms = round((time.time() - start) * 1000, 2)
        coverage = {
            "status": "success",
            "duration_ms": duration_ms,
            "error_short": "",
            "rows_per_sheet": {"vSource": 1},
            "strategy": "offline"
        }
        return CollectorResult(sheet_rows=sheet_rows, coverage=coverage)
