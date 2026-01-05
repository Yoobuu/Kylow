from __future__ import annotations

import logging
import os
from dataclasses import dataclass
from typing import List, Optional

logger = logging.getLogger(__name__)


def _as_bool(value: Optional[str]) -> bool:
    if value is None:
        return False
    return value.strip().lower() in {"1", "true", "yes", "on"}

def _as_bool_default_true(value: Optional[str], *, name: str = "WARMUP_ENABLED") -> bool:
    if value is None:
        return True
    normalized = value.strip().lower()
    if normalized in {"1", "true", "yes"}:
        return True
    if normalized in {"0", "false", "no"}:
        return False
    logger.warning("Invalid %s=%r, defaulting to true", name, value)
    return True


def _as_int(value: Optional[str], default: int) -> int:
    if value is None:
        return default
    try:
        return int(value)
    except ValueError:
        logger.warning("Invalid int for %r, using default=%s", value, default)
        return default


def _as_float(value: Optional[str], default: float) -> float:
    if value is None:
        return default
    try:
        return float(value)
    except ValueError:
        logger.warning("Invalid float for %r, using default=%s", value, default)
        return default


def _split_list(value: Optional[str]) -> List[str]:
    if not value:
        return []
    items = []
    for raw in value.replace(";", ",").split(","):
        cleaned = raw.strip()
        if cleaned:
            items.append(cleaned)
    return items


def _split_hosts(value: Optional[str]) -> List[str]:
    if not value:
        return []
    cleaned = []
    for raw in value.replace(";", ",").split(","):
        host = raw.strip().lower()
        if host:
            cleaned.append(host)
    return sorted(set(cleaned))


@dataclass(frozen=True)
class Settings:
    app_env: str
    log_level: str
    test_mode: bool
    testing: bool
    secret_key: Optional[str]
    jwt_algorithm: str
    access_token_expire_minutes: int
    cors_allow_origins: List[str]
    refresh_interval_minutes: int

    # Providers enabled/configured
    vmware_enabled: bool
    vmware_configured: bool
    vmware_missing_envs: List[str]
    cedia_enabled: bool
    cedia_configured: bool
    cedia_missing_envs: List[str]
    hyperv_enabled: bool
    hyperv_configured: bool
    hyperv_missing_envs: List[str]

    # vCenter (VMware)
    vcenter_host: Optional[str]
    vcenter_user: Optional[str]
    vcenter_pass: Optional[str]
    vmware_job_max_global: int
    vmware_job_max_per_scope: int
    vmware_job_host_timeout: int
    vmware_job_max_duration: int
    vmware_refresh_interval_minutes: int
    vmware_hosts_job_host_timeout: int
    vmware_hosts_job_max_duration: int
    vmware_hosts_refresh_interval_minutes: int

    # Cedia
    cedia_base: Optional[str]
    cedia_user: Optional[str]
    cedia_pass: Optional[str]
    cedia_job_max_global: int
    cedia_job_max_per_scope: int
    cedia_job_host_timeout: int
    cedia_job_max_duration: int
    cedia_refresh_interval_minutes: int

    # Hyper-V
    hyperv_hosts: List[str]
    hyperv_host: Optional[str]
    hyperv_user: Optional[str]
    hyperv_pass: Optional[str]
    hyperv_transport: str
    hyperv_ps_path: Optional[str]
    hyperv_cache_ttl: int
    hyperv_cache_ttl_summary: int
    hyperv_cache_ttl_detail: int
    hyperv_cache_ttl_deep: int
    hyperv_cache_ttl_hosts: int
    hyperv_job_max_global: int
    hyperv_job_max_per_scope: int
    hyperv_job_host_timeout: int
    hyperv_job_max_duration: int
    hyperv_inventory_read_timeout: int
    hyperv_inventory_retries: int
    hyperv_inventory_backoff_sec: float
    hyperv_power_read_timeout: int
    hyperv_detail_timeout: int
    hyperv_refresh_interval_minutes: int

    # Notifications
    notif_sched_enabled: bool
    notif_sched_dev_minutes: Optional[int]
    notifs_autoclear_enabled: bool
    notifs_retention_days: int
    warmup_enabled: bool

    @property
    def hyperv_hosts_configured(self) -> List[str]:
        if self.hyperv_hosts:
            return list(self.hyperv_hosts)
        if self.hyperv_host:
            return [self.hyperv_host.strip().lower()]
        return []

    @property
    def vmware_missing_vars(self) -> List[str]:
        return list(self.vmware_missing_envs)

    @property
    def cedia_missing_vars(self) -> List[str]:
        return list(self.cedia_missing_envs)

    @property
    def hyperv_missing_vars(self) -> List[str]:
        return list(self.hyperv_missing_envs)


