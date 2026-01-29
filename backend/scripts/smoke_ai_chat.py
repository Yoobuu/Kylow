"""Smoke test for AI chat tools (requires DATABASE_URL and provider configs)."""
from __future__ import annotations

import os
from sqlmodel import Session, select

from app.ai.router import chat
from app.ai.schemas import AiChatRequest
from app.auth.user_model import User
from app.db import get_engine, init_db
from app.permissions.models import PermissionCode, UserPermission
from app.permissions.service import ensure_default_permissions


def main() -> None:
    provider = os.getenv("AI_PROVIDER", "mock")
    if provider.lower() == "openai" and not os.getenv("OPENAI_API_KEY"):
        print("OPENAI_API_KEY is required when AI_PROVIDER=openai")
        raise SystemExit(1)

    engine = get_engine()
    init_db(bind=engine)
    with Session(engine) as session:
        ensure_default_permissions(session)
        user = session.exec(select(User).where(User.username == "ai-smoke")).first()
        if not user:
            user = User(username="ai-smoke", hashed_password="x")
            session.add(user)
            session.commit()
            session.refresh(user)
        existing = session.exec(
            select(UserPermission).where(
                UserPermission.user_id == user.id,
                UserPermission.permission_code == PermissionCode.AI_CHAT.value,
            )
        ).first()
        if not existing:
            session.add(UserPermission(user_id=user.id, permission_code=PermissionCode.AI_CHAT.value, granted=True))
            session.commit()

        for prompt in ("hola", "ram 32768 vmware", "muestrame hosts vmware", "abre la VM P-WWW4-OL-01"):
            req = AiChatRequest(message=prompt)
            resp = chat(req, current_user=user, session=session)
            print("provider", provider, "prompt", prompt)
            model_used = None
            fallback_used = False
            tools_used = []
            if resp.meta:
                tools_used = resp.meta.get("tools_used") or []
                for entry in tools_used:
                    if isinstance(entry, dict) and entry.get("provider") == "openai":
                        model_used = entry.get("model")
                        fallback_used = bool(entry.get("fallback"))
                        break
            if model_used:
                print("model", model_used, "fallback", fallback_used)
            print("answer", resp.answer_text)
            print("actions", resp.actions)
            if resp.meta:
                print("tools_used", tools_used)


if __name__ == "__main__":
    if not os.getenv("DATABASE_URL"):
        raise SystemExit("DATABASE_URL is required")
    main()
