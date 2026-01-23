from typing import Dict, List, Optional

from pydantic import BaseModel, Field


class AzureVMRecord(BaseModel):
    provider: str = "azure"
    id: str
    name: str
    subscription_id: Optional[str] = None
    resource_group: Optional[str] = None
    location: Optional[str] = None
    zones: List[str] = Field(default_factory=list)
    power_state: Optional[str] = None
    power_state_display: Optional[str] = None
    power_state_code: Optional[str] = None
    vm_size: Optional[str] = None
    os_type: Optional[str] = None
    guest_os: Optional[str] = None
    cpu_count: Optional[int] = None
    cpu_usage_pct: Optional[float] = None
    memory_size_MiB: Optional[int] = None
    ram_demand_mib: Optional[int] = None
    ram_usage_pct: Optional[float] = None
    provisioning_state: Optional[str] = None
    vm_agent_status: Optional[str] = None
    vm_agent_version: Optional[str] = None
    tags: Optional[Dict[str, str]] = None
    nic_ids: List[str] = Field(default_factory=list)
    nics: List[str] = Field(default_factory=list)
    ip_addresses: List[str] = Field(default_factory=list)
    public_ips: List[str] = Field(default_factory=list)
    public_dns: List[str] = Field(default_factory=list)
    networks: List[str] = Field(default_factory=list)
    disks: List[Dict[str, object]] = Field(default_factory=list)
    time_created: Optional[str] = None
