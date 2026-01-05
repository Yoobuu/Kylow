from __future__ import annotations

import os
from pathlib import Path
from typing import Iterator, Optional

try:
    from dotenv import load_dotenv
except ImportError:
    load_dotenv = None

from sqlalchemy.engine import Engine
from sqlmodel import SQLModel, Session, create_engine

BASE_DIR = Path(__file__).resolve().parent.parent
if load_dotenv is not None:
    load_dotenv(BASE_DIR / ".env", override=False)

# Resolve database path relative to this module so the app doesn't depend on the working directory.
APP_DIR = BASE_DIR / "app"
DB_PATH = (APP_DIR / "app.db").resolve()
_raw_database_url = os.getenv("DATABASE_URL", "").strip()
if _raw_database_url.startswith("postgres://"):
    _raw_database_url = f"postgresql://{_raw_database_url[len('postgres://'):]}"
SQLALCHEMY_DATABASE_URL = _raw_database_url or f"sqlite:///{DB_PATH.as_posix()}"
_app_env = (os.getenv("APP_ENV") or os.getenv("ENVIRONMENT") or "dev").strip().lower()
_missing_database_url = _app_env in {"prod", "production"} and not _raw_database_url
_IS_SQLITE = SQLALCHEMY_DATABASE_URL.startswith("sqlite:")

_engine: Engine | None = None


def get_engine() -> Engine:
    """Return the application engine, creating it if necessary."""
    global _engine
    if _missing_database_url:
        raise RuntimeError("DATABASE_URL is required when APP_ENV is set to production")
    if _engine is None:
        if _IS_SQLITE:
            _engine = create_engine(
                SQLALCHEMY_DATABASE_URL,
                echo=False,
                connect_args={"check_same_thread": False},
            )
        else:
            _engine = create_engine(SQLALCHEMY_DATABASE_URL, echo=False)
    return _engine


def set_engine(engine: Engine | None) -> None:
    """Override the application engine (useful for testing)."""
    global _engine
    _engine = engine


def init_db(*, bind: Optional[Engine] = None) -> None:
    """Create database tables on startup so a fresh environment boots cleanly."""
    engine = bind or get_engine()
    # Ensure all SQLModel tables are registered before create_all().
    from app.audit import models as audit_models  # noqa: F401
    from app.auth import user_model  # noqa: F401
    from app.notifications import models as notification_models  # noqa: F401
    from app.permissions import models as permission_models  # noqa: F401
    from app.snapshots import models as snapshot_models  # noqa: F401
    from app.system_settings import models as system_settings_models  # noqa: F401
    SQLModel.metadata.create_all(bind=engine)


def get_session() -> Iterator[Session]:
    """Provide a SQLModel session for dependency injection."""
    engine = get_engine()
    with Session(engine) as session:
        yield session
