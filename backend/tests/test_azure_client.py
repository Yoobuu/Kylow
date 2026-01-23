from __future__ import annotations

from types import SimpleNamespace

import pytest
from fastapi import HTTPException

import app.azure.arm_client as arm_client


class DummyResponse:
    def __init__(self, status_code: int, *, json_data=None, text: str = "", headers=None):
        self.status_code = status_code
        self._json_data = json_data
        self.text = text
        self.headers = headers or {}

    def json(self):
        if isinstance(self._json_data, Exception):
            raise ValueError("invalid json")
        return self._json_data


def _dummy_settings():
    return SimpleNamespace(
        azure_tenant_id="tenant",
        azure_client_id="client",
        azure_client_secret="secret",
        azure_subscription_id="sub",
        azure_api_base="https://management.azure.com",
        azure_api_version_compute="2025-04-01",
        azure_api_version_network="2024-05-01",
        azure_missing_envs=[],
        test_mode=False,
    )


def test_token_cache(monkeypatch):
    monkeypatch.setattr(arm_client, "settings", _dummy_settings())
    arm_client._TOKEN_STATE = None
    calls = {"count": 0}

    def fake_post(url, data=None, timeout=10):
        calls["count"] += 1
        return DummyResponse(200, json_data={"access_token": "tok-1", "expires_in": 3600})

    monkeypatch.setattr(arm_client.requests, "post", fake_post)

    client = arm_client.AzureArmClient()
    first = client.get_token()
    second = client.get_token()

    assert first == "tok-1"
    assert second == "tok-1"
    assert calls["count"] == 1


def test_token_refresh_on_margin(monkeypatch):
    monkeypatch.setattr(arm_client, "settings", _dummy_settings())
    arm_client._TOKEN_STATE = arm_client.TokenState(token="old", expires_at=arm_client._now() + 10)
    calls = {"count": 0}

    def fake_post(url, data=None, timeout=10):
        calls["count"] += 1
        return DummyResponse(200, json_data={"access_token": "tok-2", "expires_in": 3600})

    monkeypatch.setattr(arm_client.requests, "post", fake_post)

    client = arm_client.AzureArmClient()
    token = client.get_token()

    assert token == "tok-2"
    assert calls["count"] == 1


def test_request_retries_on_401(monkeypatch):
    monkeypatch.setattr(arm_client, "settings", _dummy_settings())
    arm_client._TOKEN_STATE = None

    def fake_post(url, data=None, timeout=10):
        return DummyResponse(200, json_data={"access_token": "tok-3", "expires_in": 3600})

    call_count = {"count": 0}

    def fake_request(method, url, headers=None, params=None, timeout=15):
        call_count["count"] += 1
        if call_count["count"] == 1:
            return DummyResponse(401, text="unauthorized")
        return DummyResponse(200, json_data={"value": 1})

    monkeypatch.setattr(arm_client.requests, "post", fake_post)
    monkeypatch.setattr(arm_client.requests, "request", fake_request)

    client = arm_client.AzureArmClient()
    payload = client.request_json("GET", "https://management.azure.com/test")

    assert payload == {"value": 1}
    assert call_count["count"] == 2


def test_request_retries_on_429(monkeypatch):
    monkeypatch.setattr(arm_client, "settings", _dummy_settings())
    arm_client._TOKEN_STATE = None

    def fake_post(url, data=None, timeout=10):
        return DummyResponse(200, json_data={"access_token": "tok-4", "expires_in": 3600})

    call_count = {"count": 0}
    slept = {"value": 0}

    def fake_request(method, url, headers=None, params=None, timeout=15):
        call_count["count"] += 1
        if call_count["count"] == 1:
            return DummyResponse(429, headers={"Retry-After": "1"})
        return DummyResponse(200, json_data={"ok": True})

    def fake_sleep(seconds):
        slept["value"] = seconds

    monkeypatch.setattr(arm_client.requests, "post", fake_post)
    monkeypatch.setattr(arm_client.requests, "request", fake_request)
    monkeypatch.setattr(arm_client.time, "sleep", fake_sleep)

    client = arm_client.AzureArmClient()
    payload = client.request_json("GET", "https://management.azure.com/test")

    assert payload == {"ok": True}
    assert call_count["count"] == 2
    assert slept["value"] == 1


def test_request_raises_on_403(monkeypatch):
    monkeypatch.setattr(arm_client, "settings", _dummy_settings())
    arm_client._TOKEN_STATE = None

    def fake_post(url, data=None, timeout=10):
        return DummyResponse(200, json_data={"access_token": "tok-5", "expires_in": 3600})

    def fake_request(method, url, headers=None, params=None, timeout=15):
        return DummyResponse(403, text="forbidden")

    monkeypatch.setattr(arm_client.requests, "post", fake_post)
    monkeypatch.setattr(arm_client.requests, "request", fake_request)

    client = arm_client.AzureArmClient()
    with pytest.raises(HTTPException) as exc:
        client.request_json("GET", "https://management.azure.com/test")

    assert exc.value.status_code == 403


def test_request_raises_on_5xx(monkeypatch):
    monkeypatch.setattr(arm_client, "settings", _dummy_settings())
    arm_client._TOKEN_STATE = None

    def fake_post(url, data=None, timeout=10):
        return DummyResponse(200, json_data={"access_token": "tok-6", "expires_in": 3600})

    def fake_request(method, url, headers=None, params=None, timeout=15):
        return DummyResponse(503, text="server error")

    monkeypatch.setattr(arm_client.requests, "post", fake_post)
    monkeypatch.setattr(arm_client.requests, "request", fake_request)

    client = arm_client.AzureArmClient()
    with pytest.raises(HTTPException) as exc:
        client.request_json("GET", "https://management.azure.com/test")

    assert exc.value.status_code == 503
