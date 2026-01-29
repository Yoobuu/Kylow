from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Dict, Iterable, List, Optional

from app.notifications.service import VmSample
from app.ai.snapshots.query import get_latest_snapshot, flatten_vms_snapshot
from app.providers.hyperv.remote import HostUnreachableError, RemoteCreds
from app.providers.hyperv.schema import DiskInfo, VMRecord
from app.vms.hyperv_router import _load_ps_content
from app.vms.hyperv_service import collect_hyperv_inventory_for_host
from app.vms.vm_service import fetch_vmware_snapshot
from app.settings import settings
from app.notifications.utils import ensure_utc

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


def _as_float(value) -> Optional[float]:
    if value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _extract_snapshot_items(payload) -> Iterable[dict]:
    if payload is None:
        return []
    try:
        return flatten_vms_snapshot(payload)
    except Exception:
        return []


def _extract_cedia_id(record: dict) -> Optional[str]:
    vm_id = record.get("id")
    if vm_id:
        return str(vm_id)
    href = record.get("href")
    if isinstance(href, str) and href:
        return href.rstrip("/").split("/")[-1]
    return None


def _coerce_datetime(value: object, fallback: datetime) -> datetime:
    if isinstance(value, datetime):
        return ensure_utc(value)
    if isinstance(value, str) and value:
        try:
            parsed = datetime.fromisoformat(value)
            return ensure_utc(parsed)
        except ValueError:
            return fallback
    return fallback


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
        winrm_https_enabled=settings.hyperv_winrm_https_enabled,
        winrm_http_enabled=settings.hyperv_winrm_http_enabled,
        use_winrm=True,
        ca_trust_path=settings.hyperv_ca_bundle,
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


def collect_ovirt_samples(refresh: bool) -> List[VmSample]:
    if settings.test_mode:
        return []
    if not settings.ovirt_enabled or not settings.ovirt_configured:
        return []
    try:
        payload = get_latest_snapshot(provider="ovirt", scope="vms", level="summary")
    except Exception as exc:
        logger.warning("Unable to load oVirt snapshot: %s", exc)
        return []
    if payload is None:
        return []

    observed_at = _coerce_datetime(getattr(payload, "generated_at", None), _now_utc())
    samples: List[VmSample] = []
    for item in _extract_snapshot_items(payload):
        if not isinstance(item, dict):
            continue
        name = item.get("name") or item.get("vm_name")
        if not name:
            continue
        cpu_pct = _as_float(item.get("cpu_usage_pct"))
        ram_pct = _as_float(item.get("ram_usage_pct"))
        if cpu_pct is None and ram_pct is None:
            continue
        samples.append(
            {
                "provider": "ovirt",
                "vm_name": str(name),
                "vm_id": str(item.get("id")) if item.get("id") is not None else None,
                "cpu_pct": cpu_pct,
                "ram_pct": ram_pct,
                "env": item.get("environment") or item.get("env"),
                "at": observed_at,
            }
        )
    return samples


def collect_cedia_samples(refresh: bool) -> List[VmSample]:
    if settings.test_mode:
        return []
    if not settings.cedia_enabled or not settings.cedia_configured:
        return []
    try:
        payload = get_latest_snapshot(provider="cedia", scope="vms", level="summary")
    except Exception as exc:
        logger.warning("Unable to load Cedia snapshot: %s", exc)
        return []
    if payload is None:
        return []

    snapshot_at = _coerce_datetime(getattr(payload, "generated_at", None), _now_utc())
    samples: List[VmSample] = []
    for item in _extract_snapshot_items(payload):
        if not isinstance(item, dict):
            continue
        name = item.get("name") or item.get("Name") or item.get("vm_name")
        if not name:
            continue
        cpu_pct = _as_float(item.get("cpu_pct")) or _as_float(item.get("cpuPct"))
        ram_pct = _as_float(item.get("mem_pct")) or _as_float(item.get("memPct"))
        if cpu_pct is None and ram_pct is None:
            continue
        observed_at = _coerce_datetime(item.get("metrics_updated_at"), snapshot_at)
        samples.append(
            {
                "provider": "cedia",
                "vm_name": str(name),
                "vm_id": _extract_cedia_id(item),
                "cpu_pct": cpu_pct,
                "ram_pct": ram_pct,
                "env": item.get("orgName") or item.get("environment") or item.get("env"),
                "at": observed_at,
            }
        )
    return samples


def collect_all_samples(refresh: bool = True) -> List[VmSample]:
    vmware_samples = collect_vmware_samples(refresh=refresh)
    hyperv_samples = collect_hyperv_samples(refresh=refresh)
    ovirt_samples = collect_ovirt_samples(refresh=refresh)
    cedia_samples = collect_cedia_samples(refresh=refresh)
    return vmware_samples + hyperv_samples + ovirt_samples + cedia_samples
