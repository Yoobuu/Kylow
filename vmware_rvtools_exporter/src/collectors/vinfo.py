from pyVmomi import vim

from .context import CollectorContext
from ..property_fetch import fetch_vms, safe_fetch_vms
from ..resolvers import InventoryResolver
from ..utils.vm_meta import get_vi_sdk_meta, get_vm_meta


VM_PROPERTIES = [
    "name",
    "runtime.powerState",
    "runtime.connectionState",
    "runtime.host",
    "runtime.consolidationNeeded",
    "runtime.bootTime",
    "runtime.suspendTime",
    "runtime.suspendInterval",
    "runtime.faultToleranceState",
    "config.template",
    "config.uuid",
    "config.instanceUuid",
    "config.guestFullName",
    "config.guestId",
    "config.hardware.numCPU",
    "config.hardware.memoryMB",
    "config.hardware.device",
    "config.version",
    "config.firmware",
    "config.latencySensitivity",
    "config.bootOptions",
    "config.rebootPowerOff",
    "config.files.vmPathName",
    "config.createDate",
    "config.changeVersion",
    "config.annotation",
    "guest.guestFullName",
    "guest.ipAddress",
    "guest.toolsStatus",
    "guest.toolsRunningStatus",
    "guest.toolsVersionStatus2",
    "guest.guestState",
    "summary.config.numEthernetCards",
    "summary.config.numVirtualDisks",
    "summary.storage.committed",
    "summary.storage.uncommitted",
    "summary.storage.unshared",
    "summary.quickStats.guestMemoryUsage",
    "resourcePool",
    "parent", # Folder
]


