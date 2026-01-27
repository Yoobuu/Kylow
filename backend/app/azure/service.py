from __future__ import annotations

import logging
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Any, Dict, List, Optional, Tuple

from fastapi import HTTPException

from app.azure.arm_client import AzureArmClient
from app.azure.models import AzureVMRecord
from app.settings import settings

logger = logging.getLogger(__name__)

_MAX_WORKERS = 6
_VM_SIZE_CACHE: Dict[str, Dict[str, Dict[str, Any]]] = {}
_PUBLIC_IP_CACHE: Dict[str, Dict[str, Any]] = {}


def _extract_resource_group(resource_id: Optional[str]) -> Optional[str]:
    if not resource_id:
        return None
    parts = [p for p in str(resource_id).strip("/").split("/") if p]
    for idx, part in enumerate(parts):
        if part.lower() == "resourcegroups" and idx + 1 < len(parts):
            return parts[idx + 1]
    return None


def _map_power_state(code: Optional[str]) -> Optional[str]:
    if not code:
        return None
    raw = code.split("/", 1)[1] if "/" in code else code
    value = raw.strip().lower()
    if value in {"running", "starting"}:
        return "POWERED_ON"
    if value in {"stopped", "stopping", "deallocated", "deallocating"}:
        return "POWERED_OFF"
    if value in {"suspended", "suspending"}:
        return "SUSPENDED"
    if not value:
        return None
    return value.upper()


def _extract_resource_name(resource_id: Optional[str]) -> Optional[str]:
    if not resource_id:
        return None
    parts = [p for p in str(resource_id).strip("/").split("/") if p]
    return parts[-1] if parts else None


def _parse_subnet_name(subnet_id: Optional[str]) -> Optional[str]:
    if not subnet_id:
        return None
    parts = [p for p in str(subnet_id).strip("/").split("/") if p]
    vnet = None
    subnet = None
    for idx, part in enumerate(parts):
        if part.lower() == "virtualnetworks" and idx + 1 < len(parts):
            vnet = parts[idx + 1]
        if part.lower() == "subnets" and idx + 1 < len(parts):
            subnet = parts[idx + 1]
    if vnet and subnet:
        return f"{vnet}/{subnet}"
    return subnet or vnet


def _build_disk_entries(storage: Dict[str, Any]) -> List[Dict[str, object]]:
    disks: List[Dict[str, object]] = []
    if not isinstance(storage, dict):
        return disks
    os_disk = storage.get("osDisk") or {}
    if isinstance(os_disk, dict) and os_disk:
        name = os_disk.get("name") or "osdisk"
        size = os_disk.get("diskSizeGB")
        disk_type = (
            os_disk.get("managedDisk", {}).get("storageAccountType")
            if isinstance(os_disk.get("managedDisk"), dict)
            else None
        )
        type_label = f" {disk_type}" if disk_type else ""
        text = f"{name}{type_label} ({size} GiB)" if size else str(name)
        disks.append(
            {
                "text": text,
                "sizeGiB": size,
                "allocatedGiB": size,
                "diskType": disk_type,
            }
        )
    data_disks = storage.get("dataDisks") or []
    if isinstance(data_disks, list):
        for disk in data_disks:
            if not isinstance(disk, dict):
                continue
            name = disk.get("name") or "data"
            size = disk.get("diskSizeGB")
            disk_type = (
                disk.get("managedDisk", {}).get("storageAccountType")
                if isinstance(disk.get("managedDisk"), dict)
                else None
            )
            type_label = f" {disk_type}" if disk_type else ""
            text = f"{name}{type_label} ({size} GiB)" if size else str(name)
            disks.append(
                {
                    "text": text,
                    "sizeGiB": size,
                    "allocatedGiB": size,
                    "diskType": disk_type,
                }
            )
    return disks


def _build_vm_record(vm: Dict[str, Any]) -> AzureVMRecord:
    props = vm.get("properties") or {}
    hardware = props.get("hardwareProfile") or {}
    storage = props.get("storageProfile") or {}
    os_disk = storage.get("osDisk") or {}
    network_profile = props.get("networkProfile") or {}
    nic_entries = network_profile.get("networkInterfaces") or []

    nic_ids: List[str] = []
    if isinstance(nic_entries, list):
        for nic in nic_entries:
            if isinstance(nic, dict):
                nic_id = nic.get("id")
                if nic_id:
                    nic_ids.append(str(nic_id))

    vm_id = vm.get("id") or ""
    name = vm.get("name") or ""
    resource_group = _extract_resource_group(vm_id)
    disks = _build_disk_entries(storage)

    zones = vm.get("zones") if isinstance(vm.get("zones"), list) else []
    return AzureVMRecord(
        id=str(vm_id),
        name=str(name),
        subscription_id=settings.azure_subscription_id,
        resource_group=resource_group,
        location=vm.get("location"),
        zones=[str(z) for z in zones if z is not None],
        power_state=None,
        power_state_display=None,
        power_state_code=None,
        vm_size=hardware.get("vmSize"),
        os_type=os_disk.get("osType"),
        guest_os=os_disk.get("osType"),
        provisioning_state=props.get("provisioningState"),
        tags=vm.get("tags") if isinstance(vm.get("tags"), dict) else None,
        nic_ids=nic_ids,
        disks=disks,
        time_created=props.get("timeCreated"),
    )


