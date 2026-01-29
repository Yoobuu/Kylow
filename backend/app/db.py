from __future__ import annotations

import os
import json
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
    load_dotenv(BASE_DIR / '.env', override=False)

APP_DIR = BASE_DIR / 'app'
DB_PATH = (APP_DIR / 'app.db').resolve()
_raw_database_url = os.getenv('DATABASE_URL', '').strip()
if _raw_database_url.startswith('postgres://'):
    _raw_database_url = f'postgresql://{_raw_database_url[len("postgres://"): ]}'
SQLALCHEMY_DATABASE_URL = _raw_database_url or f'sqlite:///{DB_PATH.as_posix()}'
_app_env = (os.getenv('APP_ENV') or os.getenv('ENVIRONMENT') or 'dev').strip().lower()
_missing_database_url = _app_env in {'prod', 'production'} and not _raw_database_url
_IS_SQLITE = SQLALCHEMY_DATABASE_URL.startswith('sqlite:')

def robust_json_loads(s):
    if not s:
        return None
    if not isinstance(s, (str, bytes)):
        return s
    try:
        return json.loads(s)
    except json.JSONDecodeError:
        try:
            # Use character codes to avoid shell escape issues during deployment
            # chr(92) is backslash
            backslash = chr(92)
            double_backslash = backslash + backslash
            return json.loads(s.replace(backslash, double_backslash))
        except Exception:
            return {}

_engine: Engine | None = None

def get_engine() -> Engine:
    global _engine
    if _missing_database_url:
        raise RuntimeError('DATABASE_URL is required when APP_ENV is set to production')
    if _engine is None:
        if _IS_SQLITE:
            _engine = create_engine(
                SQLALCHEMY_DATABASE_URL,
                echo=False,
                connect_args={'check_same_thread': False},
            )
        else:
            _engine = create_engine(
                SQLALCHEMY_DATABASE_URL,
                echo=False,
                pool_size=20,
                max_overflow=10,
                json_deserializer=robust_json_loads
            )
    return _engine

def set_engine(engine: Engine | None) -> None:
    global _engine
    _engine = engine

def init_db(*, bind: Optional[Engine] = None) -> None:
    engine = bind or get_engine()
    from app.audit import models as audit_models
    from app.auth import external_identities_model
    from app.auth import user_model
    from app.ai import storage as ai_storage
    from app.notifications import models as notification_models
    from app.permissions import models as permission_models
    from app.snapshots import models as snapshot_models
    from app.system_settings import models as system_settings_models
    SQLModel.metadata.create_all(bind=engine)

def get_session() -> Iterator[Session]:
    engine = get_engine()
    with Session(engine) as session:
        yield session
