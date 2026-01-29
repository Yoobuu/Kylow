from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Iterator, Optional
from uuid import uuid4

from sqlalchemy import Column, JSON
from sqlmodel import Field, Session, SQLModel, delete, select


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class AIConversation(SQLModel, table=True):
    __tablename__ = "ai_conversations"

    id: str = Field(primary_key=True, index=True)
    user_id: int = Field(index=True)
    created_at: datetime = Field(default_factory=utcnow, nullable=False)
    expires_at: datetime = Field(nullable=False)


class AIMessage(SQLModel, table=True):
    __tablename__ = "ai_messages"

    id: Optional[int] = Field(default=None, primary_key=True)
    conversation_id: str = Field(foreign_key="ai_conversations.id", index=True)
    role: str = Field(max_length=32, nullable=False)
    content: str = Field(nullable=False)
    tool_calls_json: Optional[dict] = Field(
        default=None,
        sa_column=Column(JSON(none_as_null=True), nullable=True),
    )
    created_at: datetime = Field(default_factory=utcnow, nullable=False)


def create_conversation(session: Session, *, user_id: int) -> AIConversation:
    now = utcnow()
    conv = AIConversation(
        id=str(uuid4()),
        user_id=user_id,
        created_at=now,
        expires_at=now + timedelta(days=1),
    )
    session.add(conv)
    return conv


def get_conversation(session: Session, conversation_id: str) -> Optional[AIConversation]:
    return session.exec(
        select(AIConversation).where(AIConversation.id == conversation_id)
    ).first()


def append_message(
    session: Session,
    *,
    conversation_id: str,
    role: str,
    content: str,
    tool_calls_json: Optional[dict] = None,
) -> AIMessage:
    msg = AIMessage(
        conversation_id=conversation_id,
        role=role,
        content=content,
        tool_calls_json=tool_calls_json,
    )
    session.add(msg)
    return msg


def purge_expired(session: Session) -> int:
    now = utcnow()
    expired_ids = session.exec(
        select(AIConversation.id).where(AIConversation.expires_at < now)
    ).all()
    if not expired_ids:
        return 0
    session.exec(delete(AIMessage).where(AIMessage.conversation_id.in_(expired_ids)))
    session.exec(delete(AIConversation).where(AIConversation.id.in_(expired_ids)))
    session.commit()
    return len(expired_ids)
