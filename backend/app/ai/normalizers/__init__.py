from app.ai.normalizers.azure import normalize_azure_vm
from app.ai.normalizers.cedia import normalize_cedia_vm
from app.ai.normalizers.hyperv import normalize_hyperv_vm
from app.ai.normalizers.ovirt import normalize_ovirt_vm
from app.ai.normalizers.vmware import normalize_vmware_vm

__all__ = [
    "normalize_azure_vm",
    "normalize_cedia_vm",
    "normalize_hyperv_vm",
    "normalize_ovirt_vm",
    "normalize_vmware_vm",
]
