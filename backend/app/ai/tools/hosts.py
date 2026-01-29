from __future__ import annotations

import logging
from typing import Dict, List, Optional

from sqlmodel import Session

from app.ai.schemas import AIHost, HostFilters
from app.ai.tools.hyperv_utils import build_creds, load_ps_content, resolve_hosts
from app.hosts import host_service, ovirt_host_service
from app.permissions.models import PermissionCode
from app.permissions.service import user_has_permission
from app.settings import settings
from app.vms import hyperv_service

logger = logging.getLogger(__name__)


def _normalize_provider(value: str) -> str:
    return value.strip().lower()


def _normalize_provider_list(values: Optional[List[str]]) -> List[str]:
    if not values:
        return []
    out: List[str] = []
    for value in values:
        if not value:
            continue
        normalized = _normalize_provider(value)
        if normalized == "kvm":
            normalized = "ovirt"
        out.append(normalized)
    return list(dict.fromkeys(out))


def _apply_host_filters(hosts: List[AIHost], filters: HostFilters) -> List[AIHost]:
    def contains(value: Optional[str], needle: Optional[str]) -> bool:
        if not needle:
            return True
        if not value:
            return False
        return needle.lower() in value.lower()

    filtered: List[AIHost] = []
    for host in hosts:
        if filters.env and host.env not in filters.env:
            continue
        if filters.state and (host.state or "").lower() != filters.state.lower():
            continue
        if filters.name_contains:
            if not contains(host.name, filters.name_contains) and not contains(host.id, filters.name_contains):
                continue
        filtered.append(host)

    if filters.sort == "name_desc":
        filtered.sort(key=lambda item: item.name or "", reverse=True)
    elif filters.sort == "name_asc":
        filtered.sort(key=lambda item: item.name or "")

    return filtered[: filters.limit]


def _note(notes: Optional[List[Dict[str, object]]], provider: str, message: str) -> None:
    if notes is None:
        return
    notes.append({"provider": provider, "note": message})


def list_hosts(
    filters: HostFilters,
    *,
    user,
    session: Session,
    notes: Optional[List[Dict[str, object]]] = None,
) -> List[AIHost]:
    providers = _normalize_provider_list(filters.provider)
    if not providers:
        # Default to providers that are typically fast/HTTP-based; include Hyper-V only when explicitly requested.
        providers = ["vmware", "ovirt"]

    results: List[AIHost] = []
    for provider in providers:
        try:
            if provider == "vmware":
                if not user_has_permission(user, PermissionCode.VMS_VIEW, session):
                    _note(notes, provider, "sin permiso")
                    continue
                if not settings.vmware_enabled or not settings.vmware_configured:
                    _note(notes, provider, "provider deshabilitado o sin configurar")
                    continue
                hosts = host_service.get_hosts_summary(refresh=False)
                for host in hosts:
                    results.append(
                        AIHost(
                            provider="vmware",
                            env="UNKNOWN",
                            id=str(host.id),
                            name=str(host.name or host.id),
                            state=host.connection_state or host.power_state,
                        )
                    )
                continue

            if provider == "ovirt":
                if not user_has_permission(user, PermissionCode.VMS_VIEW, session):
                    _note(notes, provider, "sin permiso")
                    continue
                if not settings.ovirt_enabled or not settings.ovirt_configured:
                    _note(notes, provider, "provider deshabilitado o sin configurar")
                    continue
                hosts = ovirt_host_service.get_hosts_summary(refresh=False)
                for host in hosts:
                    results.append(
                        AIHost(
                            provider="ovirt",
                            env="UNKNOWN",
                            id=str(host.id),
                            name=str(host.name or host.id),
                            state=host.connection_state or host.power_state,
                        )
                    )
                continue

            if provider == "hyperv":
                if not user_has_permission(user, PermissionCode.HYPERV_VIEW, session):
                    _note(notes, provider, "sin permiso")
                    continue
                if not settings.hyperv_enabled or not settings.hyperv_configured:
                    _note(notes, provider, "provider deshabilitado o sin configurar")
                    continue
                hosts_list = resolve_hosts()
                if not hosts_list:
                    _note(notes, provider, "sin hosts configurados")
                    continue
                ps_content = load_ps_content()
                for host_name in hosts_list:
                    try:
                        creds = build_creds(host_name)
                        host = hyperv_service.collect_hyperv_host_info(
                            creds,
                            ps_content=ps_content,
                            use_cache=True,
                        )
                        results.append(
                            AIHost(
                                provider="hyperv",
                                env="UNKNOWN",
                                id=str(host.host),
                                name=str(host.host),
                                state=None,
                            )
                        )
                    except Exception as exc:
                        logger.warning("Hyper-V host summary failed for %s: %s", host_name, exc)
                        _note(notes, provider, f"error en host {host_name}")
                continue

            _note(notes, provider, "provider no soportado")
        except Exception as exc:
            logger.exception("list_hosts provider %s failed", provider)
            _note(notes, provider, f"error: {exc}")

    return _apply_host_filters(results, filters)


def get_host_detail(
    provider: str,
    env: str,
    id: str,
    *,
    user,
    session: Session,
) -> AIHost:
    provider_norm = _normalize_provider(provider)
    if provider_norm == "vmware":
        if not user_has_permission(user, PermissionCode.VMS_VIEW, session):
            raise PermissionError("sin permiso")
        if not settings.vmware_enabled or not settings.vmware_configured:
            raise RuntimeError("provider deshabilitado o sin configurar")
        host = host_service.get_host_detail(id, refresh=False)
        return AIHost(
            provider="vmware",
            env=env or "UNKNOWN",
            id=str(host.id),
            name=str(host.name or host.id),
            state=host.quick_stats.get("connection_state") if isinstance(host.quick_stats, dict) else None,
        )

    if provider_norm == "ovirt":
        if not user_has_permission(user, PermissionCode.VMS_VIEW, session):
            raise PermissionError("sin permiso")
        if not settings.ovirt_enabled or not settings.ovirt_configured:
            raise RuntimeError("provider deshabilitado o sin configurar")
        host = ovirt_host_service.get_host_detail(id, refresh=False)
        return AIHost(
            provider="ovirt",
            env=env or "UNKNOWN",
            id=str(host.id),
            name=str(host.name or host.id),
            state=host.connection_state or host.power_state,
        )

    if provider_norm == "hyperv":
        if not user_has_permission(user, PermissionCode.HYPERV_VIEW, session):
            raise PermissionError("sin permiso")
        if not settings.hyperv_enabled or not settings.hyperv_configured:
            raise RuntimeError("provider deshabilitado o sin configurar")
        hosts_list = resolve_hosts()
        if not hosts_list:
            raise RuntimeError("sin hosts configurados")
        ps_content = load_ps_content()
        target = id
        creds = build_creds(target)
        host = hyperv_service.collect_hyperv_host_info(
            creds,
            ps_content=ps_content,
            use_cache=True,
        )
        return AIHost(
            provider="hyperv",
            env=env or "UNKNOWN",
            id=str(host.host),
            name=str(host.host),
            state=None,
        )

    raise ValueError(f"Provider '{provider_norm}' no soportado")
