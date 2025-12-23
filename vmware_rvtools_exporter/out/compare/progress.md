# Progress log

- Timestamp: 2025-12-23 00:55:06 -05
- Lote: 1

## vInfo additions (Lote 1)
- VM ID: Managed Object ID (item["moid"]).
- VI SDK Server: context.config.server.
- VI SDK API Version: content.about.apiVersion.
- VI SDK Server type: content.about.apiType.
- Total disk capacity MiB: sum of VirtualDisk.capacityInKB from config.hardware.device.
- Unshared MiB: summary.storage.unshared (bytes -> MiB).
- HW version: config.version.
- Firmware: config.firmware.
- Video Ram KiB: config.hardware.videoRamSizeInKB.
- Num Monitors: config.hardware.numVideoDisplays.

## vHost additions (Lote 1)
- Vendor: summary.hardware.vendor.
- UUID: summary.hardware.uuid.
- Speed: summary.hardware.cpuMhz.
- HT Available: summary.hardware.numCpuThreads > summary.hardware.numCpuCores.
- # NICs: len(config.network.pnic).
- # HBAs: len(config.storageDevice.hostBusAdapter).
- CPU usage %: summary.quickStats.overallCpuUsage / (cpuMhz * numCpuCores).
- Memory usage %: summary.quickStats.overallMemoryUsage / (memorySize MB).
- in Maintenance Mode: summary.runtime.inMaintenanceMode.
- Boot time: summary.runtime.bootTime (isoformat).

## Limitations / notes
- Total disk capacity MiB depends on config.hardware.device; if not available, stays empty.
- CPU usage % and Memory usage % depend on summary.quickStats; if missing, stays empty.
- No VMware Tools / guest-based fields were added in this lote.

- Timestamp: 2025-12-23 01:07:19 -05
- Lote: 2

## vInfo additions (Lote 2)
- Folder ID: parent folder MOID (parent._GetMoId).
- Latency Sensitivity: config.latencySensitivity.sensitivity.
- HA Restart Priority: config.dasSettings.restartPriority.
- HA Isolation Response: config.dasSettings.isolationResponse.
- HA VM Monitoring: config.dasSettings.vmToolsMonitoringSettings.vmMonitoring (or enabled).
- Network #1: first vNIC backing name (config.hardware.device -> VirtualEthernetCard backing).
- Network #2: second vNIC backing name.
- Network #3: third vNIC backing name.
- Network #4: fourth vNIC backing name.

## vHost additions (Lote 2)
- vRAM: sum of vInfo Memory (MB) per host.
- VMs per Core: vm_count / numCpuCores (from vInfo).
- vCPUs per Core: sum(CPUs) / numCpuCores (from vInfo).
- in Quarantine Mode: summary.runtime.inQuarantineMode.
- Time Zone: config.dateTimeInfo.timeZone.
- Time Zone Name: config.dateTimeInfo.timeZone (name when available).
- VMotion support: capability.vmotionSupported.
- Storage VMotion support: capability.storageVmotionSupported.
- VI SDK Server: config.server.
- VI SDK UUID: content.about.instanceUuid.

## Notes
- Removed properties known to throw InvalidProperty in this environment: guest.heartbeatStatus, config.hardware.videoRamSizeInKB, config.hardware.numVideoDisplays.
- Network names use NIC backing deviceName/networkName; portgroupKey is used when available. Empty when not resolvable.
- HA settings are pulled from config.dasSettings; may be empty on standalone hosts or where not configured.

- Timestamp: 2025-12-23 01:19:43 -05
- Lote: 3

## vInfo additions (Lote 3)
- PowerOn: runtime.bootTime (isoformat when available).
- Suspend Interval: runtime.suspendInterval.
- Suspend time: runtime.suspendTime (isoformat when available).
- Reboot PowerOff: config.rebootPowerOff.
- Boot delay: config.bootOptions.bootDelay.
- Boot retry delay: config.bootOptions.bootRetryDelay.
- Boot retry enabled: config.bootOptions.bootRetryEnabled.
- Boot BIOS setup: config.bootOptions.enterBIOSSetup.
- EFI Secure boot: config.bootOptions.efiSecureBootEnabled.
- FT State: runtime.faultToleranceState.

## vRP additions (Lote 3)
- Status: runtime.overallStatus.
- # VMs total: count of VMs per ResourcePool (from vInfo, fallback to vm list).
- # vCPUs: sum of vInfo CPUs per ResourcePool.
- CPU overheadLimit: config.cpuAllocation.overheadLimit.
- CPU level: config.cpuAllocation.shares.level.
- CPU expandableReservation: config.cpuAllocation.expandableReservation.
- CPU maxUsage: runtime.cpu.maxUsage.
- CPU overallUsage: runtime.cpu.overallUsage.
- Mem Configured: summary.configuredMemoryMB.
- Mem overheadLimit: config.memoryAllocation.overheadLimit.