def _build_settings() -> Settings:
    app_env = os.getenv("APP_ENV", "dev").strip().lower() or "dev"
    log_level = os.getenv("LOG_LEVEL", "INFO").strip().upper() or "INFO"
    test_mode = _as_bool(os.getenv("TEST_MODE")) or os.getenv("PYTEST_RUNNING") == "1"
    testing = os.getenv("TESTING") == "1"

    refresh_interval_minutes = max(_as_int(os.getenv("REFRESH_INTERVAL_MINUTES"), 60), 1)

    cors_allow_origins = _split_list(os.getenv("CORS_ALLOW_ORIGINS"))
    if not cors_allow_origins:
        legacy_origin = os.getenv("FRONTEND_ORIGIN")
        cors_allow_origins = _split_list(legacy_origin)

    vcenter_host = os.getenv("VCENTER_HOST")
    vcenter_user = os.getenv("VCENTER_USER")
    vcenter_pass = os.getenv("VCENTER_PASS")

    cedia_base = os.getenv("CEDIA_BASE")
    cedia_user = os.getenv("CEDIA_USER")
    cedia_pass = os.getenv("CEDIA_PASS")

    hyperv_hosts = _split_hosts(os.getenv("HYPERV_HOSTS"))
    hyperv_host = os.getenv("HYPERV_HOST")
    hyperv_user = os.getenv("HYPERV_USER")
    hyperv_pass = os.getenv("HYPERV_PASS")

    vmware_enabled = _as_bool_default_true(os.getenv("VMWARE_ENABLED"), name="VMWARE_ENABLED")
    cedia_enabled = _as_bool_default_true(os.getenv("CEDIA_ENABLED"), name="CEDIA_ENABLED")
    hyperv_enabled = _as_bool_default_true(os.getenv("HYPERV_ENABLED"), name="HYPERV_ENABLED")

    vmware_missing_envs = []
    if not vcenter_host:
        vmware_missing_envs.append("VCENTER_HOST")
    if not vcenter_user:
        vmware_missing_envs.append("VCENTER_USER")
    if not vcenter_pass:
        vmware_missing_envs.append("VCENTER_PASS")
    vmware_configured = not vmware_missing_envs

    cedia_missing_envs = []
    if not cedia_base:
        cedia_missing_envs.append("CEDIA_BASE")
    if not cedia_user:
        cedia_missing_envs.append("CEDIA_USER")
    if not cedia_pass:
        cedia_missing_envs.append("CEDIA_PASS")
    cedia_configured = not cedia_missing_envs

    hyperv_missing_envs = []
    if not (hyperv_hosts or hyperv_host):
        hyperv_missing_envs.append("HYPERV_HOSTS/HYPERV_HOST")
    if not hyperv_user:
        hyperv_missing_envs.append("HYPERV_USER")
    if not hyperv_pass:
        hyperv_missing_envs.append("HYPERV_PASS")
    hyperv_configured = not hyperv_missing_envs

    raw_autoclear = os.getenv("NOTIFS_AUTOCLEAR_ENABLED")
    notifs_autoclear_enabled = _as_bool(raw_autoclear) if raw_autoclear is not None else not testing

    warmup_enabled = _as_bool_default_true(os.getenv("WARMUP_ENABLED"), name="WARMUP_ENABLED")

    overrides = None
    if not testing and not test_mode:
        try:
            from app.db import get_engine
            from sqlmodel import Session
            from app.system_settings.service import load_system_settings, extract_overrides

            with Session(get_engine()) as session:
                row = load_system_settings(session)
            overrides = extract_overrides(row) if row else None
        except Exception as exc:
            logger.warning("System settings override unavailable: %s", exc)

    return Settings(
        app_env=app_env,
        log_level=log_level,
        test_mode=test_mode,
        testing=testing,
        secret_key=os.getenv("SECRET_KEY"),
        jwt_algorithm=os.getenv("JWT_ALGORITHM", "HS256"),
        access_token_expire_minutes=_as_int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES"), 60),
        cors_allow_origins=cors_allow_origins,
        refresh_interval_minutes=refresh_interval_minutes,
        vmware_enabled=overrides.get("vmware_enabled", vmware_enabled) if overrides else vmware_enabled,
        vmware_configured=vmware_configured,
        vmware_missing_envs=vmware_missing_envs,
        cedia_enabled=overrides.get("cedia_enabled", cedia_enabled) if overrides else cedia_enabled,
        cedia_configured=cedia_configured,
        cedia_missing_envs=cedia_missing_envs,
        hyperv_enabled=overrides.get("hyperv_enabled", hyperv_enabled) if overrides else hyperv_enabled,
        hyperv_configured=hyperv_configured,
        hyperv_missing_envs=hyperv_missing_envs,
        vcenter_host=vcenter_host,
        vcenter_user=vcenter_user,
        vcenter_pass=vcenter_pass,
        vmware_job_max_global=_as_int(os.getenv("VMWARE_JOB_MAX_GLOBAL"), 4),
        vmware_job_max_per_scope=_as_int(os.getenv("VMWARE_JOB_MAX_PER_SCOPE"), 2),
        vmware_job_host_timeout=_as_int(os.getenv("VMWARE_JOB_HOST_TIMEOUT"), 150),
        vmware_job_max_duration=_as_int(os.getenv("VMWARE_JOB_MAX_DURATION"), 15 * 60),
        vmware_refresh_interval_minutes=(
            max(
                int(overrides.get("vmware_refresh_interval_minutes")), 10
            )
            if overrides and overrides.get("vmware_refresh_interval_minutes") is not None
            else max(
                _as_int(os.getenv("VMWARE_REFRESH_INTERVAL_MINUTES"), refresh_interval_minutes),
                10,
            )
        ),
        vmware_hosts_job_host_timeout=_as_int(
            os.getenv("VMWARE_HOSTS_JOB_HOST_TIMEOUT"),
            _as_int(os.getenv("VMWARE_JOB_HOST_TIMEOUT"), 150),
        ),
        vmware_hosts_job_max_duration=_as_int(
            os.getenv("VMWARE_HOSTS_JOB_MAX_DURATION"),
            _as_int(os.getenv("VMWARE_JOB_MAX_DURATION"), 15 * 60),
        ),
        vmware_hosts_refresh_interval_minutes=(
            max(
                int(overrides.get("vmware_hosts_refresh_interval_minutes")), 10
            )
            if overrides and overrides.get("vmware_hosts_refresh_interval_minutes") is not None
            else max(
                _as_int(
                    os.getenv("VMWARE_HOSTS_REFRESH_INTERVAL_MINUTES"),
                    _as_int(os.getenv("VMWARE_REFRESH_INTERVAL_MINUTES"), refresh_interval_minutes),
                ),
                10,
            )
        ),
        cedia_base=cedia_base,
        cedia_user=cedia_user,
        cedia_pass=cedia_pass,
        cedia_job_max_global=_as_int(os.getenv("CEDIA_JOB_MAX_GLOBAL"), 4),
        cedia_job_max_per_scope=_as_int(os.getenv("CEDIA_JOB_MAX_PER_SCOPE"), 2),
        cedia_job_host_timeout=_as_int(os.getenv("CEDIA_JOB_HOST_TIMEOUT"), 150),
        cedia_job_max_duration=_as_int(os.getenv("CEDIA_JOB_MAX_DURATION"), 15 * 60),
        cedia_refresh_interval_minutes=(
            max(
                int(overrides.get("cedia_refresh_interval_minutes")), 10
            )
            if overrides and overrides.get("cedia_refresh_interval_minutes") is not None
            else max(
                _as_int(os.getenv("CEDIA_REFRESH_INTERVAL_MINUTES"), refresh_interval_minutes),
                10,
            )
        ),
        hyperv_hosts=hyperv_hosts,
        hyperv_host=hyperv_host,
        hyperv_user=hyperv_user,
        hyperv_pass=hyperv_pass,
        hyperv_transport=os.getenv("HYPERV_TRANSPORT", "ntlm"),
        hyperv_ps_path=os.getenv("HYPERV_PS_PATH"),
        hyperv_cache_ttl=_as_int(os.getenv("HYPERV_CACHE_TTL"), 300),
        hyperv_cache_ttl_summary=_as_int(os.getenv("HYPERV_CACHE_TTL_SUMMARY"), 300),
        hyperv_cache_ttl_detail=_as_int(os.getenv("HYPERV_CACHE_TTL_DETAIL"), 120),
        hyperv_cache_ttl_deep=_as_int(os.getenv("HYPERV_CACHE_TTL_DEEP"), 30),
        hyperv_cache_ttl_hosts=_as_int(os.getenv("HYPERV_CACHE_TTL_HOSTS"), 300),
        hyperv_job_max_global=_as_int(os.getenv("HYPERV_JOB_MAX_GLOBAL"), 4),
        hyperv_job_max_per_scope=_as_int(os.getenv("HYPERV_JOB_MAX_PER_SCOPE"), 2),
        hyperv_job_host_timeout=_as_int(os.getenv("HYPERV_JOB_HOST_TIMEOUT"), 300),
        hyperv_job_max_duration=_as_int(os.getenv("HYPERV_JOB_MAX_DURATION"), 15 * 60),
        hyperv_inventory_read_timeout=_as_int(os.getenv("HYPERV_INVENTORY_READ_TIMEOUT"), 1800),
        hyperv_inventory_retries=_as_int(os.getenv("HYPERV_INVENTORY_RETRIES"), 2),
        hyperv_inventory_backoff_sec=_as_float(os.getenv("HYPERV_INVENTORY_BACKOFF_SEC"), 1.5),
        hyperv_power_read_timeout=_as_int(os.getenv("HYPERV_POWER_READ_TIMEOUT"), 60),
        hyperv_detail_timeout=_as_int(os.getenv("HYPERV_DETAIL_TIMEOUT"), 300),
        hyperv_refresh_interval_minutes=(
            max(
                int(overrides.get("hyperv_refresh_interval_minutes")), 10
            )
            if overrides and overrides.get("hyperv_refresh_interval_minutes") is not None
            else max(
                _as_int(os.getenv("HYPERV_REFRESH_INTERVAL_MINUTES"), refresh_interval_minutes),
                10,
            )
        ),
        notif_sched_enabled=(
            overrides.get("notif_sched_enabled", _as_bool(os.getenv("NOTIF_SCHED_ENABLED")))
            if overrides
            else _as_bool(os.getenv("NOTIF_SCHED_ENABLED"))
        ),
        notif_sched_dev_minutes=(
            _as_int(os.getenv("NOTIF_SCHED_DEV_MINUTES"), 0)
            if os.getenv("NOTIF_SCHED_DEV_MINUTES") is not None
            else None
        ),
        notifs_autoclear_enabled=notifs_autoclear_enabled,
        notifs_retention_days=_as_int(os.getenv("NOTIFS_RETENTION_DAYS"), 180),
        warmup_enabled=overrides.get("warmup_enabled", warmup_enabled) if overrides else warmup_enabled,
    )


settings = _build_settings()
