from __future__ import annotations

from sqlmodel import Session

from app.ai.storage import purge_expired
from app.db import get_engine


def purge_expired_conversations() -> int:
    engine = get_engine()
    with Session(engine) as session:
        return purge_expired(session)
