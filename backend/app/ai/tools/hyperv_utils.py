from __future__ import annotations

from pathlib import Path
from typing import List

from app.providers.hyperv.remote import RemoteCreds
from app.settings import settings


def load_ps_content() -> str:
    ps_path = settings.hyperv_ps_path
    if ps_path:
        path = Path(ps_path)
    else:
        path = Path(__file__).resolve().parents[2] / "scripts" / "collect_hyperv_inventory.ps1"
    return path.read_text(encoding="utf-8")


def resolve_hosts() -> List[str]:
    return list(settings.hyperv_hosts_configured)


def build_creds(host: str) -> RemoteCreds:
    return RemoteCreds(
        host=host,
        username=settings.hyperv_user,
        password=settings.hyperv_pass,
        transport=settings.hyperv_transport,
        winrm_https_enabled=settings.hyperv_winrm_https_enabled,
        winrm_http_enabled=settings.hyperv_winrm_http_enabled,
        read_timeout=settings.hyperv_inventory_read_timeout,
        connect_timeout=settings.hyperv_connect_timeout,
        retries=settings.hyperv_inventory_retries,
        backoff_sec=settings.hyperv_inventory_backoff_sec,
        ca_trust_path=settings.hyperv_ca_bundle,
        server_cert_validation="validate" if settings.hyperv_ca_bundle else "ignore",
    )
