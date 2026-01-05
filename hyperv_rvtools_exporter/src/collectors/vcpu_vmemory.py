import json
import logging
import time
from typing import Dict, Any, List

from .base import CollectorResult, compute_fill_stats

logger = logging.getLogger("hyperv.collectors.vcpu_vmemory")


class VCpuVMemoryCollector:
    name = "vCPU_vMemory"
    offline = False

    def __init__(self, config):
        self.config = config

    def _build_script(self, try_cluster: bool) -> str:
        flag = "$true" if try_cluster else "$false"
        script = f"""
$ErrorActionPreference = 'SilentlyContinue'
$ProgressPreference = 'SilentlyContinue'
$tryCluster = {flag}

$cluster_name = ""
if ($tryCluster) {{
    try {{
        $c = Get-Cluster
        if ($c) {{ $cluster_name = $c.Name }}
    }} catch {{}}
}}

$rowsCpu = @()
$rowsMem = @()

$node = $env:COMPUTERNAME
$vms = @()
if ($tryCluster) {{
    try {{
        $owned = Get-ClusterGroup | Where-Object {{ $_.GroupType -eq 'VirtualMachine' -and $_.OwnerNode.Name -eq $node }} | Select-Object -ExpandProperty Name
        if ($owned) {{
            $vms = Get-VM -Name $owned
        }} else {{
            try {{ $vms = Get-VM }} catch {{ $vms = @() }}
        }}
    }} catch {{
        try {{ $vms = Get-VM }} catch {{ $vms = @() }}
    }}
}} else {{
    try {{ $vms = Get-VM }} catch {{ $vms = @() }}
}}

foreach ($vm in $vms) {{
    $cpu = $null
    $mem = $null
    try {{ $cpu = Get-VMProcessor -VMName $vm.Name -ErrorAction SilentlyContinue }} catch {{}}
    try {{ $mem = Get-VMMemory -VMName $vm.Name -ErrorAction SilentlyContinue }} catch {{}}

    $power = ""
    if ($vm.State) {{ $power = $vm.State.ToString() }}

    $sockets = ""
    $coresPerSocket = ""
    $cpuCount = if ($cpu -and $cpu.Count) {{ $cpu.Count }} else {{ $vm.ProcessorCount }}
    if ($cpu -and $cpu.PSObject.Properties.Match("SocketCount") -and $cpu.SocketCount) {{
        $sockets = $cpu.SocketCount
        try {{
            if ($cpu.SocketCount -gt 0 -and $cpuCount) {{
                $coresPerSocket = [math]::Round(($cpuCount / $cpu.SocketCount),0)
            }}
        }} catch {{}}
    }} elseif ($cpu -and $cpu.PSObject.Properties.Match("CountPerProcessor")) {{
        try {{
            $coresPerSocket = $cpu.CountPerProcessor
            if ($cpuCount -and $coresPerSocket -and $coresPerSocket -gt 0) {{
                $sockets = [math]::Round(($cpuCount / $coresPerSocket),0)
            }}
        }} catch {{}}
    }} elseif ($cpuCount) {{
        $sockets = 1
        $coresPerSocket = $cpuCount
    }}

    $cpu_row = [pscustomobject]@{{
        VM = $vm.Name
        Powerstate = $power
        CPUs = $cpuCount
        Sockets = $sockets
        CoresPerSocket = $coresPerSocket
        Cluster = $cluster_name
        Host = $env:COMPUTERNAME
        VMID = $vm.VMId
        HotAdd = if ($cpu -and $cpu.HotAddEnabled) {{ "True" }} else {{ "" }}
        HotRemove = if ($cpu -and $cpu.HotRemoveEnabled) {{ "True" }} else {{ "" }}
    }}
    $rowsCpu += $cpu_row

    $startup_mib = ""
    $max_mib = ""
    $min_mib = ""
    $limit_mib = ""
    $hot_add = ""

    $startup_val = $null
    $max_val = $null
    $min_val = $null

    if ($mem) {{
        if ($mem.PSObject.Properties.Match("StartupBytes")) {{ $startup_val = $mem.StartupBytes }}
        elseif ($mem.PSObject.Properties.Match("Startup")) {{ $startup_val = $mem.Startup }}

        if ($mem.PSObject.Properties.Match("MaximumBytes")) {{ $max_val = $mem.MaximumBytes }}
        elseif ($mem.PSObject.Properties.Match("Maximum")) {{ $max_val = $mem.Maximum }}

        if ($mem.PSObject.Properties.Match("MinimumBytes")) {{ $min_val = $mem.MinimumBytes }}
        elseif ($mem.PSObject.Properties.Match("Minimum")) {{ $min_val = $mem.Minimum }}

        if ($mem.DynamicMemoryEnabled) {{ $hot_add = "True" }}
    }}

    if (-not $startup_val -and $vm.MemoryStartup) {{ $startup_val = $vm.MemoryStartup }}
    if (-not $max_val -and $startup_val) {{ $max_val = $startup_val }}
    if (-not $min_val) {{ $min_val = $null }}
    if (-not $limit_mib -and $max_val) {{ $limit_mib = $max_val }}

    if ($startup_val) {{
        try {{ $startup_mib = [math]::Round(($startup_val/1MB),0) }} catch {{}}
    }}
    if ($max_val) {{
        try {{ $max_mib = [math]::Round(($max_val/1MB),0) }} catch {{}}
        $limit_mib = $max_mib
    }}
    if ($min_val) {{
        try {{ $min_mib = [math]::Round(($min_val/1MB),0) }} catch {{}}
    }}

    $mem_row = [pscustomobject]@{{
        VM = $vm.Name
        Powerstate = $power
        SizeMiB = $startup_mib
        Max = $max_mib
        Reservation = $min_mib
        Limit = $limit_mib
        HotAdd = $hot_add
        Cluster = $cluster_name
        Host = $env:COMPUTERNAME
        VMID = $vm.VMId
    }}
    $rowsMem += $mem_row
}}

@{{
    vCPU = $rowsCpu
    vMemory = $rowsMem
}} | ConvertTo-Json -Depth 4 -Compress
"""
        return script.strip()

    def run_for_host(self, host: str, client, contract: Dict[str, Any], config, context: Dict[str, Any] = None) -> CollectorResult:
        start = time.perf_counter()
        hv_map = (context or {}).get("hv_capabilities", {}) if context else {}
        hv = hv_map.get(host, {})
        hv_module = str(hv.get("HyperVModuleAvailable", "")).lower() == "true"
        cluster_module = str(hv.get("ClusterModuleAvailable", "")).lower() == "true"

        if not hv_module:
            duration_ms = round((time.perf_counter() - start) * 1000, 2)
            return CollectorResult(
                sheet_rows={},
                coverage={
                    "status": "not_supported",
                    "error_short": "Hyper-V module not available",
                    "rows_per_sheet": {"vCPU": 0, "vMemory": 0},
                    "duration_ms": duration_ms,
                    "strategy": "winrm"
                }
            )

        script = self._build_script(cluster_module)
        res = client.run_script_with_upload(script)

        rows_cpu: List[Dict[str, Any]] = []
        rows_mem: List[Dict[str, Any]] = []
        status = "success"
        error_short = ""
        stderr_trunc = (res.stderr or "")[:4000]
        exit_code = res.exit_code

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
                data = json.loads(res.stdout) if res.stdout else {}
                rows_cpu = data.get("vCPU", []) or []
                rows_mem = data.get("vMemory", []) or []
                if not rows_cpu and not rows_mem:
                    status = "empty"
                    error_short = "empty_result"
            except json.JSONDecodeError as e:
                status = "parse_error"
                error_short = f"JSON Parse Error: {e}"

        # Map to contract columns
        cpu_columns = contract.get("sheets", {}).get("vCPU", {}).get("columns", [])
        mem_columns = contract.get("sheets", {}).get("vMemory", {}).get("columns", [])

        mapped_cpu = []
        for item in rows_cpu:
            row = {}
            for col in cpu_columns:
                if col == "VM":
                    row[col] = item.get("VM", "")
                elif col == "Powerstate":
                    row[col] = item.get("Powerstate", "")
                elif col == "CPUs":
                    row[col] = item.get("CPUs", "")
                elif col == "Sockets":
                    row[col] = item.get("Sockets", "")
                elif col == "Cores p/s":
                    row[col] = item.get("CoresPerSocket", "")
                elif col == "Hot Add":
                    row[col] = item.get("HotAdd", "")
                elif col == "Hot Remove":
                    row[col] = item.get("HotRemove", "")
                elif col == "Cluster":
                    row[col] = item.get("Cluster", "")
                elif col == "Host":
                    row[col] = item.get("Host", "")
                elif col == "VM ID":
                    row[col] = item.get("VMID", "")
                elif col == "Datacenter":
                    row[col] = ""
                elif col == "Template":
                    row[col] = ""
                elif col == "SRM Placeholder":
                    row[col] = ""
                elif col == "OS according to the configuration file":
                    row[col] = ""
                elif col == "OS according to the VMware Tools":
                    row[col] = ""
                else:
                    row[col] = ""
            mapped_cpu.append(row)

        mapped_mem = []
        for item in rows_mem:
            row = {}
            for col in mem_columns:
                if col == "VM":
                    row[col] = item.get("VM", "")
                elif col == "Powerstate":
                    row[col] = item.get("Powerstate", "")
                elif col == "Size MiB":
                    row[col] = item.get("SizeMiB", "")
                elif col == "Max":
                    row[col] = item.get("Max", "")
                elif col == "Reservation":
                    row[col] = item.get("Reservation", "")
                elif col == "Limit":
                    row[col] = item.get("Limit", "")
                elif col == "Hot Add":
                    row[col] = item.get("HotAdd", "")
                elif col == "Cluster":
                    row[col] = item.get("Cluster", "")
                elif col == "Host":
                    row[col] = item.get("Host", "")
                elif col == "VM ID":
                    row[col] = item.get("VMID", "")
                elif col == "Datacenter":
                    row[col] = ""
                elif col == "Template":
                    row[col] = ""
                elif col == "SRM Placeholder":
                    row[col] = ""
                elif col == "OS according to the configuration file":
                    row[col] = ""
                elif col == "OS according to the VMware Tools":
                    row[col] = ""
                else:
                    row[col] = ""
            mapped_mem.append(row)

        duration_ms = round((time.perf_counter() - start) * 1000, 2)
        rows_per_sheet = {"vCPU": len(mapped_cpu), "vMemory": len(mapped_mem)}
        fill_stats = compute_fill_stats({"vCPU": mapped_cpu, "vMemory": mapped_mem}, contract)

        coverage = {
            "status": status,
            "error_short": error_short,
            "rows_per_sheet": rows_per_sheet,
            "duration_ms": duration_ms,
            "strategy": "winrm",
            "fill": {
                "vCPU": fill_stats.get("vCPU", {}),
                "vMemory": fill_stats.get("vMemory", {})
            },
            "stderr": stderr_trunc,
            "exit_code": exit_code
        }

        sheet_rows = {}
        if mapped_cpu:
            sheet_rows["vCPU"] = mapped_cpu
        if mapped_mem:
            sheet_rows["vMemory"] = mapped_mem

        return CollectorResult(sheet_rows=sheet_rows, coverage=coverage)
