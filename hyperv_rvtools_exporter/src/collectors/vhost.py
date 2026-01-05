import json
import logging
import time
from typing import Dict, Any, List

from .base import CollectorResult

logger = logging.getLogger("hyperv.collectors.vhost")


class VHostCollector:
    name = "vHost"
    offline = False

    def __init__(self, config):
        self.config = config

    def _build_script(self, try_cluster: bool, try_vm_count: bool) -> str:
        flag_cluster = "$true" if try_cluster else "$false"
        flag_vm = "$true" if try_vm_count else "$false"
        return rf"""
$ErrorActionPreference = 'SilentlyContinue'
$ProgressPreference = 'SilentlyContinue'
$tryCluster = {flag_cluster}
$tryVMCount = {flag_vm}
$errors = @()

$cs = Get-CimInstance Win32_ComputerSystem
if (-not $cs) {{ $errors += "cs" }}
$os = Get-CimInstance Win32_OperatingSystem
if (-not $os) {{ $errors += "os" }}
$procList = Get-CimInstance Win32_Processor
if (-not $procList) {{ $errors += "proc" }}
$bios = Get-CimInstance Win32_BIOS
if (-not $bios) {{ $errors += "bios" }}
$prod = Get-CimInstance Win32_ComputerSystemProduct
if (-not $prod) {{ $errors += "prod" }}

$hostName = $env:COMPUTERNAME
$domain = if ($cs) {{ $cs.Domain }} else {{ "" }}
$manufacturer = if ($cs) {{ $cs.Manufacturer }} else {{ "" }}
$model = if ($cs) {{ $cs.Model }} else {{ "" }}

$cpu_name = ""
$cpu_max_mhz = ""
$total_cores = ""
$total_threads = ""
$sockets = ""
if ($procList) {{
    $cpu_name = ($procList | Select-Object -ExpandProperty Name -First 1)
    $total_cores = ($procList | Measure-Object -Property NumberOfCores -Sum).Sum
    $total_threads = ($procList | Measure-Object -Property NumberOfLogicalProcessors -Sum).Sum
    $cpu_max_mhz = ($procList | Measure-Object -Property MaxClockSpeed -Maximum).Maximum
    $sockets = ($procList | Select-Object -ExpandProperty SocketDesignation | Sort-Object -Unique).Count
    if (-not $sockets) {{ $sockets = $cs.NumberOfProcessors }}
}}

$total_mem_mib = ""
if ($cs -and $cs.TotalPhysicalMemory) {{
    $total_mem_mib = [math]::Round(($cs.TotalPhysicalMemory/1MB),0)
}}

$nics_count = 0
try {{
    $nics_count = (Get-NetAdapter -Physical | Measure-Object).Count
    if (-not $nics_count) {{
        $nics_count = (Get-NetAdapter | Measure-Object).Count
    }}
}} catch {{
    $errors += "nics"
}}

$dns_servers = @()
try {{
    $dns_servers = Get-DnsClientServerAddress -AddressFamily IPv4 | ForEach-Object {{ $_.ServerAddresses }} | Where-Object {{ $_ }}
}} catch {{
    $errors += "dns"
}}

$timezone_id = ""
$gmt_offset = ""
try {{
    $tz = Get-TimeZone
    if ($tz) {{
        $timezone_id = $tz.Id
        if ($tz.BaseUtcOffset) {{
            $gmt_offset = $tz.BaseUtcOffset.TotalHours
        }}
    }}
}} catch {{
    $errors += "timezone"
}}

$bios_vendor = if ($bios) {{ $bios.Manufacturer }} else {{ "" }}
$bios_version = if ($bios) {{ $bios.SMBIOSBIOSVersion }} else {{ "" }}
$bios_date = ""
if ($bios -and $bios.ReleaseDate) {{
    try {{
        $bios_date = ([Management.ManagementDateTimeConverter]::ToDateTime($bios.ReleaseDate)).ToString("yyyy-MM-dd")
    }} catch {{ $bios_date = $bios.ReleaseDate }}
}}
$bios_serial = ""
if ($prod -and $prod.IdentifyingNumber) {{ $bios_serial = $prod.IdentifyingNumber }}
if (-not $bios_serial -and $bios -and $bios.SerialNumber) {{ $bios_serial = $bios.SerialNumber }}

$last_boot = ""
if ($os -and $os.LastBootUpTime) {{
    try {{
        $last_boot = ([Management.ManagementDateTimeConverter]::ToDateTime($os.LastBootUpTime)).ToString("yyyy-MM-ddTHH:mm:ssK")
    }} catch {{ $last_boot = $os.LastBootUpTime }}
}}

$host_uuid = ""
if ($prod -and $prod.UUID) {{ $host_uuid = $prod.UUID }}

$cluster_name = ""
if ($tryCluster) {{
    try {{
        $cluster = Get-Cluster
        if ($cluster) {{ $cluster_name = $cluster.Name }}
    }} catch {{ $errors += "cluster" }}
}}

$vm_count = ""
if ($tryVMCount) {{
    try {{
        $vm_count = (Get-VM | Measure-Object).Count
    }} catch {{ $errors += "vm_count" }}
}}

$result = [pscustomobject]@{{
    host = $hostName
    domain = $domain
    manufacturer = $manufacturer
    model = $model
    cpu_name = $cpu_name
    cpu_max_mhz = $cpu_max_mhz
    total_cores = $total_cores
    total_threads = $total_threads
    sockets = $sockets
    total_mem_mib = $total_mem_mib
    nics_count = $nics_count
    dns_servers = $dns_servers
    timezone_id = $timezone_id
    gmt_offset = $gmt_offset
    bios_vendor = $bios_vendor
    bios_version = $bios_version
    bios_date = $bios_date
    bios_serial = $bios_serial
    last_boot = $last_boot
    host_uuid = $host_uuid
    cluster_name = $cluster_name
    vm_count = $vm_count
    errors = $errors
}}

$result | ConvertTo-Json -Depth 4 -Compress
""".strip()

    def run_for_host(self, host: str, client, contract: Dict[str, Any], config, context: Dict[str, Any] = None) -> CollectorResult:
        start = time.perf_counter()
        hv_map = (context or {}).get("hv_capabilities", {}) if context else {}
        hv = hv_map.get(host, {})
        try_cluster = str(hv.get("ClusterModuleAvailable", "")).lower() == "true"
        try_vm = str(hv.get("HyperVModuleAvailable", "")).lower() == "true"

        script = self._build_script(try_cluster, try_vm)
        res = client.run_script_with_upload(script)

        rows: List[Dict[str, Any]] = []
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
                data = json.loads(res.stdout)
                errors = data.get("errors") or []
                status = "success" if not errors else "partial"

                total_cores = data.get("total_cores") or 0
                total_threads = data.get("total_threads") or 0
                sockets = data.get("sockets") or 0
                cores_per_cpu = ""
                try:
                    if sockets:
                        cores_per_cpu = round(float(total_cores) / float(sockets))
                except Exception:
                    cores_per_cpu = ""

                ht_flag = "True" if (total_threads and total_cores and total_threads > total_cores) else "False"

                dns_joined = ""
                if isinstance(data.get("dns_servers"), list):
                    dns_joined = ", ".join([str(x) for x in data.get("dns_servers") if x])

                row = {
                    "Host": host,
                    "Datacenter": "",
                    "Cluster": data.get("cluster_name") or "",
                    "Config status": "Connected" if status in ("success", "partial") else "",
                    "Compliance Check State": "",
                    "in Maintenance Mode": "",
                    "in Quarantine Mode": "",
                    "vSAN Fault Domain Name": "",
                    "CPU Model": data.get("cpu_name") or "",
                    "Speed": data.get("cpu_max_mhz") or "",
                    "HT Available": ht_flag,
                    "HT Active": ht_flag,
                    "# CPU": sockets or "",
                    "Cores per CPU": cores_per_cpu,
                    "# Cores": total_cores or "",
                    "CPU usage %": "",
                    "# Memory": data.get("total_mem_mib") or "",
                    "Memory Tiering Type": "",
                    "Memory usage %": "",
                    "Console": "",
                    "# NICs": data.get("nics_count") or "",
                    "# HBAs": "",
                    "# VMs total": data.get("vm_count") or "",
                    "# VMs": data.get("vm_count") or "",
                    "VMs per Core": "",
                    "# vCPUs": "",
                    "vCPUs per Core": "",
                    "vRAM": "",
                    "VM Used memory": "",
                    "VM Memory Swapped": "",
                    "VM Memory Ballooned": "",
                    "VMotion support": "",
                    "Storage VMotion support": "",
                    "Current EVC": "",
                    "Max EVC": "",
                    "Assigned License(s)": "",
                    "ATS Heartbeat": "",
                    "ATS Locking": "",
                    "Current CPU power man. policy": "",
                    "Supported CPU power man.": "",
                    "Host Power Policy": "",
                    "ESX Version": "",
                    "Boot time": data.get("last_boot") or "",
                    "DNS Servers": dns_joined,
                    "DHCP": "",
                    "Domain": data.get("domain") or "",
                    "Domain List": "",
                    "DNS Search Order": "",
                    "NTP Server(s)": "",
                    "NTPD running": "",
                    "Time Zone": data.get("timezone_id") or "",
                    "Time Zone Name": data.get("timezone_id") or "",
                    "GMT Offset": data.get("gmt_offset") or "",
                    "Vendor": data.get("manufacturer") or "",
                    "Model": data.get("model") or "",
                    "Serial number": data.get("bios_serial") or "",
                    "Service tag": data.get("bios_serial") or "",
                    "OEM specific string": "",
                    "BIOS Vendor": data.get("bios_vendor") or "",
                    "BIOS Version": data.get("bios_version") or "",
                    "BIOS Date": data.get("bios_date") or "",
                    "Certificate Issuer": "",
                    "Certificate Start Date": "",
                    "Certificate Expiry Date": "",
                    "Certificate Status": "",
                    "Certificate Subject": "",
                    "Object ID": "",
                    "AutoDeploy.MachineIdentity": "",
                    "Backup status": "",
                    "ClusterInvariantVMMId": "",
                    "Last backup": "",
                    "UUID": data.get("host_uuid") or "",
                    "VI SDK Server": "",
                    "VI SDK UUID": ""
                }
                rows.append(row)
                if errors:
                    error_short = ";".join(errors)[:200]
            except json.JSONDecodeError as e:
                status = "parse_error"
                error_short = f"JSON Parse Error: {e}"

        duration_ms = round((time.perf_counter() - start) * 1000, 2)
        rows_per_sheet = {"vHost": len(rows)}

        coverage = {
            "status": status,
            "error_short": error_short,
            "rows_per_sheet": rows_per_sheet,
            "duration_ms": duration_ms,
            "strategy": "winrm"
        }

        return CollectorResult(sheet_rows={"vHost": rows} if rows else {}, coverage=coverage)
