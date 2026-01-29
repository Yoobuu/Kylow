from __future__ import annotations

from datetime import datetime, timedelta, timezone

from sqlmodel import Session, select

from app.notifications.models import (
    Notification,
    NotificationMetric,
    NotificationProvider,
    NotificationStatus,
)
from app.notifications.sampler import collect_vmware_samples
from app.notifications.sample_history import history
from app.notifications.service import (
    clear_recovered,
    evaluate_batch,
    persist_notifications,
)


def _now() -> datetime:
    return datetime(2024, 1, 1, 10, 30, tzinfo=timezone.utc)


def _reset_history() -> None:
    history.reset()


def _cpu_samples(vm_name: str, values: list[float], *, provider: str = "vmware", start: datetime) -> list[dict]:
    return [
        {
            "provider": provider,
            "vm_name": vm_name,
            "cpu_pct": value,
            "at": start + timedelta(minutes=idx * 10),
        }
        for idx, value in enumerate(values)
    ]


def _ram_samples(vm_name: str, values: list[float], *, provider: str = "vmware", start: datetime) -> list[dict]:
    return [
        {
            "provider": provider,
            "vm_name": vm_name,
            "ram_pct": value,
            "at": start + timedelta(minutes=idx * 10),
        }
        for idx, value in enumerate(values)
    ]


def test_cpu_threshold_creates_notification(session: Session):
    _reset_history()
    samples = _cpu_samples("VM-CPU-85", [85.0, 90.0, 88.0, 86.0], start=_now())
    notifications = evaluate_batch(samples)
    assert len(notifications) == 1
    assert notifications[0].metric == NotificationMetric.CPU

    result = persist_notifications(session, notifications)
    assert result == {"created": 1, "skipped": 0}

    stored = session.exec(select(Notification)).all()
    assert len(stored) == 1
    assert stored[0].provider == NotificationProvider.VMWARE
    assert stored[0].status == NotificationStatus.OPEN


def test_cpu_below_threshold_does_not_create(session: Session):
    _reset_history()
    samples = _cpu_samples("VM-CPU-LOW", [80.0, 82.0, 84.9, 81.0], start=_now())
    notifications = evaluate_batch(samples)
    assert notifications == []


def test_ram_high_creates_notification(session: Session):
    _reset_history()
    samples = _ram_samples("HV-RAM-ALERT", [92.0, 93.0, 95.0, 90.0], provider="hyperv", start=_now())
    notifications = evaluate_batch(samples)
    assert len(notifications) == 1
    assert notifications[0].metric == NotificationMetric.RAM

    result = persist_notifications(session, notifications)
    assert result == {"created": 1, "skipped": 0}


def test_dedupe_same_hour_skips_duplicates(session: Session):
    _reset_history()
    samples = _cpu_samples("VM-DEDUPE", [90.0, 91.0, 92.0, 93.0], start=_now())
    notifications = evaluate_batch(samples)
    first = persist_notifications(session, notifications)
    assert first == {"created": 1, "skipped": 0}

    # Same hour should reuse dedupe key
    notifications_dup = evaluate_batch(samples)
    second = persist_notifications(session, notifications_dup)
    assert second["created"] == 0
    assert second["skipped"] == len(notifications_dup)


def test_disk_rules_for_hyperv(session: Session):
    _reset_history()
    base_sample = {
        "provider": "hyperv",
        "vm_name": "HV-DISK",
        "at": _now(),
    }

    sample_ok = {**base_sample, "disks": [{"used_pct": 100}, {"used_pct": 100}, {"used_pct": 100}, {"used_pct": 40}]}
    assert evaluate_batch([sample_ok]) == []

    sample_alert = {**base_sample, "disks": [{"used_pct": 90}, {"used_pct": 90}, {"used_pct": 90}, {"used_pct": 90}]}
    notifs = evaluate_batch([sample_alert])
    assert len(notifs) == 1
    assert notifs[0].metric == NotificationMetric.DISK

    sample_alert_mixed = {**base_sample, "disks": [{"used_pct": 100}, {"used_pct": 100}, {"used_pct": 100}, {"used_pct": 90}]}
    assert len(evaluate_batch([sample_alert_mixed])) == 1

    sample_no_alert = {**base_sample, "disks": [{"used_pct": 100}, {"used_pct": 100}, {"used_pct": 100}, {"used_pct": 70}]}
    assert evaluate_batch([sample_no_alert]) == []


