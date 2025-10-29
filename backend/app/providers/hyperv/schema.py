# filepath: app/providers/hyperv/schema.py
from __future__ import annotations
from typing import List, Optional, Union
from pydantic import BaseModel, Field, field_validator

class DiskInfo(BaseModel):
    SizeGiB: Optional[float] = Field(default=None, ge=0)
    AllocatedGiB: Optional[float] = Field(default=None, ge=0)
    # Permitimos >100 porque snapshots/avhdx o contadores pueden inflarlo
    AllocatedPct: Optional[float] = Field(default=None, ge=0)

class HWCompat(BaseModel):
    # En algunos hosts llega como "12.0" o como número; aceptamos ambos
    Version: Optional[Union[str, float, int]] = None
    Generation: Optional[int] = None

class VMRecord(BaseModel):
    HVHost: str
    Name: str
    State: str

    vCPU: Optional[int] = Field(default=None, ge=0)
    CPU_UsagePct: Optional[float] = Field(default=None, ge=0)      # sin límite superior
    RAM_MiB: Optional[int] = Field(default=None, ge=0)
    RAM_Demand_MiB: Optional[int] = Field(default=None, ge=0)
    RAM_UsagePct: Optional[float] = Field(default=None, ge=0)      # sin límite superior

    OS: Optional[str] = None
    Cluster: Optional[str] = None

    VLAN_IDs: List[int] = Field(default_factory=list)
    IPv4: List[str] = Field(default_factory=list)

    CompatHW: Optional[HWCompat] = None
    Disks: List[DiskInfo] = Field(default_factory=list)

    # ─────────────────────────────
    # Normalizaciones / tolerancia
    # ─────────────────────────────
    @field_validator("Disks", mode="before")
    @classmethod
    def _ensure_disks_list(cls, v):
        """
        Acepta:
          - lista de discos
          - un solo disco como dict -> lo envuelve en lista
          - None -> lista vacía
        """
        if v is None:
            return []
        if isinstance(v, dict):
            return [v]
        if isinstance(v, list):
            return v
        # cualquier otra cosa => descartar y seguir
        return []

    @field_validator("CompatHW", mode="before")
    @classmethod
    def _compat_obj_or_none(cls, v):
        """
        Si viene como dict, ok. Si viene vacío o None, lo dejamos en None.
        Si llega en un formato raro, lo ignoramos para no reventar.
        """
        if v in (None, "", {}):
            return None
        if isinstance(v, dict):
            return v
        return None

    model_config = {
        "extra": "ignore",            # ignorar campos desconocidos sin fallar
        "populate_by_name": True
    }
