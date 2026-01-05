"""Authentication helper with JWT renewal support."""
import base64
import json
import time
from typing import Any, Dict, Optional, Tuple

import requests

from . import config


class AuthError(Exception):
    """Raised when authentication fails or tokens cannot be obtained."""


class AuthManager:
    """Handles JWT acquisition and refresh."""

    def __init__(self, session: Optional[requests.Session] = None) -> None:
        self.session = session or requests.Session()
        self._token: Optional[str] = None
        self._token_exp: Optional[float] = None
        self._last_issue: Optional[float] = None
        self._last_refresh_flag: bool = False
        self._last_refresh_reason: Optional[str] = None

    def get_token(self, force_refresh: bool = False) -> str:
        """Return a valid token, logging in if needed."""
        self._last_refresh_flag = False
        self._last_refresh_reason = None
        if force_refresh or self._should_refresh():
            reason = "force_refresh" if force_refresh else "expired_or_missing"
            self.login(reason=reason)
        if not self._token:
            raise AuthError("Token unavailable after login.")
        return self._token

    def login(self, reason: str = "initial") -> None:
        """Login to obtain a fresh JWT."""
        self._last_refresh_flag = False
        self._last_refresh_reason = None
        url = config.build_url(config.AUTH_ENDPOINT)
        payload = {"username": config.USERNAME, "password": config.PASSWORD}
        try:
            response = self.session.post(url, json=payload, timeout=config.REQUEST_TIMEOUT)
        except requests.RequestException as exc:
            raise AuthError(f"Login request failed: {exc}") from exc

        if response.status_code != 200:
            raise AuthError(f"Login failed with status {response.status_code}")

        try:
            data: Dict[str, Any] = response.json()
        except ValueError as exc:
            raise AuthError("Login response is not valid JSON.") from exc

        token = self._extract_token(data)
        if not token:
            raise AuthError("Login response did not include a token.")

        self._token = token
        self._last_issue = time.time()
        self._token_exp = self._extract_exp(token)
        self._last_refresh_flag = True
        self._last_refresh_reason = reason

    def force_refresh(self) -> None:
        """Force a refresh even if a token exists."""
        self._token = None
        self._token_exp = None
        self._last_issue = None
        self.login(reason="force_refresh")

    def _should_refresh(self) -> bool:
        """Determine whether the token is missing or expired."""
        if not self._token:
            return True
        now = time.time()
        if self._token_exp:
            return now >= (self._token_exp - config.TOKEN_EXP_LEEWAY_SECONDS)
        if self._last_issue:
            return (now - self._last_issue) >= config.FALLBACK_TOKEN_TTL_SECONDS
        return True

    @staticmethod
    def _extract_token(data: Dict[str, Any]) -> Optional[str]:
        """Support common key names for tokens."""
        candidates = [data]
        nested = data.get("data")
        if isinstance(nested, dict):
            candidates.append(nested)
        for container in candidates:
            for key in ("access_token", "token", "access", "jwt"):
                candidate = container.get(key)
                if isinstance(candidate, str) and candidate:
                    return candidate
        return None

    @staticmethod
    def _extract_exp(token: str) -> Optional[float]:
        """Decode the JWT exp claim if present."""
        try:
            parts = token.split(".")
            if len(parts) < 2:
                return None
            payload_raw = parts[1]
            padding = "=" * (-len(payload_raw) % 4)
            decoded = base64.urlsafe_b64decode(payload_raw + padding)
            payload = json.loads(decoded.decode("utf-8"))
            exp = payload.get("exp")
            if isinstance(exp, (int, float)):
                return float(exp)
            return None
        except Exception:
            return None

    def consume_refresh_info(self) -> Tuple[bool, Optional[str]]:
        """Return whether the last token fetch triggered a refresh and clear the flag."""
        refreshed = self._last_refresh_flag
        reason = self._last_refresh_reason
        self._last_refresh_flag = False
        self._last_refresh_reason = None
        return refreshed, reason
