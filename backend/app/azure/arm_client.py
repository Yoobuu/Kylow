from __future__ import annotations

import logging
import time
from dataclasses import dataclass
from threading import Lock
from typing import Any, Dict, Optional

import requests
from fastapi import HTTPException

from app.settings import settings

logger = logging.getLogger(__name__)

_TOKEN_LOCK = Lock()
_TOKEN_STATE: Optional["TokenState"] = None
_TOKEN_REFRESH_MARGIN = 120


@dataclass
class TokenState:
    token: str
    expires_at: float


def _now() -> float:
    return time.time()


def _token_valid(state: Optional[TokenState]) -> bool:
    if state is None:
        return False
    return (state.expires_at - _TOKEN_REFRESH_MARGIN) > _now()


def _safe_error_text(response: requests.Response) -> str:
    try:
        text = response.text or ""
    except Exception:
        return ""
    text = text.strip()
    if len(text) > 200:
        return f"{text[:200]}..."
    return text


def _auth_failure(status_code: int, payload: Optional[Dict[str, Any]] = None) -> HTTPException:
    detail = f"Azure auth failed ({status_code})"
    if payload:
        msg = payload.get("error_description") or payload.get("error")
        if msg:
            detail = f"{detail}: {msg}"
    code = status_code if status_code in {400, 401, 403} else 502
    return HTTPException(status_code=code, detail=detail)


def _arm_failure(status_code: int, response: requests.Response) -> HTTPException:
    text = _safe_error_text(response)
    detail = f"Azure ARM error ({status_code})"
    if text:
        detail = f"{detail}: {text}"
    return HTTPException(status_code=status_code, detail=detail)


class AzureArmClient:
    def __init__(self) -> None:
        self.tenant_id = settings.azure_tenant_id
        self.client_id = settings.azure_client_id
        self.client_secret = settings.azure_client_secret
        self.subscription_id = settings.azure_subscription_id
        self.base_url = (settings.azure_api_base or "https://management.azure.com").rstrip("/")
        self.compute_api_version = settings.azure_api_version_compute
        self.network_api_version = settings.azure_api_version_network

    def _ensure_configured(self) -> None:
        if settings.test_mode:
            return
        missing = settings.azure_missing_envs or []
        if missing:
            raise HTTPException(
                status_code=500,
                detail={"detail": "Azure configuration incomplete", "missing": missing},
            )

    def _token_url(self) -> str:
        tenant = (self.tenant_id or "").strip()
        if not tenant:
            return ""
        return f"https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token"

    def _request_token(self) -> TokenState:
        self._ensure_configured()
        url = self._token_url()
        data = {
            "client_id": self.client_id or "",
            "client_secret": self.client_secret or "",
            "grant_type": "client_credentials",
            "scope": "https://management.azure.com/.default",
        }
        try:
            resp = requests.post(url, data=data, timeout=10)
        except requests.RequestException as exc:
            raise HTTPException(status_code=502, detail=f"Error conectando a Azure OAuth: {exc}") from exc

        if resp.status_code >= 400:
            try:
                payload = resp.json()
            except ValueError:
                payload = None
            raise _auth_failure(resp.status_code, payload)

        try:
            payload = resp.json()
        except ValueError as exc:
            raise HTTPException(status_code=502, detail="Respuesta OAuth invalida (no JSON)") from exc

        token = payload.get("access_token")
        if not token:
            raise HTTPException(status_code=502, detail="Respuesta OAuth sin access_token")
        expires_in = payload.get("expires_in")
        try:
            expires_in_int = int(expires_in) if expires_in is not None else 3600
        except (TypeError, ValueError):
            expires_in_int = 3600
        expires_at = _now() + max(expires_in_int, 60)
        return TokenState(token=token, expires_at=expires_at)

    def get_token(self) -> str:
        global _TOKEN_STATE
        if settings.test_mode:
            return ""
        if _token_valid(_TOKEN_STATE):
            return _TOKEN_STATE.token
        with _TOKEN_LOCK:
            if _token_valid(_TOKEN_STATE):
                return _TOKEN_STATE.token
            _TOKEN_STATE = self._request_token()
            return _TOKEN_STATE.token

    def reset_token(self) -> None:
        global _TOKEN_STATE
        with _TOKEN_LOCK:
            _TOKEN_STATE = None

    def request_json(
        self,
        method: str,
        url: str,
        *,
        params: Optional[Dict[str, Any]] = None,
        retry: int = 1,
        timeout: int = 15,
    ) -> Dict[str, Any]:
        self._ensure_configured()
        token = self.get_token()
        headers = {
            "Accept": "application/json",
            "Authorization": f"Bearer {token}",
        }

        try:
            response = requests.request(method, url, headers=headers, params=params, timeout=timeout)
        except requests.RequestException as exc:
            raise HTTPException(status_code=502, detail=f"Error conectando a Azure ARM: {exc}") from exc

        if response.status_code == 401 and retry > 0:
            self.reset_token()
            return self.request_json(method, url, params=params, retry=retry - 1, timeout=timeout)

        if response.status_code == 429 and retry > 0:
            retry_after = response.headers.get("Retry-After")
            if retry_after:
                try:
                    delay = int(retry_after)
                except ValueError:
                    delay = 1
                time.sleep(max(0, min(delay, 60)))
                return self.request_json(method, url, params=params, retry=retry - 1, timeout=timeout)

        if response.status_code >= 400:
            raise _arm_failure(response.status_code, response)

        try:
            return response.json()
        except ValueError as exc:
            raise HTTPException(status_code=502, detail="Respuesta ARM invalida (no JSON)") from exc

    def arm_get(self, path: str, *, params: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        if path.startswith("http://") or path.startswith("https://"):
            url = path
        else:
            url = f"{self.base_url}/{path.lstrip('/')}"
        return self.request_json("GET", url, params=params)

    def arm_get_paged(self, path: str, *, params: Optional[Dict[str, Any]] = None) -> list[dict]:
        url = path
        all_items: list[dict] = []
        next_params = params
        while url:
            payload = self.arm_get(url, params=next_params)
            items = payload.get("value") if isinstance(payload, dict) else None
            if isinstance(items, list):
                all_items.extend(items)
            next_link = payload.get("nextLink") if isinstance(payload, dict) else None
            if next_link:
                url = next_link
                next_params = None
            else:
                url = ""
        return all_items
