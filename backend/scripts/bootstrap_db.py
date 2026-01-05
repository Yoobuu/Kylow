"""Idempotent database bootstrap for init jobs."""

from __future__ import annotations

import os
import sys

from sqlmodel import Session, select

CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
BACKEND_ROOT = os.path.dirname(CURRENT_DIR)
if BACKEND_ROOT not in sys.path:
    sys.path.insert(0, BACKEND_ROOT)

from app.auth.user_model import User
from app.db import get_engine, init_db
from app.permissions.service import ensure_default_permissions
from app.startup import _bootstrap_admin_enabled, _bootstrap_admin_if_needed


def _bootstrap_admin(session: Session) -> str:
    if not _bootstrap_admin_enabled():
        return "skipped"
    existing = session.exec(select(User.id).limit(1)).first()
    if existing is not None:
        return "skipped"
    _bootstrap_admin_if_needed(session)
    return "created"


def main() -> None:
    try:
        init_db()
        print("db ok")
        with Session(get_engine()) as session:
            ensure_default_permissions(session)
            print("permissions ok")
            status = _bootstrap_admin(session)
            print(f"bootstrap admin {status}")
    except Exception as exc:
        print(f"bootstrap failed: {exc}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
