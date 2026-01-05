import json
import logging
import time
from pathlib import Path
from typing import Dict, Any

from .base import CollectorResult

logger = logging.getLogger("hyperv.collectors.host_facts")

SCRIPT_PATH = Path(__file__).resolve().parent.parent / "scripts" / "collect_host_facts.ps1"
FALLBACK_SCRIPT = r"""
$ErrorActionPreference = 'SilentlyContinue'
$cs = Get-CimInstance Win32_ComputerSystem
$os = Get-CimInstance Win32_OperatingSystem
$ps = $PSVersionTable
$out = [pscustomobject]@{
  HostIdentity = [pscustomobject]@{
    ComputerName = $env:COMPUTERNAME
    Domain = if ($cs) { $cs.Domain } else { "" }
    OSName = if ($os) { $os.Caption } else { "" }
    OSVersion = if ($os) { $os.Version } else { "" }
    BuildNumber = if ($os) { $os.BuildNumber } else { "" }
    LastBootUpTime = if ($os -and $os.LastBootUpTime) { $os.LastBootUpTime } else { "" }
  }
  PowerShell = [pscustomobject]@{
    PSVersion = if ($ps) { $ps.PSVersion.ToString() } else { "" }
  }
}
$out | ConvertTo-Json -Depth 4 -Compress
""".strip()


def _flatten_facts(host: str, facts: Dict[str, Any]) -> Dict[str, Any]:
    hi = facts.get("HostIdentity", {}) or {}
    ps = facts.get("PowerShell", {}) or {}
    rf = facts.get("RolesFeatures", {}) or {}
    hv = facts.get("HyperV", {}) or {}
    cl = facts.get("Cluster", {}) or {}
    net = facts.get("Networking", {}) or {}
    st = facts.get("Storage", {}) or {}

    # Flatten lists
    cmdlets = hv.get("CmdletsFound") or []
    features = rf.get("InstalledFeatures") or []
    nodes = cl.get("Nodes") or []
    adapters = net.get("NetAdapters") or []
    switches = net.get("VMSwitches") or []
    vols = st.get("Volumes") or []

    adapter_strs = []
    for a in adapters:
        if isinstance(a, dict):
            adapter_strs.append(f"{a.get('Name','')}({a.get('Status','')},{a.get('LinkSpeed','')})")
        else:
            adapter_strs.append(str(a))
    switch_strs = []
    for s in switches:
        if isinstance(s, dict):
            switch_strs.append(f"{s.get('Name','')}({s.get('SwitchType','')})")
        else:
            switch_strs.append(str(s))
    volume_strs = []
    for v in vols:
        if isinstance(v, dict):
            size = v.get("Size")
            free = v.get("SizeRemaining")
            volume_strs.append(f"{v.get('DriveLetter','')}: {v.get('FileSystem','')} size={size} free={free}")
        else:
            volume_strs.append(str(v))

    vmhost = hv.get("VMHost") or {}
    return {
        "HVHost": host,
        "ComputerName": hi.get("ComputerName", ""),
        "FQDN": hi.get("FQDN", ""),
        "Domain": hi.get("Domain", ""),
        "OSName": hi.get("OSName", ""),
        "OSVersion": hi.get("OSVersion", ""),
        "BuildNumber": hi.get("BuildNumber", ""),
        "UBR": hi.get("UBR", ""),
        "InstallDate": hi.get("InstallDate", ""),
        "LastBootUpTime": hi.get("LastBootUpTime", ""),
        "TimeZone": hi.get("TimeZone", ""),
        "Culture": hi.get("Culture", ""),
        "UILanguage": hi.get("UILanguage", ""),
        "PSVersion": ps.get("PSVersion", ""),
        "PSEdition": ps.get("PSEdition", ""),
        "CLRVersion": ps.get("CLRVersion", ""),
        "ExecutionPolicy": ps.get("ExecutionPolicy", ""),
        "RemotingEnabled": ps.get("RemotingEnabled", ""),
        "HyperVRoleInstalled": rf.get("HyperVRoleInstalled", ""),
        "FailoverClusteringInstalled": rf.get("FailoverClusteringInstalled", ""),
        "RSATHyperVToolsInstalled": rf.get("RSATHyperVToolsInstalled", ""),
        "HyperVModuleAvailable": hv.get("HyperVModuleAvailable", ""),
        "HyperVModuleVersion": hv.get("HyperVModuleVersion", ""),
        "CmdletsFound": ";".join(str(x) for x in cmdlets),
        "VMHostVersion": vmhost.get("Version", ""),
        "VMHostBuild": vmhost.get("Build", ""),
        "DefaultVHDPath": hv.get("DefaultVHDPath", ""),
        "DefaultVMPath": hv.get("DefaultVMPath", ""),
        "ClusterModuleAvailable": cl.get("ClusterModuleAvailable", ""),
        "IsClusterNode": cl.get("IsClusterNode", ""),
        "ClusterName": cl.get("ClusterName", ""),
        "ClusterFunctionalLevel": cl.get("ClusterFunctionalLevel", ""),
        "ClusterNodes": ";".join(str(x) for x in nodes),
        "CSVEnabled": cl.get("CSVEnabled", ""),
        "CSVCount": cl.get("CSVCount", ""),
        "NetAdapters": ";".join(adapter_strs),
        "VMSwitches": ";".join(switch_strs),
        "NicTeamPresent": net.get("NicTeamPresent", ""),
        "Volumes": ";".join(volume_strs),
        "VHDGetAvailable": st.get("VHDGetAvailable", "")
    }