def test_clear_recovered_updates_status(session: Session):
    _reset_history()
    alert_samples = _cpu_samples("VM-CLEAR", [90.0, 92.0, 88.0, 91.0], start=_now())
    notifications = evaluate_batch(alert_samples)
    persist_notifications(session, notifications)

    stored = session.exec(select(Notification)).one()
    assert stored.status == NotificationStatus.OPEN

    recovered_samples = _cpu_samples(
        "VM-CLEAR",
        [40.0, 42.0, 38.0, 41.0],
        start=_now() + timedelta(hours=1),
    )

    cleared = clear_recovered(session, recovered_samples)
    assert cleared == 1

    refreshed = session.exec(select(Notification)).one()
    assert refreshed.status == NotificationStatus.CLEARED


def test_vmware_sampler_uses_snapshot(session: Session, monkeypatch):
    _reset_history()
    snap_at = datetime(2024, 1, 1, 12, 0, tzinfo=timezone.utc)
    snapshots = [
        {
            "vm_name": "VM-CPU",
            "vm_id": "vm-1",
            "cpu_pct": 90.0,
            "ram_pct": 40.0,
            "env": "PRODUCCION",
            "at": snap_at,
        },
        {
            "vm_name": "VM-RAM",
            "vm_id": "vm-2",
            "cpu_pct": 20.0,
            "ram_pct": 91.0,
            "env": "SANDBOX",
            "at": snap_at,
        },
        {
            "vm_name": "VM-NO-ALERT",
            "vm_id": "vm-3",
            "cpu_pct": 10.0,
            "ram_pct": 30.0,
            "env": "DEV",
            "at": snap_at,
        },
    ]

    monkeypatch.setattr(
        "app.notifications.sampler.fetch_vmware_snapshot",
        lambda refresh: snapshots,
    )

    samples = collect_vmware_samples(refresh=False)
    assert len(samples) == len(snapshots)

    notifications = []
    for idx in range(4):
        shifted = []
        for item in samples:
            clone = dict(item)
            clone["at"] = snap_at + timedelta(minutes=idx * 10)
            shifted.append(clone)
        notifications = evaluate_batch(shifted)
    metrics = {notif.metric for notif in notifications}
    assert metrics == {NotificationMetric.CPU, NotificationMetric.RAM}

    result = persist_notifications(session, notifications)
    assert result == {"created": 2, "skipped": 0}

    stored = session.exec(select(Notification)).all()
    dedupe_keys = {notif.dedupe_key for notif in stored}
    assert "vmware:VM-CPU:cpu:2024-01-01T12" in dedupe_keys
    assert "vmware:VM-RAM:ram:2024-01-01T12" in dedupe_keys

    recovery_samples = []
    for idx in range(4):
        recovery_samples.extend(
            [
                {
                    "provider": "vmware",
                    "vm_name": "VM-CPU",
                    "cpu_pct": 10.0,
                    "at": snap_at + timedelta(hours=1, minutes=idx * 10),
                },
                {
                    "provider": "vmware",
                    "vm_name": "VM-RAM",
                    "ram_pct": 10.0,
                    "at": snap_at + timedelta(hours=1, minutes=idx * 10),
                },
            ]
        )

    cleared = clear_recovered(session, recovery_samples)
    assert cleared == 2

    refreshed = session.exec(select(Notification)).all()
    assert all(n.status == NotificationStatus.CLEARED for n in refreshed)
