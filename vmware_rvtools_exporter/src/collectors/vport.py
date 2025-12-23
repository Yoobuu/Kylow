from pyVmomi import vim

from .context import CollectorContext
from ..resolvers import InventoryResolver
from ..utils.vm_meta import apply_vm_meta, get_vi_sdk_meta


def collect(context: CollectorContext):
    diagnostics = context.diagnostics
    logger = context.logger

    vi_meta = context.shared_data.get("vi_sdk")
    if not vi_meta:
        vi_meta = get_vi_sdk_meta(context.service_instance, context.config.server)
        context.shared_data["vi_sdk"] = vi_meta

    host_items = context.shared_data.get("hosts", [])
    if not host_items:
        logger.warning("No hosts found in shared_data for vPort. Did vHost collector run?")
        return []

    resolver = InventoryResolver(context.service_instance, logger=logger)
    rows = []

    for item in host_items:
        host_name = item.get("props", {}).get("name", "")
        host_ref = item.get("ref")
        
        cluster = resolver.resolve_cluster_name(host_ref)
        datacenter = resolver.resolve_datacenter_name(host_ref)

        portgroups = item.get("props", {}).get("config.network.portgroup")
        if not portgroups:
            continue

        for pg in portgroups:
            diagnostics.add_attempt("vPort")
            pg_name = "unknown"
            try:
                if not hasattr(pg, "spec"):
                    continue
                
                pg_name = pg.spec.name
                vswitch_name = pg.spec.vswitchName
                vlan_id = pg.spec.vlanId
                
                policy = pg.spec.policy
                
                promiscuous = ""
                mac_changes = ""
                forged_transmits = ""
                shaping = ""
                
                if policy:
                    if hasattr(policy, "security") and policy.security:
                        promiscuous = str(policy.security.allowPromiscuous)
                        mac_changes = str(policy.security.macChanges)
                        forged_transmits = str(policy.security.forgedTransmits)
                    
                    if hasattr(policy, "shaping") and policy.shaping:
                        shaping = str(policy.shaping.enabled)

                rows.append({
                    "Host": host_name,
                    "Cluster": cluster,
                    "Datacenter": datacenter,
                    "PortGroup": pg_name,
                    "vSwitch": vswitch_name,
                    "VLAN": vlan_id,
                    "Promiscuous": promiscuous,
                    "MACChanges": mac_changes,
                    "ForgedTransmits": forged_transmits,
                    "TrafficShaping": shaping,
                })
                apply_vm_meta(rows[-1], None, vi_meta)
                diagnostics.add_success("vPort")
            except Exception as exc:
                diagnostics.add_error("vPort", f"{host_name}:{pg_name}", exc)

    return rows
