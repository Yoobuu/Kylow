from __future__ import annotations

from datetime import datetime
from typing import Iterable, List, Optional, TypedDict

from sqlmodel import Session

from app.notifications.models import (
    Notification,
    NotificationMetric,
    NotificationProvider,
    NotificationStatus,
)
from app.notifications.sample_history import history
from .repository import (
    compute_dedupe_key,
    create_if_new,
    mark_cleared_if_recovered,
)
from .utils import ensure_utc, norm_enum


class DiskUsageSample(TypedDict, total=False):
    used_pct: float
    size_gib: float


class VmSample(TypedDict, total=False):
    provider: str
    vm_name: str
    at: datetime
    cpu_pct: float
    ram_pct: float
    disks: List[DiskUsageSample]
    env: str
    vm_id: str


def _provider_enum(value: str | NotificationProvider) -> NotificationProvider:
    if isinstance(value, NotificationProvider):
        return value
    return NotificationProvider(norm_enum(value))


def _sanitize_disks(disks: Optional[Iterable[DiskUsageSample]]) -> Optional[List[dict]]:
    if not disks:
        return None
    sanitized: List[dict] = []
    for disk in disks:
        used = disk.get("used_pct")
        size = disk.get("size_gib")
        entry: dict = {}
        if used is not None:
            entry["used_pct"] = float(used)
        if size is not None:
            entry["size_gib"] = float(size)
        if entry:
            sanitized.append(entry)
    return sanitized or None


def evaluate_vm_sample(sample: VmSample, threshold: float = 85.0) -> List[Notification]:
    """Evaluate a single VM sample and return notifications (not persisted)."""
    return evaluate_batch([sample], threshold=threshold)


def evaluate_batch(samples: Iterable[VmSample], threshold: float = 85.0) -> List[Notification]:
    sample_list = [sample for sample in samples]
    if not sample_list:
        return []

    history.record_samples(sample_list)

    notifications: List[Notification] = []
    seen_cpu: set[tuple[str, str]] = set()
    seen_ram: set[tuple[str, str]] = set()

    for sample in sample_list:
        provider_enum = _provider_enum(sample["provider"])
        vm_name = sample["vm_name"]
        at = ensure_utc(sample["at"])
        env = sample.get("env")
        vm_id = sample.get("vm_id")

        cpu_value = sample.get("cpu_pct")
        cpu_key = (provider_enum.value, vm_name)
        if cpu_value is not None and cpu_key not in seen_cpu:
            avg, last_at, _count = history.get_recent_average(provider_enum.value, vm_name, "cpu", now=at)
            if avg is not None and avg >= threshold:
                metric = NotificationMetric.CPU
                notif_at = last_at or at
                dedupe_key = compute_dedupe_key(provider_enum.value, vm_name, metric.value, notif_at)
                notifications.append(
                    Notification(
                        provider=provider_enum,
                        vm_id=vm_id,
                        vm_name=vm_name,
                        metric=metric,
                        value_pct=float(avg),
                        threshold_pct=threshold,
                        env=env,
                        at=notif_at,
                        status=NotificationStatus.OPEN,
                        dedupe_key=dedupe_key,
                    )
                )
            seen_cpu.add(cpu_key)

        ram_value = sample.get("ram_pct")
        ram_key = (provider_enum.value, vm_name)
        if ram_value is not None and ram_key not in seen_ram:
            avg, last_at, _count = history.get_recent_average(provider_enum.value, vm_name, "ram", now=at)
            if avg is not None and avg >= threshold:
                metric = NotificationMetric.RAM
                notif_at = last_at or at
                dedupe_key = compute_dedupe_key(provider_enum.value, vm_name, metric.value, notif_at)
                notifications.append(
                    Notification(
                        provider=provider_enum,
                        vm_id=vm_id,
                        vm_name=vm_name,
                        metric=metric,
                        value_pct=float(avg),
                        threshold_pct=threshold,
                        env=env,
                        at=notif_at,
                        status=NotificationStatus.OPEN,
                        dedupe_key=dedupe_key,
                    )
                )
            seen_ram.add(ram_key)

        disks = sample.get("disks") or []
        if provider_enum == NotificationProvider.HYPERV and disks:
            used_values = [disk["used_pct"] for disk in disks if disk.get("used_pct") is not None]
            if used_values and min(used_values) >= threshold:
                metric = NotificationMetric.DISK
                dedupe_key = compute_dedupe_key(provider_enum.value, vm_name, metric.value, at)
                notifications.append(
                    Notification(
                        provider=provider_enum,
                        vm_id=vm_id,
                        vm_name=vm_name,
                        metric=metric,
                        value_pct=float(min(used_values)),
                        threshold_pct=threshold,
                        env=env,
                        at=at,
                        status=NotificationStatus.OPEN,
                        disks_json=_sanitize_disks(disks),
                        dedupe_key=dedupe_key,
                    )
                )

    return notifications