def _instance_view_power_state(
    payload: Dict[str, Any],
) -> Tuple[Optional[str], Optional[str], Optional[str], Optional[str], Optional[str]]:
    statuses = payload.get("statuses") if isinstance(payload, dict) else None
    if not isinstance(statuses, list):
        return None, None, None, None, None
    for status in statuses:
        if not isinstance(status, dict):
            continue
        code = status.get("code")
        if isinstance(code, str) and code.startswith("PowerState/"):
            display = status.get("displayStatus")
            power_state = _map_power_state(code)
            vm_agent = payload.get("vmAgent") if isinstance(payload, dict) else None
            agent_status = None
            agent_version = None
            if isinstance(vm_agent, dict):
                agent_version = vm_agent.get("vmAgentVersion")
                agent_statuses = vm_agent.get("statuses")
                if isinstance(agent_statuses, list):
                    for st in agent_statuses:
                        if isinstance(st, dict):
                            display_status = st.get("displayStatus")
                            if display_status:
                                agent_status = display_status
                                break
            return power_state, display, code, agent_status, agent_version
    return None, None, None, None, None


def _list_vms_by_resource_group(client: AzureArmClient, resource_group: str) -> List[dict]:
    sub = settings.azure_subscription_id or ""
    path = f"/subscriptions/{sub}/resourceGroups/{resource_group}/providers/Microsoft.Compute/virtualMachines"
    params = {"api-version": client.compute_api_version}
    return client.arm_get_paged(path, params=params)


def _list_vms_by_subscription(client: AzureArmClient) -> List[dict]:
    sub = settings.azure_subscription_id or ""
    path = f"/subscriptions/{sub}/providers/Microsoft.Compute/virtualMachines"
    params = {"api-version": client.compute_api_version}
    return client.arm_get_paged(path, params=params)


def _fetch_instance_view(client: AzureArmClient, resource_group: str, vm_name: str) -> Dict[str, Any]:
    sub = settings.azure_subscription_id or ""
    path = (
        f"/subscriptions/{sub}/resourceGroups/{resource_group}"
        f"/providers/Microsoft.Compute/virtualMachines/{vm_name}/instanceView"
    )
    params = {"api-version": client.compute_api_version}
    return client.arm_get(path, params=params)


def _fetch_vm_sizes(client: AzureArmClient, location: str) -> Dict[str, Dict[str, Any]]:
    if location in _VM_SIZE_CACHE:
        return _VM_SIZE_CACHE[location]
    sub = settings.azure_subscription_id or ""
    path = f"/subscriptions/{sub}/providers/Microsoft.Compute/locations/{location}/vmSizes"
    params = {"api-version": client.compute_api_version}
    payload = client.arm_get(path, params=params)
    sizes = payload.get("value") if isinstance(payload, dict) else []
    size_map: Dict[str, Dict[str, Any]] = {}
    if isinstance(sizes, list):
        for entry in sizes:
            if not isinstance(entry, dict):
                continue
            name = entry.get("name")
            if name:
                size_map[str(name)] = entry
    _VM_SIZE_CACHE[location] = size_map
    return size_map


def _fetch_nic(client: AzureArmClient, nic_id: str) -> Dict[str, Any]:
    return client.arm_get(nic_id, params={"api-version": client.network_api_version})


