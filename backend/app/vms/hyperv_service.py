# filepath: app/vms/hyperv_service.py
from __future__ import annotations
from typing import List
import logging
import os

from cachetools import TTLCache
from pydantic import ValidationError
from app.providers.hyperv.remote import RemoteCreds, run_inventory
from app.providers.hyperv.schema import VMRecord

logger = logging.getLogger("hyperv.service")

# Cache para resultados individuales por host (TTL configurable vía HYPERV_CACHE_TTL, default 5 min)
_CACHE_TTL = int(os.getenv("HYPERV_CACHE_TTL", "300"))
_HOST_CACHE = TTLCache(maxsize=64, ttl=_CACHE_TTL)

# ─────────────────────────────────────────────
# Helper para normalizar porcentajes
# ─────────────────────────────────────────────
def _clamp_pct(val):
    """Evita que valores como 100.01 o 149.26 rompan la validación."""
    try:
        v = float(val)
        if v < 0:
            v = 0.0
        if v > 100:
            v = 100.0
        return round(v, 2)
    except Exception:
        return None


def collect_hyperv_inventory_for_host(
    creds: RemoteCreds,
    ps_content: str,
    use_cache: bool = True,
) -> List[VMRecord]:
    """
    Ejecuta el colector de Hyper-V en el host indicado y valida el
    resultado contra el esquema VMRecord. Devuelve una lista de VMRecord.
    """
    cache_key = (creds.host or "").lower()
    if use_cache and cache_key in _HOST_CACHE:
        logger.debug("HyperV cache hit para host %s", creds.host)
        return _HOST_CACHE[cache_key]

    logger.debug("HyperV inventory miss para host %s -> ejecutando colector", creds.host)
    raw_items = run_inventory(creds, ps_content=ps_content)
    validated: List[VMRecord] = []
    dropped = 0

    for idx, item in enumerate(raw_items):
        # ─── Normalizar porcentajes ───
        item["RAM_UsagePct"] = _clamp_pct(item.get("RAM_UsagePct"))
        disks = item.get("Disks")
        if isinstance(disks, list):
            for d in disks:
                if isinstance(d, dict):
                    d["AllocatedPct"] = _clamp_pct(d.get("AllocatedPct"))

        # ─── Validación con Pydantic ───
        try:
            validated.append(VMRecord.model_validate(item))
        except ValidationError as ve:
            dropped += 1
            logger.warning("Descartada VM #%s de %s: %s", idx, creds.host, ve.errors())

    if dropped:
        logger.info("Host %s: %s VMs válidas, %s descartadas", creds.host, len(validated), dropped)

    _HOST_CACHE[cache_key] = validated
    return validated
