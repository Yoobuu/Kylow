"""
Migrate users and user_permissions from the local SQLite database to Postgres.

Usage:
  DATABASE_URL=postgresql://user:pass@host:5432/db \
    python backend/scripts/migrate_users_sqlite_to_postgres.py

Optional:
  SQLITE_PATH=/path/to/app.db  # defaults to backend/app/app.db
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

from sqlalchemy import func
from sqlalchemy.exc import SQLAlchemyError
from sqlmodel import Session, create_engine, select

CURRENT_DIR = Path(__file__).resolve().parent
BACKEND_ROOT = CURRENT_DIR.parent
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from app.auth.user_model import User
from app.db import init_db
from app.permissions.models import UserPermission
from app.permissions.service import ensure_default_permissions


def _normalize_database_url(raw_url: str) -> str:
    url = raw_url.strip()
    if url.startswith("postgres://"):
        return f"postgresql://{url[len('postgres://'):]}"
    return url


def _resolve_sqlite_path() -> Path:
    default_path = (BACKEND_ROOT / "app" / "app.db").resolve()
    override = os.getenv("SQLITE_PATH", "").strip()
    if not override:
        return default_path
    return Path(override).expanduser().resolve()


def _update_user_from_source(dest_user: User, source_data: dict) -> None:
    for field, value in source_data.items():
        if field == "id":
            continue
        setattr(dest_user, field, value)


def main() -> int:
    raw_database_url = os.getenv("DATABASE_URL", "").strip()
    if not raw_database_url:
        print("ERROR: DATABASE_URL is required for the destination Postgres database.")
        return 2
    database_url = _normalize_database_url(raw_database_url)

    sqlite_path = _resolve_sqlite_path()
    if not sqlite_path.exists():
        print(f"ERROR: SQLite source not found at {sqlite_path}")
        return 2

    source_engine = create_engine(
        f"sqlite:///{sqlite_path.as_posix()}",
        connect_args={"check_same_thread": False},
    )
    dest_engine = create_engine(database_url, echo=False)

    try:
        init_db(bind=dest_engine)
        with Session(dest_engine) as session:
            ensure_default_permissions(session)
            session.commit()
    except SQLAlchemyError as exc:
        print(f"ERROR: failed to initialize destination database: {exc}")
        return 1

    users_migrated = 0
    users_inserted = 0
    users_updated = 0
    users_skipped = 0

    perms_migrated = 0
    perms_inserted = 0
    perms_updated = 0
    perms_skipped = 0

    try:
        with Session(source_engine) as source_session, Session(dest_engine) as dest_session:
            source_users = source_session.exec(select(User)).all()
            for source_user in source_users:
                source_data = source_user.model_dump()

                # Upsert strategy: by id. If id exists, update; if not, insert.
                # If username exists with a different id, skip to avoid duplicates.
                dest_user = dest_session.get(User, source_user.id)
                if dest_user:
                    _update_user_from_source(dest_user, source_data)
                    dest_session.add(dest_user)
                    users_updated += 1
                    users_migrated += 1
                    continue

                username_conflict = dest_session.exec(
                    select(User).where(User.username == source_user.username)
                ).first()
                if username_conflict:
                    users_skipped += 1
                    print(
                        "WARNING: username conflict; skipping user "
                        f"id={source_user.id} username={source_user.username}"
                    )
                    continue

                dest_session.add(User(**source_data))
                users_inserted += 1
                users_migrated += 1

            dest_session.commit()

            source_perms = source_session.exec(select(UserPermission)).all()
            for source_perm in source_perms:
                dest_perm = dest_session.exec(
                    select(UserPermission).where(
                        UserPermission.user_id == source_perm.user_id,
                        UserPermission.permission_code == source_perm.permission_code,
                    )
                ).first()
                if dest_perm:
                    dest_perm.granted = source_perm.granted
                    dest_session.add(dest_perm)
                    perms_updated += 1
                    perms_migrated += 1
                    continue

                dest_session.add(
                    UserPermission(
                        user_id=source_perm.user_id,
                        permission_code=source_perm.permission_code,
                        granted=source_perm.granted,
                    )
                )
                perms_inserted += 1
                perms_migrated += 1

            dest_session.commit()

            dest_user_total = len(dest_session.exec(select(User)).all())
            dest_perm_total = len(dest_session.exec(select(UserPermission)).all())

    except SQLAlchemyError as exc:
        print(f"ERROR: migration failed: {exc}")
        return 1

    print(
        "Users migrated: "
        f"{users_migrated} (inserted={users_inserted}, updated={users_updated}, skipped={users_skipped})"
    )
    print(
        "User permissions migrated: "
        f"{perms_migrated} (inserted={perms_inserted}, updated={perms_updated}, skipped={perms_skipped})"
    )
    print(f"Destination totals: users={dest_user_total}, user_permissions={dest_perm_total}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
