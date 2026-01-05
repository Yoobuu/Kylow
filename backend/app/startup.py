"""Application startup helpers (validation + resource bootstrap)."""

from __future__ import annotations

import logging
import os
from dataclasses import dataclass, field
from typing import List

from fastapi import FastAPI
from sqlmodel import Session

from app.db import get_engine, init_db
from app.notifications.models import Notification  # noqa: F401
from app.permissions.models import Permission  # noqa: F401
from app.permissions.service import ensure_default_permissions
from app.vms import vm_service
try:
    from app.main import TEST_MODE
except Exception:
    TEST_MODE = False

logger = logging.getLogger(__name__)

REQUIRED_ENV_VARS = ("SECRET_KEY", "VCENTER_HOST", "VCENTER_USER", "VCENTER_PASS")


@dataclass
class StartupDiagnostics:
    """Diagnostics captured during application startup for health/observability."""

    env_issues: List[str] = field(default_factory=list)
    db_initialized: bool = False
    errors: List[str] = field(default_factory=list)


def _collect_env_issues() -> List[str]:
    """Return a list of missing or empty environment variables required at runtime."""
    issues: List[str] = []
    for name in REQUIRED_ENV_VARS:
        if not os.getenv(name):
            issues.append(f"Environment variable '{name}' is not set")
    return issues


def _as_bool(value: str | None, default: bool = False) -> bool:
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def _app_env() -> str:
    return (os.getenv("APP_ENV") or os.getenv("ENVIRONMENT") or "dev").strip().lower()


def _is_production_env() -> bool:
    return _app_env() in {"prod", "production"}


def register_startup_events(app: FastAPI) -> None:
    """Attach startup hooks that validate configuration and warm system components."""

    @app.on_event("startup")
    async def on_startup() -> None:
        if TEST_MODE:
            print("[TEST MODE ENABLED] Startup hooks skipped.")
            return
        diagnostics = StartupDiagnostics()

        diagnostics.env_issues = _collect_env_issues()
        if diagnostics.env_issues:
            logger.error("Configuration issues detected: %s", diagnostics.env_issues)
        else:
            logger.info("Environment variables validated successfully")

        if _is_production_env() and not os.getenv("DATABASE_URL"):
            raise RuntimeError("DATABASE_URL is required when APP_ENV is set to production")

        init_db_on_startup = _as_bool(
            os.getenv("INIT_DB_ON_STARTUP"),
            default=not _is_production_env(),
        )

        if os.getenv("TESTING") == "1":
            logger.info("Skipping database initialization in testing mode")
        elif not init_db_on_startup:
            logger.info("Skipping database initialization (INIT_DB_ON_STARTUP=false)")
        else:
            try:
                init_db()
                diagnostics.db_initialized = True
                logger.info("Database metadata ensured")

                with Session(get_engine()) as session:
                    ensure_default_permissions(session)
            except Exception as exc:  # pragma: no cover - defensive
                diagnostics.errors.append(f"Database init failed: {exc}")
                logger.exception("Database initialization failed")

        vm_service.reset_caches()
        logger.info("VM caches cleared on startup")

        vc_issues = vm_service.validate_vcenter_configuration()
        if vc_issues:
            diagnostics.env_issues.extend(vc_issues)
            logger.error("vCenter configuration issues: %s", vc_issues)

        scheduler_enabled = os.getenv("NOTIF_SCHED_ENABLED", "").strip().lower() in {"1", "true", "yes", "on"}
        notification_scheduler = None
        if scheduler_enabled:
            try:
                from app.notifications.scheduler import create_scheduler, schedule_scan_job

                notification_scheduler = create_scheduler()
                schedule_scan_job(notification_scheduler)
                notification_scheduler.start()
                logger.info(
                    "Notification scheduler started (dev_minutes=%s)",
                    os.getenv("NOTIF_SCHED_DEV_MINUTES"),
                )
            except Exception as exc:  # pragma: no cover - defensive
                logger.exception("Failed to start notification scheduler: %s", exc)
                notification_scheduler = None
        else:
            logger.info("Notification scheduler disabled via NOTIF_SCHED_ENABLED")

        app.state.notification_scheduler = notification_scheduler
        app.state.startup_diagnostics = diagnostics

    @app.on_event("shutdown")
    async def on_shutdown() -> None:
        if TEST_MODE:
            return
        scheduler = getattr(app.state, "notification_scheduler", None)
        if scheduler is not None:
            try:
                scheduler.shutdown(wait=False)
                logger.info("Notification scheduler stopped")
            except Exception:  # pragma: no cover - defensive
                logger.exception("Failed to stop notification scheduler")
