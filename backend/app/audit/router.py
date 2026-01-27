from __future__ import annotations

from typing import List, Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func
from sqlalchemy.sql import Select
from sqlmodel import Session, SQLModel, select

from app.audit.service import log_audit
from app.audit.models import AuditLog
from app.db import get_session
from app.dependencies import AuditRequestContext, get_request_audit_context, require_permission
from app.auth.user_model import User
from app.permissions.models import PermissionCode

router = APIRouter(prefix="/api/audit", tags=["audit"])


class AuditLogRead(SQLModel):
    id: int
    when: str
    actor_id: Optional[int]
    actor_username: Optional[str]
    action: str
    target_type: Optional[str]
    target_id: Optional[str]
    meta: Optional[dict]
    ip: Optional[str]
    user_agent: Optional[str]
    correlation_id: Optional[str]


class AuditLogListResponse(SQLModel):
    items: List[AuditLogRead]
    limit: int
    offset: int
    total: int


def _apply_filters(statement: Select[AuditLog], *, action: Optional[str], target_type: Optional[str], actor_username: Optional[str]) -> Select[AuditLog]:
    conditions = []
    if action:
        conditions.append(AuditLog.action == action)
    if target_type:
        conditions.append(AuditLog.target_type == target_type)
    if actor_username:
        conditions.append(AuditLog.actor_username == actor_username)
    if conditions:
        statement = statement.where(*conditions)
    return statement


@router.get(
    "/",
    response_model=AuditLogListResponse,
)
def list_audit_logs(
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    action: Optional[str] = Query(None),
    target_type: Optional[str] = Query(None),
    actor_username: Optional[str] = Query(None),
    session: Session = Depends(get_session),
    current_user: User = Depends(require_permission(PermissionCode.AUDIT_VIEW)),
    audit_ctx: AuditRequestContext = Depends(get_request_audit_context),
):
    log_audit(
        session,
        actor=current_user,
        action="audit.view",
        target_type="audit",
        target_id="list",
        meta={
            "limit": limit,
            "offset": offset,
            "action": action,
            "target_type": target_type,
            "actor_username": actor_username,
        },
        ip=audit_ctx.ip,
        ua=audit_ctx.user_agent,
        corr=audit_ctx.correlation_id,
    )
    session.commit()
    base_stmt = select(AuditLog)
    base_stmt = _apply_filters(base_stmt, action=action, target_type=target_type, actor_username=actor_username)

    total_stmt = base_stmt.with_only_columns(func.count()).order_by(None)
    total = session.exec(total_stmt).one()

    records = session.exec(
        base_stmt.order_by(AuditLog.when.desc()).offset(offset).limit(limit)
    ).all()

    items = [
        AuditLogRead(
            id=record.id,
            when=record.when.isoformat(),
            actor_id=record.actor_id,
            actor_username=record.actor_username,
            action=record.action,
            target_type=record.target_type,
            target_id=record.target_id,
            meta=record.meta,
            ip=record.ip,
            user_agent=record.user_agent,
            correlation_id=record.correlation_id,
        )
        for record in records
    ]

    return AuditLogListResponse(items=items, limit=limit, offset=offset, total=total)
