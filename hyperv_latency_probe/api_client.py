"""HTTP client wrapper with JWT handling and latency measurement."""
import time
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
from urllib.parse import urlencode

import requests

from . import config
from .auth import AuthError, AuthManager
from .reporter import LatencyReporter


class ApiClient:
    """Performs sequential API calls with retry on auth/timeouts."""

    def __init__(
        self,
        auth_manager: AuthManager,
        reporter: LatencyReporter,
        session: Optional[requests.Session] = None,
    ) -> None:
        self.session = session or requests.Session()
        self.auth_manager = auth_manager
        self.reporter = reporter

    def perform_request(
        self,
        method: str,
        path: str,
        *,
        params: Optional[Dict[str, Any]] = None,
        label: Optional[str] = None,
        host: Optional[str] = None,
        cycle: Optional[int] = None,
        sequence: Optional[int] = None,
        run_id: Optional[int] = None,
    ) -> Dict[str, Any]:
        """Execute an HTTP request and record the outcome."""
        query_string = urlencode(params or {}, doseq=True) if params else ""
        started_at = datetime.now(timezone.utc)
        start_monotonic = time.monotonic()
        retries_allowed = max(0, int(config.REQUEST_RETRY_LIMIT))
        retry_count = 0
        timeout_hit = False
        token_refresh = False
        retry_reasons: List[str] = []
        http_status: Optional[int] = None
        success = False
        error_type: str = ""
        error_message: str = ""
        route_type = self._derive_route_type(path, label)
        level = self._derive_level(params, path)
        refresh_flag = self._derive_refresh(params)
        request_host = self._derive_host(host, params)
        headers: Dict[str, str] = {"Accept": "application/json"}

        while True:
            try:
                token = self.auth_manager.get_token()
                refreshed, _ = self.auth_manager.consume_refresh_info()
                if refreshed:
                    token_refresh = True
                headers["Authorization"] = f"Bearer {token}"
                response = self.session.request(
                    method=method.upper(),
                    url=config.build_url(path),
                    params=params,
                    headers=headers,
                    timeout=config.REQUEST_TIMEOUT,
                )
                http_status = response.status_code
                if http_status == 408:
                    timeout_hit = True
                success = 200 <= http_status < 300
                if http_status == 401 and retry_count < retries_allowed:
                    retry_count += 1
                    retry_reasons.append("auth_401")
                    token_refresh = True
                    self.auth_manager.force_refresh()
                    continue
                if not success:
                    error_message = response.text or response.reason or f"HTTP {http_status}"
                    error_type = self._map_error_type(http_status, path, error_message)
                break
            except requests.Timeout as exc:
                timeout_hit = True
                error_type = "timeout"
                error_message = str(exc)
                if retry_count < retries_allowed:
                    retry_count += 1
                    retry_reasons.append("timeout")
                    continue
                break
            except AuthError as exc:
                error_message = str(exc)
                lowered = error_message.lower()
                if "timeout" in lowered:
                    timeout_hit = True
                    error_type = "timeout"
                elif "connection" in lowered or "network" in lowered:
                    error_type = "network"
                else:
                    error_type = "auth"
                break
            except requests.ConnectionError as exc:
                error_type = "network"
                error_message = str(exc)
                break
            except requests.RequestException as exc:
                error_type = "network"
                error_message = str(exc)
                break
            except Exception as exc:
                error_type = "other"
                error_message = str(exc)
                break

        finished_at = datetime.now(timezone.utc)
        latency = time.monotonic() - start_monotonic
        if success:
            error_type = ""
            error_message = ""

        entry = {
            "run_id": run_id,
            "cycle": cycle,
            "sequence": sequence,
            "label": label,
            "route_type": route_type,
            "endpoint": path,
            "host": request_host,
            "query": query_string,
            "level": level,
            "refresh": refresh_flag,
            "http_status": http_status,
            "success": success,
            "latency_sec": latency,
            "timeout_hit": timeout_hit,
            "retry_count": retry_count,
            "retry_reason": "|".join(retry_reasons),
            "token_refresh": token_refresh,
            "error_type": error_type,
            "error_message": error_message,
            "started_at": started_at.isoformat(),
            "finished_at": finished_at.isoformat(),
        }
        self.reporter.record(entry)
        return entry

    def close(self) -> None:
        """Close HTTP session resources."""
        try:
            self.session.close()
        except Exception:
            pass
        try:
            self.reporter.close()
        except Exception:
            pass

    @staticmethod
    def _derive_route_type(path: str, label: Optional[str]) -> str:
        route = (path or "").lower()
        if route.startswith("/hyperv"):
            return "hyperv"
        if route.startswith("/auth") or route.startswith("/users") or route.startswith("/permissions"):
            return "auth"
        if route.startswith("/vms") or route.startswith("/hosts") or route.startswith("/cedia"):
            return "inventory"
        if label and "vmware" in label.lower():
            return "inventory"
        return "other"

    @staticmethod
    def _derive_level(params: Optional[Dict[str, Any]], path: str) -> str:
        if params:
            level = params.get("level")
            if isinstance(level, str) and level:
                normalized = level.lower()
                if normalized in {"summary", "deep", "batch"}:
                    return normalized
        if "batch" in (path or "").lower():
            return "batch"
        return "none"

    @staticmethod
    def _derive_refresh(params: Optional[Dict[str, Any]]) -> bool:
        if not params:
            return False
        value = params.get("refresh")
        if isinstance(value, str):
            return value.lower() == "true"
        return bool(value)

    @staticmethod
    def _derive_host(spec_host: Optional[str], params: Optional[Dict[str, Any]]) -> str:
        if spec_host:
            return spec_host
        if params:
            for key in ("host", "hostname"):
                candidate = params.get(key)
                if isinstance(candidate, str) and candidate:
                    return candidate
        return ""

    @staticmethod
    def _contains_winrm_hint(text: Optional[str]) -> bool:
        if not text:
            return False
        lowered = text.lower()
        return "winrm" in lowered or "powershell" in lowered

    def _map_error_type(
        self, status_code: Optional[int], path: str, response_text: Optional[str] = None
    ) -> str:
        if status_code is None:
            return ""
        if status_code == 401:
            return "auth"
        if status_code == 408:
            return "timeout"
        if status_code >= 500:
            if self._contains_winrm_hint(response_text):
                return "winrm"
            if path.startswith("/hyperv"):
                return "winrm"
            return "other"
        if status_code >= 400:
            if status_code == 403 and path.startswith("/auth"):
                return "auth"
            return "other"
        return ""
