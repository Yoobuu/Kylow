from __future__ import annotations

import logging
import os
import signal
import threading
import time

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlmodel import Session

from app.audit.service import log_audit
from app.auth.user_model import User
from app.db import get_engine
from app.dependencies import AuditRequestContext, get_request_audit_context, require_permission
from app.permissions.models import PermissionCode
from app.system_state import is_restarting, set_restarting

router = APIRouter(prefix="/api/admin/system", tags=["system"])
logger = logging.getLogger(__name__)


class RestartRequest(BaseModel):
    confirm: str


def _restart_worker(actor: User, ctx: AuditRequestContext) -> None:
    time.sleep(0.75)
    try:
        with Session(get_engine()) as session:
            log_audit(
                session,
                actor=actor,
                action="system.restart",
                target_type="system",
                target_id="backend",
                meta={"reason": "manual"},
                ip=ctx.ip,
                ua=ctx.user_agent,
                corr=ctx.correlation_id,
            )
            session.commit()
    except Exception as exc:
        logger.exception("Failed to audit system restart: %s", exc)
    pid = os.getpid()
    logger.warning("Restarting now pid=%s", pid)
    # If no supervisor/reloader is present, the process will exit without respawn.
    try:
        os.kill(pid, signal.SIGTERM)
    finally:
        time.sleep(0.25)
        os._exit(0)


@router.post("/restart", status_code=status.HTTP_202_ACCEPTED)
def restart_system(
    payload: RestartRequest,
    current_user: User = Depends(require_permission(PermissionCode.SYSTEM_RESTART)),
    ctx: AuditRequestContext = Depends(get_request_audit_context),
):
    if payload.confirm != "RESTART":
        raise HTTPException(status_code=400, detail="Confirmación inválida")
    if is_restarting():
        return {"status": "accepted", "message": "Restart already scheduled"}
    set_restarting(True)
    logger.warning(
        "Restart scheduled by user=%s id=%s pid=%s",
        current_user.username,
        current_user.id,
        os.getpid(),
    )
    threading.Thread(target=_restart_worker, args=(current_user, ctx), daemon=True).start()
    return {"status": "accepted", "message": "Restart scheduled"}
