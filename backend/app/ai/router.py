from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from fastapi.encoders import jsonable_encoder
from sqlmodel import Session

from app.ai.schemas import AiChatRequest, AiChatResponse
from app.ai.service import AiService
from app.ai.storage import append_message, create_conversation, get_conversation
from app.auth.user_model import User
from app.db import get_session
from app.dependencies import require_permission
from app.permissions.models import PermissionCode

router = APIRouter(tags=["ai"])


@router.post("/chat", response_model=AiChatResponse)
def chat(
    payload: AiChatRequest,
    current_user: User = Depends(require_permission(PermissionCode.AI_CHAT)),
    session: Session = Depends(get_session),
):
    message = (payload.message or "").strip()
    if not message:
        raise HTTPException(status_code=400, detail="message is required")

    conversation_id = payload.conversation_id
    if conversation_id:
        conversation = get_conversation(session, conversation_id)
        if conversation is None:
            raise HTTPException(status_code=404, detail="conversation not found")
        if conversation.user_id != current_user.id:
            raise HTTPException(status_code=403, detail="forbidden")
    else:
        conversation = create_conversation(session, user_id=current_user.id)

    append_message(
        session,
        conversation_id=conversation.id,
        role="user",
        content=message,
    )

    service = AiService()
    result = service.chat(message, payload.ui_context, user=current_user, session=session)

    tool_meta = jsonable_encoder(result.meta or {"tools_used": result.tools_used})
    append_message(
        session,
        conversation_id=conversation.id,
        role="assistant",
        content=result.answer_text,
        tool_calls_json=tool_meta,
    )

    session.commit()

    meta = tool_meta

    return AiChatResponse(
        conversation_id=conversation.id,
        answer_text=result.answer_text,
        entities=result.entities,
        actions=result.actions,
        meta=meta,
    )
