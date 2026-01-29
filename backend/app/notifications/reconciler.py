from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Dict, List, Optional, Tuple, TypedDict, cast

from sqlmodel import Session, select

from app.audit.service import log_audit
from app.db import get_engine
from app.notifications.models import (
    Notification,
    NotificationMetric,
    NotificationProvider,
    NotificationStatus,
)
from app.notifications.repository import compute_dedupe_key
from app.notifications.utils import ensure_utc, norm_enum


class NotificationLike(TypedDict, total=False):
    provider: str
    vm_name: str
    metric: str
    value_pct: float
    threshold_pct: float
    env: Optional[str]
    vm_id: Optional[str]
    disks_json: Optional[List[dict]]
    at: Optional[datetime]


@dataclass(slots=True)
class ReconciliationReport:
    created: int = 0
    cleared: int = 0
    updated: int = 0
    preserved: int = 0
    created_ids: List[int] = field(default_factory=list)
    cleared_ids: List[int] = field(default_factory=list)
    updated_ids: List[int] = field(default_factory=list)
    preserved_ids: List[int] = field(default_factory=list)

    def to_dict(self) -> Dict[str, object]:
        return {
            "created": self.created,
            "cleared": self.cleared,
            "updated": self.updated,
            "preserved": self.preserved,
            "created_ids": self.created_ids,
            "cleared_ids": self.cleared_ids,
            "updated_ids": self.updated_ids,
            "preserved_ids": self.preserved_ids,
        }


NotificationKey = Tuple[str, str, str, Optional[str]]
SYSTEM_ACTOR = {"username": "system"}
_EPSILON = 1e-6


def reconcile_notifications(
    current_anomalies: List[NotificationLike],
    now: datetime,
    *,
    observed_keys: Optional[set[tuple[str, str, str]]] = None,
) -> ReconciliationReport:
    """
    Reconcile persisted notifications with the anomalies detected during the latest scrape.

    This function is idempotent and encapsulates its own transaction. It returns a structured
    report that can be used for logging or metrics once the reconciliation finishes.
    """

    now_utc = ensure_utc(now)
    engine = get_engine()
    with Session(engine) as session:
        with session.begin():
            report = _reconcile_with_session(session, current_anomalies, now_utc, observed_keys)
            session.flush()
        return report


def _normalize_provider(value: str) -> NotificationProvider:
    return NotificationProvider(norm_enum(value))


def _normalize_metric(value: str) -> NotificationMetric:
    return NotificationMetric(norm_enum(value))


def _normalize_env(value: Optional[str]) -> Optional[str]:
    if value is None:
        return None
    normalized = value.strip()
    return normalized.upper() or None


def _build_key(
    provider: NotificationProvider | str,
    vm_name: str,
    metric: NotificationMetric | str,
    env: Optional[str],
) -> NotificationKey:
    provider_value = (
        provider.value if isinstance(provider, NotificationProvider) else _normalize_provider(provider).value
    )
    metric_value = metric.value if isinstance(metric, NotificationMetric) else _normalize_metric(metric).value
    vm_key = vm_name.strip().lower()
    env_key = _normalize_env(env)
    return provider_value, vm_key, metric_value, env_key


def _sanitize_disks(disks: Optional[List[dict]]) -> Optional[List[dict]]:
    if not disks:
        return None
    sanitized: List[dict] = []
    for disk in disks:
        if not isinstance(disk, dict):
            continue
        sanitized.append({k: disk[k] for k in disk if disk[k] is not None})
    return sanitized or None


