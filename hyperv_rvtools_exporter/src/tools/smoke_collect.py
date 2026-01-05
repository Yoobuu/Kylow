import logging
from ..config import load_config
from ..runner import Runner


def _setup_logging(debug: bool):
    level = logging.DEBUG if debug else logging.INFO
    logging.basicConfig(
        level=level,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
        datefmt="%H:%M:%S",
    )


def main():
    config = load_config()
    # Speed up smoke runs: skip XLSX unless explicitly requested otherwise
    config.no_xlsx = True
    _setup_logging(config.debug)
    runner = Runner(config)
    runner.execute()

    requested = config.only_collectors or []
    print("\n=== Smoke Collect Summary ===")
    print(f"Collectors: {','.join(requested) if requested else 'all default'}")
    print(f"Hosts targeted: {runner.report['summary'].get('hosts_targeted')}")
    print(f"Hosts reachable: {runner.report['summary'].get('hosts_reachable')}")
    for cname in (requested or runner.coverage.keys()):
        cov = runner.coverage.get(cname, {})
        hosts_ok = [h for h, v in cov.items() if v.get('status') == 'success']
        hosts_failed = [h for h, v in cov.items() if v.get('status') != 'success']
        rows = len(runner.report.get("collectors", {}).get(cname, {}).get("rows", []))
        print(f"- {cname}: hosts_ok={len(hosts_ok)} hosts_failed={len(hosts_failed)} rows={rows}")
    print(f"Report: {config.json_report_path}")
    print("=============================\n")


if __name__ == "__main__":
    main()
