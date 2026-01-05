from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional

from sqlmodel import Session, select

from app.snapshots.models import SnapshotRecord


def make_hosts_key(hosts: list[str]) -> str:
    cleaned = sorted({h.strip() for h in hosts if h and h.strip()})
    return ",".join(cleaned)


def upsert_snapshot(
    session: Session,
    provider: str,
    scope: str,
    hosts_key: str,
    level: str,
    payload: dict,
) -> None:
    record = session.exec(
        select(SnapshotRecord).where(
            SnapshotRecord.provider == provider,
            SnapshotRecord.scope == scope,
            SnapshotRecord.hosts_key == hosts_key,
            SnapshotRecord.level == level,
        )
    ).first()

    now = datetime.now(timezone.utc)
    if record is None:
        record = SnapshotRecord(
            provider=provider,
            scope=scope,
            hosts_key=hosts_key,
            level=level,
            payload=payload,
            created_at=now,
            updated_at=now,
        )
    else:
        record.payload = payload
        record.updated_at = now
    session.add(record)


def get_snapshot(
    session: Session,
    provider: str,
    scope: str,
    hosts_key: str,
    level: str,
) -> Optional[dict]:
    record = session.exec(
        select(SnapshotRecord).where(
            SnapshotRecord.provider == provider,
            SnapshotRecord.scope == scope,
            SnapshotRecord.hosts_key == hosts_key,
            SnapshotRecord.level == level,
        )
    ).first()
    if record is None:
        return None
    return record.payload
