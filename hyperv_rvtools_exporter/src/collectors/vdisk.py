import json
import logging
import time
import os
from typing import Dict, Any, List

from .base import CollectorResult, compute_fill_stats

logger = logging.getLogger("hyperv.collectors.vdisk")


class VDiskCollector:
    name = "vDisk"
    offline = False

    def __init__(self, config):
        self.config = config

    def _build_script(self, try_cluster: bool, vm_names: List[str] = None) -> str:
        flag_cluster = "$true" if try_cluster else "$false"
        names_filter = ""
        if vm_names:
            names_str = ",".join([f"'{n}'" for n in vm_names])
            names_filter = f"$targetVMs = @({names_str})"
        else:
            names_filter = "$targetVMs = $null"

        return rf"""
$ErrorActionPreference = 'SilentlyContinue'
$ProgressPreference = 'SilentlyContinue'
$tryCluster = {flag_cluster}
{names_filter}
$node = $env:COMPUTERNAME

$vms = @()
if ($targetVMs) {{
    try {{ $vms = Get-VM -Name $targetVMs }} catch {{ $vms = @() }}
}} elseif ($tryCluster) {{
    try {{
        $owned = Get-ClusterGroup | Where-Object {{ $_.GroupType -eq 'VirtualMachine' -and $_.OwnerNode.Name -eq $node }} | Select-Object -ExpandProperty Name
        if ($owned) {{ $vms = Get-VM -Name $owned }} else {{ $vms = @() }}
    }} catch {{
        try {{ $vms = Get-VM }} catch {{ $vms = @() }}
    }}
}} else {{
    try {{ $vms = Get-VM }} catch {{ $vms = @() }}
}}

$cluster_name = ""
if ($tryCluster) {{
    try {{
        $cluster = Get-Cluster
        if ($cluster) {{ $cluster_name = $cluster.Name }}
    }} catch {{}}
}}

$rows = @()
foreach ($vm in $vms) {{
    $power = ""
    if ($vm.State) {{ $power = $vm.State.ToString() }}

    $disks = @()
    try {{ $disks = Get-VMHardDiskDrive -VMName $vm.Name -ErrorAction SilentlyContinue }} catch {{ $disks = @() }}
    foreach ($d in $disks) {{
        $vhdInfo = $null
        $sizeMiB = ""
        $thin = ""
        $fixed = ""
        try {{
            $vhdInfo = Get-VHD -Path $d.Path -ErrorAction SilentlyContinue
            if ($vhdInfo -and $vhdInfo.Size) {{
                $sizeMiB = [math]::Round(($vhdInfo.Size/1MB),0)
            }}
            if ($vhdInfo -and $vhdInfo.VhdType) {{
                if ($vhdInfo.VhdType -eq "Dynamic") {{
                    $thin = "True"; $fixed = "False"
                }} elseif ($vhdInfo.VhdType -eq "Fixed") {{
                    $thin = "False"; $fixed = "True"
                }}
            }}
        }} catch {{}}

        $controller = ""
        $scsiUnit = ""
        $unit = ""
        if ($d.ControllerType -and $d.ControllerNumber -ne $null) {{
            $controller = "$($d.ControllerType) $($d.ControllerNumber)"
        }}
        if ($d.ControllerLocation -ne $null) {{
            $unit = $d.ControllerLocation
            $scsiUnit = $d.ControllerLocation
        }}

        $row = [pscustomobject]@{{
            VM = $vm.Name
            Powerstate = $power
            Host = $node
            Cluster = $cluster_name
            VMID = $vm.VMId
            DiskPath = $d.Path
            Disk = if ($d.Path) {{ [IO.Path]::GetFileName($d.Path) }} else {{ "" }}
            Controller = $controller
            Unit = $unit
            SCSIUnit = $scsiUnit
            CapacityMiB = $sizeMiB
            Thin = $thin
            Fixed = $fixed
        }}
        $rows += $row
    }}
}}

$rows | ConvertTo-Json -Depth 5 -Compress
""".strip()

    def run_for_host(self, host: str, client, contract: Dict[str, Any], config, context: Dict[str, Any] = None) -> CollectorResult:
        start = time.perf_counter()
        hv_map = (context or {}).get("hv_capabilities", {}) if context else {}
        hv = hv_map.get(host, {})
        hv_module = str(hv.get("HyperVModuleAvailable", "")).lower() == "true"
        cluster_module = str(hv.get("ClusterModuleAvailable", "")).lower() == "true"

        target_vm_names = None
        vinfo_map = (context or {}).get("vinfo_by_host", {}) if context else {}
        host_vm_names = vinfo_map.get(host)
        if host_vm_names:
            target_vm_names = host_vm_names

        if not hv_module:
            duration_ms = round((time.perf_counter() - start) * 1000, 2)
            return CollectorResult(
                sheet_rows={},
                coverage={
                    "status": "not_supported",
                    "error_short": "Hyper-V module not available",
                    "rows_per_sheet": {"vDisk": 0},
                    "duration_ms": duration_ms,
                    "strategy": "winrm"
                }
            )

        script = self._build_script(cluster_module, target_vm_names)
        res = client.run_script_with_upload(script)

        rows_raw: List[Dict[str, Any]] = []
        status = "success"
        error_short = ""

        if res.exit_code != 0 or res.error:
            err_msg = res.error or res.stderr or ""
            lowered = err_msg.lower()
            if "credential" in lowered or "access is denied" in lowered or "401" in lowered:
                status = "auth_failed"
            elif "timeout" in lowered or "timed out" in lowered:
                status = "timeout"
            else:
                status = "winrm_error"
            error_short = err_msg[:200]
        else:
            try:
                data = json.loads(res.stdout) if res.stdout else []
                if not data:
                    status = "empty"
                    error_short = "empty_result"
                else:
                    rows_raw = data
            except json.JSONDecodeError as e:
                status = "parse_error"
                error_short = f"JSON Parse Error: {e}"

        columns = contract.get("sheets", {}).get("vDisk", {}).get("columns", [])
        mapped = []
        for item in rows_raw:
            row = {}
            for col in columns:
                if col == "VM":
                    row[col] = item.get("VM", "")
                elif col == "Powerstate":
                    row[col] = item.get("Powerstate", "")
                elif col == "Disk Path":
                    row[col] = item.get("DiskPath", "")
                elif col == "Capacity MiB":
                    row[col] = item.get("CapacityMiB", "")
                elif col == "Thin":
                    row[col] = item.get("Thin", "")
                elif col == "Disk":
                    row[col] = item.get("Disk", "")
                elif col == "Controller":
                    row[col] = item.get("Controller", "")
                elif col == "Unit #":
                    row[col] = item.get("Unit", "")
                elif col == "SCSI Unit #":
                    row[col] = item.get("SCSIUnit", "")
                elif col == "Host":
                    row[col] = item.get("Host", "")
                elif col == "Cluster":
                    row[col] = item.get("Cluster", "")
                elif col == "VM ID":
                    row[col] = item.get("VMID", "")
                elif col == "Datacenter":
                    row[col] = ""
                elif col == "Template":
                    row[col] = ""
                elif col == "SRM Placeholder":
                    row[col] = ""
                elif col == "Disk Mode":
                    row[col] = ""
                elif col == "Sharing mode":
                    row[col] = ""
                elif col == "Raw":
                    row[col] = ""
                elif col == "Fixed":
                    row[col] = item.get("Fixed", "")
                elif col == "Eagerly Scrub":
                    row[col] = ""
                elif col == "Split":
                    row[col] = ""
                elif col == "Write Through":
                    row[col] = ""
                elif col == "Label":
                    row[col] = ""
                elif col == "Internal Sort Column":
                    row[col] = ""
                elif col == "Annotation":
                    row[col] = ""
                elif col == "Backup status":
                    row[col] = ""
                elif col == "ClusterInvariantVMMId":
                    row[col] = ""
                elif col == "Last backup":
                    row[col] = ""
                elif col == "Folder":
                    row[col] = ""
                elif col == "OS according to the configuration file":
                    row[col] = ""
                elif col == "OS according to the VMware Tools":
                    row[col] = ""
                elif col == "VM UUID":
                    row[col] = ""
                elif col == "VI SDK Server":
                    row[col] = ""
                elif col == "VI SDK UUID":
                    row[col] = ""
                else:
                    row[col] = ""
            mapped.append(row)

        duration_ms = round((time.perf_counter() - start) * 1000, 2)
        rows_per_sheet = {"vDisk": len(mapped)}
        fill_stats = compute_fill_stats({"vDisk": mapped}, contract)

        coverage = {
            "status": status,
            "error_short": error_short,
            "rows_per_sheet": rows_per_sheet,
            "duration_ms": duration_ms,
            "strategy": "winrm",
            "fill": fill_stats.get("vDisk", {})
        }

        return CollectorResult(sheet_rows={"vDisk": mapped} if mapped else {}, coverage=coverage)
