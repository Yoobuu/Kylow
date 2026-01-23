from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Dict, List, Optional

from app.notifications.service import VmSample
from app.providers.hyperv.remote import HostUnreachableError, RemoteCreds
from app.providers.hyperv.schema import DiskInfo, VMRecord
from app.vms.hyperv_router import _load_ps_content
from app.vms.hyperv_service import collect_hyperv_inventory_for_host
from app.vms.vm_service import fetch_vmware_snapshot
from app.settings import settings

logger = logging.getLogger(__name__)


def _now_utc() -> datetime:
    return datetime.now(timezone.utc)


def _normalize_hyperv_env(value: Optional[str]) -> Optional[str]:
    if not value:
        return None
    return value.strip().upper()


def _normalize_disk_info(disk: DiskInfo | Dict) -> Dict:
    used = getattr(disk, "AllocatedPct", None)
    if used is None and isinstance(disk, dict):
        used = disk.get("AllocatedPct") or disk.get("allocated_pct")

    size = getattr(disk, "SizeGiB", None)
    if size is None and isinstance(disk, dict):
        size = disk.get("SizeGiB") or disk.get("size_gib")

    entry: Dict = {}
    if used is not None:
        entry["used_pct"] = float(used)
    if size is not None:
        entry["size_gib"] = float(size)
    return entry


def _build_hyperv_sample(record: VMRecord, observed_at: datetime) -> VmSample:
    sample: VmSample = {
        "provider": "hyperv",
        "vm_name": record.Name,
        "at": observed_at,
        "env": _normalize_hyperv_env(record.Cluster or record.HVHost),
    }
    if record.CPU_UsagePct is not None:
        sample["cpu_pct"] = float(record.CPU_UsagePct)
    if record.RAM_UsagePct is not None:
        sample["ram_pct"] = float(record.RAM_UsagePct)
    if record.Disks:
        disks = [_normalize_disk_info(d) for d in record.Disks]
        sample["disks"] = [disk for disk in disks if disk]
    return sample


def _collect_hyperv_for_host(host: str, refresh: bool, ps_content: str, observed_at: datetime) -> List[VmSample]:
    creds = RemoteCreds(
        host=host,
        username=settings.hyperv_user,
        password=settings.hyperv_pass,
        transport=settings.hyperv_transport,
        use_winrm=True,
        connect_timeout=settings.hyperv_connect_timeout,
    )
    try:
        records = collect_hyperv_inventory_for_host(
            creds,
            ps_content=ps_content,
            use_cache=not refresh,
        )
    except HostUnreachableError:
        logger.warning("Hyper-V host unreachable for sampler: %s", host)
        return []
    except Exception as exc:  # broad to ensure scheduler continues
        logger.warning("Unable to collect Hyper-V inventory for host %s: %s", host, exc)
        return []

    return [_build_hyperv_sample(record, observed_at) for record in records]


def collect_hyperv_samples(refresh: bool) -> List[VmSample]:
    if settings.test_mode:
        return []
    host_list = settings.hyperv_hosts_configured

    if not host_list:
        return []

    try:
        ps_content = _load_ps_content()
    except Exception as exc:
        logger.warning("Unable to load Hyper-V PowerShell script: %s", exc)
        return []

    samples: List[VmSample] = []
    observed_at = _now_utc()
    for host in host_list:
        samples.extend(
            _collect_hyperv_for_host(
                host,
                refresh=refresh,
                ps_content=ps_content,
                observed_at=observed_at,
            )
        )
    return samples


def collect_vmware_samples(refresh: bool) -> List[VmSample]:
    if settings.test_mode:
        return []
    try:
        snapshots = fetch_vmware_snapshot(refresh=refresh)
    except Exception as exc:
        logger.warning("Unable to collect VMware snapshot: %s", exc)
        return []

    now = _now_utc()
    samples: List[VmSample] = []
    for vm in snapshots:
        vm_name = vm.get("vm_name") or vm.get("name")
        if not vm_name:
            continue
        at_value = vm.get("at")
        if isinstance(at_value, datetime):
            at_ts = at_value if at_value.tzinfo else at_value.replace(tzinfo=timezone.utc)
        else:
            at_ts = now

        samples.append(
            {
                "provider": "vmware",
                "vm_name": vm_name,
                "cpu_pct": vm.get("cpu_pct"),
                "ram_pct": vm.get("ram_pct"),
                "disks": None,
                "env": vm.get("env") or vm.get("environment"),
                "at": at_ts,
                "vm_id": vm.get("vm_id") or vm.get("id"),
            }
        )

    return samples


def collect_all_samples(refresh: bool = True) -> List[VmSample]:
    vmware_samples = collect_vmware_samples(refresh=refresh)
    hyperv_samples = collect_hyperv_samples(refresh=refresh)
    return vmware_samples + hyperv_samples
