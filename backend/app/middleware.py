from __future__ import annotations

from typing import Callable
from uuid import uuid4

from app.settings import settings

from fastapi import FastAPI, Request, Response

CORRELATION_HEADER = "X-Correlation-Id"


def install_audit_middleware(app: FastAPI) -> None:
    @app.middleware("http")
    async def ensure_correlation_id(request: Request, call_next: Callable[[Request], Response]):
        correlation_id = request.headers.get(CORRELATION_HEADER) or str(uuid4())
        request.state.correlation_id = correlation_id

        response = await call_next(request)
        if CORRELATION_HEADER not in response.headers:
            response.headers[CORRELATION_HEADER] = correlation_id
        return response


def _is_https_request(request: Request) -> bool:
    forwarded = request.headers.get("X-Forwarded-Proto", "")
    if forwarded:
        return forwarded.split(",")[0].strip().lower() == "https"
    return request.url.scheme == "https"


def install_security_headers(app: FastAPI) -> None:
    if not settings.security_headers_enabled:
        return

    @app.middleware("http")
    async def add_security_headers(request: Request, call_next: Callable[[Request], Response]):
        response = await call_next(request)

        response.headers.setdefault("X-Content-Type-Options", "nosniff")
        response.headers.setdefault("X-Frame-Options", "DENY")
        response.headers.setdefault("Referrer-Policy", "no-referrer")
        response.headers.setdefault("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
        response.headers.setdefault("Cross-Origin-Resource-Policy", "same-origin")
        response.headers.setdefault("Cross-Origin-Opener-Policy", "same-origin")
        response.headers.setdefault("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'")

        if settings.app_env in {"prod", "production"} and settings.hsts_max_age > 0 and _is_https_request(request):
            hsts = f"max-age={settings.hsts_max_age}"
            if settings.hsts_include_subdomains:
                hsts += "; includeSubDomains"
            if settings.hsts_preload:
                hsts += "; preload"
            response.headers.setdefault("Strict-Transport-Security", hsts)

        return response
