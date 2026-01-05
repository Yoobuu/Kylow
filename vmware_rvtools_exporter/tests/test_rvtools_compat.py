import pytest
from src.rvtools_compat import apply_compatibility, RVTOOLS_HEADERS, to_mib

def test_apply_compatibility_columns_and_order():
    """Test that columns are created and ordered correctly."""
    sheet_name = "vCPU"
    input_rows = [
        {"VM": "vm1", "CPUs": 2, "CoresPerSocket": 1, "vCPU_Reservation": 0}
    ]
    
    expected_headers = RVTOOLS_HEADERS["vCPU"]
    new_rows, new_headers = apply_compatibility(sheet_name, input_rows)
    
    assert new_headers == expected_headers
    assert len(new_rows) == 1
    
    row = new_rows[0]
    # Check mapped fields
    assert row["VM"] == "vm1"
    assert row["CPUs"] == 2
    assert row["Cores p/s"] == 1
    assert row["Reservation"] == 0
    
    # Check unmapped/missing fields are present but empty
    assert "Sockets" in row
    # Depending on mapping Sockets maps to CPUs approx, let's check
    # Mapping says: "Sockets": "CPUs"
    assert row["Sockets"] == 2 
    
    assert "Annotation" in row
    assert row["Annotation"] == ""

def test_apply_compatibility_unit_conversion():
    """Test GB to MiB conversion."""
    sheet_name = "vMemory"
    # Mappings: "Size MiB": ("MemoryMB", to_mib) -> Wait, MemoryMB is collected in MB usually? 
    # Let's check logic. In collector vMemory: props.get("config.hardware.memoryMB") -> MemoryMB
    # In compat: "# Memory": ("Memory_GB", to_mib) for vHost.
    # For vMemory: "Size MiB": "MemoryMB". No conversion if it's already MB.
    # Let's check vDisk: "Capacity MiB": ("CapacityGB", to_mib)
    
    input_rows = [
        {"VM": "vm1", "CapacityGB": 2, "ProvisionedGB": "1.5"}
    ]
    
    new_rows, _ = apply_compatibility("vDisk", input_rows)
    row = new_rows[0]
    
    # 2 GB = 2048 MiB
    assert row["Capacity MiB"] == 2048.0
    # Provisioned MiB is not in vDisk headers, so it won't be in the output row
    # assert row["Provisioned MiB"] == 1536.0

def test_apply_compatibility_empty_input():
    """Test empty input handling for vSnapshot and vCD."""
    for sheet in ["vSnapshot", "vCD"]:
        new_rows, new_headers = apply_compatibility(sheet, [])
        
        assert new_rows == []
        assert new_headers == RVTOOLS_HEADERS[sheet]

def test_to_mib_helper():
    """Test the to_mib helper function directly."""
    assert to_mib(1) == 1024
    assert to_mib("2") == 2048
    assert to_mib(1.5) == 1536
    assert to_mib(None) == ""
    assert to_mib("") == ""
    assert to_mib("invalid") == "invalid"
