"""Application startup helpers (validation + resource bootstrap)."""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import List

from fastapi import FastAPI
import os
from passlib.hash import bcrypt
from sqlmodel import Session, select

from app.db import get_engine, init_db
from app.notifications.models import Notification  # noqa: F401
from app.auth.user_model import User
from app.permissions.models import Permission, UserPermission  # noqa: F401
from app.permissions.service import ensure_default_permissions
from app.vms import vm_service
from app.settings import settings
try:
    from app.main import TEST_MODE
except Exception:
    TEST_MODE = False

logger = logging.getLogger("uvicorn.error")

REQUIRED_ENV_VARS = ("SECRET_KEY",)
# Bootstrap admin envs:
# - BOOTSTRAP_ADMIN_ENABLED=true
# - BOOTSTRAP_ADMIN_USERNAME=admin
# - BOOTSTRAP_ADMIN_PASSWORD=<required when enabled>


def _bootstrap_admin_enabled() -> bool:
    value = os.getenv("BOOTSTRAP_ADMIN_ENABLED", "").strip().lower()
    return value in {"1", "true", "yes", "on"}


def _bootstrap_admin_if_needed(session: Session) -> None:
    if not _bootstrap_admin_enabled():
        return
    password = os.getenv("BOOTSTRAP_ADMIN_PASSWORD", "").strip()
    if not password:
        raise RuntimeError("BOOTSTRAP_ADMIN_PASSWORD is required when BOOTSTRAP_ADMIN_ENABLED=true")
    existing = session.exec(select(User.id).limit(1)).first()
    if existing is not None:
        return

    username = (os.getenv("BOOTSTRAP_ADMIN_USERNAME", "admin").strip() or "admin")
    new_user = User(
        username=username,
        hashed_password=bcrypt.hash(password),
        must_change_password=True,
    )
    new_user.mark_password_reset()
    session.add(new_user)
    session.flush()

    rows = session.exec(select(Permission.code)).all()
    permission_codes = [row[0] if isinstance(row, tuple) else row for row in rows]
    for code in permission_codes:
        session.add(
            UserPermission(
                user_id=new_user.id,
                permission_code=code,
                granted=True,
            )
        )
    session.commit()
    logger.info("Bootstrap admin created: %s", username)


@dataclass
class StartupDiagnostics:
    """Diagnostics captured during application startup for health/observability."""

    env_issues: List[str] = field(default_factory=list)
    db_initialized: bool = False
    errors: List[str] = field(default_factory=list)


