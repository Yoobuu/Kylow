from pyVmomi import vim

from .context import CollectorContext
from ..property_fetch import fetch_objects
from ..resolvers import InventoryResolver
from ..utils.vm_meta import apply_vm_meta, get_vi_sdk_meta

DVPORT_PROPERTIES = [
    "name",
    "key",
    "config.defaultPortConfig",
    "config.distributedVirtualSwitch",
    "config.numPorts",
    "config.type",
]


def _format_vlan(vlan_spec):
    if isinstance(vlan_spec, vim.dvs.VmwareDistributedVirtualSwitch.VlanIdSpec):
        return str(vlan_spec.vlanId)
    elif isinstance(vlan_spec, vim.dvs.VmwareDistributedVirtualSwitch.TrunkVlanSpec):
        ranges = []
        if vlan_spec.vlanId:
            for r in vlan_spec.vlanId:
                if r.start == r.end:
                    ranges.append(str(r.start))
                else:
                    ranges.append(f"{r.start}-{r.end}")
        return ",".join(ranges)
    elif isinstance(vlan_spec, vim.dvs.VmwareDistributedVirtualSwitch.PvlanSpec):
        return f"PVLAN {vlan_spec.pvlanId}"
    return ""

def _policy_value(policy):
    if policy is None:
        return ""
    if hasattr(policy, "value"):
        return policy.value
    return policy


def collect(context: CollectorContext):
    diagnostics = context.diagnostics
    logger = context.logger

    vi_meta = context.shared_data.get("vi_sdk")
    if not vi_meta:
        vi_meta = get_vi_sdk_meta(context.service_instance, context.config.server)
        context.shared_data["vi_sdk"] = vi_meta

    try:
        dvport_items = fetch_objects(
            context.service_instance, vim.dvs.DistributedVirtualPortgroup, DVPORT_PROPERTIES
        )
    except Exception as exc:
        diagnostics.add_error("dvPort", "property_fetch", exc)
        logger.error("Fallo fetching dvPort: %s", exc)
        return []

    # Cache for dvSwitch names
    dvs_names = {}
    
    # Pre-populate dvs names from shared data if available or resolve dynamically
    # Since we have fetch_objects for dvSwitch in another collector, we could use shared_data if ordered correctly.
    # But usually collectors run in parallel or sequence.
    # We'll use a simple cache or resolver logic. InventoryResolver handles Host/Cluster/Datacenter.
    # We can fetch DVS name by resizing referencing config.distributedVirtualSwitch
    
    def resolve_dvs_name(ref):
        if not ref:
            return ""
        if ref in dvs_names:
            return dvs_names[ref]
        try:
            name = ref.name
            dvs_names[ref] = name
            return name
        except:
            return ""

    rows = []

    for item in dvport_items:
        diagnostics.add_attempt("dvPort")
        try:
            props = item.get("props", {})
            name = props.get("name") or ""
            key = props.get("key", "")
            
            dvs_ref = props.get("config.distributedVirtualSwitch")
            dvs_name = resolve_dvs_name(dvs_ref)
            
            num_ports = props.get("config.numPorts", 0)
            pg_type = props.get("config.type", "")
            
            # VLAN
            vlan_str = ""
            default_config = props.get("config.defaultPortConfig")
            if default_config and hasattr(default_config, "vlan"):
                vlan_str = _format_vlan(default_config.vlan)

            allow_promiscuous = ""
            mac_changes = ""
            forged_transmits = ""
            policy = ""
            reverse_policy = ""
            rolling_order = ""
            active_uplink = ""
            standby_uplink = ""

            if default_config:
                security = getattr(default_config, "securityPolicy", None)
                allow_promiscuous = _policy_value(
                    getattr(security, "allowPromiscuous", None)
                )
                mac_changes = _policy_value(getattr(security, "macChanges", None))
                forged_transmits = _policy_value(
                    getattr(security, "forgedTransmits", None)
                )

                uplink = getattr(default_config, "uplinkTeamingPolicy", None)
                policy = _policy_value(getattr(uplink, "policy", None))
                reverse_policy = _policy_value(getattr(uplink, "reversePolicy", None))
                rolling_order = _policy_value(getattr(uplink, "rollingOrder", None))
                order = getattr(uplink, "uplinkPortOrder", None)
                if order is not None:
                    active = getattr(order, "activeUplinkPort", None) or []
                    standby = getattr(order, "standbyUplinkPort", None) or []
                    if isinstance(active, (list, tuple)):
                        active_uplink = ",".join([str(a) for a in active if a])
                    else:
                        active_uplink = str(active)
                    if isinstance(standby, (list, tuple)):
                        standby_uplink = ",".join([str(s) for s in standby if s])
                    else:
                        standby_uplink = str(standby)

            rows.append({
                "dvSwitch": dvs_name,
                "PortGroup": name,
                "VLAN": vlan_str,
                "PortKey": key,
                "PortName": "", # Usually same as PortGroup for the group itself
                "Connectee": "", 
                "Connected": "",
                "Type": pg_type,
                "Host": "", # Many hosts, mapped in vHost or vNetwork usually
                "VM": "",
                "NumPorts": num_ports,
                "Allow Promiscuous": allow_promiscuous,
                "Mac Changes": mac_changes,
                "Forged Transmits": forged_transmits,
                "Policy": policy,
                "Active Uplink": active_uplink,
                "Standby Uplink": standby_uplink,
                "Reverse Policy": reverse_policy,
                "Rolling Order": rolling_order,
                "VI SDK Server": "",
                "VI SDK UUID": "",
            })
            apply_vm_meta(rows[-1], None, vi_meta)
            diagnostics.add_success("dvPort")
        except Exception as exc:
            diagnostics.add_error("dvPort", name, exc)

    return rows
