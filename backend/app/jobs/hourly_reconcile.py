from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import List, Optional

from sqlmodel import Session

from app.audit.service import log_audit
from app.db import get_engine
from app.notifications.models import NotificationMetric, NotificationProvider
from app.notifications.reconciler import (
    NotificationLike,
    ReconciliationReport,
    reconcile_notifications,
)
from app.notifications.sampler import collect_all_samples
from app.notifications.service import evaluate_batch, build_observed_keys
from app.settings import settings

logger = logging.getLogger(__name__)

def _is_autoclear_enabled() -> bool:
    return settings.notifs_autoclear_enabled


def _build_anomalies(refresh: bool) -> tuple[List[NotificationLike], set[tuple[str, str, str]]]:
    samples = collect_all_samples(refresh=refresh)
    notifications = evaluate_batch(samples, threshold=85.0)
    observed_keys = build_observed_keys(samples)

    anomalies: List[NotificationLike] = []
    for notif in notifications:
        provider = notif.provider.value if isinstance(notif.provider, NotificationProvider) else str(notif.provider)
        metric = notif.metric.value if isinstance(notif.metric, NotificationMetric) else str(notif.metric)
        anomalies.append(
            {
                "provider": provider,
                "vm_name": notif.vm_name,
                "vm_id": notif.vm_id,
                "metric": metric,
                "value_pct": float(notif.value_pct),
                "threshold_pct": float(notif.threshold_pct),
                "env": notif.env,
                "at": notif.at,
                "disks_json": notif.disks_json,
            }
        )
    return anomalies, observed_keys


def run_hourly_reconcile(refresh: bool = True) -> Optional[ReconciliationReport]:
    if not _is_autoclear_enabled():
        logger.info("Notifications autoclear disabled via NOTIFS_AUTOCLEAR_ENABLED")
        return None

    anomalies, observed_keys = _build_anomalies(refresh=refresh)
    now = datetime.now(timezone.utc)

    report = reconcile_notifications(anomalies, now, observed_keys=observed_keys)

    engine = get_engine()
    with Session(engine) as session:
        log_audit(
            session,
            actor={"username": "system"},
            action="notifications.reconcile",
            target_type="notification",
            target_id=None,
            meta=report.to_dict(),
        )
        session.commit()

    logger.info("Notifications reconciliation completed: %s", report.to_dict())
    return report
