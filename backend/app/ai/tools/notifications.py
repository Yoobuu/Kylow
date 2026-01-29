from __future__ import annotations

import logging
from typing import Dict, List, Optional

from sqlmodel import Session, select

from app.ai.schemas import AINotification, NotificationFilters
from app.db import get_engine
from app.notifications.models import Notification, NotificationMetric, NotificationProvider, NotificationStatus
from app.permissions.models import PermissionCode
from app.permissions.service import user_has_permission

logger = logging.getLogger(__name__)


def _normalize_provider(value: str) -> Optional[NotificationProvider]:
    if not value:
        return None
    try:
        return NotificationProvider(value)
    except ValueError:
        try:
            return NotificationProvider(value.lower())
        except ValueError:
            return None


def _normalize_metric(value: str) -> Optional[NotificationMetric]:
    if not value:
        return None
    try:
        return NotificationMetric(value)
    except ValueError:
        try:
            return NotificationMetric(value.lower())
        except ValueError:
            return None


def _normalize_status(value: str) -> Optional[NotificationStatus]:
    if not value:
        return None
    try:
        return NotificationStatus(value)
    except ValueError:
        try:
            return NotificationStatus(value.lower())
        except ValueError:
            return None


def _derive_severity(notif: Notification) -> Optional[str]:
    try:
        if notif.value_pct is None:
            return None
        threshold = notif.threshold_pct or 0
        if notif.value_pct >= threshold + 10:
            return "critical"
        if notif.value_pct >= threshold:
            return "warning"
        return "info"
    except Exception:
        return None


def _note(notes: Optional[List[Dict[str, object]]], message: str) -> None:
    if notes is None:
        return
    notes.append({"note": message})


def list_notifications(
    filters: NotificationFilters,
    *,
    user,
    session: Session,
    notes: Optional[List[Dict[str, object]]] = None,
) -> List[AINotification]:
    if not user_has_permission(user, PermissionCode.NOTIFICATIONS_VIEW, session):
        _note(notes, "sin permiso")
        return []

    engine = get_engine()
    with Session(engine) as db_session:
        query = select(Notification)

        if filters.provider:
            providers = [p for p in (_normalize_provider(val) for val in filters.provider) if p]
            if providers:
                query = query.where(Notification.provider.in_(providers))

        if filters.status:
            status = _normalize_status(filters.status)
            if status:
                query = query.where(Notification.status == status)

        if filters.metric:
            metric = _normalize_metric(filters.metric)
            if metric:
                query = query.where(Notification.metric == metric)

        if filters.env:
            query = query.where(Notification.env.in_(filters.env))

        if filters.sort == "oldest":
            query = query.order_by(Notification.at.asc())
        else:
            query = query.order_by(Notification.at.desc())

        query = query.limit(filters.limit)
        rows = db_session.exec(query).all()

    output: List[AINotification] = []
    for notif in rows:
        severity = _derive_severity(notif)
        if filters.severity:
            if severity is None or severity.lower() != filters.severity.lower():
                continue
        if filters.resource_type and filters.resource_type.lower() != "vm":
            continue
        message = f"{notif.metric} sobre {notif.threshold_pct}% en {notif.vm_name}"
        output.append(
            AINotification(
                id=notif.id or 0,
                provider=notif.provider.value if notif.provider else None,
                env=notif.env,
                severity=severity,
                status=notif.status.value if notif.status else None,
                metric=notif.metric.value if notif.metric else None,
                resource_type="vm",
                resource_id=notif.vm_id or notif.vm_name,
                message=message,
                timestamp=notif.at or notif.created_at,
            )
        )

    return output
