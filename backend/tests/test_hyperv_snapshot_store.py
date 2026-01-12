from app.vms.hyperv_host_models import HyperVHostSummary
from app.vms.hyperv_jobs.models import ScopeKey, ScopeName, SnapshotHostState, SnapshotHostStatus
from app.vms.hyperv_jobs.stores import SnapshotStore


def _ok_status() -> SnapshotHostStatus:
    return SnapshotHostStatus(state=SnapshotHostState.OK)


def test_upsert_host_replaces_pydantic_items():
    store = SnapshotStore()
    store._persist_snapshot = lambda *args, **kwargs: None
    scope_key = ScopeKey.from_parts(ScopeName.HOSTS, ["p-hyp-01"], "summary")

    first = HyperVHostSummary(host="p-hyp-01", total_vms=1)
    store.upsert_host(scope_key, "P-HYP-01", data=first, status=_ok_status())

    second = HyperVHostSummary(host="p-hyp-01", total_vms=2)
    store.upsert_host(scope_key, "p-hyp-01", data=second, status=_ok_status())

    snap = store.get_snapshot(scope_key)
    assert isinstance(snap.data, list)
    assert len(snap.data) == 1
    assert getattr(snap.data[0], "total_vms") == 2


def test_upsert_host_replaces_dict_items():
    store = SnapshotStore()
    store._persist_snapshot = lambda *args, **kwargs: None
    scope_key = ScopeKey.from_parts(ScopeName.HOSTS, ["p-hyp-01"], "summary")

    first = {"host": "p-hyp-01", "total_vms": 1}
    store.upsert_host(scope_key, "p-hyp-01", data=first, status=_ok_status())

    second = {"host": "P-HYP-01", "total_vms": 2}
    store.upsert_host(scope_key, "p-hyp-01", data=second, status=_ok_status())

    snap = store.get_snapshot(scope_key)
    assert isinstance(snap.data, list)
    assert len(snap.data) == 1
    assert snap.data[0]["total_vms"] == 2
