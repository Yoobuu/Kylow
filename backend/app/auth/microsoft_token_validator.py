from __future__ import annotations

import time
from dataclasses import dataclass
from typing import Any, Dict, Iterable, Optional

import requests
from jose import ExpiredSignatureError, JWTError, jwt


DISCOVERY_URL_TEMPLATE = "https://login.microsoftonline.com/{tenant_id}/v2.0/.well-known/openid-configuration"
_CONFIG_TTL_SECONDS = 60 * 30
_JWKS_TTL_SECONDS = 60 * 60

_CONFIG_CACHE: Dict[str, Dict[str, Any]] = {}
_JWKS_CACHE: Dict[str, Dict[str, Any]] = {}


@dataclass
class TokenValidationError(Exception):
    code: str
    message: str
    status_code: int = 401


def _now() -> float:
    return time.time()


def _cached_value(cache: Dict[str, Dict[str, Any]], key: str, ttl: int) -> Optional[Dict[str, Any]]:
    item = cache.get(key)
    if not item:
        return None
    if _now() - item["fetched_at"] > ttl:
        return None
    return item["value"]


def _store_cache(cache: Dict[str, Dict[str, Any]], key: str, value: Dict[str, Any]) -> None:
    cache[key] = {"fetched_at": _now(), "value": value}


def _fetch_json(url: str) -> Dict[str, Any]:
    try:
        response = requests.get(url, timeout=8)
    except requests.RequestException as exc:
        raise TokenValidationError(
            code="invalid_token",
            message=f"Error al consultar OpenID config: {exc}",
            status_code=401,
        ) from exc
    if response.status_code != 200:
        raise TokenValidationError(
            code="invalid_token",
            message=f"OpenID config inválido (status {response.status_code})",
            status_code=401,
        )
    try:
        return response.json()
    except ValueError as exc:
        raise TokenValidationError(
            code="invalid_token",
            message="OpenID config no es JSON válido",
            status_code=401,
        ) from exc


def _get_openid_config(tenant_id: str, *, force_refresh: bool = False) -> Dict[str, Any]:
    cache_key = tenant_id.strip().lower()
    if not force_refresh:
        cached = _cached_value(_CONFIG_CACHE, cache_key, _CONFIG_TTL_SECONDS)
        if cached:
            return cached

    url = DISCOVERY_URL_TEMPLATE.format(tenant_id=tenant_id)
    payload = _fetch_json(url)
    if "issuer" not in payload or "jwks_uri" not in payload:
        raise TokenValidationError(
            code="invalid_token",
            message="OpenID config incompleto",
            status_code=401,
        )
    _store_cache(_CONFIG_CACHE, cache_key, payload)
    return payload


def _get_jwks(jwks_uri: str, *, force_refresh: bool = False) -> Dict[str, Any]:
    if not force_refresh:
        cached = _cached_value(_JWKS_CACHE, jwks_uri, _JWKS_TTL_SECONDS)
        if cached:
            return cached
    payload = _fetch_json(jwks_uri)
    if "keys" not in payload:
        raise TokenValidationError(
            code="invalid_token",
            message="JWKS sin llaves",
            status_code=401,
        )
    _store_cache(_JWKS_CACHE, jwks_uri, payload)
    return payload


def _select_jwk(jwks: Dict[str, Any], kid: Optional[str]) -> Optional[Dict[str, Any]]:
    for key in jwks.get("keys", []):
        if kid and key.get("kid") == kid:
            return key
    return None


def _extract_email(claims: Dict[str, Any]) -> Optional[str]:
    for key in ("preferred_username", "upn", "email", "unique_name"):
        value = claims.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return None


def validate_id_token(
    id_token: str,
    *,
    tenant_id: Optional[str],
    client_id: Optional[str],
    allowed_tenants: Iterable[str],
) -> Dict[str, Any]:
    if not id_token:
        raise TokenValidationError(code="invalid_token", message="id_token requerido", status_code=401)
    if not client_id:
        raise TokenValidationError(
            code="invalid_token",
            message="Client ID no configurado",
            status_code=401,
        )

    try:
        unverified_claims = jwt.get_unverified_claims(id_token)
    except JWTError as exc:
        raise TokenValidationError(code="invalid_token", message="Token inválido", status_code=401) from exc

    tid = unverified_claims.get("tid")
    if not tid or not isinstance(tid, str):
        raise TokenValidationError(code="invalid_token", message="Token sin tid", status_code=401)

    allowed = {t.strip() for t in allowed_tenants if t and t.strip()}
    if allowed and tid not in allowed:
        raise TokenValidationError(
            code="tenant_not_allowed",
            message="Tenant no permitido",
            status_code=403,
        )

    tenant_for_discovery = tid or tenant_id
    if not tenant_for_discovery:
        raise TokenValidationError(
            code="invalid_token",
            message="Tenant no configurado",
            status_code=401,
        )

    try:
        header = jwt.get_unverified_header(id_token)
    except JWTError as exc:
        raise TokenValidationError(code="invalid_token", message="Token inválido", status_code=401) from exc

    if header.get("alg") != "RS256":
        raise TokenValidationError(code="invalid_token", message="Algoritmo inválido", status_code=401)

    oidc_config = _get_openid_config(tenant_for_discovery)
    issuer = oidc_config["issuer"]
    jwks_uri = oidc_config["jwks_uri"]

    jwks = _get_jwks(jwks_uri)
    jwk_key = _select_jwk(jwks, header.get("kid"))
    if jwk_key is None:
        jwks = _get_jwks(jwks_uri, force_refresh=True)
        jwk_key = _select_jwk(jwks, header.get("kid"))
    if jwk_key is None:
        raise TokenValidationError(code="invalid_token", message="kid no encontrado", status_code=401)

    try:
        claims = jwt.decode(
            id_token,
            jwk_key,
            algorithms=["RS256"],
            audience=client_id,
            issuer=issuer,
        )
    except ExpiredSignatureError as exc:
        raise TokenValidationError(code="invalid_token", message="Token expirado", status_code=401) from exc
    except JWTError as exc:
        raise TokenValidationError(code="invalid_token", message="Token inválido", status_code=401) from exc

    tid_verified = claims.get("tid")
    if not tid_verified or tid_verified != tid:
        raise TokenValidationError(code="invalid_token", message="Tenant inválido", status_code=401)
    if allowed and tid_verified not in allowed:
        raise TokenValidationError(
            code="tenant_not_allowed",
            message="Tenant no permitido",
            status_code=403,
        )

    oid = claims.get("oid")
    if not oid or not isinstance(oid, str):
        raise TokenValidationError(code="invalid_token", message="Token sin oid", status_code=401)

    return {
        "oid": oid,
        "tid": tid_verified,
        "email": _extract_email(claims),
        "claims": claims,
    }

