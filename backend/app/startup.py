"""Application startup helpers (validation + resource bootstrap)."""

from __future__ import annotations

import logging
import os
from dataclasses import dataclass, field
from typing import List

from fastapi import FastAPI

from app.db import init_db
from app.vms import vm_service

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


def register_startup_events(app: FastAPI) -> None:
    """Attach startup hooks that validate configuration and warm system components."""

    @app.on_event("startup")
    async def on_startup() -> None:
        diagnostics = StartupDiagnostics()

        diagnostics.env_issues = _collect_env_issues()
        if diagnostics.env_issues:
            logger.error("Configuration issues detected: %s", diagnostics.env_issues)
        else:
            logger.info("Environment variables validated successfully")

        try:
            init_db()
            diagnostics.db_initialized = True
            logger.info("Database metadata ensured")
        except Exception as exc:  # pragma: no cover - defensive
            diagnostics.errors.append(f"Database init failed: {exc}")
            logger.exception("Database initialization failed")

        vm_service.reset_caches()
        logger.info("VM caches cleared on startup")

        vc_issues = vm_service.validate_vcenter_configuration()
        if vc_issues:
            diagnostics.env_issues.extend(vc_issues)
            logger.error("vCenter configuration issues: %s", vc_issues)

        app.state.startup_diagnostics = diagnostics
