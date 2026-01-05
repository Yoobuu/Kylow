import json
import logging
import time
from typing import Dict, Any, List

from .base import CollectorResult, compute_fill_stats

logger = logging.getLogger("hyperv.collectors.vnetwork")


class VNetworkCollector:
    name = "vNetwork"
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

function Format-Mac($mac) {{
    if (-not $mac) {{ return "" }}
    $clean = $mac -replace "[:\-]", ""
    if ($clean.Length -ne 12) {{ return $mac }}
    return ($clean.ToCharArray() | ForEach-Object -Begin {{ $i = 0; $sb = @() }} -Process {{
        if ($i % 2 -eq 0 -and $i -gt 0) {{ $sb += ":" }}
        $sb += $_; $i++
    }} -End {{ -join $sb }})
}}

$rows = @()
foreach ($vm in $vms) {{
    $power = ""
    if ($vm.State) {{ $power = $vm.State.ToString() }}

    $adapters = @()
    try {{ $adapters = Get-VMNetworkAdapter -VMName $vm.Name -ErrorAction SilentlyContinue }} catch {{ $adapters = @() }}

    foreach ($nic in $adapters) {{
        $ipv4 = ""
        $ipv6 = ""
        $miss = ""
        if ($nic.IPAddresses) {{
            $ipv4 = ($nic.IPAddresses | Where-Object {{ $_ -match '^\d+\.\d+\.\d+\.\d+$' }})
            $ipv6 = ($nic.IPAddresses | Where-Object {{ $_ -match ':' }})
            if ((-not $ipv4) -and (-not $ipv6)) {{ $miss = "empty_ipaddresses" }}
        }} else {{
            if ($vm.State -and $vm.State.ToString() -ne "Running") {{
                $miss = "vm_off"
            }} else {{
                $miss = "empty_ipaddresses"
            }}
        }}
        $vlanId = ""
        try {{
            $vlanInfo = Get-VMNetworkAdapterVlan -VMNetworkAdapter $nic -ErrorAction SilentlyContinue
            if ($vlanInfo -and $vlanInfo.AccessVlanId) {{ $vlanId = $vlanInfo.AccessVlanId }}
        }} catch {{}}

        $row = [pscustomobject]@{{
            VM = $vm.Name
            Powerstate = $power
            NICLabel = if ($nic.Name) {{ $nic.Name }} else {{ $nic.DeviceId }}
            Switch = $nic.SwitchName
            Network = $nic.SwitchName
            Connected = if ($nic.Connected -ne $null) {{ $nic.Connected.ToString() }} else {{ "" }}
            MacAddress = Format-Mac $nic.MacAddress
            Type = if ($nic.AdapterType) {{ $nic.AdapterType.ToString() }} else {{ "" }}
            IPv4 = if ($ipv4) {{ ($ipv4 -join ",") }} else {{ "" }}
            IPv6 = if ($ipv6) {{ ($ipv6 -join ",") }} else {{ "" }}
            Cluster = ""  # filled via mapping outside if needed
            Host = $node
            VMID = $vm.VMId
            VlanId = $vlanId
            MissReasonIP = $miss
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
                    "rows_per_sheet": {"vNetwork": 0},
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

        columns = contract.get("sheets", {}).get("vNetwork", {}).get("columns", [])
        mapped = []
        miss_reasons: Dict[str, int] = {}
        for item in rows_raw:
            row = {}
            for col in columns:
                if col == "VM":
                    row[col] = item.get("VM", "")
                elif col == "Powerstate":
                    row[col] = item.get("Powerstate", "")
                elif col == "NIC label":
                    row[col] = item.get("NICLabel", "")
                elif col == "Switch":
                    row[col] = item.get("Switch", "")
                elif col == "Network":
                    row[col] = item.get("Network", "")
                elif col == "Connected":
                    row[col] = item.get("Connected", "")
                elif col == "Mac Address":
                    row[col] = item.get("MacAddress", "")
                elif col == "Type":
                    row[col] = item.get("Type", "")
                elif col == "IPv4 Address":
                    row[col] = item.get("IPv4", "")
                elif col == "IPv6 Address":
                    row[col] = item.get("IPv6", "")
                elif col == "VLAN":
                    row[col] = item.get("VlanId", "")
                elif col == "Datacenter":
                    row[col] = ""
                elif col == "Cluster":
                    row[col] = item.get("Cluster", "")
                elif col == "Host":
                    row[col] = item.get("Host", "")
                elif col == "VM ID":
                    row[col] = item.get("VMID", "")
                elif col == "Template":
                    row[col] = ""
                elif col == "SRM Placeholder":
                    row[col] = ""
                elif col == "Adapter":
                    row[col] = ""
                elif col == "Network":
                    row[col] = item.get("Network", "")
                elif col == "Starts Connected":
                    row[col] = ""
                elif col == "Direct Path IO":
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
                else:
                    row[col] = ""
            mapped.append(row)
            miss = item.get("MissReasonIP")
            if miss:
                miss_reasons[miss] = miss_reasons.get(miss, 0) + 1

        duration_ms = round((time.perf_counter() - start) * 1000, 2)
        rows_per_sheet = {"vNetwork": len(mapped)}
        fill_stats = compute_fill_stats({"vNetwork": mapped}, contract)

        coverage = {
            "status": status,
            "error_short": error_short,
            "rows_per_sheet": rows_per_sheet,
            "duration_ms": duration_ms,
            "strategy": "winrm",
            "fill": fill_stats.get("vNetwork", {}),
            "miss_reasons": miss_reasons
        }

        return CollectorResult(sheet_rows={"vNetwork": mapped} if mapped else {}, coverage=coverage)