def collect(context: CollectorContext):
    diagnostics = context.diagnostics
    logger = context.logger

    if "vi_sdk" not in context.shared_data:
        context.shared_data["vi_sdk"] = get_vi_sdk_meta(
            context.service_instance, context.config.server
        )
    vm_meta_by_moid = context.shared_data.setdefault("vm_meta_by_moid", {})

    vm_properties = list(VM_PROPERTIES)
    try:
        vm_items = safe_fetch_vms(
            context.service_instance,
            vm_properties,
            logger=logger,
            diagnostics=diagnostics,
        )
    except Exception as exc:
        diagnostics.add_error("vInfo", "property_fetch", exc)
        return []

    logger.debug("vInfo properties used: %s", ", ".join(vm_properties))

    if not vm_items:
        logger.warning(
            "safe_fetch_vms devolvio 0 filas; usando fallback name+powerState"
        )
        fallback_properties = ["name", "runtime.powerState"]
        try:
            vm_items = fetch_vms(context.service_instance, fallback_properties)
            logger.debug(
                "vInfo fallback properties used: %s",
                ", ".join(fallback_properties),
            )
        except Exception as exc:
            diagnostics.add_error("vInfo", "fallback_fetch_vms", exc)
            logger.error("Fallo fallback fetch_vms en vInfo: %s", exc)
            return []

    resolver = InventoryResolver(context.service_instance, logger=logger)
    rows = []

    for item in vm_items:
        props = item.get("props", {})
        name = props.get("name") or ""
        power_state = props.get("runtime.powerState")
        host_ref = props.get("runtime.host")
        moid = item.get("moid") or ""

        diagnostics.add_attempt("vInfo")
        if name and power_state is not None:
            diagnostics.add_success("vInfo")
        else:
            diagnostics.add_error("vInfo", name or "<unknown>", ValueError("Missing data"))

        # Resolve references
        host_name = resolver.resolve_host_name(host_ref)
        cluster = resolver.resolve_cluster_name(host_ref)
        datacenter = resolver.resolve_datacenter_name(host_ref)
        
        folder_ref = props.get("parent")
        folder_name = resolver.resolve_folder_name(folder_ref)
        folder_id = ""
        if folder_ref is not None and hasattr(folder_ref, "_GetMoId"):
            try:
                folder_id = folder_ref._GetMoId()
            except Exception:
                folder_id = ""

        vm_ref = item.get("ref")
        vm_meta = get_vm_meta(vm_ref, props, folder_ref)
        vm_meta_moid = vm_meta.get("VM ID") or item.get("moid") or ""
        if vm_meta_moid:
            vm_meta_by_moid[vm_meta_moid] = vm_meta
        
        rp_ref = props.get("resourcePool")
        rp_name = resolver.resolve_resource_pool_name(rp_ref)

        # Storage
        committed = props.get("summary.storage.committed") or 0
        uncommitted = props.get("summary.storage.uncommitted") or 0
        unshared = props.get("summary.storage.unshared") if "summary.storage.unshared" in props else None
        provisioned_bytes = committed + uncommitted
        
        in_use_mib = committed // (1024 * 1024)
        provisioned_mib = provisioned_bytes // (1024 * 1024)
        unshared_mib = "" if unshared is None else unshared // (1024 * 1024)
        total_disk_mib = ""
        devices = []
        if "config.hardware.device" in props:
            devices = props.get("config.hardware.device") or []
            total = 0
            for device in devices:
                if isinstance(device, vim.vm.device.VirtualDisk):
                    cap_kb = getattr(device, "capacityInKB", 0) or 0
                    total += int(cap_kb // 1024)
            total_disk_mib = total
        
        # Other
        active_mem = props.get("summary.quickStats.guestMemoryUsage") or 0 # already MB usually? check doc. "Guest memory usage in MB"
        num_monitors = ""
        video_ram_kib = ""
        hw_version = props.get("config.version") or ""
        firmware = props.get("config.firmware") or ""
        latency = props.get("config.latencySensitivity")
        latency_value = ""
        if latency is not None:
            latency_value = getattr(latency, "sensitivity", "")

        ha_restart_priority = ""
        ha_isolation_response = ""
        ha_vm_monitoring = ""

        boot_options = props.get("config.bootOptions")
        boot_delay = ""
        boot_retry_delay = ""
        boot_retry_enabled = ""
        boot_bios_setup = ""
        efi_secure_boot = ""
        if boot_options is not None:
            boot_delay = getattr(boot_options, "bootDelay", "")
            boot_retry_delay = getattr(boot_options, "bootRetryDelay", "")
            boot_retry_enabled = getattr(boot_options, "bootRetryEnabled", "")
            boot_bios_setup = getattr(boot_options, "enterBIOSSetup", "")
            efi_secure_boot = getattr(boot_options, "efiSecureBootEnabled", "")

        reboot_poweroff = props.get("config.rebootPowerOff")

        boot_time = props.get("runtime.bootTime")
        if hasattr(boot_time, "isoformat"):
            boot_time = boot_time.isoformat()

        suspend_time = props.get("runtime.suspendTime")
        if hasattr(suspend_time, "isoformat"):
            suspend_time = suspend_time.isoformat()
        suspend_interval = props.get("runtime.suspendInterval", "")
        ft_state = props.get("runtime.faultToleranceState", "")

        network_names = []
        for device in devices:
            if isinstance(device, vim.vm.device.VirtualEthernetCard):
                backing = getattr(device, "backing", None)
                name = ""
                if backing is not None:
                    name = getattr(backing, "deviceName", "") or ""
                    if not name:
                        name = getattr(backing, "networkName", "") or ""
                    if not name:
                        network = getattr(backing, "network", None)
                        if network is not None and hasattr(network, "name"):
                            name = network.name
                    if not name:
                        port = getattr(backing, "port", None)
                        if port is not None and hasattr(port, "portgroupKey"):
                            name = port.portgroupKey
                if not name:
                    name = getattr(device, "deviceInfo", None)
                    if name is not None and hasattr(name, "summary"):
                        name = name.summary
                    else:
                        name = ""
                network_names.append(name)
        
        path_name = props.get("config.files.vmPathName") or ""
        log_dir = "" 
        snap_dir = ""
        suspend_dir = ""
        # Parsing path for directory? "[DS] Path/file.vmx" -> "[DS] Path/"
        if path_name and "/" in path_name:
            base_dir = path_name.rsplit("/", 1)[0] + "/"
            log_dir = base_dir
            snap_dir = base_dir
            suspend_dir = base_dir

        row = {
            "VM": name,
            "Powerstate": str(power_state) if power_state is not None else "",
            "Template": props.get("config.template", ""),
            "Config status": "", # configStatus property? Not fetched yet.
            "DNS Name": "", # guest.hostname?
            "Connection state": str(props.get("runtime.connectionState", "")),
            "Guest state": str(props.get("guest.guestState", "")),
            "Heartbeat": str(props.get("guest.heartbeatStatus", "")),
            "Consolidation Needed": str(props.get("runtime.consolidationNeeded", "")),
            "PowerOn": "", # summary.runtime.bootTime?
            "Creation date": str(props.get("config.createDate", "")),
            "Change Version": str(props.get("config.changeVersion", "")),
            "CPUs": props.get("config.hardware.numCPU", ""),
            "Memory": props.get("config.hardware.memoryMB", ""),
            "Active Memory": active_mem,
            "NICs": props.get("summary.config.numEthernetCards", ""),
            "Disks": props.get("summary.config.numVirtualDisks", ""),
            "Total disk capacity MiB": total_disk_mib,
            "Provisioned MiB": provisioned_mib,
            "In Use MiB": in_use_mib,
            "Unshared MiB": unshared_mib,
            "PowerOn": boot_time or "",
            "Suspend time": suspend_time or "",
            "Suspend Interval": suspend_interval if suspend_interval != "" else "",
            "Folder": folder_name,
            "Folder ID": folder_id,
            "Resource pool": rp_name,
            "Path": path_name,
            "Log directory": log_dir,
            "Snapshot directory": snap_dir,
            "Suspend directory": suspend_dir,
            "Annotation": props.get("config.annotation", ""),
            "Datacenter": datacenter,
            "Cluster": cluster,
            "Host": host_name,
            "OS": props.get("config.guestFullName")
            or props.get("config.guestId", ""),
            "ToolsStatus": props.get("guest.toolsStatus", ""),
            "ToolsRunningStatus": props.get("guest.toolsRunningStatus", ""),
            "ToolsVersionStatus2": props.get("guest.toolsVersionStatus2", ""),
            "Primary IP": props.get("guest.ipAddress", ""),
            "VMUUID": props.get("config.uuid", ""), # BIOS UUID
            "SMBIOS UUID": props.get("config.uuid", ""), # usually same
            "InstanceUUID": props.get("config.instanceUuid", ""), # VC UUID
            "VM ID": moid,
            "VI SDK Server": context.config.server,
            "VI SDK API Version": context.content.about.apiVersion if context.content else "",
            "VI SDK Server type": context.content.about.apiType if context.content else "",
            "HW version": hw_version,
            "Firmware": firmware,
            "Video Ram KiB": video_ram_kib,
            "Num Monitors": num_monitors,
            "Latency Sensitivity": latency_value,
            "HA Restart Priority": ha_restart_priority,
            "HA Isolation Response": ha_isolation_response,
            "HA VM Monitoring": ha_vm_monitoring,
            "Network #1": network_names[0] if len(network_names) > 0 else "",
            "Network #2": network_names[1] if len(network_names) > 1 else "",
            "Network #3": network_names[2] if len(network_names) > 2 else "",
            "Network #4": network_names[3] if len(network_names) > 3 else "",
            "Boot delay": boot_delay if boot_delay != "" else "",
            "Boot retry delay": boot_retry_delay if boot_retry_delay != "" else "",
            "Boot retry enabled": str(boot_retry_enabled) if boot_retry_enabled != "" else "",
            "Boot BIOS setup": str(boot_bios_setup) if boot_bios_setup != "" else "",
            "EFI Secure boot": str(efi_secure_boot) if efi_secure_boot != "" else "",
            "Reboot PowerOff": reboot_poweroff if reboot_poweroff is not None else "",
            "FT State": str(ft_state) if ft_state != "" else "",
        }

        rows.append(row)

    context.shared_data["vInfo"] = rows
    return rows