class HostFactsCollector:
    name = "host_facts"
    offline = False

    def __init__(self, config):
        self.config = config
        with open(SCRIPT_PATH, "r") as f:
            self.script_content = f.read()

    def run_for_host(self, host: str, client, contract: Dict[str, Any], config, context: Dict[str, Any] = None) -> CollectorResult:
        start = time.perf_counter()
        res = client.run_script_with_upload(self.script_content)

        status = "success"
        error_short = ""
        facts_obj: Dict[str, Any] = {}
        flat_row: Dict[str, Any] = {}
        stderr_snippet = (res.stderr or "")[:200]

        # Try parsing stdout first if present
        if res.stdout:
            try:
                facts_obj = json.loads(res.stdout)
                if facts_obj:
                    flat_row = _flatten_facts(host, facts_obj)
                    if isinstance(facts_obj, dict) and facts_obj.get("Error"):
                        status = "partial"
                        error_short = str(facts_obj.get("Error"))[:200]
                else:
                    status = "empty"
                    error_short = "empty_result"
            except json.JSONDecodeError as e:
                status = "parse_error"
                error_short = f"JSON Parse Error: {e}"
        else:
            status = "empty"
            error_short = "empty_result"

        # Override status if execution errors occurred and we couldn't parse facts
        if (res.exit_code != 0 or res.error) and not facts_obj:
            err_msg = res.error or res.stderr or ""
            lowered = err_msg.lower()
            if "credential" in lowered or "access is denied" in lowered or "401" in lowered:
                status = "auth_failed"
            elif "timeout" in lowered or "timed out" in lowered:
                status = "timeout"
            else:
                status = "winrm_error"
            error_short = err_msg[:200] or error_short

        # Fallback minimal facts if we still have no data
        if not facts_obj and status in ("empty", "parse_error", "winrm_error", "timeout"):
            fb_res = client.run_command(f"powershell -NoProfile -ExecutionPolicy Bypass -Command \"{FALLBACK_SCRIPT}\"")
            if fb_res.stdout:
                try:
                    facts_obj = json.loads(fb_res.stdout)
                    flat_row = _flatten_facts(host, facts_obj)
                    status = "partial" if status != "success" else status
                    error_short = error_short or "fallback_used"
                except Exception as e:
                    error_short = error_short or f"fallback_failed: {e}"

        duration_ms = round((time.perf_counter() - start) * 1000, 2)
        coverage = {
            "status": status,
            "error_short": error_short,
            "rows_per_sheet": {"host_facts": 1 if flat_row else 0},
            "duration_ms": duration_ms,
            "strategy": "winrm",
            "facts": facts_obj,
            "stderr": stderr_snippet
        }

        sheet_rows = {"host_facts": [flat_row]} if flat_row else {}
        return CollectorResult(sheet_rows=sheet_rows, coverage=coverage)
