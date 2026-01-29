from datetime import datetime, timedelta

from app.ai.snapshots.query import flatten_vms_snapshot, snapshot_meta
from app.vms.vmware_jobs.models import SnapshotPayload, ScopeName


def _fake_payload():
    now = datetime.utcnow()
    return SnapshotPayload(
        scope=ScopeName.VMS,
        hosts=["h1", "h2"],
        level="summary",
        generated_at=now - timedelta(minutes=7),
        data={
            "h1": [{"id": "vm1"}, {"id": "vm2"}],
            "h2": [{"id": "vm3"}],
        },
    )


def test_flatten_vms_snapshot():
    payload = _fake_payload()
    items = flatten_vms_snapshot(payload)
    assert len(items) == 3
    assert {i.get("id") for i in items} == {"vm1", "vm2", "vm3"}


def test_snapshot_meta_age_and_stale():
    payload = _fake_payload()
    meta = snapshot_meta(payload)
    assert meta["generated_at"] == payload.generated_at
    assert isinstance(meta["age_min"], int)
    assert meta["age_min"] >= 6
    assert meta["stale"] is False
