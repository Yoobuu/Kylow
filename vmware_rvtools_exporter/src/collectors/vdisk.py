from typing import Optional

from pyVmomi import vim

from .context import CollectorContext
from ..property_fetch import fetch_vms
from ..resolvers import InventoryResolver
from ..utils.vm_meta import apply_vm_meta, get_vi_sdk_meta, get_vm_meta


VM_PROPERTIES = [
    "name",
    "runtime.powerState",
    "runtime.host",
    "config.template",
    "config.hardware.device",
]


def _capacity_gb_from_kb(capacity_kb):
    if capacity_kb is None:
        return ""
    try:
        return round(float(capacity_kb) / (1024 * 1024), 2)
    except (TypeError, ValueError):
        return ""


def _extract_datastore_name(backing, filename: str) -> str:
    if getattr(backing, "datastore", None) is not None:
        try:
            return backing.datastore.name
        except Exception:
            return ""
    if filename and filename.startswith("[") and "]" in filename:
        return filename.split("]", 1)[0].lstrip("[")
    return ""


def _bool_to_rvtools(value) -> str:
    if value is None or value == "":
        return ""
    return "TRUE" if bool(value) else "FALSE"


def _is_raw_backing(backing) -> Optional[bool]:
    if backing is None:
        return None
    name = backing.__class__.__name__
    if "RawDiskMapping" in name:
        return True
    return False


def collect(context: CollectorContext):
    diagnostics = context.diagnostics
    logger = context.logger

    vi_meta = context.shared_data.get("vi_sdk")
    if not vi_meta:
        vi_meta = get_vi_sdk_meta(context.service_instance, context.config.server)
        context.shared_data["vi_sdk"] = vi_meta
    vm_meta_by_moid = context.shared_data.get("vm_meta_by_moid", {})

    try:
        vm_items = fetch_vms(context.service_instance, VM_PROPERTIES)
    except Exception as exc:
        diagnostics.add_error("vDisk", "property_fetch", exc)
        logger.error("Error PropertyCollector vDisk: %s", exc)
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
        devices = props.get("config.hardware.device") or []

        host_name = resolver.resolve_host_name(host_ref)
        cluster = resolver.resolve_cluster_name(host_ref)
        datacenter = resolver.resolve_datacenter_name(host_ref)

        controller_shared_bus = {}
        for device in devices:
            if isinstance(device, vim.vm.device.VirtualSCSIController):
                shared_bus = getattr(device, "sharedBus", "")
                controller_shared_bus[getattr(device, "key", "")] = shared_bus

        for device in devices:
            if not isinstance(device, vim.vm.device.VirtualDisk):
                continue

            diagnostics.add_attempt("vDisk")
            try:
                label = getattr(device.deviceInfo, "label", "") if device.deviceInfo else ""
                capacity_gb = _capacity_gb_from_kb(getattr(device, "capacityInKB", None))
                backing = getattr(device, "backing", None)
                filename = getattr(backing, "fileName", "") if backing else ""
                thin = getattr(backing, "thinProvisioned", "") if backing else ""
                datastore_name = _extract_datastore_name(backing, filename)
                disk_uuid = getattr(backing, "uuid", "") if backing else ""
                disk_key = getattr(device, "key", "")
                raw_val = _is_raw_backing(backing)
                sharing_mode = getattr(device, "sharing", "")
                eagerly_scrub = getattr(backing, "eagerlyScrub", None) if backing else None
                split = getattr(backing, "split", None) if backing else None
                write_through = getattr(backing, "writeThrough", None) if backing else None
                storage_io = getattr(device, "storageIOAllocation", None)
                shares_level = ""
                shares_value = ""
                reservation = ""
                limit = ""
                if storage_io is not None:
                    shares = getattr(storage_io, "shares", None)
                    if shares is not None:
                        shares_level = getattr(shares, "level", "") or ""
                        shares_value = getattr(shares, "shares", "") or ""
                    reservation = getattr(storage_io, "reservation", "")
                    limit = getattr(storage_io, "limit", "")
                scsi_unit = getattr(device, "unitNumber", "")
                shared_bus = controller_shared_bus.get(
                    getattr(device, "controllerKey", ""), ""
                )
                internal_sort = f"{moid}:{disk_key}" if moid and disk_key != "" else sort_index

                row = {
                    "VM": name,
                    "Powerstate": str(power_state) if power_state is not None else "",
                    "Template": template,
                    "Disk": label,
                    "Label": label,
                    "CapacityGB": capacity_gb,
                    "Datastore": datastore_name,
                    "File": filename,
                    "Thin": thin,
                    "Controller": getattr(device, "controllerKey", ""),
                    "UnitNumber": getattr(device, "unitNumber", ""),
                    "Type": device.__class__.__name__,
                    "Disk UUID": disk_uuid,
                    "Disk Path": filename,
                    "Disk Key": disk_key,
                    "Raw": _bool_to_rvtools(raw_val) if raw_val is not None else "",
                    "Sharing mode": str(sharing_mode) if sharing_mode != "" else "",
                    "Eagerly Scrub": _bool_to_rvtools(eagerly_scrub),
                    "Split": _bool_to_rvtools(split),
                    "Write Through": _bool_to_rvtools(write_through),
                    "Level": shares_level,
                    "Shares": shares_value,
                    "Reservation": reservation,
                    "Limit": limit,
                    "SCSI Unit #": scsi_unit,
                    "Shared Bus": str(shared_bus) if shared_bus != "" else "",
                    "Internal Sort Column": internal_sort,
                    "Host": host_name,
                    "Cluster": cluster,
                    "Datacenter": datacenter,
                }
                apply_vm_meta(row, vm_meta, vi_meta, include_srm=True)
                rows.append(row)
                sort_index += 1
                diagnostics.add_success("vDisk")
            except Exception as exc:
                diagnostics.add_error("vDisk", name or "<unknown>", exc)

    return rows