## Notes
- config.dasSettings removed due to InvalidProperty; HA Restart Priority / Isolation Response / HA VM Monitoring remain empty (requires cluster HA config access).
- Fixed Passthru HotPlug, HW upgrade policy/status not implemented in this lote (no safe API source confirmed).

- Timestamp: 2025-12-23 01:27:48 -05
- Lote: 4

## vHost additions (Lote 4)
- Serial number: hardware.systemInfo.serialNumber.
- Service tag: hardware.systemInfo.otherIdentifyingInfo (identifierType contains ServiceTag).
- OEM specific string: hardware.systemInfo.otherIdentifyingInfo (identifierType contains OEM).
- Object ID: HostSystem MOID (ref._GetMoId).
- NTP Server(s): config.dateTimeInfo.ntpConfig.server.
- Supported CPU power man.: hardware.cpuPowerManagementInfo.hardwareSupport.
- Current CPU power man. policy: hardware.cpuPowerManagementInfo.currentPolicy.
- Host Power Policy: same as currentPolicy (if available).
- Memory Tiering Type: hardware.memoryTieringType.

## dvPort additions (Lote 4)
- Allow Promiscuous: config.defaultPortConfig.securityPolicy.allowPromiscuous.value.
- Mac Changes: config.defaultPortConfig.securityPolicy.macChanges.value.
- Forged Transmits: config.defaultPortConfig.securityPolicy.forgedTransmits.value.
- Policy: config.defaultPortConfig.uplinkTeamingPolicy.policy.value.
- Active Uplink: config.defaultPortConfig.uplinkTeamingPolicy.uplinkPortOrder.activeUplinkPort.
- Standby Uplink: config.defaultPortConfig.uplinkTeamingPolicy.uplinkPortOrder.standbyUplinkPort.
- Reverse Policy: config.defaultPortConfig.uplinkTeamingPolicy.reversePolicy.value.
- Rolling Order: config.defaultPortConfig.uplinkTeamingPolicy.rollingOrder.value.
- VI SDK Server: config.server.
- VI SDK UUID: content.about.instanceUuid.

## Notes
- No VMware Tools or PerformanceManager usage.
- Values left empty when properties are missing or not applicable.

- Timestamp: 2025-12-23 01:39:45 -05
- Lote: 4 (VM meta propagation)

## vPartition additions
- SRM Placeholder: default "FALSE".
- Internal Sort Column: incremental counter per row.
- VM ID: VM MoID (vm._GetMoId).
- VM UUID: vm.config.uuid (fallback vm.config.instanceUuid).
- ClusterInvariantVMMId: vm.config.instanceUuid.
- Folder: VM folder path (/Datacenter/...).
- OS according to the configuration file: vm.config.guestFullName (fallback vm.config.guestId).
- OS according to the VMware Tools: vm.guest.guestFullName (may be empty).
- VI SDK Server: vCenter hostname (from config.server).
- VI SDK UUID: vCenter instanceUuid (content.about.instanceUuid).
- Annotation: vm.config.annotation.

## vNetwork additions
- SRM Placeholder: default "FALSE".
- VM ID / VM UUID / Folder / OS config / OS tools / ClusterInvariantVMMId / Annotation.
- VI SDK Server / VI SDK UUID.

## vDisk additions
- SRM Placeholder: default "FALSE".
- VM ID / VM UUID / Folder / OS config / OS tools / ClusterInvariantVMMId / Annotation.
- VI SDK Server / VI SDK UUID.
- Disk UUID: backing.uuid (if present).
- Disk Path: backing.fileName (if present).
- Disk Key: device.key (if present).

## vPort additions
- VI SDK Server / VI SDK UUID.

## dvSwitch additions
- VI SDK Server / VI SDK UUID.

## Notes
- SRM Placeholder is set to "FALSE" by default (no SRM detection implemented).
- HA/DRS config-based fields still not populated; left empty by design.

- Timestamp: 2025-12-23 01:46:06 -05
- Lote: 5

## vDisk additions (Lote 5)
- Raw: backing class contains RawDiskMapping (TRUE/FALSE).
- Sharing mode: device.sharing.
- Eagerly Scrub: backing.eagerlyScrub.
- Split: backing.split (if present).
- Write Through: backing.writeThrough (if present).
- Level: device.storageIOAllocation.shares.level.
- Shares: device.storageIOAllocation.shares.shares.

## vPartition additions (Lote 5)
- Disk Key: guest.disk.mappings[0].key when available; fallback "disk-<index>".
- Backup status: VM custom field value (CustomFieldsManager) where name contains backup/veeam/rubrik/commvault.
- Last backup: VM custom field value where name contains last backup / lastbackup.

## Notes
- No timestamps invented; backup fields only filled when custom fields exist.
- Raw/IO flags derived solely from VirtualDisk backing and storageIOAllocation; empty when not present.
