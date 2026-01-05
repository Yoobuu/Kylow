$ErrorActionPreference = 'SilentlyContinue'
$ProgressPreference = 'SilentlyContinue'

# 1. PowerShell Version
$psVer = $PSVersionTable.PSVersion.ToString()

# 2. OS Info
$osInfo = Get-CimInstance -ClassName Win32_OperatingSystem | Select-Object Caption, Version, BuildNumber
$osStr = if ($osInfo) { "$($osInfo.Caption) ($($osInfo.Version))" } else { "Unknown" }

# 3. Module Checks
$hyperv = Get-Module -ListAvailable -Name Hyper-V
$clustering = Get-Module -ListAvailable -Name FailoverClusters

# 4. Cmdlet Checks
$targetCmdlets = @('Get-VM', 'Get-VMHost', 'Get-VMNetworkAdapter', 'Get-VMHardDiskDrive', 'Get-VHD', 'Get-Cluster')
$foundCmdlets = @()

foreach ($cmd in $targetCmdlets) {
    if (Get-Command $cmd -ErrorAction SilentlyContinue) {
        $foundCmdlets += $cmd
    }
}

# 5. Determine Strategy
$strategy = "CIMFallback"
if ($hyperv -and ($foundCmdlets -contains 'Get-VM')) {
    $strategy = "HyperVModule"
}

$result = [pscustomobject]@{
    PSVersion = $psVer
    OS = $osStr
    HyperVModule = [bool]$hyperv
    ClusterModule = [bool]$clustering
    Cmdlets = $foundCmdlets
    Strategy = $strategy
    Timestamp = (Get-Date).ToString("yyyy-MM-ddTHH:mm:ssZ")
}

$result | ConvertTo-Json -Depth 2 -Compress
