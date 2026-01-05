$ErrorActionPreference = 'SilentlyContinue'
$ProgressPreference = 'SilentlyContinue'

try {
    # Host Identity
    $cs = Get-CimInstance Win32_ComputerSystem
    $os = Get-CimInstance Win32_OperatingSystem
    $culture = Get-Culture
    $uiCulture = Get-UICulture
    $fqdn = ""
    try {
        $fqdn = [System.Net.Dns]::GetHostByName($env:COMPUTERNAME).HostName
    } catch {
        $fqdn = ""
    }

    # PowerShell Info
    $psTable = $PSVersionTable
    $execPolicy = (Get-ExecutionPolicy -Scope LocalMachine)
    $remotingEnabled = $false
    try {
        $remotingEnabled = (Get-Item WSMan:\localhost\Shell\MaxShellsPerUser) -ne $null
    } catch { $remotingEnabled = $false }

    # Roles/Features
    $hyperVRole = $false
    $clusteringRole = $false
    $rsatHyperV = $false
    $featureNames = @()
    try {
        $features = Get-WindowsFeature
        if ($features) {
            $hyperVRole = ($features | Where-Object { $_.Name -eq "Hyper-V" -and $_.Installed }).Count -gt 0
            $clusteringRole = ($features | Where-Object { $_.Name -eq "Failover-Clustering" -and $_.Installed }).Count -gt 0
            $rsatHyperV = ($features | Where-Object { $_.Name -eq "RSAT-Hyper-V-Tools" -and $_.Installed }).Count -gt 0
            $featureNames = ($features | Where-Object { $_.Installed }) | Select-Object -First 20 -ExpandProperty Name
        }
    } catch {}

    # Hyper-V module/cmdlets
    $hypervModule = Get-Module -ListAvailable -Name Hyper-V
    $hypervModuleAvailable = [bool]$hypervModule
    $hypervModuleVersion = if ($hypervModule) { ($hypervModule | Select-Object -ExpandProperty Version | Select-Object -First 1).ToString() } else { "" }
    $targetCmdlets = @('Get-VM', 'Get-VMHost', 'Get-VMNetworkAdapter', 'Get-VMHardDiskDrive', 'Get-VHD', 'Get-VMSwitch', 'Get-VMIntegrationService', 'Get-VMMemory', 'Get-VMProcessor', 'Measure-VM', 'Get-VMReplication')
    $foundCmdlets = @()
    foreach ($cmd in $targetCmdlets) {
        if (Get-Command $cmd -ErrorAction SilentlyContinue) {
            $foundCmdlets += $cmd
        }
    }
    $vmHostInfo = $null
    try { $vmHostInfo = Get-VMHost } catch {}

    # Default paths
    $defaultVhdPath = ""
    $defaultVmPath = ""
    if ($vmHostInfo) {
        $defaultVhdPath = $vmHostInfo.VirtualHardDiskPath
        $defaultVmPath = $vmHostInfo.VirtualMachinePath
    }

    # Cluster info
    $clusterModule = Get-Module -ListAvailable -Name FailoverClusters
    $clusterModuleAvailable = [bool]$clusterModule
    $clusterInfo = @{
        ClusterModuleAvailable = $clusterModuleAvailable
        IsClusterNode = $false
        ClusterName = ""
        ClusterFunctionalLevel = ""
        Nodes = @()
        CSVEnabled = $false
        CSVCount = 0
    }
    if ($clusterModuleAvailable) {
        try {
            $cluster = Get-Cluster
            if ($cluster) {
                $clusterInfo["IsClusterNode"] = $true
                $clusterInfo["ClusterName"] = $cluster.Name
                if ($cluster | Get-Member -Name "FunctionalLevel") {
                    $clusterInfo["ClusterFunctionalLevel"] = $cluster.FunctionalLevel
                }
                try {
                    $nodes = Get-ClusterNode | Select-Object -First 50 -ExpandProperty Name
                    $clusterInfo["Nodes"] = $nodes
                } catch {}
                try {
                    $csvs = Get-ClusterSharedVolume
                    if ($csvs) {
                        $clusterInfo["CSVEnabled"] = $true
                        $clusterInfo["CSVCount"] = ($csvs | Measure-Object).Count
                    }
                } catch {}
            }
        } catch {}
    }

    # Networking
    $netAdapters = @()
    try {
        $netAdapters = Get-NetAdapter | Select-Object -Property Name, Status, LinkSpeed, MacAddress, DriverDescription, InterfaceDescription
    } catch {}
    $vmSwitches = @()
    try {
        $vmSwitches = Get-VMSwitch | Select-Object -Property Name, SwitchType, NetAdapterInterfaceDescription
    } catch {}
    $nicTeam = $false
    try {
        $teams = Get-NetLbfoTeam
        if ($teams) { $nicTeam = $true }
    } catch {}

    # Storage
    $volumes = @()
    try {
        $volumes = Get-Volume | Where-Object { $_.DriveLetter } | Select-Object -Property DriveLetter, FileSystem, Size, SizeRemaining
    } catch {}

    $result = [pscustomobject]@{
        HostIdentity = [pscustomobject]@{
            ComputerName = $env:COMPUTERNAME
            FQDN = $fqdn
            Domain = if ($cs) { $cs.Domain } else { "" }
            OSName = if ($os) { $os.Caption } else { "" }
            OSVersion = if ($os) { $os.Version } else { "" }
            BuildNumber = if ($os) { $os.BuildNumber } else { "" }
            UBR = if ($os -and $os.UBR) { $os.UBR } else { "" }
            InstallDate = if ($os -and $os.InstallDate) { $os.InstallDate } else { "" }
            LastBootUpTime = if ($os -and $os.LastBootUpTime) { $os.LastBootUpTime } else { "" }
            TimeZone = try { (Get-TimeZone).Id } catch { "" }
            Culture = if ($culture) { $culture.Name } else { "" }
            UILanguage = if ($uiCulture) { $uiCulture.Name } else { "" }
        }
        PowerShell = [pscustomobject]@{
            PSVersion = if ($psTable) { $psTable.PSVersion.ToString() } else { "" }
            PSEdition = if ($psTable) { $psTable.PSEdition } else { "" }
            CLRVersion = if ($psTable) { $psTable.CLRVersion.ToString() } else { "" }
            ExecutionPolicy = $execPolicy
            RemotingEnabled = $remotingEnabled
        }
        RolesFeatures = [pscustomobject]@{
            HyperVRoleInstalled = $hyperVRole
            FailoverClusteringInstalled = $clusteringRole
            RSATHyperVToolsInstalled = $rsatHyperV
            InstalledFeatures = $featureNames
        }
        HyperV = [pscustomobject]@{
            HyperVModuleAvailable = $hypervModuleAvailable
            HyperVModuleVersion = $hypervModuleVersion
            CmdletsFound = $foundCmdlets
            VMHost = $vmHostInfo
            DefaultVHDPath = $defaultVhdPath
            DefaultVMPath = $defaultVmPath
        }
        Cluster = $clusterInfo
        Networking = [pscustomobject]@{
            NetAdapters = $netAdapters
            VMSwitches = $vmSwitches
            NicTeamPresent = $nicTeam
        }
        Storage = [pscustomobject]@{
            Volumes = $volumes
            VHDGetAvailable = ($foundCmdlets -contains "Get-VHD")
        }
    }
} catch {
    $result = @{ Error = ($_ | Out-String) }
}

$result | ConvertTo-Json -Depth 6 -Compress