def _collect_env_issues() -> List[str]:
    """Return a list of missing or empty environment variables required at runtime."""
    issues: List[str] = []
    if not settings.secret_key:
        issues.append("Environment variable 'SECRET_KEY' is not set")
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

        if settings.testing:
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
                    _bootstrap_admin_if_needed(session)
            except Exception as exc:  # pragma: no cover - defensive
                diagnostics.errors.append(f"Database init failed: {exc}")
                logger.exception("Database initialization failed")

        vm_service.reset_caches()
        logger.info("VM caches cleared on startup")

        vc_issues = vm_service.validate_vcenter_configuration()
        if vc_issues:
            diagnostics.env_issues.extend(vc_issues)
            logger.error("vCenter configuration issues: %s", vc_issues)

        scheduler_enabled = settings.notif_sched_enabled
        notification_scheduler = None
        if scheduler_enabled:
            try:
                from app.notifications.scheduler import create_scheduler, schedule_scan_job

                notification_scheduler = create_scheduler()
                schedule_scan_job(notification_scheduler)
                notification_scheduler.start()
                logger.info(
                    "Notification scheduler started (dev_minutes=%s)",
                    settings.notif_sched_dev_minutes,
                )
            except Exception as exc:  # pragma: no cover - defensive
                logger.exception("Failed to start notification scheduler: %s", exc)
                notification_scheduler = None
        else:
            logger.info("Notification scheduler disabled via NOTIF_SCHED_ENABLED")

        app.state.notification_scheduler = notification_scheduler
        app.state.startup_diagnostics = diagnostics

        logger.info(f"Warmup enabled: {settings.warmup_enabled}")
        # ── Hyper-V warmup ──
        try:
            from app.vms.hyperv_router import _kick_scheduler, _kick_warmup

            _kick_scheduler()
            if settings.warmup_enabled:
                if not settings.hyperv_configured:
                    logger.info(
                        "Warmup skipped for hyperv: not configured missing=%s",
                        settings.hyperv_missing_envs or [],
                    )
                elif settings.hyperv_enabled:
                    _kick_warmup()
                    logger.info("Hyper-V warmup scheduled on startup")
        except Exception as exc:  # pragma: no cover - defensive
            logger.exception("Failed to start Hyper-V warmup: %s", exc)
        # ── VMware warmup ──
        try:
            from app.vms.vmware_router import _kick_scheduler as _kick_vmware_scheduler, _kick_warmup as _kick_vmware_warmup

            _kick_vmware_scheduler()
            if settings.warmup_enabled:
                if not settings.vmware_configured:
                    logger.info(
                        "Warmup skipped for vmware: not configured missing=%s",
                        settings.vmware_missing_envs or [],
                    )
                elif settings.vmware_enabled:
                    _kick_vmware_warmup()
                    logger.info("VMware warmup scheduled on startup")
        except Exception as exc:  # pragma: no cover - defensive
            logger.exception("Failed to start VMware warmup: %s", exc)
        # ── oVirt warmup ──
        try:
            from app.vms.ovirt_router import _kick_scheduler as _kick_ovirt_scheduler, _kick_warmup as _kick_ovirt_warmup

            _kick_ovirt_scheduler()
            if settings.warmup_enabled:
                if not settings.ovirt_configured:
                    logger.info(
                        "Warmup skipped for ovirt: not configured missing=%s",
                        settings.ovirt_missing_envs or [],
                    )
                elif settings.ovirt_enabled:
                    _kick_ovirt_warmup()
                    logger.info("oVirt warmup scheduled on startup")
        except Exception as exc:  # pragma: no cover - defensive
            logger.exception("Failed to start oVirt warmup: %s", exc)
        # ── VMware hosts warmup ──
        try:
            from app.hosts.vmware_host_snapshot_router import (
                _kick_scheduler as _kick_vmware_hosts_scheduler,
                _kick_warmup as _kick_vmware_hosts_warmup,
            )

            _kick_vmware_hosts_scheduler()
            if settings.warmup_enabled:
                if not settings.vmware_configured:
                    logger.info(
                        "Warmup skipped for vmware-hosts: not configured missing=%s",
                        settings.vmware_missing_envs or [],
                    )
                elif settings.vmware_enabled:
                    _kick_vmware_hosts_warmup()
                    logger.info("VMware hosts warmup scheduled on startup")
        except Exception as exc:  # pragma: no cover - defensive
            logger.exception("Failed to start VMware hosts warmup: %s", exc)
        # ── oVirt hosts warmup ──
        try:
            from app.hosts.ovirt_host_snapshot_router import (
                _kick_scheduler as _kick_ovirt_hosts_scheduler,
                _kick_warmup as _kick_ovirt_hosts_warmup,
            )

            _kick_ovirt_hosts_scheduler()
            if settings.warmup_enabled:
                if not settings.ovirt_configured:
                    logger.info(
                        "Warmup skipped for ovirt-hosts: not configured missing=%s",
                        settings.ovirt_missing_envs or [],
                    )
                elif settings.ovirt_enabled:
                    _kick_ovirt_hosts_warmup()
                    logger.info("oVirt hosts warmup scheduled on startup")
        except Exception as exc:  # pragma: no cover - defensive
            logger.exception("Failed to start oVirt hosts warmup: %s", exc)
        # ── Cedia warmup ──
        try:
            from app.cedia.cedia_snapshot_router import _kick_scheduler as _kick_cedia_scheduler, _kick_warmup as _kick_cedia_warmup

            _kick_cedia_scheduler()
            if settings.warmup_enabled:
                if not settings.cedia_configured:
                    logger.info(
                        "Warmup skipped for cedia: not configured missing=%s",
                        settings.cedia_missing_envs or [],
                    )
                elif settings.cedia_enabled:
                    _kick_cedia_warmup()
                    logger.info("Cedia warmup scheduled on startup")
        except Exception as exc:  # pragma: no cover - defensive
            logger.exception("Failed to start Cedia warmup: %s", exc)
        # ── Azure warmup ──
        try:
            from app.azure.azure_snapshot_router import _kick_scheduler as _kick_azure_scheduler, _kick_warmup as _kick_azure_warmup

            _kick_azure_scheduler()
            if settings.warmup_enabled:
                if not settings.azure_configured:
                    logger.info(
                        "Warmup skipped for azure: not configured missing=%s",
                        settings.azure_missing_envs or [],
                    )
                elif settings.azure_enabled:
                    _kick_azure_warmup()
                    logger.info("Azure warmup scheduled on startup")
        except Exception as exc:  # pragma: no cover - defensive
            logger.exception("Failed to start Azure warmup: %s", exc)

        # ── Startup config logging (no secrets) ──
        logger.info(
            "hyperv enabled=%s configured=%s missing=%s",
            settings.hyperv_enabled,
            settings.hyperv_configured,
            settings.hyperv_missing_envs or [],
        )
        logger.info(
            "vmware enabled=%s configured=%s missing=%s",
            settings.vmware_enabled,
            settings.vmware_configured,
            settings.vmware_missing_envs or [],
        )
        logger.info(
            "ovirt enabled=%s configured=%s missing=%s",
            settings.ovirt_enabled,
            settings.ovirt_configured,
            settings.ovirt_missing_envs or [],
        )
        logger.info(
            "cedia enabled=%s configured=%s missing=%s",
            settings.cedia_enabled,
            settings.cedia_configured,
            settings.cedia_missing_envs or [],
        )
        logger.info(
            "azure enabled=%s configured=%s missing=%s",
            settings.azure_enabled,
            settings.azure_configured,
            settings.azure_missing_envs or [],
        )
        logger.info(
            "Hyper-V hosts configured: %s",
            len(settings.hyperv_hosts_configured),
        )
        logger.info(
            "Refresh intervals (minutes): hyperv=%s vmware=%s ovirt=%s vmware_hosts=%s ovirt_hosts=%s cedia=%s azure=%s",
            settings.hyperv_refresh_interval_minutes,
            settings.vmware_refresh_interval_minutes,
            settings.ovirt_refresh_interval_minutes,
            settings.vmware_hosts_refresh_interval_minutes,
            settings.ovirt_hosts_refresh_interval_minutes,
            settings.cedia_refresh_interval_minutes,
            settings.azure_refresh_interval_minutes,
        )
        logger.info(
            "CORS allow origins configured: %s",
            len(settings.cors_allow_origins),
        )

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
        # ── Hyper-V warmup stop ──
        try:
            from app.vms.hyperv_router import _stop_warmup

            _stop_warmup()
            logger.info("Hyper-V warmup stopped")
        except Exception as exc:  # pragma: no cover - defensive
            logger.exception("Failed to stop Hyper-V warmup: %s", exc)
        # ── VMware warmup stop ──
        try:
            from app.vms.vmware_router import _stop_warmup as _stop_vmware_warmup

            _stop_vmware_warmup()
            logger.info("VMware warmup stopped")
        except Exception as exc:  # pragma: no cover - defensive
            logger.exception("Failed to stop VMware warmup: %s", exc)
        # ── oVirt warmup stop ──
        try:
            from app.vms.ovirt_router import _stop_warmup as _stop_ovirt_warmup

            _stop_ovirt_warmup()
            logger.info("oVirt warmup stopped")
        except Exception as exc:  # pragma: no cover - defensive
            logger.exception("Failed to stop oVirt warmup: %s", exc)
        # ── VMware hosts warmup stop ──
        try:
            from app.hosts.vmware_host_snapshot_router import _stop_warmup as _stop_vmware_hosts_warmup

            _stop_vmware_hosts_warmup()
            logger.info("VMware hosts warmup stopped")
        except Exception as exc:  # pragma: no cover - defensive
            logger.exception("Failed to stop VMware hosts warmup: %s", exc)
        # ── oVirt hosts warmup stop ──
        try:
            from app.hosts.ovirt_host_snapshot_router import _stop_warmup as _stop_ovirt_hosts_warmup

            _stop_ovirt_hosts_warmup()
            logger.info("oVirt hosts warmup stopped")
        except Exception as exc:  # pragma: no cover - defensive
            logger.exception("Failed to stop oVirt hosts warmup: %s", exc)
        # ── Cedia warmup stop ──
        try:
            from app.cedia.cedia_snapshot_router import _stop_warmup as _stop_cedia_warmup

            _stop_cedia_warmup()
            logger.info("Cedia warmup stopped")
        except Exception as exc:  # pragma: no cover - defensive
            logger.exception("Failed to stop Cedia warmup: %s", exc)
        # ── Azure warmup stop ──
        try:
            from app.azure.azure_snapshot_router import _stop_warmup as _stop_azure_warmup

            _stop_azure_warmup()
            logger.info("Azure warmup stopped")
        except Exception as exc:  # pragma: no cover - defensive
            logger.exception("Failed to stop Azure warmup: %s", exc)
