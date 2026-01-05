import json
import logging
import time
from typing import Dict, Any, List

from .base import CollectorResult, compute_fill_stats

logger = logging.getLogger("hyperv.collectors.vpartition")


class VPartitionCollector:
    name = "vPartition"
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

function Parse-KvpXml($kvpItems) {{
    $rows = @()
    foreach ($item in $kvpItems) {{
        try {{
            $xml = [xml]$item
            $name = $xml.INSTANCE.PROPERTY[0].VALUE
            $val = $xml.INSTANCE.PROPERTY[1].VALUE
            if ($name -and $val -and $val -match "<logicaldisk") {{
                $doc = [xml]$val
                foreach ($ld in $doc.SelectNodes("//logicaldisk")) {{
                    $drive = $ld.driveletter
                    $size = $ld.total
                    $free = $ld.free
                    $rows += [pscustomobject]@{{
                        Drive = $drive
                        Size = $size
                        Free = $free
                    }}
                }}
            }}
        }} catch {{}}
    }}
    return $rows
}}

$rows = @()
foreach ($vm in $vms) {{
    $power = ""
    if ($vm.State) {{ $power = $vm.State.ToString() }}

    $kvpMiss = ""
    $parts = @()
    try {{
        $kvp = Get-CimInstance -Namespace root\virtualization\v2 -ClassName Msvm_KvpExchangeComponent -Filter "SystemName='$($vm.VMId.Guid)'"
        if ($kvp -and $kvp.GuestIntrinsicExchangeItems) {{
            $parts = Parse-KvpXml $kvp.GuestIntrinsicExchangeItems
        }} else {{
            if ($power -ne "Running") {{ $kvpMiss = "vm_off" }} else {{ $kvpMiss = "no_kvp" }}
        }}
    }} catch {{
        if ($power -ne "Running") {{ $kvpMiss = "vm_off" }} else {{ $kvpMiss = "kvp_error" }}
    }}

    foreach ($p in $parts) {{
        if (-not $p) {{ continue }}
        $sizeMiB = ""
        $freeMiB = ""
        $freePct = ""
        $sizeBytes = $null
        $freeBytes = $null
        if ($p.Size) {{
            try {{ $sizeBytes = [double]$p.Size }} catch {{}}
        }}
        if ($p.Free) {{
            try {{ $freeBytes = [double]$p.Free }} catch {{}}
        }}
        if ($sizeBytes -ne $null) {{
            try {{ $sizeMiB = [math]::Round(($sizeBytes/1MB),0) }} catch {{}}
        }}
        if ($freeBytes -ne $null) {{
            try {{ $freeMiB = [math]::Round(($freeBytes/1MB),0) }} catch {{}}
        }}
        if ($sizeBytes -ne $null -and $freeBytes -ne $null -and $sizeBytes -gt 0) {{
            try {{
                $freePct = [math]::Round((($freeBytes / $sizeBytes) * 100),2)
            }} catch {{}}
        }}

        $row = [pscustomobject]@{{
            VM = $vm.Name
            Powerstate = $power
            DiskKey = $p.Drive
            Disk = $p.Drive
            CapacityMiB = $sizeMiB
            FreeMiB = $freeMiB
            FreePct = $freePct
            Host = $node
            Cluster = ""
            VMID = $vm.VMId
            KvpMissReason = $kvpMiss
        }}
        $rows += $row
    }}

    if (-not $parts -and $kvpMiss) {{
        $row = [pscustomobject]@{{
            VM = $vm.Name
            Powerstate = $power
            Host = $node
            Cluster = ""
            VMID = $vm.VMId
            KvpMissReason = $kvpMiss
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
                    "rows_per_sheet": {"vPartition": 0},
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

        columns = contract.get("sheets", {}).get("vPartition", {}).get("columns", [])
        mapped = []
        miss_reasons: Dict[str, int] = {}
        kvp_ok = 0
        for item in rows_raw:
            row = {}
            for col in columns:
                if col == "VM":
                    row[col] = item.get("VM", "")
                elif col == "Powerstate":
                    row[col] = item.get("Powerstate", "")
                elif col == "Disk Key":
                    row[col] = item.get("DiskKey", "")
                elif col == "Disk":
                    row[col] = item.get("Disk", "")
                elif col == "Capacity MiB":
                    row[col] = item.get("CapacityMiB", "")
                elif col == "Consumed MiB":
                    row[col] = ""
                elif col == "Free MiB":
                    row[col] = item.get("FreeMiB", "")
                elif col == "Free %":
                    row[col] = item.get("FreePct", "")
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
            miss = item.get("KvpMissReason")
            if miss:
                miss_reasons[miss] = miss_reasons.get(miss, 0) + 1
            else:
                kvp_ok += 1

        duration_ms = round((time.perf_counter() - start) * 1000, 2)
        rows_per_sheet = {"vPartition": len(mapped)}
        fill_stats = compute_fill_stats({"vPartition": mapped}, contract)

        coverage = {
            "status": status,
            "error_short": error_short,
            "rows_per_sheet": rows_per_sheet,
            "duration_ms": duration_ms,
            "strategy": "winrm",
            "fill": fill_stats.get("vPartition", {}),
            "miss_reasons": miss_reasons,
            "kvp_ok": kvp_ok
        }

        return CollectorResult(sheet_rows={"vPartition": mapped} if mapped else {}, coverage=coverage)
