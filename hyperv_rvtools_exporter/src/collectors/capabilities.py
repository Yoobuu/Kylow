import json
import logging
import time
from pathlib import Path
from typing import Dict, Any

from .base import CollectorResult

logger = logging.getLogger("hyperv.collectors.capabilities")

SCRIPT_PATH = Path(__file__).resolve().parent.parent / "scripts" / "collect_capabilities.ps1"


class CapabilitiesCollector:
    name = "hvCapabilities"
    offline = False

    def __init__(self, config):
        self.config = config
        with open(SCRIPT_PATH, "r") as f:
            self.script_content = f.read()

    def run_for_host(self, host: str, client, contract: Dict[str, Any], config, context: Dict[str, Any] = None) -> CollectorResult:
        """Collect capabilities for a single host."""
        start = time.perf_counter()
        rows = []
        status = "success"
        error_short = ""

        res = client.run_script_with_upload(self.script_content)

        if res.exit_code == 0 and res.stdout:
            try:
                data = json.loads(res.stdout)
                if not data:
                    status = "empty"
                    error_short = "empty_result"
                row = {
                    "HVHost": host,
                    "PSVersion": data.get("PSVersion", ""),
                    "OS": data.get("OS", ""),
                    "HyperVModuleAvailable": str(data.get("HyperVModule", False)),
                    "ClusterModuleAvailable": str(data.get("ClusterModule", False)),
                    "CmdletsFound": ", ".join(data.get("Cmdlets", [])),
                    "StrategyChosen": data.get("Strategy", "Unknown"),
                    "CollectedAt": data.get("Timestamp", ""),
                    "Errors": "" if status == "success" else error_short
                }
                rows.append(row)
            except json.JSONDecodeError as e:
                status = "parse_error"
                error_short = f"JSON Parse Error: {e}"
                rows.append({
                    "HVHost": host,
                    "PSVersion": "",
                    "OS": "",
                    "HyperVModuleAvailable": "",
                    "ClusterModuleAvailable": "",
                    "CmdletsFound": "",
                    "StrategyChosen": "",
                    "CollectedAt": "",
                    "Errors": error_short
                })
        else:
            err_msg = res.error or res.stderr or ""
            lowered = err_msg.lower()
            if "credential" in lowered or "access is denied" in lowered or "401" in lowered:
                status = "auth_failed"
            elif "timeout" in lowered or "timed out" in lowered:
                status = "timeout"
            else:
                status = "winrm_error"
            error_short = err_msg[:200]
            rows.append({
                "HVHost": host,
                "PSVersion": "",
                "OS": "",
                "HyperVModuleAvailable": "",
                "ClusterModuleAvailable": "",
                "CmdletsFound": "",
                "StrategyChosen": "",
                "CollectedAt": "",
                "Errors": error_short
            })

        duration_ms = round((time.perf_counter() - start) * 1000, 2)
        coverage: Dict[str, Any] = {
            "status": status,
            "error_short": error_short,
            "rows_per_sheet": {"hvCapabilities": len(rows)},
            "duration_ms": duration_ms,
            "strategy": "winrm"
        }

        return CollectorResult(
            sheet_rows={"hvCapabilities": rows},
            coverage=coverage
        )
