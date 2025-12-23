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


def _resolve_network_name(device, resolver: InventoryResolver) -> str:
    backing = getattr(device, "backing", None)
    if backing is None:
        return ""

    if isinstance(backing, vim.vm.device.VirtualEthernetCard.NetworkBackingInfo):
        if getattr(backing, "deviceName", None):
            return backing.deviceName
        network = getattr(backing, "network", None)
        return network.name if network else ""

    if isinstance(
        backing, vim.vm.device.VirtualEthernetCard.DistributedVirtualPortBackingInfo
    ):
        port = getattr(backing, "port", None)
        portgroup_key = getattr(port, "portgroupKey", "") if port else ""
        return resolver.resolve_dvportgroup_name(portgroup_key)

    if hasattr(backing, "opaqueNetworkName"):
        return getattr(backing, "opaqueNetworkName", "")

    return ""


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
        diagnostics.add_error("vNetwork", "property_fetch", exc)
        logger.error("Error PropertyCollector vNetwork: %s", exc)
        return []

    resolver = InventoryResolver(context.service_instance, logger=logger)
    rows = []

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

        for device in devices:
            if not isinstance(device, vim.vm.device.VirtualEthernetCard):
                continue

            diagnostics.add_attempt("vNetwork")
            try:
                network_name = _resolve_network_name(device, resolver)
                connectable = getattr(device, "connectable", None)
                connected = getattr(connectable, "connected", "") if connectable else ""
                start_connected = getattr(connectable, "startConnected", "") if connectable else ""
                
                row = {
                    "VM": name,
                    "Powerstate": str(power_state) if power_state is not None else "",
                    "Template": template,
                    "Network": network_name,
                    "PortGroup": network_name,
                    "Adapter": getattr(device.deviceInfo, "label", "")
                    if device.deviceInfo
                    else "",
                    "MAC": getattr(device, "macAddress", ""),
                    "Connected": str(connected),
                    "Starts Connected": str(start_connected),
                    "Type": device.__class__.__name__,
                    "Host": host_name,
                    "Cluster": cluster,
                    "Datacenter": datacenter,
                }
                apply_vm_meta(row, vm_meta, vi_meta, include_srm=True)
                rows.append(row)
                diagnostics.add_success("vNetwork")
            except Exception as exc:
                diagnostics.add_error("vNetwork", name or "<unknown>", exc)

    return rows