def build_observed_keys(samples: Iterable[VmSample], *, record: bool = False) -> set[tuple[str, str, str]]:
    sample_list = [sample for sample in samples]
    if not sample_list:
        return set()
    if record:
        history.record_samples(sample_list)

    observed: set[tuple[str, str, str]] = set()
    for sample in sample_list:
        provider_enum = _provider_enum(sample["provider"])
        vm_name = sample["vm_name"]
        vm_key = vm_name.strip().lower()
        at = ensure_utc(sample["at"])

        if sample.get("cpu_pct") is not None:
            _avg, _last_at, count = history.get_recent_average(provider_enum.value, vm_name, "cpu", now=at)
            if count >= history.min_samples:
                observed.add((provider_enum.value, vm_key, "cpu"))

        if sample.get("ram_pct") is not None:
            _avg, _last_at, count = history.get_recent_average(provider_enum.value, vm_name, "ram", now=at)
            if count >= history.min_samples:
                observed.add((provider_enum.value, vm_key, "ram"))

    return observed


def persist_notifications(session: Session, notifications: Iterable[Notification]) -> dict:
    created = 0
    skipped = 0
    for notif in notifications:
        _, is_new = create_if_new(session, notif)
        if is_new:
            created += 1
        else:
            skipped += 1
    return {"created": created, "skipped": skipped}


def clear_recovered(session: Session, samples: Iterable[VmSample], threshold: float = 85.0) -> int:
    sample_list = [sample for sample in samples]
    if not sample_list:
        return 0

    history.record_samples(sample_list)

    cleared = 0
    seen_cpu: set[tuple[str, str]] = set()
    seen_ram: set[tuple[str, str]] = set()

    for sample in sample_list:
        provider_enum = _provider_enum(sample["provider"])
        vm_name = sample["vm_name"]
        at = ensure_utc(sample["at"])

        cpu_value = sample.get("cpu_pct")
        cpu_key = (provider_enum.value, vm_name)
        if cpu_value is not None and cpu_key not in seen_cpu:
            avg, last_at, _count = history.get_recent_average(provider_enum.value, vm_name, "cpu", now=at)
            if avg is not None and avg < threshold:
                cleared += mark_cleared_if_recovered(
                    session,
                    provider_enum,
                    vm_name,
                    NotificationMetric.CPU,
                    last_at or at,
                    threshold=threshold,
                )
            seen_cpu.add(cpu_key)

        ram_value = sample.get("ram_pct")
        ram_key = (provider_enum.value, vm_name)
        if ram_value is not None and ram_key not in seen_ram:
            avg, last_at, _count = history.get_recent_average(provider_enum.value, vm_name, "ram", now=at)
            if avg is not None and avg < threshold:
                cleared += mark_cleared_if_recovered(
                    session,
                    provider_enum,
                    vm_name,
                    NotificationMetric.RAM,
                    last_at or at,
                    threshold=threshold,
                )
            seen_ram.add(ram_key)

        disks = sample.get("disks") or []
        if provider_enum == NotificationProvider.HYPERV and disks:
            used_values = [disk["used_pct"] for disk in disks if disk.get("used_pct") is not None]
            if used_values and min(used_values) < threshold:
                cleared += mark_cleared_if_recovered(
                    session,
                    provider_enum,
                    vm_name,
                    NotificationMetric.DISK,
                    at,
                    threshold=threshold,
                )

    return cleared
