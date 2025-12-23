from pyVmomi import vim

from .context import CollectorContext
from ..property_fetch import fetch_vms, safe_fetch_vms
from ..resolvers import InventoryResolver
from ..utils.vm_meta import apply_vm_meta, get_vi_sdk_meta, get_vm_meta


VM_PROPERTIES = [
    "name",
    "runtime.powerState",
    "runtime.host",
    "config.template",
    "guest.disk",
    "guest.toolsStatus",
    "customValue",
]


def _custom_field_map(content) -> dict:
    mapping = {}
    if not content:
        return mapping
    manager = getattr(content, "customFieldsManager", None)
    fields = getattr(manager, "field", None) if manager else None
    if not fields:
        return mapping
    for field in fields:
        key = getattr(field, "key", None)
        name = getattr(field, "name", None)
        if key is not None and name:
            mapping[int(key)] = str(name)
    return mapping


def _extract_backup_fields(custom_values, field_map: dict) -> tuple:
    backup_status = ""
    last_backup = ""
    for entry in custom_values or []:
        key = getattr(entry, "key", None)
        value = getattr(entry, "value", None)
        if key is None:
            continue
        name = field_map.get(int(key), "")
        if not name:
            continue
        name_l = name.lower()
        value_str = str(value) if value is not None else ""
        if not value_str:
            continue
        if not last_backup and ("last backup" in name_l or "lastbackup" in name_l):
            last_backup = value_str
            continue
        if not backup_status:
            if "backup" in name_l or "veeam" in name_l or "rubrik" in name_l or "commvault" in name_l:
                backup_status = value_str
    return backup_status, last_backup


def collect(context: CollectorContext):
    diagnostics = context.diagnostics
    logger = context.logger

    vi_meta = context.shared_data.get("vi_sdk")
    if not vi_meta:
        vi_meta = get_vi_sdk_meta(context.service_instance, context.config.server)
        context.shared_data["vi_sdk"] = vi_meta
    vm_meta_by_moid = context.shared_data.get("vm_meta_by_moid", {})
    field_map = context.shared_data.get("custom_field_map")
    if field_map is None:
        field_map = _custom_field_map(context.content)
        context.shared_data["custom_field_map"] = field_map

    vm_properties = list(VM_PROPERTIES)
    try:
        vm_items = safe_fetch_vms(
            context.service_instance,
            vm_properties,
            logger=logger,
            diagnostics=diagnostics,
            sheet_name="vPartition",
        )
    except Exception as exc:
        diagnostics.add_error("vPartition", "property_fetch", exc)
        logger.error("Error PropertyCollector vPartition: %s", exc)
        return []

    if not vm_items:
        logger.warning(
            "safe_fetch_vms devolvio 0 filas en vPartition; usando fallback name+guest.disk"
        )
        fallback_properties = ["name", "guest.disk"]
        try:
            vm_items = fetch_vms(context.service_instance, fallback_properties)
        except Exception as exc:
            diagnostics.add_error("vPartition", "fallback_fetch_vms", exc)
            logger.error("Fallo fallback fetch_vms en vPartition: %s", exc)
            return []

    resolver = InventoryResolver(context.service_instance, logger=logger)
    rows = []
    sort_index = 1

    for item in vm_items:
        props = item.get("props", {})
        vm_ref = item.get("ref")
        moid = item.get("moid") or (vm_ref._GetMoId() if vm_ref and hasattr(vm_ref, "_GetMoId") else "")
        vm_meta = vm_meta_by_moid.get(moid)
        if not vm_meta:
            vm_meta = get_vm_meta(vm_ref, props, None)
        name = props.get("name") or ""
        power_state = props.get("runtime.powerState")
        host_ref = props.get("runtime.host")
        template = props.get("config.template", "")
        guest_disks = props.get("guest.disk") or []
        backup_status = ""
        last_backup = ""
        if field_map:
            backup_status, last_backup = _extract_backup_fields(
                props.get("customValue"), field_map
            )
        
        host_name = resolver.resolve_host_name(host_ref)
        cluster = resolver.resolve_cluster_name(host_ref)
        datacenter = resolver.resolve_datacenter_name(host_ref)

        if not guest_disks:
            # If no partitions, should we add a row? 
            # RVTools usually only lists VMs with partitions reported by tools.
            # If tools not running, no rows for this VM in vPartition.
            continue

        for disk in guest_disks:
            diagnostics.add_attempt("vPartition")
            try:
                disk_path = disk.diskPath
                capacity = disk.capacity
                free_space = disk.freeSpace
                
                # Capacity/Free are in bytes? PyVmomi docs say "Total capacity of the disk, in bytes."
                # We need MiB for RVTools.
                # capacity_mib = capacity / 1024 / 1024
                # free_mib = free_space / 1024 / 1024
                # consumed_mib = capacity_mib - free_mib
                
                # Note: conversion happens in compat layer usually if we map to "Capacity MiB".
                # But compat layer expects raw values to be converted?
                # In rvtools_compat.py, to_mib converts GB to MiB.
                # Here we have Bytes.
                # I should probably convert to MiB here or add a to_mib_from_bytes in compat.
                # Let's convert here to be safe and consistent with "Capacity MiB" expectation of being MiB.
                # Or output GB and let compat convert?
                # Compat to_mib multiplies by 1024.
                # If I output bytes, and compat multiplies by 1024, it becomes huge.
                # So I must output GB if I use the existing to_mib.
                # Or I handle it here.
                
                # Let's output raw bytes or MB and handle mapping in compat layer specially?
                # Or just do the math here and map directly to "Capacity MiB".
                
                cap_mib = capacity // (1024 * 1024)
                free_mib = free_space // (1024 * 1024)
                consumed_mib = cap_mib - free_mib
                
                free_pct = 0
                if cap_mib > 0:
                    free_pct = round((free_mib / cap_mib) * 100, 1)

                disk_key = ""
                mappings = getattr(disk, "mappings", None) or []
                if mappings:
                    mapping = mappings[0]
                    disk_key = getattr(mapping, "key", "") or ""
                if disk_key == "":
                    disk_key = f"disk-{sort_index}"

                rows.append({
                    "VM": name,
                    "Powerstate": str(power_state) if power_state is not None else "",
                    "Template": template,
                    "Host": host_name,
                    "Cluster": cluster,
                    "Datacenter": datacenter,
                    "Disk": disk_path, # Mapping "Disk" to path
                    "Capacity MiB": cap_mib,
                    "Free MiB": free_mib,
                    "Consumed MiB": consumed_mib,
                    "Free %": free_pct,
                    "Disk Key": disk_key,
                    "Internal Sort Column": sort_index,
                    "Backup status": backup_status,
                    "Last backup": last_backup,
                })
                apply_vm_meta(rows[-1], vm_meta, vi_meta, include_srm=True)
                sort_index += 1
                diagnostics.add_success("vPartition")
            except Exception as exc:
                diagnostics.add_error("vPartition", name, exc)

    return rows
