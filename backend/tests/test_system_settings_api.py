from __future__ import annotations

from app.auth.user_model import User
from app.permissions.models import PermissionCode, UserPermission
from app.permissions.service import ensure_default_permissions


def _grant(session, user_id: int, code: PermissionCode) -> None:
    session.add(
        UserPermission(
            user_id=user_id,
            permission_code=code.value,
            granted=True,
        )
    )
    session.commit()


def test_get_settings_requires_permission(client):
    response = client.get("/api/admin/system/settings")
    assert response.status_code == 403


def test_put_settings_requires_permission(client):
    response = client.put("/api/admin/system/settings", json={"warmup_enabled": True})
    assert response.status_code == 403


def test_put_settings_invalid_interval(client, session):
    ensure_default_permissions(session)
    user = User(id=1, username="superadmin", hashed_password="x")
    session.add(user)
    session.commit()
    _grant(session, user.id, PermissionCode.SYSTEM_SETTINGS_EDIT)

    response = client.put(
        "/api/admin/system/settings",
        json={"hyperv_refresh_interval_minutes": 5},
    )
    assert response.status_code == 422


def test_put_settings_ok(client, session):
    ensure_default_permissions(session)
    user = User(id=1, username="superadmin", hashed_password="x")
    session.add(user)
    session.commit()
    _grant(session, user.id, PermissionCode.SYSTEM_SETTINGS_EDIT)

    response = client.put(
        "/api/admin/system/settings",
        json={
            "warmup_enabled": False,
            "notif_sched_enabled": True,
            "hyperv_enabled": True,
            "vmware_enabled": True,
            "cedia_enabled": False,
            "hyperv_refresh_interval_minutes": 15,
            "vmware_refresh_interval_minutes": 20,
            "vmware_hosts_refresh_interval_minutes": 25,
            "cedia_refresh_interval_minutes": 30,
        },
    )
    assert response.status_code == 200
    body = response.json()
    assert body["saved"] is True
    assert body["requires_restart"] is True
