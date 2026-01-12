from datetime import datetime, timezone

from app.cedia.metrics import normalize_vcloud_metrics


def test_normalize_vcloud_metrics_extracts_cpu_mem_and_disks():
    now = datetime(2026, 1, 6, 12, 0, 0, tzinfo=timezone.utc)
    payload = {
        "metric": [
            {"name": "cpu.usage.average", "unit": "PERCENT", "value": 12.5},
            {"name": "mem.usage.average", "unit": "PERCENT", "value": "33.2"},
            {"name": "cpu.usagemhz.average", "unit": "MEGAHERTZ", "value": 1500},
            {"name": "disk.used.latest.0", "unit": "KILOBYTE", "value": 1000},
            {"name": "disk.provisioned.latest.0", "unit": "KILOBYTE", "value": 2000},
            {"name": "disk.used.latest.1", "unit": "KILOBYTE", "value": 3000},
            {"name": "disk.provisioned.latest.1", "unit": "KILOBYTE", "value": 4000},
        ]
    }

    result = normalize_vcloud_metrics(payload, now=now)

    assert result["cpu_pct"] == 12.5
    assert result["mem_pct"] == 33.2
    assert result["cpu_mhz"] == 1500
    assert result["metrics_updated_at"] == now
    assert result["disk_used_kb_total"] == 4000
    assert result["disk_provisioned_kb_total"] == 6000
    assert result["disks"] == [
        {"index": 0, "used_kb": 1000.0, "provisioned_kb": 2000.0},
        {"index": 1, "used_kb": 3000.0, "provisioned_kb": 4000.0},
    ]


def test_normalize_vcloud_metrics_empty_payload():
    result = normalize_vcloud_metrics(None)
    assert result == {}
