import json
import logging
import time
from typing import Dict, Any, List

from .base import CollectorResult, compute_fill_stats

logger = logging.getLogger("hyperv.collectors.vinfo")


class VInfoCollector:
    name = "vInfo"
    offline = False

    def __init__(self, config):
        self.config = config

    def _build_script(self, try_cluster: bool) -> str:
        flag = '$true' if try_cluster else '$false'
        script = '''
$ErrorActionPreference = 'SilentlyContinue'
$ProgressPreference = 'SilentlyContinue'
$VerbosePreference = 'SilentlyContinue'
$tryCluster = {TRY_CLUSTER}

function Get-IPv4Primary($vmName) {
    try {
        $adapters = Get-VMNetworkAdapter -VMName $vmName -ErrorAction SilentlyContinue
        foreach ($nic in $adapters) {
            if ($nic.IPAddresses) {
                $ip = ($nic.IPAddresses | Where-Object { $_ -match '^\d+\.\d+\.\d+\.\d+$' } | Select-Object -First 1)
                if ($ip) { return $ip }
            }
        }
    } catch {
        return ""
    }
    return ""
}

$node = $env:COMPUTERNAME
$vms = @()
if ($tryCluster) {
    try {
        $owned = Get-ClusterGroup | Where-Object { $_.GroupType -eq 'VirtualMachine' -and $_.OwnerNode.Name -eq $node } | Select-Object -ExpandProperty Name
        if ($owned) {
            $vms = Get-VM -Name $owned
        } else {
            $vms = @()
        }
    } catch {
        try { $vms = Get-VM } catch { $vms = @() }
    }
} else {
    try { $vms = Get-VM } catch { $vms = @() }
}

$cluster_name = ""
if ($tryCluster) {
    try {
        $cluster = Get-Cluster
        if ($cluster) { $cluster_name = $cluster.Name }
    } catch {}
}

$vmHealth = @{}
foreach ($vmh in $vms) {
    try {
        $vmGuid = $vmh.VMId.Guid
        $csWmi = Get-CimInstance -Namespace root\\virtualization\\v2 -ClassName Msvm_ComputerSystem -Filter "Name='$vmGuid'"
        $health = ""
        if ($csWmi) {
            $hs = $csWmi.HealthState
            if ($hs -eq 5) { $health = "OK" }
            elseif ($hs -eq 20) { $health = "Warning" }
            elseif ($hs -eq 25 -or $hs -eq 30) { $health = "Critical" }
            else { $health = $csWmi.HealthState }
        }
        $vmHealth[$vmh.VMId] = $health
    } catch {}
}

$rows = @()
foreach ($vm in $vms) {
    $powerstate = ""
    if ($vm.State) {
        switch ($vm.State.ToString()) {
            "Running" { $powerstate = "On" }
            "Off" { $powerstate = "Off" }
            "Paused" { $powerstate = "Paused" }
            "Saved" { $powerstate = "Saved" }
            default { $powerstate = $vm.State.ToString() }
        }
    }

    $nics = 0
    try {
        $nics = (Get-VMNetworkAdapter -VMName $vm.Name | Measure-Object).Count
    } catch { $nics = 0 }

    $disks = 0
    try {
        $disks = (Get-VMHardDiskDrive -VMName $vm.Name | Measure-Object).Count
    } catch { $disks = 0 }

    $dnsName = ""
    $guestOs = ""
    $kvpReason = ""
    try {
        $kvp = Get-CimInstance -Namespace root\\virtualization\\v2 -ClassName Msvm_KvpExchangeComponent -Filter "SystemName='$($vm.VMId.Guid)'"
        if ($kvp -and $kvp.GuestIntrinsicExchangeItems) {
            foreach ($item in $kvp.GuestIntrinsicExchangeItems) {
                try {
                    $xml = [xml]$item
                    $name = $xml.INSTANCE.PROPERTY[0].VALUE
                    $val = $xml.INSTANCE.PROPERTY[1].VALUE
                    if ($name -eq "FullyQualifiedDomainName") { $dnsName = $val }
                    elseif ($name -eq "OSName") { $guestOs = $val }
                    elseif ($name -eq "OSVersion") { if (-not $guestOs) { $guestOs = $val } }
                } catch {}
            }
        } else {
            if ($powerstate -ne "On") { $kvpReason = "vm_off" } else { $kvpReason = "no_kvp" }
        }
    } catch {
        if ($powerstate -ne "On") { $kvpReason = "vm_off" } else { $kvpReason = "kvp_error" }
    }

    $heartbeat = ""
    $guestState = ""
    try {
        $hb = Get-VMIntegrationService -VMName $vm.Name -Name "Heartbeat" -ErrorAction SilentlyContinue
        if ($hb -and $hb.PrimaryStatusDescription) {
            $heartbeat = $hb.PrimaryStatusDescription
            $guestState = $hb.PrimaryStatusDescription
        }
    } catch {}

    $row = [pscustomobject]@{
        VM = $vm.Name
        Powerstate = $powerstate
        CPUs = $vm.ProcessorCount
        Memory = [math]::Round(($vm.MemoryStartup/1MB),0)
        NICs = $nics
        Disks = $disks
        DNSName = $dnsName
        GuestOS = $guestOs
        KvpMissReason = $kvpReason
        Heartbeat = $heartbeat
        GuestState = $guestState
        PrimaryIPAddress = Get-IPv4Primary -vmName $vm.Name
        Path = $vm.Path
        LogDirectory = $vm.SmartPagingFilePath
        SnapshotDirectory = $vm.SnapshotFileLocation
        VMID = $vm.VMId
        Host = $env:COMPUTERNAME
        Cluster = $cluster_name
        ConfigStatus = if ($vmHealth.ContainsKey($vm.VMId)) { $vmHealth[$vm.VMId] } else { "" }
    }
    $rows += $row
}

$rows | ConvertTo-Json -Depth 4 -Compress
'''
        return script.replace('{TRY_CLUSTER}', flag).strip()



    def run_for_host(self, host: str, client, contract: Dict[str, Any], config, context: Dict[str, Any] = None) -> CollectorResult:
        start = time.perf_counter()
        logger.debug(f"[{host}] start vInfo collector")
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
                    "rows_per_sheet": {"vInfo": 0},
                    "duration_ms": duration_ms,
                    "strategy": "winrm"
                }
            )

        script = self._build_script(cluster_module)
        res = client.run_script_with_upload(script)

        rows: List[Dict[str, Any]] = []
        status = "success"
        error_short = ""
        reason = ""
        kvp_ok = 0
        miss_reasons: Dict[str, int] = {}
        hb_ok = 0
        raw_rows_count = 0
        mapped_rows_count = 0
        stderr_trunc = (res.stderr or "")[:8000]
        exit_code = res.exit_code

        error_text = res.error or res.stderr or ""
        is_error_stderr = False
        if error_text:
            lowered = error_text.lower()
            patterns = [
                "remoteexception",
                "fullyqualifiederrorid",
                "categoryinfo",
                "<s s=\"error\">",
                "cannot find path",
                "exception calling",
                "at line"
            ]
            for p in patterns:
                if p in lowered:
                    is_error_stderr = True
                    break

        if res.exit_code != 0 or res.error or is_error_stderr:
            err_msg = error_text
            lowered = err_msg.lower()
            if "credential" in lowered or "access is denied" in lowered or "401" in lowered:
                status = "auth_failed"
            elif "timeout" in lowered or "timed out" in lowered:
                status = "timeout"
            else:
                status = "winrm_error"
            error_short = err_msg[:200]
            reason = "powershell_error"
        else:
            try:
                data = json.loads(res.stdout) if res.stdout else []
                raw_rows_count = len(data) if isinstance(data, list) else 0
                if not data:
                    status = "empty"
                    error_short = "empty_result"
                    reason = "no_vms_returned"
                columns = contract.get("sheets", {}).get("vInfo", {}).get("columns", [])
                for item in data or []:
                    row = {}
                    for col in columns:
                        if col == "VM":
                            row[col] = item.get("VM", "")
                        elif col == "Powerstate":
                            row[col] = item.get("Powerstate", "")
                        elif col == "CPUs":
                            row[col] = item.get("CPUs", "")
                        elif col == "Memory":
                            row[col] = item.get("Memory", "")
                        elif col == "DNS Name":
                            row[col] = item.get("DNSName", "")
                        elif col == "Heartbeat":
                            row[col] = item.get("Heartbeat", "")
                        elif col == "Guest state":
                            row[col] = item.get("GuestState", "")
                        elif col == "OS according to the configuration file":
                            row[col] = item.get("GuestOS", "")
                        elif col == "OS according to the VMware Tools":
                            row[col] = item.get("GuestOS", "")
                        elif col == "NICs":
                            row[col] = item.get("NICs", "")
                        elif col == "Disks":
                            row[col] = item.get("Disks", "")
                        elif col == "Primary IP Address":
                            row[col] = item.get("PrimaryIPAddress", "")
                        elif col == "Path":
                            row[col] = item.get("Path", "")
                        elif col == "Log directory":
                            row[col] = item.get("LogDirectory", "")
                        elif col == "Snapshot directory":
                            row[col] = item.get("SnapshotDirectory", "")
                        elif col == "VM ID":
                            row[col] = item.get("VMID", "")
                        elif col == "Host":
                            row[col] = item.get("Host", "")
                        elif col == "Cluster":
                            row[col] = item.get("Cluster", "")
                        elif col == "Config status":
                            row[col] = item.get("ConfigStatus", "")
                        elif col == "Datacenter":
                            row[col] = ""
                        elif col == "Template":
                            row[col] = ""
                        elif col == "SRM Placeholder":
                            row[col] = ""
                        elif col == "Connection state":
                            row[col] = ""
                        elif col == "Heartbeat":
                            row[col] = ""
                        else:
                            row[col] = ""
                    rows.append(row)
                    mapped_rows_count += 1
                    miss = item.get("KvpMissReason")
                    if miss:
                        miss_reasons[miss] = miss_reasons.get(miss, 0) + 1
                    else:
                        kvp_ok += 1
                    if item.get("Heartbeat"):
                        hb_ok += 1
                if mapped_rows_count == 0 and not reason:
                    reason = "filtered_all_rows"
            except json.JSONDecodeError as e:
                status = "parse_error"
                error_short = f"JSON Parse Error: {e}"
                reason = "parse_error"
            except Exception as e:
                status = "winrm_error"
                error_short = str(e)[:200]
                reason = "parse_error"

        duration_ms = round((time.perf_counter() - start) * 1000, 2)
        rows_per_sheet = {"vInfo": len(rows)}
        fill_stats = compute_fill_stats({"vInfo": rows}, contract)

        logger.debug(
            f"[{host}] vInfo raw_rows={raw_rows_count} mapped_rows={len(rows)} "
            f"status={status} reason={reason or error_short}"
        )

        coverage = {
            "status": status,
            "error_short": error_short,
            "rows_per_sheet": rows_per_sheet,
            "duration_ms": duration_ms,
            "strategy": "winrm",
            "fill": fill_stats.get("vInfo", {}),
            "kvp_ok": kvp_ok,
            "kvp_miss": miss_reasons,
            "heartbeat_ok": hb_ok,
            "stderr": stderr_trunc,
            "exit_code": exit_code,
            "reason": reason or ("empty_result" if not rows else ""),
            "raw_rows_count": raw_rows_count,
            "mapped_rows_count": mapped_rows_count
        }

        return CollectorResult(sheet_rows={"vInfo": rows} if rows else {}, coverage=coverage)