def _reconcile_with_session(
    session: Session,
    current_anomalies: List[NotificationLike],
    now: datetime,
    observed_keys: Optional[set[tuple[str, str, str]]] = None,
) -> ReconciliationReport:
    report = ReconciliationReport()
    anomaly_index: Dict[NotificationKey, NotificationLike] = {}

    for anomaly in current_anomalies:
        provider = anomaly.get("provider")
        metric = anomaly.get("metric")
        vm_name = anomaly.get("vm_name")

        if not provider or not metric or not vm_name:
            continue

        key = _build_key(provider, vm_name, metric, anomaly.get("env"))
        anomaly_index[key] = anomaly

    existing = session.exec(
        select(Notification).where(
            Notification.status.in_([NotificationStatus.OPEN, NotificationStatus.ACK]),
            Notification.archived.is_(False),
        )
    ).all()

    for notif in existing:
        key = _build_key(
            notif.provider,
            notif.vm_name,
            notif.metric,
            notif.env,
        )
        key_no_env = (key[0], key[1], key[2])

        anomaly = anomaly_index.pop(key, None)

        if anomaly is None:
            if observed_keys is not None and key_no_env not in observed_keys:
                report.preserved += 1
                report.preserved_ids.append(cast(int, notif.id))
                continue
            previous_status = notif.status
            notif.status = NotificationStatus.CLEARED
            notif.cleared_at = now
            session.add(notif)

            log_audit(
                session,
                actor=SYSTEM_ACTOR,
                action="NOTIFICATION_CLEARED",
                target_type="notification",
                target_id=notif.id,
                meta={
                    "before": {"status": previous_status.name},
                    "after": {"status": NotificationStatus.CLEARED.name},
                },
            )

            report.cleared += 1
            report.cleared_ids.append(cast(int, notif.id))
            continue

        changes: Dict[str, Dict[str, object]] = {}

        value = anomaly.get("value_pct")
        if value is not None and abs(notif.value_pct - float(value)) > _EPSILON:
            _record_change(changes, "value_pct", notif.value_pct, float(value))
            notif.value_pct = float(value)

        threshold = anomaly.get("threshold_pct")
        if threshold is not None and abs(notif.threshold_pct - float(threshold)) > _EPSILON:
            _record_change(changes, "threshold_pct", notif.threshold_pct, float(threshold))
            notif.threshold_pct = float(threshold)

        if "vm_id" in anomaly:
            vm_id = anomaly.get("vm_id")
            if vm_id != notif.vm_id:
                _record_change(changes, "vm_id", notif.vm_id, vm_id)
                notif.vm_id = vm_id

        if "env" in anomaly:
            raw_env = anomaly.get("env")
            normalized_env = _normalize_env(cast(Optional[str], raw_env))
            if normalized_env != notif.env:
                _record_change(changes, "env", notif.env, normalized_env)
                notif.env = normalized_env

        disks = _sanitize_disks(anomaly.get("disks_json"))
        if disks != notif.disks_json:
            _record_change(changes, "disks_json", notif.disks_json, disks)
            notif.disks_json = disks

        at_value = anomaly.get("at")
        if at_value:
            at_utc = ensure_utc(at_value)
            if notif.at != at_utc:
                _record_change(changes, "at", notif.at, at_utc)
                notif.at = at_utc

        notif.cleared_at = None
        session.add(notif)

        if changes:
            report.updated += 1
            report.updated_ids.append(cast(int, notif.id))
            log_audit(
                session,
                actor=SYSTEM_ACTOR,
                action="NOTIFICATION_UPDATED",
                target_type="notification",
                target_id=notif.id,
                meta={"changes": changes},
            )
        else:
            report.preserved += 1
            report.preserved_ids.append(cast(int, notif.id))

    if anomaly_index:
        for key, anomaly in anomaly_index.items():
            provider_value, vm_key, metric_value, env_key = key
            provider_enum = NotificationProvider(provider_value)
            metric_enum = NotificationMetric(metric_value)

            vm_name = anomaly.get("vm_name") or vm_key
            at_value = anomaly.get("at")
            at_utc = ensure_utc(at_value) if at_value else now

            new_notif = Notification(
                provider=provider_enum,
                vm_name=vm_name,
                vm_id=anomaly.get("vm_id"),
                metric=metric_enum,
                value_pct=float(anomaly.get("value_pct", 0.0)),
                threshold_pct=float(anomaly.get("threshold_pct", 85.0)),
                env=env_key,
                at=at_utc,
                status=NotificationStatus.OPEN,
                disks_json=_sanitize_disks(anomaly.get("disks_json")),
                dedupe_key=compute_dedupe_key(provider_value, vm_name, metric_value, at_utc),
                created_at=now,
                cleared_at=None,
                archived=False,
            )

            session.add(new_notif)
            session.flush()

            report.created += 1
            report.created_ids.append(cast(int, new_notif.id))

            log_audit(
                session,
                actor=SYSTEM_ACTOR,
                action="NOTIFICATION_CREATED",
                target_type="notification",
                target_id=new_notif.id,
                meta={
                    "provider": provider_value,
                    "vm_name": vm_name,
                    "metric": metric_value,
                    "value_pct": new_notif.value_pct,
                    "threshold_pct": new_notif.threshold_pct,
                },
            )

    return report
def _meta_value(value: object) -> object:
    if isinstance(value, datetime):
        return ensure_utc(value).isoformat()
    return value


def _record_change(changes: Dict[str, Dict[str, object]], field: str, before: object, after: object) -> None:
    changes[field] = {
        "before": _meta_value(before),
        "after": _meta_value(after),
    }
