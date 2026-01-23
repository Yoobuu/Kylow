from __future__ import annotations

from datetime import datetime
from pathlib import Path
from typing import Iterable
import re

from sqlalchemy import text

from app.db import get_engine

MIGRATIONS_DIR = Path(__file__).resolve().parent / "migrations"


def _iter_migration_files() -> Iterable[Path]:
    if not MIGRATIONS_DIR.exists():
        return []
    return sorted(p for p in MIGRATIONS_DIR.iterdir() if p.is_file() and p.suffix == ".sql")


def _split_statements(sql_text: str) -> list[str]:
    statements = []
    for chunk in sql_text.split(";"):
        stmt = chunk.strip()
        if stmt:
            statements.append(stmt)
    return statements


_SQLITE_ADD_COLUMN_RE = re.compile(
    r"ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS",
    flags=re.IGNORECASE,
)
_SQLITE_ADD_COLUMN_PARSE_RE = re.compile(
    r"ALTER\s+TABLE\s+(?P<table>\S+)\s+ADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?(?P<column>\S+)",
    flags=re.IGNORECASE,
)


def _normalize_sqlite_statement(statement: str) -> str:
    stripped = statement.lstrip()
    upper = stripped.upper()
    if upper.startswith("ALTER TABLE") and _SQLITE_ADD_COLUMN_RE.search(statement):
        return _SQLITE_ADD_COLUMN_RE.sub("ADD COLUMN", statement)
    return statement


def _sqlite_column_exists(conn, table: str, column: str) -> bool:
    table_clean = table.strip("`\"'")
    column_clean = column.strip("`\"'")
    rows = conn.exec_driver_sql(f"PRAGMA table_info('{table_clean}')").fetchall()
    for row in rows:
        if len(row) > 1 and row[1] == column_clean:
            return True
    return False


def _ensure_migrations_table(conn) -> None:
    conn.exec_driver_sql(
        """
        CREATE TABLE IF NOT EXISTS schema_migrations (
            id TEXT PRIMARY KEY,
            applied_at TIMESTAMP NOT NULL
        )
        """
    )


def run_migrations() -> int:
    engine = get_engine()
    dialect = engine.dialect.name
    files = list(_iter_migration_files())
    if not files:
        print("No migration files found.")
        return 0

    applied = set()
    with engine.begin() as conn:
        _ensure_migrations_table(conn)
        rows = conn.execute(text("SELECT id FROM schema_migrations")).fetchall()
        applied = {row[0] for row in rows}

        for path in files:
            if path.name in applied:
                continue
            sql_text = path.read_text()
            for stmt in _split_statements(sql_text):
                if dialect == "sqlite" and stmt.lstrip().upper().startswith("ALTER TYPE "):
                    continue
                if dialect == "sqlite":
                    match = _SQLITE_ADD_COLUMN_PARSE_RE.match(stmt.lstrip())
                    if match:
                        table = match.group("table")
                        column = match.group("column")
                        if _sqlite_column_exists(conn, table, column):
                            continue
                    stmt = _normalize_sqlite_statement(stmt)
                conn.exec_driver_sql(stmt)
            conn.execute(
                text("INSERT INTO schema_migrations (id, applied_at) VALUES (:id, :ts)"),
                {"id": path.name, "ts": datetime.utcnow()},
            )
            print(f"Applied {path.name}")

    return 0


if __name__ == "__main__":
    raise SystemExit(run_migrations())
