import time
import uuid
import json
import csv
import logging
import concurrent.futures
from datetime import datetime, timezone
from typing import Dict, Any, List, Set
from dataclasses import replace

from .config import Config
from .winrm_client import WinRMClient
from .collectors.base import CollectorResult
from .collectors.capabilities import CapabilitiesCollector
from .collectors.metadata import VMetaDataCollector
from .collectors.source import VSourceCollector
from .collectors.vhost import VHostCollector
from .collectors.vinfo import VInfoCollector
from .collectors.vcpu_vmemory import VCpuVMemoryCollector
from .collectors.vnetwork import VNetworkCollector
from .collectors.vdisk import VDiskCollector
from .collectors.vpartition import VPartitionCollector
from .collectors.vsnapshot import VSnapshotCollector
from .collectors.host_facts import HostFactsCollector
from .contracts import load_or_build_contract
from .writers import RVToolsXlsxWriter

logger = logging.getLogger("hyperv.runner")

class Runner:
    def __init__(self, config: Config):
        self.config = config
        self.run_id = f"{datetime.now(timezone.utc).strftime('%Y%m%d_%H%M%S')}_{uuid.uuid4().hex[:6]}"
        self.contract = {}
        self.coverage: Dict[str, Any] = {}
        self.host_inventory: Dict[str, Any] = {}
        self.requested_collectors: Set[str] = set()
        self.sheet_rows: Dict[str, List[Dict[str, Any]]] = {}
        self.report = {
            "run_id": self.run_id,
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "config": {
                "user": self.config.username,
                "hosts_targeted_count": len(self.config.hosts),
                "dry_run": self.config.dry_run,
                "auth_probe": self.config.auth_probe,
                "enable_collectors": self.config.enable_collectors,
                "host_facts": self.config.host_facts,
                "collector_timeout_sec": self.config.collector_timeout_sec,
                "baseline_timeout_sec": self.config.baseline_timeout_sec,
                "coverage_threshold": self.config.coverage_threshold,
                "allow_partial_ok": self.config.allow_partial_ok,
                "xlsx_output": str(self.config.xlsx_output_path),
                "contract_json": str(self.config.contract_json_path)
            },
            "inventory": self.config.hosts,
            "hosts": {},
            "pre_flight": {},
            "collectors": {},
            "coverage": {},
            "contract": {},
            "summary": {
                "hosts_targeted": len(self.config.hosts),
                "hosts_reachable": 0,
                "inventory_ok": 0,
                "inventory_partial": 0,
                "inventory_empty": 0,
                "inventory_error": 0,
                "hosts_failed": [],
                "duration_sec": 0
            }
        }

    def _categorize_error(self, error_msg: str, exit_code: int) -> Dict[str, str]:
        """Classify WinRM errors for better diagnostics."""
        cat = "UNKNOWN"
        short = str(error_msg)[:200]
        
        if "401" in error_msg or "credentials were rejected" in error_msg or "Access is denied" in error_msg:
            cat = "AUTH_REJECTED"
        elif "timed out" in error_msg or "timeout" in error_msg.lower():
            cat = "TIMEOUT"
        elif "Connection refused" in error_msg:
            cat = "CONNECTION_REFUSED"
        elif "certificate" in error_msg.lower() or "ssl" in error_msg.lower():
            cat = "TLS_ERROR"
        elif "resolve" in error_msg.lower() or "unknown host" in error_msg.lower():
            cat = "DNS_ERROR"
        
        return {
            "error_category": cat,
            "error_detail": short
        }

    def _vm_key(self, row: Dict[str, Any]) -> str:
        """Choose a stable VM identifier: prefer VM ID, fallback to VM name."""
        if not row:
            return ""
        vmid = str(row.get("VM ID") or row.get("VMID") or "").strip()
        if vmid:
            return vmid
        name = str(row.get("VM") or row.get("VM Name") or "").strip()
        return name

    def _baseline_status_from_coverage(self, cov: Dict[str, Any], vm_count: int = 0) -> str:
        if not cov:
            return "ERROR" if vm_count == 0 else "UNKNOWN"
        status = cov.get("status")
        if status == "timeout":
            return "TIMEOUT"
        if status in ("winrm_error", "auth_failed", "parse_error", "not_supported"):
            return "ERROR"
        if status == "empty" or vm_count == 0:
            return "EMPTY"
        if status == "success":
            return "OK"
        return "ERROR" if status else "UNKNOWN"

    def _is_error_status(self, status: str) -> bool:
        return bool(status) and status not in ("success", "empty")

    def _expand_requested_collectors(self, requested: Set[str]) -> Set[str]:
        """Normalize --only list to include combined collectors."""
        expanded = set(requested)
        # Normalize aliases to combined vCPU_vMemory collector
        if {"vcpu", "vmemory"} & expanded:
            expanded.add("vcpu_vmemory")
        return expanded

    def _check_host(self, host: str, config: Config = None) -> Dict[str, Any]:
        """Fast connectivity check."""
        cfg = config or self.config
        client = WinRMClient(host, cfg)
        start = time.time()
        # Simple command to check connectivity/auth
        result = client.run_command("hostname")
        duration = time.time() - start
        
        status = "OK"
        error_info = {}
        
        if result.error:
            status = "ERROR"
            error_info = self._categorize_error(result.error, -1)
        elif result.exit_code != 0:
            status = "EXEC_FAIL"
            error_info = {"error_category": "NON_ZERO_EXIT", "error_detail": result.stderr}
        
        return {
            "host": host,
            "status": status,
            "latency_ms": round(duration * 1000, 2),
            "endpoint": f"{cfg.winrm_scheme}://{host}:{cfg.winrm_port} ({cfg.winrm_transport})",
            "hostname": result.stdout.strip(),
            **error_info
        }

    def run_auth_probe(self):
        """Try different auth combinations for unreachable hosts."""
        logger.info("Starting Auth Probe...")
        
        # Strategies to try
        strategies = [
            # Standard NTLM HTTP 5985
            {"transport": "ntlm", "scheme": "http", "port": 5985},
            # Kerberos HTTP 5985 (needs domain setup usually)
            {"transport": "kerberos", "scheme": "http", "port": 5985},
            # CredSSP HTTP 5985
            {"transport": "credssp", "scheme": "http", "port": 5985},
            # Basic HTTPS 5986
            {"transport": "basic", "scheme": "https", "port": 5986},
            # NTLM HTTPS 5986
            {"transport": "ntlm", "scheme": "https", "port": 5986},
        ]
        
        probe_results = []
        
        # Only probe a subset or all? All for now.
        for host in self.config.hosts:
            logger.info(f"Probing {host}...")
            host_res = {"host": host, "success": False, "working_strategy": None, "attempts": []}
            
            for strat in strategies:
                # Create temp config
                # We need to copy the dataclass. 'replace' is from dataclasses but I imported it from copy in prev snippet?
                # No, replace is in dataclasses. I imported from copy? Let me check import.
                # Actually I should use dataclasses.replace
                
                # Check if current config matches this strategy to avoid redundant check if pre-flight ran?
                # But pre-flight uses self.config.
                
                # Try variants of username
                user_variants = [self.config.username]
                if "@" in self.config.username:
                    # try domain\user
                    u, d = self.config.username.split("@")
                    user_variants.append(f"{d}\\{u}")
                elif "\\" in self.config.username:
                    # try user@domain
                    d, u = self.config.username.split("\\")
                    user_variants.append(f"{u}@{d}")
                
                for user_var in user_variants:
                    # from dataclasses import replace # Moved import to top
                    test_cfg = replace(self.config, 
                                       username=user_var,
                                       winrm_transport=strat["transport"],
                                       winrm_scheme=strat["scheme"],
                                       winrm_port=strat["port"])
                    
                    res = self._check_host(host, test_cfg)
                    attempt_info = {
                        "strategy": strat,
                        "user": user_var,
                        "result": res["status"],
                        "error": res.get("error_category")
                    }
                    host_res["attempts"].append(attempt_info)
                    
                    if res["status"] == "OK":
                        host_res["success"] = True
                        host_res["working_strategy"] = {**strat, "user": user_var}
                        logger.info(f"SUCCESS {host}: {strat} user={user_var}")
                        break # Stop trying for this host
                
                if host_res["success"]:
                    break
            
            probe_results.append(host_res)
            
        self.report["auth_probe"] = probe_results
        
        # Print Probe Summary
        print("\n=== Auth Probe Results ===")
        print(f"{'Host':<15} | {'Status':<10} | {'Method':<40}")
        print("-" * 70)
        for r in probe_results:
            status = "OK" if r["success"] else "FAIL"
            method = str(r["working_strategy"]) if r["success"] else "All failed"
            print(f"{r['host']:<15} | {status:<10} | {method:<40}")
        print("="*70 + "\n")

    def run_pre_flight(self):
        logger.info("Starting Pre-Flight check...")
        results = {}
        reachable_count = 0
        failed_hosts = []

        with concurrent.futures.ThreadPoolExecutor(max_workers=self.config.max_concurrency) as executor:
            future_to_host = {executor.submit(self._check_host, h): h for h in self.config.hosts}
            
            for future in concurrent.futures.as_completed(future_to_host):
                host = future_to_host[future]
                try:
                    data = future.result()
                    results[host] = data
                    if data["status"] == "OK":
                        reachable_count += 1
                        logger.info(f"[{host}] Pre-flight OK ({data['latency_ms']}ms)")
                    else:
                        failed_hosts.append(host)
                        logger.warning(f"[{host}] Pre-flight FAILED: {data.get('error_category')} - {data.get('error_detail')}")
                except Exception as exc:
                    logger.error(f"[{host}] Pre-flight EXCEPTION: {exc}")
                    results[host] = {"status": "EXCEPTION", "error": str(exc)}
                    failed_hosts.append(host)

        self.report["pre_flight"] = results
        self.report["summary"]["hosts_reachable"] = reachable_count
        self.report["summary"]["hosts_failed"] = failed_hosts
        return reachable_count > 0

    def _ensure_contract(self):
        """Load or build the RVTools contract JSON."""
        self.contract = load_or_build_contract(self.config.contract_source_path, self.config.contract_json_path)
        self.report["contract"] = {
            "sheet_order": self.contract.get("sheet_order", []),
            "source_file": str(self.config.contract_source_path),
            "json_path": str(self.config.contract_json_path)
        }
        logger.info(f"Contract ready with {len(self.contract.get('sheet_order', []))} sheets.")

    def _write_xlsx(self, sheet_rows: Dict[str, List[Dict[str, Any]]]):
        """Generate the RVTools-style XLSX using the writer."""
        writer = RVToolsXlsxWriter(self.contract)
        summary = writer.write(sheet_rows, self.config.xlsx_output_path)
        self.report["xlsx_output"] = {
            "path": str(self.config.xlsx_output_path),
            "sheets": summary
        }
        print("\n=== RVTools XLSX Summary ===")
        for item in summary:
            print(f"{item['sheet']}: cols={item['columns']} rows={item['rows']}")
        print("============================\n")

    def _init_coverage_entry(self, collector_name: str):
        if collector_name not in self.coverage:
            self.coverage[collector_name] = {}

    def _normalize_result(self, result: CollectorResult) -> CollectorResult:
        # Fill coverage defaults
        rows_per_sheet = {s: len(v) for s, v in (result.sheet_rows or {}).items()}
        cov = result.coverage or {}
        cov.setdefault("status", "success")
        cov.setdefault("error_short", "")
        cov.setdefault("rows_per_sheet", rows_per_sheet)
        result.coverage = cov
        return result

    def _run_collector_once(self, collector, host: str, context: Dict[str, Any] = None, timeout_seconds: int = None) -> CollectorResult:
        """
        Execute a collector for a host (or offline) with timeout protection.
        """
        start = time.perf_counter()
        timeout_val = timeout_seconds or self.config.collector_timeout_sec

        def call():
            client = None
            if not getattr(collector, "offline", False) and host:
                client = WinRMClient(host, self.config)
            return collector.run_for_host(host, client, self.contract, self.config, context=context)

        with concurrent.futures.ThreadPoolExecutor(max_workers=1) as executor:
            future = executor.submit(call)
            try:
                result = future.result(timeout=timeout_val)
            except concurrent.futures.TimeoutError:
                duration_ms = round((time.perf_counter() - start) * 1000, 2)
                return CollectorResult(
                    sheet_rows={},
                    coverage={
                        "status": "timeout",
                        "error_short": "timeout",
                        "duration_ms": duration_ms,
                        "rows_per_sheet": {},
                        "timeout_seconds": timeout_val,
                        "exception_type": "TimeoutError",
                        "exception_message": "collector timeout",
                        "traceback_snip": "",
                    }
                )
            except Exception as exc:
                import traceback
                duration_ms = round((time.perf_counter() - start) * 1000, 2)
                tb = traceback.format_exc()
                return CollectorResult(
                    sheet_rows={},
                    coverage={
                        "status": "winrm_error",
                        "error_short": str(exc)[:200],
                        "duration_ms": duration_ms,
                        "rows_per_sheet": {},
                        "exception_type": exc.__class__.__name__,
                        "exception_message": str(exc),
                        "traceback_snip": tb[-8000:],
                    }
                )

        duration_ms = round((time.perf_counter() - start) * 1000, 2)
        result = self._normalize_result(result)
        if "duration_ms" not in result.coverage or result.coverage.get("duration_ms", 0) <= 0:
            result.coverage["duration_ms"] = duration_ms
        return result

    def _run_baseline_with_retry(self, collector, host: str, context: Dict[str, Any] = None) -> CollectorResult:
        """
        Baseline (vInfo) retry: single retry with backoff when inventory is empty or errors out.
        """
        result = self._run_collector_once(collector, host, context=context, timeout_seconds=self.config.baseline_timeout_sec)
        cov = result.coverage or {}
        rows_count = 0
        if cov.get("rows_per_sheet"):
            rows_count = cov.get("rows_per_sheet", {}).get("vInfo", 0) or 0
        baseline_status = self._baseline_status_from_coverage(cov, rows_count)
        if baseline_status in ("EMPTY", "ERROR", "TIMEOUT"):
            logger.warning(f"[{collector.name}][{host}] baseline retry after status={baseline_status}")
            time.sleep(3)
            result_retry = self._run_collector_once(collector, host, context=context, timeout_seconds=self.config.baseline_timeout_sec)
            retry_cov = result_retry.coverage or {}
            retry_cov["retried"] = True
            retry_cov["first_attempt_status"] = cov.get("status")
            retry_cov["first_attempt_error"] = cov.get("error_short", "")
            result_retry.coverage = retry_cov
            return result_retry
        return result

    def _run_collector_with_retry(self, collector, host: str, context: Dict[str, Any] = None) -> CollectorResult:
        return self._run_collector_once(collector, host, context=context)

    def _aggregate_result(self, collector_name: str, host: str, result: CollectorResult, sheet_rows: Dict[str, List[Dict[str, Any]]]):
        # Append rows per sheet
        for sheet, rows in (result.sheet_rows or {}).items():
            sheet_rows.setdefault(sheet, []).extend(rows)

        self._init_coverage_entry(collector_name)
        host_key = host or "local"
        cov = result.coverage or {}
        self.coverage[collector_name][host_key] = cov
        entry = self.report["collectors"].setdefault(collector_name, {"rows": [], "per_host": {}, "attempted_hosts": [], "success_hosts": [], "status": "ran"})
        entry["attempted_hosts"].append(host_key)
        entry["per_host"][host_key] = cov
        if cov.get("status") == "success":
            entry["success_hosts"].append(host_key)
        # Keep collector rows aggregated (optional)
        for rows in (result.sheet_rows or {}).values():
            entry["rows"].extend(rows)
        entry["rows_total"] = len(entry["rows"])

    def _align_vm_sheets(self, sheet_rows: Dict[str, List[Dict[str, Any]]]):
        """Align VM-level sheets to vInfo VM IDs to avoid duplicates (per cluster)."""
        vinfo_rows = sheet_rows.get("vInfo", []) or []
        vmids = {r.get("VM ID") for r in vinfo_rows if r.get("VM ID")}
        if not vmids:
            return
        def align_simple(sheet: str):
            rows = sheet_rows.get(sheet)
            if rows is None:
                return
            before = len(rows)
            filtered = []
            missing_id = []
            for r in rows:
                vmid = r.get("VM ID")
                if vmid:
                    if vmid in vmids:
                        filtered.append(r)
                else:
                    missing_id.append(r)
            after_filter = len(filtered) + len(missing_id)
            seen = set()
            deduped = []
            dropped_dup = 0
            for r in filtered:
                vmid = r.get("VM ID")
                if vmid in seen:
                    dropped_dup += 1
                    continue
                seen.add(vmid)
                deduped.append(r)
            combined = deduped + missing_id
            sheet_rows[sheet] = combined
            dropped_not_in_set = before - after_filter
            logger.info(
                f"{sheet} align: before={before} after_filter={after_filter} after_dedupe={len(combined)} "
                f"dropped_not_in_set={dropped_not_in_set} missing_id={len(missing_id)} dropped_dups={dropped_dup}"
            )

        def align_network(sheet: str):
            rows = sheet_rows.get(sheet)
            if rows is None:
                return
            before = len(rows)
            filtered = []
            missing_id = []
            for r in rows:
                vmid = r.get("VM ID")
                if vmid:
                    if vmid in vmids:
                        filtered.append(r)
                else:
                    missing_id.append(r)
            after_filter = len(filtered) + len(missing_id)
            seen = set()
            deduped = []
            dropped_dup = 0
            for r in filtered:
                key = (r.get("VM ID"), r.get("NIC label"), r.get("Mac Address"))
                if key in seen:
                    dropped_dup += 1
                    continue
                seen.add(key)
                deduped.append(r)
            combined = deduped + missing_id
            sheet_rows[sheet] = combined
            dropped_not_in_set = before - after_filter
            logger.info(
                f"{sheet} align: before={before} after_filter={after_filter} after_dedupe={len(combined)} "
                f"dropped_not_in_set={dropped_not_in_set} missing_id={len(missing_id)} dropped_dups={dropped_dup}"
            )

        for sheet in ("vCPU", "vMemory"):
            align_simple(sheet)
        align_network("vNetwork")
        # Deduplicate vDisk by VMID+DiskPath
        disk_rows = sheet_rows.get("vDisk")
        if disk_rows is not None:
            before = len(disk_rows)
            filtered = []
            missing_id = []
            seen = set()
            for r in disk_rows:
                vmid = r.get("VM ID")
                path = r.get("Disk Path") or r.get("DiskPath")
                if vmid and path:
                    key = (vmid, path)
                    if key in seen:
                        continue
                    seen.add(key)
                    filtered.append(r)
                else:
                    missing_id.append(r)
            sheet_rows["vDisk"] = filtered + missing_id
            logger.info(f"vDisk align: before={before} after={len(sheet_rows['vDisk'])} missing_id={len(missing_id)}")

        # Deduplicate vPartition by VMID+DiskKey
        part_rows = sheet_rows.get("vPartition")
        if part_rows is not None:
            before = len(part_rows)
            filtered = []
            missing_id = []
            seen = set()
            for r in part_rows:
                vmid = r.get("VM ID")
                diskkey = r.get("Disk Key")
                if vmid and diskkey:
                    key = (vmid, diskkey)
                    if key in seen:
                        continue
                    seen.add(key)
                    filtered.append(r)
                else:
                    missing_id.append(r)
            sheet_rows["vPartition"] = filtered + missing_id
            logger.info(f"vPartition align: before={before} after={len(sheet_rows['vPartition'])} missing_id={len(missing_id)}")

    def _mark_collector_skipped(self, collector_name: str, reason: str):
        self.report["collectors"][collector_name] = {
            "status": "skipped",
            "reason": reason,
            "rows": [],
            "per_host": {},
            "attempted_hosts": [],
            "success_hosts": [],
            "rows_total": 0
        }

    def _augment_host_sheet(self, sheet_rows: Dict[str, List[Dict[str, Any]]]):
        """Compute host aggregates from existing sheets."""
        vinfo = sheet_rows.get("vInfo", []) or []
        vcpu = sheet_rows.get("vCPU", []) or []
        vmem = sheet_rows.get("vMemory", []) or []
        vhost = sheet_rows.get("vHost", [])
        if vhost is None:
            return

        # Aggregations by Host
        vm_count = {}
        cpu_sum = {}
        mem_sum = {}

        for r in vinfo:
            host = r.get("Host")
            if not host:
                continue
            vm_count[host] = vm_count.get(host, 0) + 1
            try:
                mem_val = float(r.get("Memory") or 0)
                mem_sum[host] = mem_sum.get(host, 0) + mem_val
            except Exception:
                pass

        for r in vcpu:
            host = r.get("Host")
            if not host:
                continue
            try:
                cpu_val = float(r.get("CPUs") or 0)
                cpu_sum[host] = cpu_sum.get(host, 0) + cpu_val
            except Exception:
                pass

        if not vm_count and not cpu_sum and not mem_sum:
            return

        for r in vhost:
            host = r.get("Host")
            if not host:
                continue
            cores = None
            try:
                cores = float(r.get("# Cores") or 0)
            except Exception:
                cores = None

            vm_total = vm_count.get(host)
            vcpus_total = cpu_sum.get(host)
            mem_total = mem_sum.get(host)

            cols = self.contract.get("sheets", {}).get("vHost", {}).get("columns", [])
            if " # VMs" in cols or "# VMs" in cols:
                if vm_total is not None:
                    r["# VMs"] = vm_total
                    r["# VMs total"] = vm_total
            else:
                if vm_total is not None:
                    r["# VMs"] = vm_total

            if "# vCPUs" in cols and vcpus_total is not None:
                r["# vCPUs"] = vcpus_total

            if "vRAM" in cols and mem_total is not None:
                r["vRAM"] = mem_total

            if "VMs per Core" in cols and vm_total is not None and cores:
                try:
                    r["VMs per Core"] = round(vm_total / cores, 2)
                except Exception:
                    pass

            if "vCPUs per Core" in cols and vcpus_total is not None and cores:
                try:
                    r["vCPUs per Core"] = round(vcpus_total / cores, 2)
                except Exception:
                    pass

    def _vm_map_for_host(self, rows: List[Dict[str, Any]], host: str) -> Dict[str, str]:
        host_norm = (host or "").lower()
        mapping: Dict[str, str] = {}
        for r in rows or []:
            r_host = str(r.get("Host") or "").lower()
            if r_host != host_norm:
                continue
            key = self._vm_key(r)
            if not key:
                continue
            name = str(r.get("VM") or r.get("VM Name") or "").strip()
            mapping[key] = name
        return mapping

    def _vm_set_for_host(self, rows: List[Dict[str, Any]], host: str) -> Set[str]:
        return set(self._vm_map_for_host(rows, host).keys())

    def _compute_host_inventory(self, sheet_rows: Dict[str, List[Dict[str, Any]]]):
        vinfo_rows = sheet_rows.get("vInfo", []) or []
        vcpu_rows = sheet_rows.get("vCPU", []) or []
        vmem_rows = sheet_rows.get("vMemory", []) or []
        vnet_rows = sheet_rows.get("vNetwork", []) or []
        vdisk_rows = sheet_rows.get("vDisk", []) or []

        coverage_vinfo = self.coverage.get("vInfo", {}) or {}
        coverage_cpu = self.coverage.get("vCPU_vMemory", {}) or {}
        coverage_net = self.coverage.get("vNetwork", {}) or {}
        coverage_disk = self.coverage.get("vDisk", {}) or {}

        pre_flight = self.report.get("pre_flight", {})
        threshold = self.config.coverage_threshold or 0.90
        requested = self.requested_collectors or set()
        cpu_requested = (not requested) or any(name in requested for name in ("vcpu", "vmemory", "vcpu_vmemory"))
        net_requested = (not requested) or ("vnetwork" in requested)
        disk_requested = (not requested) or ("vdisk" in requested)

        host_inventory: Dict[str, Any] = {}
        status_groups = {
            "Inventory OK": [],
            "Inventory Partial": [],
            "Inventory Empty": [],
            "Inventory Error": []
        }
        missing_rows: List[Dict[str, Any]] = []

        for host in self.config.hosts:
            reach = pre_flight.get(host, {})
            reachable = reach.get("status") == "OK"
            reachability = {
                "status": reach.get("status", "UNKNOWN"),
                "latency_ms": reach.get("latency_ms"),
                "endpoint": reach.get("endpoint"),
                "hostname": reach.get("hostname")
            }

            baseline_map = self._vm_map_for_host(vinfo_rows, host)
            baseline_set = set(baseline_map.keys())
            baseline_cov = coverage_vinfo.get(host, {})
            if not baseline_cov:
                baseline_cov = {"status": "not_run", "error_short": "no coverage", "reason": "not_run"}
            baseline_status = self._baseline_status_from_coverage(baseline_cov, len(baseline_set))
            stderr_snip = ""
            if baseline_cov:
                stderr_snip = (baseline_cov.get("stderr") or baseline_cov.get("error_short") or "")[:8000]
            baseline_info = {
                "status": baseline_status,
                "vm_count": len(baseline_set),
                "vm_ids_returned": sorted(list(baseline_set)),
                "vm_names_returned": sorted([v for v in baseline_map.values() if v]),
                "vm_ids_sample": sorted(list(baseline_set))[:10],
                "vm_names_sample": sorted([v for v in baseline_map.values() if v])[:10],
                "exit_code": baseline_cov.get("exit_code"),
                "stderr_snip": stderr_snip,
                "duration_ms": baseline_cov.get("duration_ms"),
                "raw_status": baseline_cov.get("status"),
                "error_short": baseline_cov.get("error_short"),
                "exception_type": baseline_cov.get("exception_type"),
                "exception_message": baseline_cov.get("exception_message"),
                "traceback_snip": baseline_cov.get("traceback_snip"),
                "reason": baseline_cov.get("reason"),
            }

            cpu_cov_host = coverage_cpu.get(host)
            net_cov_host = coverage_net.get(host)
            disk_cov_host = coverage_disk.get(host)

            vcpu_set = self._vm_set_for_host(vcpu_rows, host) if cpu_cov_host else (set() if cpu_requested else None)
            vmem_set = self._vm_set_for_host(vmem_rows, host) if cpu_cov_host else (set() if cpu_requested else None)
            vnet_set = self._vm_set_for_host(vnet_rows, host) if net_cov_host else (set() if net_requested else None)
            vdisk_set = self._vm_set_for_host(vdisk_rows, host) if disk_cov_host else (set() if disk_requested else None)

            missing_vcpu = (baseline_set - vcpu_set) if vcpu_set is not None else "not_run"
            missing_vmem = (baseline_set - vmem_set) if vmem_set is not None else "not_run"
            missing_vnet = (baseline_set - vnet_set) if vnet_set is not None else "not_run"
            missing_vdisk = (baseline_set - vdisk_set) if vdisk_set is not None else "not_run"
            sets_for_union = [s for s in (vcpu_set, vmem_set, vnet_set, vdisk_set) if s is not None]
            if sets_for_union:
                union_all = set().union(*sets_for_union)
                missing_any = baseline_set - union_all
            else:
                missing_any = set()

            for vm_id in sorted(baseline_set):
                vm_name = baseline_map.get(vm_id, "")
                if isinstance(missing_vcpu, set) and vm_id in missing_vcpu:
                    missing_rows.append({"host": host, "vm_id": vm_id, "vm_name": vm_name, "missing_in": "vCPU"})
                if isinstance(missing_vmem, set) and vm_id in missing_vmem:
                    missing_rows.append({"host": host, "vm_id": vm_id, "vm_name": vm_name, "missing_in": "vMemory"})
                if isinstance(missing_vnet, set) and vm_id in missing_vnet:
                    missing_rows.append({"host": host, "vm_id": vm_id, "vm_name": vm_name, "missing_in": "vNetwork"})

            if baseline_status in ("ERROR", "TIMEOUT", "EMPTY") or (not baseline_set and not reachable):
                missing_rows.append({"host": host, "vm_id": "", "vm_name": "", "missing_in": "baseline"})

            collector_errors_present = False
            collector_error_statuses = {}
            for cname, cmap in [("vCPU_vMemory", coverage_cpu), ("vNetwork", coverage_net), ("vDisk", coverage_disk)]:
                cov = cmap.get(host, {})
                if self._is_error_status(cov.get("status")):
                    collector_errors_present = True
                    collector_error_statuses[cname] = cov.get("status")

            coverage_gap = False
            if baseline_set:
                if vcpu_set is not None and len(vcpu_set) < threshold * len(baseline_set):
                    coverage_gap = True
                if vmem_set is not None and len(vmem_set) < threshold * len(baseline_set):
                    coverage_gap = True
                if vnet_set is not None and len(vnet_set) < threshold * len(baseline_set):
                    coverage_gap = True

            partial_reason = []
            if baseline_status == "EMPTY":
                partial_reason.append("baseline_empty")
            if baseline_status in ("ERROR", "TIMEOUT"):
                partial_reason.append("baseline_error")
            if coverage_gap:
                partial_reason.append("coverage_gap")
            if collector_errors_present:
                partial_reason.append("collector_errors_present")
            if not reachable:
                partial_reason.append("preflight_failed")

            final_status = "Inventory OK"
            if not reachable:
                final_status = "Inventory Error"
            elif baseline_status in ("ERROR", "TIMEOUT"):
                final_status = "Inventory Error"
            elif baseline_status == "EMPTY" or len(baseline_set) == 0:
                final_status = "Inventory Empty"
            elif coverage_gap or collector_errors_present:
                if collector_errors_present or not self.config.allow_partial_ok:
                    final_status = "Inventory Partial"

            status_groups[final_status].append(host)

            top_missing_sample = sorted(list(missing_any))[:5] if isinstance(missing_any, set) else []
            top_error = ""
            if baseline_status in ("ERROR", "TIMEOUT"):
                top_error = baseline_cov.get("error_short") or baseline_cov.get("stderr") or baseline_cov.get("status", "")
            else:
                for cov in (coverage_cpu.get(host, {}), coverage_net.get(host, {}), coverage_disk.get(host, {})):
                    if cov and self._is_error_status(cov.get("status")):
                        top_error = cov.get("error_short") or cov.get("status")
                        break
            if not top_error and partial_reason:
                top_error = ",".join(partial_reason)

            host_inventory[host] = {
                "reachability": reachability,
                "baseline": baseline_info,
                "coverage": {
                    "baseline_vm_count": len(baseline_set),
                    "vCPU_vm_count": (len(vcpu_set) if vcpu_set is not None else "not_run"),
                    "vMemory_vm_count": (len(vmem_set) if vmem_set is not None else "not_run"),
                    "vNetwork_vm_count": (len(vnet_set) if vnet_set is not None else "not_run"),
                    "vDisk_vm_count": (len(vdisk_set) if vdisk_set is not None else "not_run"),
                    "missing_counts": {
                        "vCPU": (len(missing_vcpu) if isinstance(missing_vcpu, set) else missing_vcpu),
                        "vMemory": (len(missing_vmem) if isinstance(missing_vmem, set) else missing_vmem),
                        "vNetwork": (len(missing_vnet) if isinstance(missing_vnet, set) else missing_vnet),
                        "vDisk": (len(missing_vdisk) if isinstance(missing_vdisk, set) else missing_vdisk),
                        "any": (len(missing_any) if isinstance(missing_any, set) else missing_any)
                    },
                    "top_missing_vmids_sample": top_missing_sample,
                    "top_missing_vmnames_sample": [baseline_map.get(v, "") for v in top_missing_sample if baseline_map.get(v, "")]
                },
                "collector_statuses": {
                    "vInfo": baseline_cov.get("status") if baseline_cov else None,
                    "vCPU_vMemory": coverage_cpu.get(host, {}).get("status"),
                    "vNetwork": coverage_net.get(host, {}).get("status"),
                    "vDisk": coverage_disk.get(host, {}).get("status")
                },
                "partial_reason": partial_reason,
                "final_status": final_status,
                "top_error": top_error
            }

            logger.info(f"[{host}] baseline_vm_count={len(baseline_set)} final_status={final_status}")

        # Log top 5 hosts with lowest baseline counts
        sorted_baseline = sorted([(h, data["baseline"]["vm_count"]) for h, data in host_inventory.items()], key=lambda x: x[1])
        if sorted_baseline:
            logger.info("Top 5 hosts with lowest baseline_vm_count:")
            for h, cnt in sorted_baseline[:5]:
                logger.info(f"  {h}: {cnt}")

        return host_inventory, status_groups, missing_rows

    def _write_inventory_outputs(self, host_inventory: Dict[str, Any], missing_rows: List[Dict[str, Any]]):
        out_dir = self.config.out_dir
        coverage_csv = out_dir / "host_inventory_coverage.csv"
        retry_txt = out_dir / "targets_retry_hosts.txt"
        missing_csv = out_dir / "missing_vms_by_host.csv"

        try:
            with open(coverage_csv, "w", newline="", encoding="utf-8") as f:
                columns = [
                    "host",
                    "reachable",
                    "baseline_vm_count",
                    "vCPU_vm_count",
                    "vMemory_vm_count",
                    "vNetwork_vm_count",
                    "vDisk_vm_count",
                    "missing_vCPU",
                    "missing_vMemory",
                    "missing_vNetwork",
                    "final_status",
                    "top_error"
                ]
                writer = csv.DictWriter(f, fieldnames=columns, extrasaction="ignore", restval="")
                writer.writeheader()
                for host, data in host_inventory.items():
                    cov = data.get("coverage", {})
                    missing_counts = cov.get("missing_counts", {})
                    reach_status = data.get("reachability", {}).get("status")
                    row = {
                        "host": host,
                        "reachable": reach_status == "OK",
                        "baseline_vm_count": cov.get("baseline_vm_count", 0),
                        "vCPU_vm_count": cov.get("vCPU_vm_count", 0),
                        "vMemory_vm_count": cov.get("vMemory_vm_count", 0),
                        "vNetwork_vm_count": cov.get("vNetwork_vm_count", 0),
                        "vDisk_vm_count": cov.get("vDisk_vm_count", 0),
                        "missing_vCPU": missing_counts.get("vCPU", 0),
                        "missing_vMemory": missing_counts.get("vMemory", 0),
                        "missing_vNetwork": missing_counts.get("vNetwork", 0),
                        "final_status": data.get("final_status"),
                        "top_error": data.get("top_error", "")
                    }
                    writer.writerow(row)
            logger.info(f"Host inventory coverage CSV saved to {coverage_csv}")
        except Exception as e:
            logger.error(f"Failed to write {coverage_csv}: {e}")

        try:
            retry_hosts = [h for h, data in host_inventory.items() if data.get("final_status") != "Inventory OK"]
            with open(retry_txt, "w", encoding="utf-8") as f:
                for host in retry_hosts:
                    f.write(f"{host}\n")
            logger.info(f"Targets retry list saved to {retry_txt}")
        except Exception as e:
            logger.error(f"Failed to write {retry_txt}: {e}")

        try:
            with open(missing_csv, "w", newline="", encoding="utf-8") as f:
                columns = ["host", "vm_id", "vm_name", "missing_in"]
                writer = csv.DictWriter(f, fieldnames=columns, extrasaction="ignore", restval="")
                writer.writeheader()
                for row in missing_rows:
                    writer.writerow(row)
            logger.info(f"Missing VMs by host CSV saved to {missing_csv}")
        except Exception as e:
            logger.error(f"Failed to write {missing_csv}: {e}")

    def run_host_facts_mode(self):
        logger.info("Host facts mode enabled. Running pre-flight and host facts collector only.")
        if not self.run_pre_flight():
            logger.warning("No hosts reachable in pre-flight. Proceeding with empty facts.")

        reachable_hosts = [
            h for h, res in self.report["pre_flight"].items()
            if res.get("status") == "OK"
        ]

        collector = HostFactsCollector(self.config)
        facts_rows: List[Dict[str, Any]] = []
        facts_full: Dict[str, Any] = {}
        coverage: Dict[str, Any] = {}

        if reachable_hosts:
            with concurrent.futures.ThreadPoolExecutor(max_workers=self.config.max_concurrency) as executor:
                futures = {executor.submit(self._run_collector_with_retry, collector, host): host for host in reachable_hosts}
                for fut, host in futures.items():
                    try:
                        result = fut.result()
                    except Exception as exc:
                        result = CollectorResult(
                            sheet_rows={},
                            coverage={
                                "status": "winrm_error",
                                "error_short": str(exc)[:200],
                                "rows_per_sheet": {},
                                "duration_ms": 0
                            }
                        )
                    cov = result.coverage or {}
                    facts_obj = cov.pop("facts", None)
                    coverage[host] = cov
                    if facts_obj:
                        facts_full[host] = facts_obj
                    for rows in (result.sheet_rows or {}).values():
                        facts_rows.extend(rows)

        self.report["host_facts"] = {
            "rows": facts_rows,
            "full": facts_full,
            "coverage": coverage
        }
        self.coverage["host_facts"] = coverage
        self._write_host_facts_files(facts_rows, facts_full)

    def save_report(self):
        path = self.config.json_report_path
        try:
            self.report["coverage"] = self.coverage
            with open(path, 'w') as f:
                json.dump(self.report, f, indent=2)
            logger.info(f"Report saved to {path}")
        except Exception as e:
            logger.error(f"Failed to save report: {e}")

    def _write_host_facts_files(self, rows: List[Dict[str, Any]], full: Dict[str, Any]):
        json_path = self.config.out_dir / "host_facts.json"
        csv_path = self.config.out_dir / "host_facts.csv"
        try:
            with open(json_path, "w", encoding="utf-8") as f:
                json.dump(full, f, indent=2)
            logger.info(f"Host facts JSON saved to {json_path}")
        except Exception as e:
            logger.error(f"Failed to save host facts JSON: {e}")

        if rows:
            columns = [
                "HVHost",
                "ComputerName",
                "FQDN",
                "Domain",
                "OSName",
                "OSVersion",
                "BuildNumber",
                "UBR",
                "InstallDate",
                "LastBootUpTime",
                "TimeZone",
                "Culture",
                "UILanguage",
                "PSVersion",
                "PSEdition",
                "CLRVersion",
                "ExecutionPolicy",
                "RemotingEnabled",
                "HyperVRoleInstalled",
                "FailoverClusteringInstalled",
                "RSATHyperVToolsInstalled",
                "HyperVModuleAvailable",
                "HyperVModuleVersion",
                "CmdletsFound",
                "VMHostVersion",
                "VMHostBuild",
                "DefaultVHDPath",
                "DefaultVMPath",
                "ClusterModuleAvailable",
                "IsClusterNode",
                "ClusterName",
                "ClusterFunctionalLevel",
                "ClusterNodes",
                "CSVEnabled",
                "CSVCount",
                "NetAdapters",
                "VMSwitches",
                "NicTeamPresent",
                "Volumes",
                "VHDGetAvailable"
            ]
            try:
                with open(csv_path, "w", newline="", encoding="utf-8") as f:
                    writer = csv.DictWriter(f, fieldnames=columns, extrasaction="ignore", restval="")
                    writer.writeheader()
                    writer.writerows(rows)
                logger.info(f"Host facts CSV saved to {csv_path}")
            except Exception as e:
                logger.error(f"Failed to save host facts CSV: {e}")

    def save_csvs(self):
        """Save collected rows to CSV files per sheet, honoring contract columns."""
        out_dir = self.config.out_dir
        if not self.sheet_rows:
            return

        sheets_meta = self.contract.get("sheets", {})
        for sheet_name, rows in self.sheet_rows.items():
            if not rows:
                continue
            columns = sheets_meta.get(sheet_name, {}).get("columns", [])
            if not columns:
                continue
            csv_path = out_dir / f"{sheet_name}.csv"
            try:
                with open(csv_path, 'w', newline='', encoding='utf-8') as f:
                    writer = csv.DictWriter(
                        f,
                        fieldnames=columns,
                        extrasaction="ignore",
                        restval=""
                    )
                    writer.writeheader()
                    for row in rows:
                        writer.writerow(row)
                logger.info(f"CSV saved: {csv_path}")
            except Exception as e:
                logger.error(f"Failed to save CSV {sheet_name}: {e}")

    def execute(self):
        start_time = time.time()
        
        # Log config (Task A.2)
        logger.info(f"Config loaded. User: {self.config.username[:3]}***")
        logger.info(f"Default Transport: {self.config.winrm_transport} Port: {self.config.winrm_port} Scheme: {self.config.winrm_scheme}")
        requested = {c.lower() for c in (self.config.only_collectors or [])}
        requested = self._expand_requested_collectors(requested)
        self.requested_collectors = requested
        if requested:
            logger.info(f"Only collectors requested: {sorted(requested)}")

        if self.config.host_facts:
            self.run_host_facts_mode()
            self.report["summary"]["duration_sec"] = round(time.time() - start_time, 2)
            self.save_report()
            print("\n=== Host Facts Run Summary ===")
            print(f"Run ID: {self.run_id}")
            print(f"Hosts Targeted: {self.report['summary']['hosts_targeted']}")
            print(f"Hosts Reachable: {self.report['summary']['hosts_reachable']}")
            print(f"Hosts Failed: {len(self.report['summary']['hosts_failed'])}")
            hf = self.report.get("host_facts", {})
            print(f"Host facts rows: {len(hf.get('rows', []))}")
            print(f"Host facts JSON: {self.config.out_dir / 'host_facts.json'}")
            print(f"Host facts CSV: {self.config.out_dir / 'host_facts.csv'}")
            print("====================================\n")
            return

        self._ensure_contract()

        sheet_rows: Dict[str, List[Dict[str, Any]]] = {}
        offline_all = [VMetaDataCollector(), VSourceCollector()]
        offline_collectors = [c for c in offline_all if not requested or c.name.lower() in requested]
        for c in offline_all:
            if c not in offline_collectors:
                self._mark_collector_skipped(c.name, "filtered_by_only")

        online_all = [
            CapabilitiesCollector(self.config),
            VHostCollector(self.config),
            VInfoCollector(self.config),
            VCpuVMemoryCollector(self.config),
            VNetworkCollector(self.config),
            VDiskCollector(self.config),
            VPartitionCollector(self.config),
            VSnapshotCollector(self.config)
        ]
        needs_hv_cap = bool(requested) and any(name != "hvcapabilities" for name in requested)
        online_collectors = []
        for collector in online_all:
            cname = collector.name.lower()
            if cname == "hvcapabilities":
                if not requested or cname in requested or needs_hv_cap:
                    online_collectors.append(collector)
            else:
                if not requested or cname in requested:
                    online_collectors.append(collector)
        for c in online_all:
            if c not in online_collectors:
                self._mark_collector_skipped(c.name, "filtered_by_only")

        if self.config.auth_probe:
            self.run_auth_probe()
        else:
            # Offline collectors
            for collector in offline_collectors:
                res = self._run_collector_with_retry(collector, host="local")
                self._aggregate_result(collector.name, "local", res, sheet_rows)

            if self.config.dry_run or not self.config.enable_collectors:
                logger.info("Collectors disabled or dry-run; skipping WinRM collectors.")
                for collector in online_collectors:
                    self._mark_collector_skipped(collector.name, "collectors disabled or dry-run")
            elif not online_collectors:
                logger.info("No online collectors selected after filtering; skipping WinRM collectors.")
                for collector in online_all:
                    self._mark_collector_skipped(collector.name, "no collectors selected")
            else:
                # 1. Pre-flight
                if not self.run_pre_flight():
                    logger.error("No hosts reachable in pre-flight.")
                    logger.info("Aborting collectors.")
                    for collector in online_collectors:
                        self._mark_collector_skipped(collector.name, "no reachable hosts")
                else:
                    logger.info("Starting collectors...")
                    
                    # Get reachable hosts
                    reachable_hosts = [
                        h for h, res in self.report["pre_flight"].items() 
                        if res["status"] == "OK"
                    ]

                    if not reachable_hosts:
                        logger.warning("No reachable hosts after pre-flight. Skipping WinRM collectors.")
                    else:
                        hv_context = {}
                        with concurrent.futures.ThreadPoolExecutor(max_workers=self.config.max_concurrency) as executor:
                            for collector in online_collectors:
                                # Build context per collector if needed
                                context = None
                                if collector.name in ("vHost", "vInfo", "vCPU_vMemory", "vNetwork", "vDisk", "vPartition", "vSnapshot"):
                                    hv_rows = self.report.get("collectors", {}).get("hvCapabilities", {}).get("rows", [])
                                    hv_map = {row.get("HVHost"): row for row in hv_rows if isinstance(row, dict)}
                                    hv_context = {"hv_capabilities": hv_map}
                                if collector.name in ("vNetwork", "vDisk", "vPartition", "vSnapshot"):
                                    vinfo_rows = sheet_rows.get("vInfo", []) or []
                                    vinfo_by_host = {}
                                    for r in vinfo_rows:
                                        if r.get("Host") and r.get("VM"):
                                            vinfo_by_host.setdefault(r.get("Host"), []).append(r.get("VM"))
                                    hv_context["vinfo_by_host"] = vinfo_by_host
                                context = hv_context

                                run_method = self._run_baseline_with_retry if collector.name == "vInfo" else self._run_collector_with_retry
                                futures = {executor.submit(run_method, collector, host, context): host for host in reachable_hosts}
                                for fut, host in futures.items():
                                    try:
                                        result = fut.result()
                                    except Exception as exc:
                                        result = CollectorResult(
                                            sheet_rows={},
                                            coverage={
                                                "status": "winrm_error",
                                                "error_short": str(exc)[:200],
                                                "rows_per_sheet": {},
                                                "duration_ms": 0,
                                                "exception_type": exc.__class__.__name__,
                                                "exception_message": str(exc)
                                            }
                                        )
                                    self._aggregate_result(collector.name, host, result, sheet_rows)

        # Align VM-level sheets to vInfo to avoid duplicates
        self._align_vm_sheets(sheet_rows)
        # Augment host aggregates
        self._augment_host_sheet(sheet_rows)

        self.host_inventory, status_groups, missing_rows = self._compute_host_inventory(sheet_rows)
        self.report["hosts"] = self.host_inventory
        summary = self.report["summary"]
        summary["inventory_ok"] = len(status_groups.get("Inventory OK", []))
        summary["inventory_partial"] = len(status_groups.get("Inventory Partial", []))
        summary["inventory_empty"] = len(status_groups.get("Inventory Empty", []))
        summary["inventory_error"] = len(status_groups.get("Inventory Error", []))
        summary["inventory_ok_hosts"] = status_groups.get("Inventory OK", [])
        summary["inventory_partial_hosts"] = status_groups.get("Inventory Partial", [])
        summary["inventory_empty_hosts"] = status_groups.get("Inventory Empty", [])
        summary["inventory_error_hosts"] = status_groups.get("Inventory Error", [])
        summary["hosts_failed"] = status_groups.get("Inventory Error", []) + status_groups.get("Inventory Empty", [])

        try:
            self.sheet_rows = sheet_rows
            if self.config.no_xlsx:
                logger.info("Flag --no-xlsx set; skipping XLSX writer.")
            else:
                self._write_xlsx(sheet_rows)
        except Exception as e:
            logger.error(f"Failed to write XLSX: {e}")
            self.report["xlsx_output"] = {"error": str(e)}

        self.report["summary"]["duration_sec"] = round(time.time() - start_time, 2)
        self.save_report()
        if not self.config.dry_run and not self.config.auth_probe:
            self.save_csvs()
            self._write_inventory_outputs(self.host_inventory, missing_rows)
        
        # Print Summary to Console
        print("\n=== Hyper-V Exporter Run Summary ===")
        print(f"Run ID: {self.run_id}")
        if not self.config.auth_probe:
            print(f"Hosts Targeted: {self.report['summary']['hosts_targeted']}")
            print(f"Hosts Reachable: {self.report['summary']['hosts_reachable']}")
            print(f"Hosts Failed: {len(self.report['summary']['hosts_failed'])}")
            print(f"Inventory OK: {self.report['summary'].get('inventory_ok', 0)}")
            print(f"Inventory Partial: {self.report['summary'].get('inventory_partial', 0)}")
            print(f"Inventory Empty: {self.report['summary'].get('inventory_empty', 0)}")
            print(f"Inventory Error: {self.report['summary'].get('inventory_error', 0)}")
            if "hosts_with_hyperv_mod" in self.report["summary"]:
                print(f"Hosts with Hyper-V Module: {self.report['summary']['hosts_with_hyperv_mod']}")
            if "xlsx_output" in self.report:
                print(f"XLSX: {self.report['xlsx_output'].get('path', 'N/A')}")
            print(f"Coverage CSV: {self.config.out_dir / 'host_inventory_coverage.csv'}")
            print(f"Retry targets: {self.config.out_dir / 'targets_retry_hosts.txt'}")
        else:
            print("Mode: Auth Probe (check report/logs for details)")
        print(f"Duration: {self.report['summary']['duration_sec']}s")
        print(f"Report: {self.config.json_report_path}")
        print("====================================\n")
