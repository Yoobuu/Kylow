from __future__ import annotations

import json
import logging
import os
import sys
import threading
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Mapping, MutableMapping, Optional

from sqlmodel import Session

from app.audit.models import AuditLog
from app.auth.user_model import User

_raw_audit_log_path = os.getenv("AUDIT_LOG_PATH", "").strip()
AUDIT_LOG_PATH = Path(_raw_audit_log_path).expanduser().resolve() if _raw_audit_log_path else None

_audit_logger = logging.getLogger("app.audit")
_audit_logger_lock = threading.Lock()
_audit_logger_ready = False


@dataclass(slots=True)
class AuditActor:
    id: Optional[int]
    username: Optional[str]


def _resolve_actor(actor: Any) -> AuditActor:
    if actor is None:
        return AuditActor(id=None, username=None)
    if isinstance(actor, AuditActor):
        return actor
    if isinstance(actor, User):
        return AuditActor(id=getattr(actor, "id", None), username=getattr(actor, "username", None))
    if isinstance(actor, Mapping):
        return AuditActor(
            id=actor.get("id"),
            username=actor.get("username") or actor.get("actor_username"),
        )
    actor_id = getattr(actor, "id", None)
    actor_username = getattr(actor, "username", None) or getattr(actor, "actor_username", None)
    return AuditActor(id=actor_id, username=actor_username)


def _normalize_meta(value: Any) -> Optional[MutableMapping[str, Any]]:
    if value is None:
        return None
    if isinstance(value, MutableMapping):
        return dict(value)
    if isinstance(value, Mapping):
        return dict(value)  # type: ignore[arg-type]
    # fallback: encode value in a uniform field
    return {"value": value}


def _truncate_error(value: Exception | str, max_len: int = 200) -> str:
    msg = str(value).strip()
    if not msg:
        return "unknown error"
    if len(msg) > max_len:
        return f"{msg[:max_len]}..."
    return msg


def get_audit_logger() -> logging.Logger:
    global _audit_logger_ready
    if _audit_logger_ready and _audit_logger.handlers:
        return _audit_logger
    with _audit_logger_lock:
        if _audit_logger_ready and _audit_logger.handlers:
            return _audit_logger

        handler: logging.Handler
        if AUDIT_LOG_PATH is not None:
            try:
                AUDIT_LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
                handler = logging.FileHandler(AUDIT_LOG_PATH, encoding="utf-8")
            except Exception as exc:
                print(
                    f"Audit log file disabled; falling back to stdout. Reason: {_truncate_error(exc)}",
                    file=sys.stderr,
                )
                handler = logging.StreamHandler(stream=sys.stdout)
        else:
            handler = logging.StreamHandler(stream=sys.stdout)

        handler.setFormatter(logging.Formatter("%(message)s"))
        handler.setLevel(logging.INFO)
        _audit_logger.addHandler(handler)
        _audit_logger.setLevel(logging.INFO)
        _audit_logger.propagate = False
        _audit_logger_ready = True
    return _audit_logger


def log_audit(
    session: Session,
    *,
    actor: Any,
    action: str,
    target_type: Optional[str] = None,
    target_id: Optional[Any] = None,
    meta: Any = None,
    ip: Optional[str] = None,
    ua: Optional[str] = None,
    corr: Optional[str] = None,
) -> AuditLog:
    """
    Persist an audit record and emit the same payload to the audit logger.

    The record is flushed (but not committed) so the caller can control transaction scope.
    """
    actor_info = _resolve_actor(actor)
    meta_dict = _normalize_meta(meta)
    when = datetime.now(timezone.utc)

    entry = AuditLog(
        when=when,
        actor_id=actor_info.id,
        actor_username=actor_info.username,
        action=action,
        target_type=target_type,
        target_id=str(target_id) if target_id is not None else None,
        meta=meta_dict,
        ip=ip,
        user_agent=ua,
        correlation_id=corr,
    )

    db_write = "ok"
    db_error = None
    try:
        with session.begin_nested():
            session.add(entry)
            session.flush()
    except Exception as exc:
        db_write = "failed"
        db_error = _truncate_error(exc)
        try:
            session.expunge(entry)
        except Exception:
            pass

    payload = {
        "id": entry.id,
        "when": when.isoformat(),
        "actor": asdict(actor_info),
        "action": action,
        "target_type": target_type,
        "target_id": entry.target_id,
        "meta": meta_dict,
        "ip": ip,
        "user_agent": ua,
        "correlation_id": corr,
        "db_write": db_write,
        "db_error": db_error,
    }
    logger = get_audit_logger()
    logger.info(json.dumps(payload, ensure_ascii=False, default=str))

    return entry
