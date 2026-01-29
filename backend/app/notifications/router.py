from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Iterable, List, Sequence
import json

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select
from sqlmodel import Session

from app.audit.service import log_audit
from app.auth.user_model import User
from app.db import get_session
from app.dependencies import (
    AuditRequestContext,
    get_request_audit_context,
    require_permission,
)
from app.permissions.models import PermissionCode
from app.notifications.models import (
    Notification,
    NotificationMetric,
    NotificationProvider,
    NotificationStatus,
)
from app.notifications.sampler import collect_all_samples
from app.notifications.schemas import (
    AckResponse,
    ClearResolvedRequest,
    ClearResolvedResponse,
    NotificationListResponse,
    NotificationRead,
)
from app.notifications.utils import ensure_utc, norm_enum
from app.notifications.sample_history import history

logger = logging.getLogger(__name__)

router = APIRouter()


def _normalize_notification(rec: Notification) -> Notification:
    if isinstance(rec.disks_json, str):
        try:
            rec.disks_json = json.loads(rec.disks_json)
        except Exception:
            rec.disks_json = None
    return rec


def _parse_csv_enum(value: str | None, enum_cls) -> List:
    if not value:
        return []
    items = []
    for part in value.split(","):
        token = part.strip()
        if not token:
            continue
        try:
            items.append(enum_cls(norm_enum(token)))
        except ValueError:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"Invalid value '{token}' for {enum_cls.__name__}",
            )
    return items


def _parse_datetime(value: str | None, *, field: str) -> datetime | None:
    if not value:
        return None
    candidate = value.strip()
    if candidate.endswith("Z"):
        candidate = candidate[:-1] + "+00:00"
    try:
        dt = datetime.fromisoformat(candidate)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Invalid datetime for '{field}'",
        ) from exc
    return ensure_utc(dt)


def _apply_filters(
    statement,
    *,
    statuses: Sequence[NotificationStatus],
    provider: NotificationProvider | None,
    metric: NotificationMetric | None,
    vm_substr: str | None,
    env_substr: str | None,
    from_at: datetime | None,
    to_at: datetime | None,
):
    conditions = []

    if statuses:
        conditions.append(Notification.status.in_(statuses))
    if provider:
        conditions.append(Notification.provider == provider)
    if metric:
        conditions.append(Notification.metric == metric)
    if vm_substr:
        like = f"%{vm_substr.lower()}%"
        conditions.append(func.lower(Notification.vm_name).like(like))
    if env_substr:
        like = f"%{env_substr.lower()}%"
        conditions.append(func.lower(Notification.env).like(like))
    if from_at:
        conditions.append(Notification.at >= from_at)
    if to_at:
        conditions.append(Notification.at <= to_at)

    if conditions:
        statement = statement.where(*conditions)

    return statement


@router.get("/", response_model=NotificationListResponse)
def list_notifications(
    status_filter: str | None = Query(default=None, alias="status"),
    provider: str | None = Query(default=None),
    metric: str | None = Query(default=None),
    vm: str | None = Query(default=None, description="Substring match on VM name"),
    env: str | None = Query(default=None, description="Substring match on environment"),
    from_at: str | None = Query(default=None, alias="from"),
    to_at: str | None = Query(default=None, alias="to"),
    limit: int = Query(default=25, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    session: Session = Depends(get_session),
    _user: User = Depends(require_permission(PermissionCode.NOTIFICATIONS_VIEW)),
):
    statuses = _parse_csv_enum(status_filter, NotificationStatus)
    provider_enum = None
    metric_enum = None

    if provider:
        try:
            provider_enum = NotificationProvider(norm_enum(provider))
        except ValueError as exc:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"Invalid provider '{provider}'",
            ) from exc

    if metric:
        try:
            metric_enum = NotificationMetric(norm_enum(metric))
        except ValueError as exc:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"Invalid metric '{metric}'",
            ) from exc

    from_dt = _parse_datetime(from_at, field="from")
    to_dt = _parse_datetime(to_at, field="to")

    stmt = select(Notification)
    stmt = _apply_filters(
        stmt,
        statuses=statuses,
        provider=provider_enum,
        metric=metric_enum,
        vm_substr=vm,
        env_substr=env,
        from_at=from_dt,
        to_at=to_dt,
    )

    total_stmt = stmt.with_only_columns(func.count()).order_by(None)
    total = session.exec(total_stmt).scalar_one()

    records = session.exec(
        stmt.order_by(Notification.at.desc(), Notification.id.desc()).offset(offset).limit(limit)
    ).scalars().all()

    items = [NotificationRead.model_validate(_normalize_notification(rec)) for rec in records]

    return NotificationListResponse(items=items, total=total, limit=limit, offset=offset)


@router.post("/{notification_id}/ack/", response_model=NotificationRead)
def ack_notification(
    notification_id: int,
    session: Session = Depends(get_session),
    current_user: User = Depends(require_permission(PermissionCode.NOTIFICATIONS_ACK)),
    audit_ctx: AuditRequestContext = Depends(get_request_audit_context),
):
    notification = session.get(Notification, notification_id)
    if not notification:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Notification not found")

    if notification.status != NotificationStatus.OPEN:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Notification is not open",
        )

    notification.status = NotificationStatus.ACK
    notification.ack_by = current_user.username or str(current_user.id)
    notification.ack_at = datetime.now(timezone.utc)
    notification.cleared_at = None
    session.add(notification)

    log_audit(
        session,
        actor=current_user,
        action="notification.ack",
        target_type="notification",
        target_id=str(notification.id),
        meta={
            "provider": notification.provider.value if hasattr(notification.provider, "value") else notification.provider,
            "vm_name": notification.vm_name,
            "metric": notification.metric.value if hasattr(notification.metric, "value") else notification.metric,
            "value_pct": notification.value_pct,
        },
        ip=audit_ctx.ip,
        ua=audit_ctx.user_agent,
        corr=audit_ctx.correlation_id,
    )

    session.commit()
    session.refresh(notification)
    return NotificationRead.model_validate(_normalize_notification(notification))


