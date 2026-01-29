from app.ai.normalizers.azure import normalize_azure_vm


def test_normalize_azure_vm_none() -> None:
    vm = normalize_azure_vm(None)
    assert vm.env == "UNKNOWN"


def test_normalize_azure_vm_tags_none() -> None:
    vm = normalize_azure_vm({"tags": None})
    assert vm.env == "UNKNOWN"


def test_normalize_azure_vm_tags_env() -> None:
    vm = normalize_azure_vm({"tags": {"env": "prod"}})
    assert vm.env == "prod"
