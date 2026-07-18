"""POST /api/chat SSE streaming endpoint."""

import logging
from datetime import UTC, datetime
from typing import Any

from fastapi import APIRouter, Depends, Request
from langchain_core.runnables import RunnableConfig
from sqlalchemy import update as sa_update
from starlette.responses import StreamingResponse

from agent_platform.api.dependencies import (
    Graph,
    get_graph,
    get_session_factory,
)
from agent_platform.api.schemas import ChatRequest
from agent_platform.api.streaming import build_graph_input, sse_response, stream_graph
from agent_platform.auth import _get_user_and_token
from agent_platform.db.models import Run
from agent_platform.observability.callback import ObservabilityCallbackHandler

logger = logging.getLogger(__name__)

router = APIRouter(tags=["chat"])

@router.post("/chat")
async def chat(
    request_body: ChatRequest,
    request: Request,
    graph: Graph = Depends(get_graph),
    session_factory: Any = Depends(get_session_factory),
) -> StreamingResponse:
    logger.info(
        "chat_request: session_id=%s message_len=%d approval_action=%s agent_type=%s",
        request_body.session_id,
        len(request_body.message or ""),
        request_body.approval_action,
        request_body.agent_type,
    )

    auth_user, auth_token = _get_user_and_token(request)

    callback_handler = ObservabilityCallbackHandler(
        session_factory,
        request_body.session_id,
        user_id=auth_user,
        run_metadata=(
            request_body.session_context.run_metadata()
            if request_body.session_context is not None
            else None
        ),
    )

    # Build config
    configurable: dict[str, Any] = {"thread_id": request_body.session_id}
    if request_body.session_context is not None:
        configurable["session_context"] = request_body.session_context.model_dump()

    configurable["auth_context"] = {"user": auth_user, "token": auth_token}

    config: RunnableConfig = {
        "configurable": configurable,
        "callbacks": [callback_handler],
    }

    # Build input
    input_val, is_approval = build_graph_input(
        message=request_body.message,
        agent_type=request_body.agent_type,
        approval_action=request_body.approval_action,
        modifications=request_body.modifications,
    )

    # Resolve pending_approval runs
    if is_approval:
        status_map = {
            "approve": "approved",
            "reject": "rejected",
            "edit": "edited",
        }
        resolved_status = status_map.get(request_body.approval_action or "", "approved")
        async with session_factory() as session:
            await session.execute(
                sa_update(Run)
                .where(Run.thread_id == request_body.session_id)
                .where(Run.status == "pending_approval")
                .values(status=resolved_status, ended_at=datetime.now(UTC))
            )
            await session.commit()

    if not is_approval:
        await callback_handler.write_conversation_message("user", request_body.message)

    return sse_response(
        stream_graph(
            graph=graph,
            input_val=input_val,
            config=config,
            callback_handler=callback_handler,
            is_approval_resume=is_approval,
            session_id=request_body.session_id,
        )
    )
