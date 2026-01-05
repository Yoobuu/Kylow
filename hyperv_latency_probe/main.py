"""Entry point for the Hyper-V latency diagnostic runner."""
import time
from dataclasses import dataclass
from typing import List, Optional

import requests

from . import config
from .api_client import ApiClient
from .auth import AuthManager
from .reporter import LatencyReporter


@dataclass
class RequestSpec:
    """Single request definition for the diagnostic plan."""

    method: str
    path: str
    params: Optional[dict]
    label: str
    host: Optional[str] = None
    repetitions: int = config.REQUEST_REPETITIONS


class DiagnosticRunner:
    """Runs the sequential diagnostic workflow for a finite set of cycles."""

    def __init__(self, api_client: ApiClient) -> None:
        self.api_client = api_client
        self.sequence: int = 0
        self.plan: List[RequestSpec] = build_request_plan()
        self.completed_requests: int = 0
        self.total_requests: int = self._compute_total_requests()

    def run(self) -> None:
        max_cycles = self._max_cycles()
        try:
            self._log(
                "[runner] starting run: %s endpoints, %s repetitions each, %s total requests",
                len(self.plan),
                config.REQUEST_REPETITIONS,
                self.total_requests,
            )
            for cycle in range(1, max_cycles + 1):
                self.sequence = 0
                self._log("[runner] cycle %s/%s starting", cycle, max_cycles)
                try:
                    self._run_cycle(cycle, run_id=cycle)
                except Exception as exc:
                    self._log("[runner] cycle %s failed: %s", cycle, exc)
                if cycle < max_cycles and config.CYCLE_PAUSE_SECONDS > 0:
                    time.sleep(config.CYCLE_PAUSE_SECONDS)
        finally:
            self.api_client.close()
            self._log("[runner] finished. %s requests completed.", self.completed_requests)

    def _max_cycles(self) -> int:
        if config.MAX_CYCLES is None:
            return 1
        return max(1, int(config.MAX_CYCLES))

    def _compute_total_requests(self) -> int:
        cycles = self._max_cycles()
        return cycles * sum(spec.repetitions for spec in self.plan)

    def _run_cycle(self, cycle: int, *, run_id: int) -> None:
        for spec in self.plan:
            self._invoke_spec(spec, cycle, run_id)

    def _invoke_spec(self, spec: RequestSpec, cycle: int, run_id: int) -> None:
        for attempt in range(1, spec.repetitions + 1):
            self.sequence += 1
            self.completed_requests += 1
            remaining = self.total_requests - self.completed_requests
            self._log(
                "[runner] cycle %s request %s/%s (%s %s attempt %s/%s, remaining %s)",
                cycle,
                self.completed_requests,
                self.total_requests,
                spec.method,
                spec.label,
                attempt,
                spec.repetitions,
                remaining,
            )
            try:
                self.api_client.perform_request(
                    spec.method,
                    spec.path,
                    params=spec.params,
                    label=spec.label,
                    host=spec.host,
                    cycle=cycle,
                    sequence=self.sequence,
                    run_id=run_id,
                )
            except Exception as exc:
                # Defensive: never let an unexpected error stop the loop.
                self._log("[runner] unexpected error during request: %s", exc)

    def _log(self, msg: str, *args: object) -> None:
        try:
            print(msg % args, flush=True)
        except Exception:
            pass


def build_request_plan() -> List[RequestSpec]:
    """Define the full request plan to execute sequentially."""
    hosts_query = ",".join(config.HOSTS)
    plan: List[RequestSpec] = [
        RequestSpec(
            "GET",
            config.BATCH_ENDPOINT,
            {"hosts": hosts_query} if hosts_query else None,
            "hyperv_batch_no_refresh",
        ),
        RequestSpec(
            "GET",
            config.BATCH_ENDPOINT,
            {"refresh": "true", "hosts": hosts_query} if hosts_query else {"refresh": "true"},
            "hyperv_batch_refresh",
        ),
        RequestSpec(
            "GET",
            config.HOSTS_ENDPOINT,
            {"refresh": "true", "hosts": hosts_query} if hosts_query else {"refresh": "true"},
            "hyperv_hosts_refresh",
        ),
    ]

    # Hyper-V per-host summaries
    for host in config.HOSTS:
        plan.append(
            RequestSpec(
                "GET",
                config.HOST_SUMMARY_ENDPOINT.format(host=host),
                {"refresh": "true", "level": "summary"},
                f"hyperv_host_summary_{host}",
                host=host,
            )
        )
        plan.append(
            RequestSpec(
                "GET",
                config.HYPERV_VMS_ENDPOINT,
                {"refresh": "true", "level": "summary", "host": host},
                f"hyperv_vms_{host}",
                host=host,
            )
        )

    # VMware inventory
    plan.extend(
        [
            RequestSpec(
                "GET",
                config.VMS_ENDPOINT,
                {"refresh": "true"},
                "vmware_vms",
            ),
            RequestSpec(
                "GET",
                config.VMWARE_HOSTS_ENDPOINT,
                {"refresh": "true"},
                "vmware_hosts",
            ),
        ]
    )

    # Auth and user management
    plan.extend(
        [
            RequestSpec("GET", config.AUTH_ME_ENDPOINT, None, "auth_me"),
            RequestSpec("GET", config.USERS_ENDPOINT, None, "users_list"),
            RequestSpec("GET", config.PERMISSIONS_ENDPOINT, None, "permissions_catalog"),
        ]
    )

    # Audit and notifications
    plan.extend(
        [
            RequestSpec(
                "GET",
                config.AUDIT_LOGS_ENDPOINT,
                {"limit": 50, "offset": 0},
                "audit_logs",
            ),
            RequestSpec(
                "GET",
                config.NOTIFICATIONS_ENDPOINT,
                {"limit": 25, "offset": 0},
                "notifications_list",
            ),
        ]
    )

    # CEDIA
    plan.extend(
        [
            RequestSpec("GET", config.CEDIA_LOGIN_ENDPOINT, None, "cedia_login"),
            RequestSpec("GET", config.CEDIA_VMS_ENDPOINT, None, "cedia_vms"),
        ]
    )

    return plan


def build_runner() -> DiagnosticRunner:
    """Assemble dependencies for the runner."""
    session = requests.Session()
    reporter = LatencyReporter()
    auth_manager = AuthManager(session=session)
    api_client = ApiClient(auth_manager=auth_manager, reporter=reporter, session=session)
    return DiagnosticRunner(api_client)


def main() -> None:
    runner = build_runner()
    runner.run()


if __name__ == "__main__":
    main()
