from typing import List, Optional
from pydantic import BaseModel

# —————— Esquemas de datos para máquinas virtuales ——————
class VMBase(BaseModel):
    """
    Representa la información esencial de una máquina virtual:
      • Identificadores y metadatos (id, nombre, estado de energía).
      • Recursos asignados (número de CPUs, cantidad de memoria).
      • Contexto operativo (entorno, sistema operativo invitado).
      • Ubicación en la infraestructura (host, cluster).
      • Compatibilidad de la versión de la VM (código y descripción).
      • Conectividad de red (redes, direcciones IP, adaptadores de red).
      • Almacenamiento (lista de discos con su capacidad en GB).
    """
    id: str
    name: str
    power_state: str
    cpu_count: int
    memory_size_MiB: int
    environment: str
    guest_os: Optional[str]
    host: str
    cluster: str
    compatibility_code: str      # e.g. "VMX_21"
    compatibility_human: str     # e.g. "ESXi 8.0 U2 and later (VM version 21)"
    networks: List[str]
    ip_addresses: List[str] = []
    disks:        List[str] = []
    nics:         List[str] = []

# —————— Esquema para detalles extendidos ——————
class VMDetail(VMBase):
    """
    Extiende VMBase sin modificaciones adicionales.
    Reservado para incluir, en el futuro, información más detallada
    de la máquina virtual cuando sea necesario.
    """
    pass
