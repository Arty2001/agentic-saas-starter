"""POST /api/tenant/{tenant_id}/generate — raw single-shot LLM streaming (no graph)."""

import asyncio
import logging
import uuid
from collections.abc import AsyncIterable
from typing import Any

from fastapi import APIRouter, Depends
from langchain_core.runnables import RunnableConfig
from starlette.responses import StreamingResponse

from agent_platform.api.dependencies import (
    get_session_factory,
)
from agent_platform.api.routes.tenant.config import get_tenant_config
from agent_platform.api.schemas import GenerateRequest
from agent_platform.api.streaming import SSEEvent, _sse, sse_response
from agent_platform.llm import get_llm
from agent_platform.observability.callback import ObservabilityCallbackHandler

logger = logging.getLogger(__name__)

router = APIRouter(tags=["generate"])


@router.post("/tenant/{tenant_id}/generate")
async def generate(
    tenant_id: str,
    request_body: GenerateRequest,
    session_factory: Any = Depends(get_session_factory),
) -> StreamingResponse:
    logger.info(
        "generate_request: tenant=%s session_id=%s message_len=%d agent_type=%s",
        tenant_id,
        request_body.session_id,
        len(request_body.message or ""),
        request_body.agent_type,
    )

    callback_handler = ObservabilityCallbackHandler(
        session_factory,
        request_body.session_id,
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
    config: RunnableConfig = {
        "configurable": configurable,
        "callbacks": [callback_handler],
    }

    tenant_config = await get_tenant_config(
        tenant_id=tenant_id,
        session_factory=session_factory,
    )
    llm = get_llm(
        provider=tenant_config.provider if tenant_config is not None else None,
        model=tenant_config.model or None if tenant_config is not None else None,
    )

    async def _llm_stream_with_lifecycle() -> AsyncIterable[str]:
        parent_run_id = uuid.uuid4()
        run_id = parent_run_id
        callback_handler.run_id = str(parent_run_id)
        await callback_handler._safe_write("create_run", callback_handler._create_run())
        await callback_handler._safe_write(
            "record_metadata_keys", callback_handler._record_metadata_keys()
        )
        await asyncio.gather(
            callback_handler.set_agent_type(agent_type='raw_generation'),
            callback_handler.set_run_status(status='Approved'),
        )
        await callback_handler.on_chain_start(serialized={}, inputs={}, run_id=run_id, parent_run_id=parent_run_id, name='generate')
        generated = ''
        async for chunk in llm.astream(
                    request_body.message,
                    config=config,
                ):
            text = chunk.content if isinstance(chunk.content, str) else str(chunk.content or "")
            if text:
                generated += text
                yield _sse('message', SSEEvent.create('message', { "generated": generated, "content": text }))
        await callback_handler.on_chain_end(outputs={}, run_id=run_id, parent_run_id=parent_run_id,)
        await callback_handler.on_chain_end(outputs={}, run_id=parent_run_id,)
        

    return sse_response(
        _llm_stream_with_lifecycle(),
    )
