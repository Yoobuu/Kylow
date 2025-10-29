# backend/scripts/collect_hyperv_inventory.ps1
param(
    [Parameter(Mandatory=$true)][string]$HVHost
)

$ErrorActionPreference = 'Stop'
$ProgressPreference    = 'SilentlyContinue'

Import-Module Hyper-V -ErrorAction Stop
Import-Module FailoverClusters -ErrorAction SilentlyContinue

# --- Cluster (opcional si existe) ---
$clusterName = $null; $vmOwnerMap = @{}
try {
  $cluster = Get-Cluster -ErrorAction Stop
  $clusterName = $cluster.Name
  $vmGroups = Get-ClusterGroup | Where-Object GroupType -eq "VirtualMachine"
  foreach ($g in $vmGroups) { $vmOwnerMap[$g.Name] = $g.OwnerNode.Name }
} catch {}

# --- SO desde KVP (local) ---
function Get-HVGuestOSFromKVP {
  param([Microsoft.HyperV.PowerShell.VirtualMachine]$VM)
  try {
    $vmGuid = $VM.VMId.Guid
    $cs = Get-CimInstance -Namespace root\virtualization\v2 `
         -ClassName Msvm_ComputerSystem -Filter "Name='$vmGuid'"
    if (-not $cs) { return $null }
    $kvp = Get-CimAssociatedInstance -InputObject $cs -ResultClassName Msvm_KvpExchangeComponent
    if (-not $kvp) { return $null }
    foreach ($raw in $kvp.GuestIntrinsicExchangeItems) {
      try {
        [xml]$xml = $raw
        $name = $xml.INSTANCE.PROPERTY | Where-Object { $_.Name -eq 'Name' } | Select-Object -ExpandProperty VALUE
        if ($name -eq 'OSName') {
          $data = $xml.INSTANCE.PROPERTY | Where-Object { $_.Name -eq 'Data' } | Select-Object -ExpandProperty VALUE
          if ($data) { return [string]$data }
        }
      } catch {}
    }
    return $null
  } catch { return $null }
}

function Get-Disks($vm) {
  $diskObjs=@()
  try {
    foreach($hdd in (Get-VMHardDiskDrive -VM $vm)){
      try {
        $v=Get-VHD -Path $hdd.Path -ErrorAction Stop
        $sizeGiB = [math]::Round(($v.Size/1GB),2)
        $allocGiB= [math]::Round(($v.FileSize/1GB),2)
        $allocPct= if ($v.Size -gt 0) { [math]::Round(($v.FileSize / $v.Size)*100,2) } else { 0 }
        $diskObjs+=[pscustomobject]@{
          SizeGiB      = $sizeGiB
          AllocatedGiB = $allocGiB
          AllocatedPct = $allocPct
        }
      } catch {}
    }
  } catch {}
  return $diskObjs
}

function Get-NICInfo($vm) {
  $vlanIds=@(); $ipList=@()
  try {
    $nics=Get-VMNetworkAdapter -VM $vm
    foreach ($nic in $nics) {
      try {
        $vlan=Get-VMNetworkAdapterVlan -VMNetworkAdapter $nic
        if ($vlan) {
          if ($vlan.AccessVlanId){$vlanIds+=[int]$vlan.AccessVlanId}
          if ($vlan.TrunkVlanId){$vlanIds+=[int]$vlan.TrunkVlanId}
        }
      } catch {}
      if ($nic.IPAddresses){
        $ipList += $nic.IPAddresses | Where-Object { $_ -match '^\d{1,3}(\.\d{1,3}){3}$' }
      }
    }
  } catch {}
  if ($vlanIds.Count -gt 0){$vlanIds=$vlanIds|Sort-Object -Unique}else{$vlanIds=@()}
  if ($ipList.Count  -eq 0){$ipList=@()}
  return @{ VLANs = $vlanIds; IPv4 = $ipList }
}

function Get-OneVM {
  param([string]$HVHost,[Microsoft.HyperV.PowerShell.VirtualMachine]$VM)

  # vCPU y uso CPU (fallback Measure-VM)
  $vCPU = $null; try { $vCPU = (Get-VMProcessor -VM $VM).Count } catch {}
  $cpuUsagePct = $null
  try { $cpuUsagePct = $VM.CPUUsage } catch {}
  if ($cpuUsagePct -eq $null -or $cpuUsagePct -eq 0) {
    try {
      $m = Measure-VM -ComputerName $HVHost -VMName $VM.Name -ErrorAction Stop
      if ($m.Processor.Average) { $cpuUsagePct = [math]::Round($m.Processor.Average,2) }
    } catch {}
  }

  # RAM
  $ramMB  = $null; $ramDem = $null; $ramPct = $null
  try { $ramMB  = [int]($VM.MemoryAssigned/1MB) } catch {}
  try { $ramDem = [int]($VM.MemoryDemand/1MB)   } catch {}
  if ($ramMB -gt 0 -and $ramDem -ge 0) {
    $ramPct = [math]::Round(($ramDem / $ramMB)*100,2)
  }

  # NICs
  $nicInfo = Get-NICInfo -vm $VM

  # Compatibilidad (Version y Generation 1/2)
  $ver=$null; try { $ver=$VM.Version } catch {}
  $gen=$null; try { $gen=$VM.Generation } catch {}  # ← aquí tienes Generation 1 o 2

  # SO (KVP) y cluster
  $guestOS=$null
  if($VM.State -eq 'Running'){ $guestOS=Get-HVGuestOSFromKVP -VM $VM }
  $cluster = $null
  try {
    $grp = Get-ClusterGroup -Name ("Virtual Machine " + $VM.Name) -ErrorAction SilentlyContinue
    if ($grp) { $cluster = $grp.Cluster.Name }
  } catch {}

  # Discos
  $disks = Get-Disks -vm $VM

  # → SALIDA en el **esquema objetivo (inglés)** para no tocar schema.py
  [pscustomobject]@{
    HVHost         = $HVHost
    Name           = $VM.Name
    State          = $VM.State.ToString()
    vCPU           = [int]$vCPU
    CPU_UsagePct   = ($cpuUsagePct -as [double])
    RAM_MiB        = ($ramMB -as [int])
    RAM_Demand_MiB = ($ramDem -as [int])
    RAM_UsagePct   = ($ramPct -as [double])
    OS             = $guestOS
    Cluster        = $cluster
    VLAN_IDs       = @($nicInfo.VLANs)
    IPv4           = @($nicInfo.IPv4)
    CompatHW       = @{ Version = $ver; Generation = $gen }
    Disks          = $disks
  }
}

# --- Recoger inventario del host indicado ---
$items = @()
try {
  $vms = Get-VM -ComputerName $HVHost -ErrorAction Stop
  foreach ($vm in $vms) { $items += Get-OneVM -HVHost $HVHost -VM $vm }
} catch {
  Write-Warning "Get-VM en $HVHost falló: $($_.Exception.Message)"
}

$items | ConvertTo-Json -Depth 6
