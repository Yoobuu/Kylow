# Hyper-V RVTools Exporter - Phase 0

## Architecture
This project is designed to be resilient to intermittent Hyper-V host failures. Unlike vCenter, Hyper-V requires querying each host individually via WinRM.

### Components
*   **Config (`src/config.py`)**: Handles CLI args and `.env` loading.
*   **WinRM Client (`src/winrm_client.py`)**: Robust wrapper around `pywinrm`. Handles chunked script uploads to bypass CLI length limits.
*   **Runner (`src/runner.py`)**: Orchestrator. Manages the "Run ID", executes Pre-flight checks concurrently, and generates the structured JSON report.
*   **Main (`src/main.py`)**: Entry point.

## Workflow
1.  **Init**: Generate unique `run_id`. Load hosts.
2.  **Pre-Flight**: Ping every host (WinRM `hostname`) with a short timeout.
    *   Goal: Fail fast on dead hosts, identify reachable ones.
3.  **Collectors (Future Phase)**: Run heavy scripts only on reachable hosts.
4.  **Reporting**: Save a JSON state file (`hyperv_run_report.json`) containing the status of every attempt.

## Usage (Phase 0)

**Dry Run (Connectivity Check Only):**
```bash
python3 -m src.main --hosts "HOST1,HOST2" --dry-run
```

**Using .env for credentials:**
Ensure `HYPERV_USER` and `HYPERV_PASSWORD` are set in your `.env` file.

**Hosts from file:**
```bash
python3 -m src.main --hosts-file /path/to/hosts.txt
```
The file should contain one host per line.

**Full Run (simulated for Phase 0):**
```bash
python3 -m src.main --hosts "HOST1,HOST2"
```

**Debugging a single collector quickly (no XLSX):**
```bash
python3 -m src.tools.smoke_collect --only vInfo --out-dir ./out
```
This runs only the requested collectors, skips XLSX generation, and prints a short per-collector summary.

## Output
*   Console summary with reachability plus Inventory OK/Partial/Empty/Error counts (coverage threshold defaults to `0.90`, override with `--coverage-threshold 0.9`).
*   `out/hyperv_run_report.json`: Detailed execution log, including per-host reachability, baseline inventory, coverage gaps, and final inventory status.
*   Quick-look CSVs in `out/`:
    *   `host_inventory_coverage.csv`: One row per host with baseline VM count, per-collector VM counts, missing counts, reachability, and `final_status`.
    *   `missing_vms_by_host.csv`: Expanded list of which VM IDs/names are missing in vCPU/vMemory/vNetwork (or baseline) by host.
    *   `targets_retry_hosts.txt`: Hosts where `final_status != Inventory OK` (ready to feed back into the CLI).
    *   Optional: `--allow-partial-ok` keeps coverage gaps in `Inventory OK` (collector errors still show as Partial).

**Retrying hosts only:**
```bash
python3 -m src.main --hosts-file out/targets_retry_hosts.txt --coverage-threshold 0.9
```
The retry file includes hosts with `Inventory Empty` or `Inventory Error` (and any partials if coverage stayed below the threshold).
