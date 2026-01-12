from __future__ import annotations

import os
import sys

from app.db import init_db


def _app_env() -> str:
    return (os.getenv("APP_ENV") or os.getenv("ENVIRONMENT") or "dev").strip().lower()


def main() -> None:
    app_env = _app_env()
    database_url = os.getenv("DATABASE_URL", "").strip()
    if app_env in {"prod", "production"} and not database_url:
        print(
            "ERROR: DATABASE_URL is required when APP_ENV is set to production",
            file=sys.stderr,
        )
        raise SystemExit(1)

    try:
        init_db()
    except Exception as exc:
        print(f"ERROR: database init failed: {exc}", file=sys.stderr)
        raise SystemExit(1)

    print("Database initialization complete.")


if __name__ == "__main__":
    main()