def _extract_nic_data(nic_payload: Dict[str, Any]) -> Tuple[List[str], List[str], List[str], List[str]]:
    nics: List[str] = []
    ip_addresses: List[str] = []
    networks: List[str] = []
    public_ip_ids: List[str] = []
    if not isinstance(nic_payload, dict):
        return nics, ip_addresses, networks, public_ip_ids
    nic_name = nic_payload.get("name") or _extract_resource_name(nic_payload.get("id"))
    if nic_name:
        nics.append(str(nic_name))
    props = nic_payload.get("properties") or {}
    ip_configs = props.get("ipConfigurations") or []
    if isinstance(ip_configs, list):
        for entry in ip_configs:
            if not isinstance(entry, dict):
                continue
            ip_props = entry.get("properties") or {}
            private_ip = ip_props.get("privateIPAddress")
            if private_ip:
                ip_addresses.append(str(private_ip))
            subnet_id = None
            subnet = ip_props.get("subnet")
            if isinstance(subnet, dict):
                subnet_id = subnet.get("id")
            network_name = _parse_subnet_name(subnet_id)
            if network_name:
                networks.append(network_name)
            public_ip = ip_props.get("publicIPAddress")
            if isinstance(public_ip, dict):
                public_id = public_ip.get("id")
                if public_id:
                    public_ip_ids.append(str(public_id))
    return nics, ip_addresses, networks, public_ip_ids


def _fetch_public_ip(client: AzureArmClient, public_ip_id: str) -> Dict[str, Any]:
    if public_ip_id in _PUBLIC_IP_CACHE:
        return _PUBLIC_IP_CACHE[public_ip_id]
    payload = client.arm_get(public_ip_id, params={"api-version": client.network_api_version})
    if isinstance(payload, dict):
        _PUBLIC_IP_CACHE[public_ip_id] = payload
    return payload


def _extract_public_ip_data(payload: Dict[str, Any]) -> Tuple[Optional[str], Optional[str]]:
    if not isinstance(payload, dict):
        return None, None
    props = payload.get("properties") or {}
    ip_address = props.get("ipAddress")
    dns = None
    dns_settings = props.get("dnsSettings")
    if isinstance(dns_settings, dict):
        dns = dns_settings.get("fqdn") or dns_settings.get("domainNameLabel")
    return ip_address, dns


