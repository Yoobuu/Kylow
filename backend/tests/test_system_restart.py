from __future__ import annotations

from app.auth.user_model import User
from app.permissions.models import PermissionCode, UserPermission
from app.permissions.service import ensure_default_permissions
from app.system_state import set_restarting


def test_restart_requires_permission(client):
    response = client.post("/api/admin/system/restart", json={"confirm": "RESTART"})
    assert response.status_code == 403


def test_restart_rejects_invalid_confirm(client, session):
    ensure_default_permissions(session)
    user = User(id=1, username="superadmin", hashed_password="x")
    session.add(user)
    session.add(
        UserPermission(
            user_id=user.id,
            permission_code=PermissionCode.SYSTEM_RESTART.value,
            granted=True,
        )
    )
    session.commit()

    response = client.post("/api/admin/system/restart", json={"confirm": "NOPE"})
    assert response.status_code == 400


def test_healthz_returns_503_during_restart(client):
    set_restarting(True)
    response = client.get("/healthz")
    assert response.status_code == 503
    set_restarting(False)
