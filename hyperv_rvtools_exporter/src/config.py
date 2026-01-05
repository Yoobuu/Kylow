import argparse
import os
from dataclasses import dataclass
from pathlib import Path
from typing import List, Optional

from dotenv import load_dotenv

# Default paths
DEFAULT_ENV_PATH = Path(__file__).resolve().parent.parent.parent / "backend" / ".env"
DEFAULT_CONTRACT_SOURCE = Path(__file__).resolve().parent.parent / "RVTOOLEX.xlsx"
DEFAULT_CONTRACT_JSON = Path(__file__).resolve().parent / "contracts" / "rvtools_contract.json"

@dataclass
class Config:
    # Auth
    username: str
    password: str
    
    # Hosts
    hosts: List[str]
    
    # WinRM settings
    winrm_port: int
    winrm_transport: str
    winrm_scheme: str
    verify_ssl: bool
    
    # Resilience / Performance
    connect_timeout: int
    read_timeout: int
    max_concurrency: int
    retries: int
    collector_timeout_sec: int
    baseline_timeout_sec: int
    coverage_threshold: float
    allow_partial_ok: bool
    
    # Output
    out_dir: Path
    json_report_path: Path
    xlsx_output_path: Path
    contract_json_path: Path
    contract_source_path: Path
    only_collectors: Optional[List[str]]
    no_xlsx: bool
    
    # Mode
    dry_run: bool
    auth_probe: bool
    debug: bool
    enable_collectors: bool
    host_facts: bool

def load_config() -> Config:
    parser = argparse.ArgumentParser(description="Hyper-V RVTools Exporter")
    
    # Auth args
    parser.add_argument("--username", help="WinRM Username")
    parser.add_argument("--password", help="WinRM Password")
    
    # Target args
    parser.add_argument("--hosts", help="Comma-separated list of hosts (or path to file)")
    parser.add_argument("--hosts-file", help="Path to file with hosts (one per line)")
    
    # WinRM config
    parser.add_argument("--winrm-port", type=int, default=5985, help="WinRM Port (default 5985)")
    parser.add_argument("--winrm-transport", default="ntlm", choices=["ntlm", "kerberos", "basic", "credssp"], help="WinRM Transport")
    parser.add_argument("--winrm-scheme", default="http", choices=["http", "https"], help="WinRM Scheme")
    parser.add_argument("--insecure", action="store_true", help="Ignore SSL cert validation")
    
    # Resilience
    parser.add_argument("--connect-timeout", type=int, default=5, help="Connection timeout (sec) for pre-flight")
    parser.add_argument("--read-timeout", type=int, default=60, help="Read timeout (sec) for operations")
    parser.add_argument("--concurrency", type=int, default=4, help="Max parallel hosts")
    parser.add_argument("--retries", type=int, default=1, help="Number of retries per host")
    parser.add_argument("--collector-timeout-sec", type=int, default=90, help="Timeout per host/collector")
    parser.add_argument("--baseline-timeout-seconds", type=int, default=90, help="Timeout (sec) for baseline vInfo collector")
    parser.add_argument("--coverage-threshold", type=float, default=0.90, help="Min coverage ratio (0-1) for Inventory OK (default 0.90)")
    parser.add_argument("--allow-partial-ok", action="store_true", help="Treat partial coverage as OK")
    
    # Output
    parser.add_argument("--out-dir", default="./out", help="Output directory")
    parser.add_argument("--xlsx-out", help="Path for generated RVTools-style XLSX")
    parser.add_argument("--contract-json", help="Path to store generated contract JSON")
    parser.add_argument("--contract-xlsx", help="Path to RVTools template XLSX")
    collector_toggle = parser.add_mutually_exclusive_group()
    collector_toggle.add_argument("--enable-collectors", dest="enable_collectors", action="store_true", help="Force enable collectors")
    collector_toggle.add_argument("--disable-collectors", dest="enable_collectors", action="store_false", help="Force disable collectors")
    parser.set_defaults(enable_collectors=None)
    
    # Flags
    parser.add_argument("--dry-run", action="store_true", help="Only check connectivity, do not run collectors")
    parser.add_argument("--auth-probe", action="store_true", help="Probe authentication methods")
    parser.add_argument("--debug", action="store_true", help="Enable debug logging")
    parser.add_argument("--env-file", help="Path to .env file")
    parser.add_argument("--host-facts", action="store_true", help="Run host facts collector only")
    parser.add_argument("--only", help="Comma-separated list of collectors to run (e.g., vInfo,vCPU_vMemory)")
    parser.add_argument("--no-xlsx", action="store_true", help="Skip XLSX writer (CSV/report only)")

    args = parser.parse_args()

    # Load Env
    env_path = Path(args.env_file) if args.env_file else DEFAULT_ENV_PATH
    if env_path.exists():
        load_dotenv(env_path)
    
    # Resolve Auth
    # Check HYPERV_PASS as well!
    username = args.username or os.getenv("HYPERV_USER") or os.getenv("VCENTER_USER") 
    password = args.password or os.getenv("HYPERV_PASSWORD") or os.getenv("HYPERV_PASS") or os.getenv("VCENTER_PASSWORD")
    
    # Resolve Hosts
    hosts: List[str] = []
    if args.hosts_file:
        if os.path.isfile(args.hosts_file):
            with open(args.hosts_file, 'r') as f:
                hosts.extend([line.strip() for line in f if line.strip()])
    if args.hosts:
        if os.path.isfile(args.hosts):
            with open(args.hosts, 'r') as f:
                hosts.extend([line.strip() for line in f if line.strip()])
        else:
            hosts.extend([h.strip() for h in args.hosts.split(",") if h.strip()])
    
    if not hosts and os.getenv("HYPERV_HOSTS"):
        hosts = [h.strip() for h in os.getenv("HYPERV_HOSTS").split(",") if h.strip()]
    
    hosts = list(dict.fromkeys(hosts))

    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    contract_json_path = Path(args.contract_json) if args.contract_json else DEFAULT_CONTRACT_JSON
    contract_json_path.parent.mkdir(parents=True, exist_ok=True)

    contract_source_path = Path(args.contract_xlsx) if args.contract_xlsx else DEFAULT_CONTRACT_SOURCE
    xlsx_output_path = Path(args.xlsx_out) if args.xlsx_out else (out_dir / "rvtools_hyperv.xlsx")
    enable_collectors = args.enable_collectors if args.enable_collectors is not None else (not args.dry_run)
    only_collectors = [c.strip() for c in args.only.split(",")] if args.only else None
    
    return Config(
        username=username or "",
        password=password or "",
        hosts=hosts,
        winrm_port=args.winrm_port,
        winrm_transport=args.winrm_transport,
        winrm_scheme=args.winrm_scheme,
        verify_ssl=not args.insecure,
        connect_timeout=args.connect_timeout,
        read_timeout=args.read_timeout,
        max_concurrency=args.concurrency,
        retries=args.retries,
        collector_timeout_sec=args.collector_timeout_sec,
        baseline_timeout_sec=args.baseline_timeout_seconds,
        coverage_threshold=args.coverage_threshold,
        allow_partial_ok=args.allow_partial_ok,
        out_dir=out_dir,
        json_report_path=out_dir / "hyperv_run_report.json",
        xlsx_output_path=xlsx_output_path,
        contract_json_path=contract_json_path,
        contract_source_path=contract_source_path,
        only_collectors=only_collectors,
        no_xlsx=args.no_xlsx,
        dry_run=args.dry_run,
        auth_probe=args.auth_probe,
        debug=args.debug,
        enable_collectors=enable_collectors,
        host_facts=args.host_facts
    )