def list_azure_vms(*, include_power_state: bool = False) -> List[AzureVMRecord]:
    if settings.test_mode:
        return []
    client = AzureArmClient()
    if not settings.azure_configured:
        raise HTTPException(
            status_code=500,
            detail={"detail": "Azure configuration incomplete", "missing": settings.azure_missing_envs},
        )

    # Always list at subscription scope to include all resource groups.
    raw_vms = _list_vms_by_subscription(client)

    records = [_build_vm_record(vm) for vm in raw_vms if isinstance(vm, dict)]

    if records:
        # Enrich with size-based CPU/RAM for each location.
        locations = {rec.location for rec in records if rec.location}
        size_maps: Dict[str, Dict[str, Dict[str, Any]]] = {}
        for loc in locations:
            try:
                size_maps[loc] = _fetch_vm_sizes(client, str(loc))
            except HTTPException as exc:
                logger.warning("Azure vmSizes failed for %s: %s", loc, exc.detail)
            except Exception as exc:
                logger.warning("Azure vmSizes failed for %s: %s", loc, exc)

        for rec in records:
            size_name = rec.vm_size
            size_map = size_maps.get(rec.location or "", {})
            size_entry = size_map.get(size_name or "") if size_name else None
            if size_entry:
                cores = size_entry.get("numberOfCores")
                mem_mb = size_entry.get("memoryInMB")
                rec.cpu_count = int(cores) if isinstance(cores, (int, float)) else None
                rec.memory_size_MiB = int(mem_mb) if isinstance(mem_mb, (int, float)) else None

        # Enrich with NIC/IP/network data.
        nic_ids = {nid for rec in records for nid in rec.nic_ids if nid}
        nic_map: Dict[str, Dict[str, Any]] = {}
        if nic_ids:
            max_workers = min(_MAX_WORKERS, len(nic_ids))
            if max_workers <= 1:
                for nic_id in nic_ids:
                    try:
                        nic_map[nic_id] = _fetch_nic(client, nic_id)
                    except HTTPException as exc:
                        logger.warning("Azure NIC fetch failed for %s: %s", nic_id, exc.detail)
                    except Exception as exc:
                        logger.warning("Azure NIC fetch failed for %s: %s", nic_id, exc)
            else:
                with ThreadPoolExecutor(max_workers=max_workers) as ex:
                    futures = {ex.submit(_fetch_nic, client, nic_id): nic_id for nic_id in nic_ids}
                    for fut in as_completed(futures):
                        nic_id = futures[fut]
                        try:
                            nic_map[nic_id] = fut.result()
                        except HTTPException as exc:
                            logger.warning("Azure NIC fetch failed for %s: %s", nic_id, exc.detail)
                        except Exception as exc:
                            logger.warning("Azure NIC fetch failed for %s: %s", nic_id, exc)

        for rec in records:
            nics: List[str] = []
            ip_addresses: List[str] = []
            networks: List[str] = []
            for nic_id in rec.nic_ids:
                payload = nic_map.get(nic_id)
                if not payload:
                    continue
                nic_names, ips, nets, _ = _extract_nic_data(payload)
                nics.extend(nic_names)
                ip_addresses.extend(ips)
                networks.extend(nets)
            rec.nics = sorted({n for n in nics if n})
            rec.ip_addresses = sorted({ip for ip in ip_addresses if ip})
            rec.networks = sorted({net for net in networks if net})

        public_ip_ids: set[str] = set()
        nic_public_map: Dict[str, List[str]] = {}
        if nic_ids:
            for nic_id, payload in nic_map.items():
                _, _, _, public_ids = _extract_nic_data(payload)
                if public_ids:
                    nic_public_map[nic_id] = public_ids
                    public_ip_ids.update(public_ids)

        public_ip_map: Dict[str, Dict[str, Any]] = {}
        if public_ip_ids:
            max_workers = min(_MAX_WORKERS, len(public_ip_ids))
            if max_workers <= 1:
                for public_id in public_ip_ids:
                    try:
                        public_ip_map[public_id] = _fetch_public_ip(client, public_id)
                    except HTTPException as exc:
                        logger.warning("Azure public IP fetch failed for %s: %s", public_id, exc.detail)
                    except Exception as exc:
                        logger.warning("Azure public IP fetch failed for %s: %s", public_id, exc)
            else:
                with ThreadPoolExecutor(max_workers=max_workers) as ex:
                    futures = {ex.submit(_fetch_public_ip, client, public_id): public_id for public_id in public_ip_ids}
                    for fut in as_completed(futures):
                        public_id = futures[fut]
                        try:
                            public_ip_map[public_id] = fut.result()
                        except HTTPException as exc:
                            logger.warning("Azure public IP fetch failed for %s: %s", public_id, exc.detail)
                        except Exception as exc:
                            logger.warning("Azure public IP fetch failed for %s: %s", public_id, exc)

        for rec in records:
            public_ips: List[str] = []
            public_dns: List[str] = []
            for nic_id in rec.nic_ids:
                for public_id in nic_public_map.get(nic_id, []):
                    payload = public_ip_map.get(public_id)
                    if not payload:
                        continue
                    ip, dns = _extract_public_ip_data(payload)
                    if ip:
                        public_ips.append(str(ip))
                    if dns:
                        public_dns.append(str(dns))
            rec.public_ips = sorted({ip for ip in public_ips if ip})
            rec.public_dns = sorted({dns for dns in public_dns if dns})

    if not include_power_state or not records:
        return records

    def _worker(
        index: int,
        record: AzureVMRecord,
    ) -> Tuple[int, Optional[str], Optional[str], Optional[str], Optional[str], Optional[str]]:
        if not record.resource_group or not record.name:
            return index, None, None, None, None, None
        payload = _fetch_instance_view(client, record.resource_group, record.name)
        return (index, *_instance_view_power_state(payload))

    max_workers = min(_MAX_WORKERS, len(records))
    if max_workers <= 1:
        for idx, rec in enumerate(records):
            try:
                if not rec.resource_group or not rec.name:
                    continue
                state, display, code, agent_status, agent_version = _instance_view_power_state(
                    _fetch_instance_view(client, rec.resource_group, rec.name)
                )
                rec.power_state = state
                rec.power_state_display = display
                rec.power_state_code = code
                rec.vm_agent_status = agent_status
                rec.vm_agent_version = agent_version
            except HTTPException as exc:
                logger.warning("Azure instanceView failed for %s: %s", rec.name, exc.detail)
            except Exception as exc:
                logger.warning("Azure instanceView failed for %s: %s", rec.name, exc)
        return records

    with ThreadPoolExecutor(max_workers=max_workers) as ex:
        futures = {ex.submit(_worker, idx, rec): idx for idx, rec in enumerate(records)}
        for fut in as_completed(futures):
            idx = futures[fut]
            try:
                _, state, display, code, agent_status, agent_version = fut.result()
                rec = records[idx]
                rec.power_state = state
                rec.power_state_display = display
                rec.power_state_code = code
                rec.vm_agent_status = agent_status
                rec.vm_agent_version = agent_version
            except HTTPException as exc:
                rec = records[idx]
                logger.warning("Azure instanceView failed for %s: %s", rec.name, exc.detail)
            except Exception as exc:
                rec = records[idx]
                logger.warning("Azure instanceView failed for %s: %s", rec.name, exc)

    return records
