from __future__ import annotations

from types import SimpleNamespace

from app.azure import service as azure_service


def _dummy_settings(resource_groups=None):
    return SimpleNamespace(
        test_mode=False,
        azure_configured=True,
        azure_missing_envs=[],
        azure_resource_groups=resource_groups or [],
        azure_subscription_id="sub",
    )


def test_list_azure_vms_with_power_state(monkeypatch):
    vm1 = {
        "id": "/subscriptions/sub/resourceGroups/rg1/providers/Microsoft.Compute/virtualMachines/vm1",
        "name": "vm1",
        "location": "eastus",
        "tags": {"env": "dev"},
        "properties": {
            "provisioningState": "Succeeded",
            "timeCreated": "2025-01-01T00:00:00Z",
            "hardwareProfile": {"vmSize": "Standard_B2s"},
            "storageProfile": {"osDisk": {"osType": "Linux"}},
            "networkProfile": {"networkInterfaces": [{"id": "nic-1"}]},
        },
    }
    vm2 = {
        "id": "/subscriptions/sub/resourceGroups/rg1/providers/Microsoft.Compute/virtualMachines/vm2",
        "name": "vm2",
        "location": "eastus2",
        "properties": {
            "provisioningState": "Succeeded",
            "hardwareProfile": {"vmSize": "Standard_B4ms"},
            "storageProfile": {"osDisk": {"osType": "Windows"}},
            "networkProfile": {"networkInterfaces": [{"id": "nic-2"}]},
        },
    }

    class DummyClient:
        def __init__(self):
            self.compute_api_version = "2025-04-01"

        def arm_get_paged(self, path, params=None):
            return [vm1, vm2]

        def arm_get(self, path, params=None):
            if "vm1" in path:
                return {"statuses": [{"code": "PowerState/running", "displayStatus": "VM running"}]}
            return {"statuses": [{"code": "PowerState/deallocated", "displayStatus": "VM deallocated"}]}

    monkeypatch.setattr(azure_service, "settings", _dummy_settings(["rg1"]))
    monkeypatch.setattr(azure_service, "AzureArmClient", DummyClient)

    records = azure_service.list_azure_vms(include_power_state=True)

    assert len(records) == 2
    assert records[0].resource_group == "rg1"
    assert records[0].vm_size == "Standard_B2s"
    assert records[0].os_type == "Linux"
    assert records[0].power_state == "POWERED_ON"
    assert records[1].power_state == "POWERED_OFF"
