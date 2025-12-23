from pyVmomi import vim

from .context import CollectorContext
from ..property_fetch import fetch_objects
from ..resolvers import InventoryResolver
from ..utils.vm_meta import apply_vm_meta, get_vi_sdk_meta

DVS_PROPERTIES = [
    "name",
    "uuid",
    "summary.productInfo.version",
    "config.maxPorts",
    "summary.numPorts",
    "config.uplinkPortgroup",
    "parent",
    "config.defaultPortConfig",
]


def collect(context: CollectorContext):
    diagnostics = context.diagnostics
    logger = context.logger

    vi_meta = context.shared_data.get("vi_sdk")
    if not vi_meta:
        vi_meta = get_vi_sdk_meta(context.service_instance, context.config.server)
        context.shared_data["vi_sdk"] = vi_meta

    try:
        dvs_items = fetch_objects(
            context.service_instance, vim.DistributedVirtualSwitch, DVS_PROPERTIES
        )
    except Exception as exc:
        diagnostics.add_error("dvSwitch", "property_fetch", exc)
        logger.error("Fallo fetching dvSwitch: %s", exc)
        return []

    resolver = InventoryResolver(context.service_instance, logger=logger)
    rows = []

    for item in dvs_items:
        diagnostics.add_attempt("dvSwitch")
        try:
            props = item.get("props", {})
            ref = item.get("ref")
            name = props.get("name") or ""
            
            uuid = props.get("uuid", "")
            version = props.get("summary.productInfo.version", "")
            max_ports = props.get("config.maxPorts", 0)
            num_ports = props.get("summary.numPorts", 0)
            
            uplink_pgs = props.get("config.uplinkPortgroup", [])
            uplinks_count = len(uplink_pgs) if uplink_pgs else 0
            
            # Resolve Datacenter
            datacenter = resolver.resolve_datacenter_name(ref)
            
            rows.append({
                "dvSwitch": name,
                "Datacenter": datacenter,
                "Version": version,
                "NumHosts": "", # Would need to check config.host or summary.hostMember
                "NumPorts": num_ports, # or max_ports? RVTools usually shows configured ports or total?
                "MTU": "", # Often in config.maxMtu if VmwareDVS
                "Uplinks": uplinks_count,
                "HealthStatus": "",
                "Created": "",
            })
            apply_vm_meta(rows[-1], None, vi_meta)
            diagnostics.add_success("dvSwitch")
        except Exception as exc:
            diagnostics.add_error("dvSwitch", name, exc)

    return rows
