from __future__ import annotations

from datetime import datetime, timezone
from typing import Dict, List, Optional

from sqlmodel import Session, select

from app.db import get_engine
from app.snapshots.models import SnapshotRecord
from app.snapshots.service import make_hosts_key
from app.vms.vmware_jobs.models import SnapshotPayload


def _scope_value(scope: object) -> str:
    if hasattr(scope, "value"):
        return str(getattr(scope, "value"))
    return str(scope)


def _payload_to_snapshot(payload: dict) -> SnapshotPayload:
    if hasattr(SnapshotPayload, "model_validate"):
        return SnapshotPayload.model_validate(payload)
    return SnapshotPayload.parse_obj(payload)


def get_latest_snapshot(
    provider: str,
    scope: str,
    level: Optional[str] = None,
    hosts: Optional[List[str]] = None,
) -> Optional[SnapshotPayload]:
    """
    Fetch the newest snapshot for the given provider/scope and optional level/hosts.
    """
    if not provider or not scope:
        return None

    query = select(SnapshotRecord).where(
        SnapshotRecord.provider == provider,
        SnapshotRecord.scope == scope,
    )

    if level:
        query = query.where(SnapshotRecord.level == level)
    if hosts:
        hosts_key = make_hosts_key(hosts)
        query = query.where(SnapshotRecord.hosts_key == hosts_key)

    query = query.order_by(SnapshotRecord.updated_at.desc())

    engine = get_engine()
    with Session(engine) as session:
        record = session.exec(query).first()
        if record is None:
            return None
        if not isinstance(record.payload, dict):
            return None
        return _payload_to_snapshot(record.payload)


def flatten_vms_snapshot(payload: SnapshotPayload) -> List[Dict[str, object]]:
    scope_val = _scope_value(payload.scope).lower()
    if scope_val != "vms":
        return []
    data = payload.data
    if not isinstance(data, dict):
        return []
    flattened: List[Dict[str, object]] = []
    for _, items in data.items():
        if not isinstance(items, list):
            continue
        for item in items:
            if isinstance(item, dict):
                flattened.append(item)
    return flattened


def snapshot_meta(payload: SnapshotPayload) -> Dict[str, object]:
    generated_at = payload.generated_at
    generated_at_iso: Optional[str] = None
    if isinstance(generated_at, datetime):
        if generated_at.tzinfo is None:
            generated_at = generated_at.replace(tzinfo=timezone.utc)
            now = datetime.now(timezone.utc)
        else:
            now = datetime.now(timezone.utc)
        age_min = int(max(0, (now - generated_at).total_seconds() // 60))
        generated_at_iso = generated_at.isoformat()
    else:
        age_min = None
    return {
        "generated_at": generated_at_iso or generated_at,
        "age_min": age_min,
        "stale": bool(payload.stale),
    }