router.add_api_route(
    "/{notification_id}/ack",
    ack_notification,
    methods=["POST"],
    include_in_schema=False,
)


def _evaluate_clear_candidates(
    open_notifications: Iterable[Notification],
    samples: Iterable[dict],
    threshold: float = 85.0,
) -> List[Notification]:
    sample_list = [sample for sample in samples]
    if not sample_list:
        return []
    history.record_samples(sample_list)

    index = {}
    for notif in open_notifications:
        key = (
            NotificationProvider(notif.provider),
            notif.vm_name.lower(),
            NotificationMetric(notif.metric),
        )
        index[key] = notif

    candidates: List[Notification] = []
    seen_cpu: set[tuple[str, str]] = set()
    seen_ram: set[tuple[str, str]] = set()

    for sample in sample_list:
        provider_raw = sample.get("provider")
        vm_name = sample.get("vm_name")
        if not provider_raw or not vm_name:
            continue
        try:
            provider_enum = NotificationProvider(norm_enum(provider_raw))
        except ValueError:
            continue

        vm_key = vm_name.lower()

        at_value = sample.get("at")
        cpu_pct = sample.get("cpu_pct")
        cpu_key = (provider_enum.value, vm_key)
        if cpu_pct is not None and cpu_key not in seen_cpu:
            avg, _last_at, _count = history.get_recent_average(provider_enum.value, vm_name, "cpu", now=at_value)
            if avg is not None and avg < threshold:
                key = (provider_enum, vm_key, NotificationMetric.CPU)
                notif = index.get(key)
                if notif:
                    candidates.append(notif)
            seen_cpu.add(cpu_key)

        ram_pct = sample.get("ram_pct")
        ram_key = (provider_enum.value, vm_key)
        if ram_pct is not None and ram_key not in seen_ram:
            avg, _last_at, _count = history.get_recent_average(provider_enum.value, vm_name, "ram", now=at_value)
            if avg is not None and avg < threshold:
                key = (provider_enum, vm_key, NotificationMetric.RAM)
                notif = index.get(key)
                if notif:
                    candidates.append(notif)
            seen_ram.add(ram_key)

        disks = sample.get("disks") or []
        if provider_enum == NotificationProvider.HYPERV and disks:
            used = [disk.get("used_pct") for disk in disks if disk.get("used_pct") is not None]
            if used and min(used) < threshold:
                key = (provider_enum, vm_key, NotificationMetric.DISK)
                notif = index.get(key)
                if notif:
                    candidates.append(notif)

    unique_candidates = list({candidate.id: candidate for candidate in candidates}.values())
    return unique_candidates


@router.post("/clear-resolved", response_model=ClearResolvedResponse)
def clear_resolved_notifications(
    payload: ClearResolvedRequest,
    session: Session = Depends(get_session),
    current_user: User = Depends(require_permission(PermissionCode.NOTIFICATIONS_CLEAR)),
    audit_ctx: AuditRequestContext = Depends(get_request_audit_context),
):
    open_notifications = session.exec(
        select(Notification).where(Notification.status == NotificationStatus.OPEN)
    ).all()
    if not open_notifications:
        log_audit(
            session,
            actor=current_user,
            action="notifications.clear_resolved",
            target_type="notifications",
            target_id="open",
            meta={"dry_run": payload.dry_run, "cleared_count": 0},
            ip=audit_ctx.ip,
            ua=audit_ctx.user_agent,
            corr=audit_ctx.correlation_id,
        )
        session.commit()
        return ClearResolvedResponse(cleared_count=0, dry_run=payload.dry_run)

    try:
        samples = collect_all_samples(refresh=True)
    except Exception as exc:  # pragma: no cover - defensive
        logger.exception("Failed to collect samples for clear-resolved: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Unable to collect samples for clearing",
        ) from exc

    candidates = _evaluate_clear_candidates(open_notifications, samples, threshold=85.0)
    cleared_count = len(candidates)

    if payload.dry_run or cleared_count == 0:
        log_audit(
            session,
            actor=current_user,
            action="notifications.clear_resolved",
            target_type="notifications",
            target_id="open",
            meta={"dry_run": payload.dry_run, "cleared_count": cleared_count},
            ip=audit_ctx.ip,
            ua=audit_ctx.user_agent,
            corr=audit_ctx.correlation_id,
        )
        session.commit()
        return ClearResolvedResponse(cleared_count=cleared_count, dry_run=payload.dry_run)

    for notif in candidates:
        notif.status = NotificationStatus.CLEARED
        notif.ack_at = None
        session.add(notif)
    session.commit()
    log_audit(
        session,
        actor=current_user,
        action="notifications.clear_resolved",
        target_type="notifications",
        target_id="open",
        meta={"dry_run": False, "cleared_count": cleared_count},
        ip=audit_ctx.ip,
        ua=audit_ctx.user_agent,
        corr=audit_ctx.correlation_id,
    )
    session.commit()

    return ClearResolvedResponse(cleared_count=cleared_count, dry_run=payload.dry_run)
