"""Shared chat pipeline: protocol input building + SSE streaming.

Both POST /api/chat and POST /api/playground/chat use the same graph
streaming pipeline, and the regression test runner replays the same
protocol. This module holds the shared pieces so no consumer duplicates
them:

- `build_graph_input` turns a chat request (message / approval_action /
  modifications) into the LangGraph input value.
- `stream_graph_events` yields `SSEEvent` objects (plus the `KEEPALIVE`
  sentinel) so non-HTTP consumers can capture the exact event stream the
  browser sees; `stream_graph` wraps it into the SSE wire format.
"""

from __future__ import annotations

import logging
from collections.abc import AsyncIterable
from typing import Any, cast

from langchain_core.messages import AIMessage, AIMessageChunk, HumanMessage
from langchain_core.runnables import RunnableConfig
from langgraph.types import Command
from starlette.responses import StreamingResponse

from agent_platform.api.dependencies import Graph
from agent_platform.api.schemas import SSEEvent
from agent_platform.observability.callback import ObservabilityCallbackHandler

logger = logging.getLogger(__name__)

_STREAMABLE_NODES = {"guide_respond", "chat"}
_TEXT_NODES = {"format_results"}


def build_graph_input(
    *,
    message: str,
    agent_type: str | None,
    approval_action: str | None,
    modifications: list[dict] | None,
) -> tuple[Any, bool]:
    """Return ``(input_val, is_approval_resume)`` for a graph invocation.

    - ``approval_action == "clarification_response"``: resume with the raw
      modification payload (single item unwrapped, multiple passed as a list —
      one entry per pending interrupt).
    - other approval actions (approve/reject/edit): resume with the
      ``{action, modifications, message}`` dict the approval nodes expect.
    - no approval action: a fresh HumanMessage turn; ``agent_type`` of None or
      "router" leaves routing to the router LLM.
    """
    if approval_action is not None:
        if approval_action == "clarification_response":
            mods = modifications or []
            input_val: Any = Command(resume=mods[0] if len(mods) == 1 else mods)
        else:
            input_val = Command(
                resume={
                    "action": approval_action,
                    "modifications": modifications,
                    "message": message,
                }
            )
        return input_val, True

    agent = agent_type
    if agent and agent.lower() == "router":
        agent = None

    input_val = {"messages": [HumanMessage(content=message)]}
    if agent:
        input_val["selected_agent"] = agent
    return input_val, False

KEEPALIVE: Any = object()


def _sse(event: str, data_obj: SSEEvent) -> str:
    return f"event: {event}\ndata: {data_obj.model_dump_json()}\n\n"


async def stream_graph_events(
    *,
    graph: Graph,
    input_val: Any,
    config: RunnableConfig,
    callback_handler: ObservabilityCallbackHandler,
    is_approval_resume: bool,
    session_id: str,
) -> AsyncIterable[Any]:
    """Stream SSEEvent objects (and KEEPALIVE sentinels) from a LangGraph execution."""
    seen_past_steps = 0
    agent_type_set = False

    # Stamp every event with the current run id so the client can map a reply to
    # its run. run_id is set on the root chain start, before the first chunk.
    def emit(data_obj: SSEEvent) -> SSEEvent:
        data_obj.run_id = callback_handler.run_id
        return data_obj

    try:
        logger.info("stream_start: session_id=%s", session_id)
        chunk_count = 0
        last_progress_node: str | None = None

        # str stream modes are valid at runtime; the typed overloads only accept literals
        async for chunk in graph.astream(  # type: ignore[call-overload]
            input_val,
            config=config,
            stream_mode=["updates", "messages", "custom"],
            subgraphs=True,
            # Persist only at exit/interrupt, not at every super-step. Default
            # "async" writes a checkpoint + per-channel blobs on every step of
            # every (fanned-out) subgraph, which bloats the database without bound.
            # "exit" still checkpoints at interrupts, so HITL resume works.
            # Propagates to subgraphs via config (CONFIG_KEY_DURABILITY).
            durability="exit",
        ):
            chunk_count += 1
            namespace, mode, data = cast("tuple[Any, str, Any]", chunk)

            if chunk_count <= 3:
                logger.info(
                    "stream_chunk: n=%d mode=%s session_id=%s",
                    chunk_count, mode, session_id,
                )

            # Set agent type on first chunk for resume flows. We re-enter
            # mid-dispatcher on a resume, so the router/dispatcher don't
            # re-emit selected_agent — read it from the checkpointed state
            # instead of assuming a specific agent (keeps observability
            # correct whichever agent is in use).
            if not agent_type_set and is_approval_resume:
                agent_type_set = True
                try:
                    snapshot = await graph.aget_state(config)
                    resumed_agent = (snapshot.values or {}).get("selected_agent")
                except Exception:
                    logger.warning("resume: could not read selected_agent", exc_info=True)
                    resumed_agent = None
                if resumed_agent:
                    await callback_handler.set_agent_type(resumed_agent)

            if mode == "updates":
                # -- Interrupt (plan approval or tool clarification) -----------
                if "__interrupt__" in data:
                    interrupts = data["__interrupt__"]
                    first_value = interrupts[0].value
                    interrupt_type = first_value.get("type", "") if isinstance(first_value, dict) else ""

                    if interrupt_type == "clarification":
                        remaining = len(interrupts)
                        yield emit(
                            SSEEvent.create("tool_clarification", {
                                **first_value,
                                "remaining": remaining,
                            }),
                        )
                    else:
                        yield emit(SSEEvent.create("plan", first_value))

                    await callback_handler.set_run_status("pending_approval")
                    yield emit(SSEEvent.create("done", {"awaiting_approval": True}))
                    return

                # -- Node updates ----------------------------------------------
                for node_name, update in data.items():
                    if node_name == "router":
                        selected_agent = update.get("selected_agent")
                        if selected_agent:
                            await callback_handler.set_agent_type(selected_agent)
                            agent_type_set = True
                        yield emit(
                            SSEEvent.create("router_decision", {
                                "selected_agent": selected_agent,
                            }),
                        )

                    if node_name == "dispatcher":
                        # Set agent type from state on first dispatcher update
                        if not agent_type_set:
                            selected = update.get("selected_agent")
                            if selected:
                                await callback_handler.set_agent_type(selected)
                                agent_type_set = True

                        is_plan_run = (
                            is_approval_resume
                            or update.get("plan_approved") is not None
                        )
                        if is_plan_run:
                            # Fan-out agents: surface each parallel branch result
                            item_results = update.get("item_results") or []
                            if len(item_results) > seen_past_steps:
                                for i in range(seen_past_steps, len(item_results)):
                                    result = item_results[i]
                                    yield emit(
                                        SSEEvent.create("step_complete", {
                                            "step_index": result.get("index", i),
                                            "step": result.get("name", f"Item {i + 1}"),
                                            "result": result.get("status", "unknown"),
                                        }),
                                    )
                                seen_past_steps = len(item_results)

                            current_idx = update.get("current_step_index")
                            plan = update.get("plan")
                            if current_idx is not None and plan and current_idx < len(plan):
                                yield emit(
                                    SSEEvent.create("step_start", {
                                        "step_index": current_idx,
                                        "step": plan[current_idx],
                                    }),
                                )

                            past_steps = update.get("past_steps") or []
                            if past_steps and len(past_steps) > seen_past_steps:
                                for i in range(seen_past_steps, len(past_steps)):
                                    step_desc, step_result = past_steps[i]
                                    yield emit(
                                        SSEEvent.create("step_complete", {
                                            "step_index": i,
                                            "step": step_desc,
                                            "result": str(step_result),
                                        }),
                                    )
                                seen_past_steps = len(past_steps)

                    # -- Final text from dispatcher / format_results ----------------------------
                    if node_name in _TEXT_NODES:
                        resp_messages = update.get("messages", [])
                        if isinstance(resp_messages, list) and resp_messages:
                            last_msg = resp_messages[-1]
                            if (
                                isinstance(last_msg, AIMessage)
                                and last_msg.content
                                and not getattr(last_msg, "tool_calls", None)
                            ):

                                extras = getattr(last_msg, "additional_kwargs", None) or {}
                                display = extras.get("display")
                                items = extras.get("items") or []

                                if display == "items_completed":
                                    yield emit(
                                        SSEEvent.create("items_completed", {
                                            "items": items,
                                        }),
                                    )
                                else:
                                    yield emit(
                                        SSEEvent.create("text_delta", {"content": last_msg.content}),
                                    )

                    # -- Tool calls / results ----------------------------------
                    node_messages = update.get("messages", [])
                    if isinstance(node_messages, list):
                        for msg in node_messages:
                            if isinstance(msg, AIMessage) and getattr(msg, "tool_calls", None):
                                for tc in msg.tool_calls:
                                    yield emit(
                                        SSEEvent.create("tool_call", {
                                            "tool_name": tc["name"],
                                            "arguments": tc["args"],
                                        }),
                                    )
                            if hasattr(msg, "tool_call_id") and msg.tool_call_id:
                                yield emit(
                                    SSEEvent.create("tool_result", {
                                        "tool_name": getattr(msg, "name", "unknown"),
                                        "result": msg.content,
                                    }),
                                )

            elif mode == "messages":
                message_chunk, metadata = data
                node = metadata.get("langgraph_node")
                is_chunk = type(message_chunk) is AIMessageChunk
                if not (is_chunk and message_chunk.content and isinstance(message_chunk.content, str)):
                    continue

                if node in _STREAMABLE_NODES:
                    yield emit(
                        SSEEvent.create("text_delta", {"content": message_chunk.content}),
                    )
                else:
                    # Non-streamable LLM node (triage, planner): emit progress on first
                    # chunk per node, keepalive comments otherwise to keep the pipe flowing.
                    if node != last_progress_node:
                        last_progress_node = node
                        yield emit(SSEEvent.create("node_progress", {"node": node}))
                    else:
                        yield KEEPALIVE

            elif mode == "custom":
                event_type = data.get("type", "custom") if isinstance(data, dict) else "custom"
                event_data = data.get("data", data) if isinstance(data, dict) else data
                yield emit(SSEEvent.create(event_type, event_data))

        logger.info("stream_done: session_id=%s total_chunks=%d", session_id, chunk_count)
        yield emit(SSEEvent.create("done", {"awaiting_approval": False}))

    except Exception as e:
        logger.exception("stream_error: session_id=%s error=%s", session_id, str(e))
        yield emit(SSEEvent.create("error", {"error_type": type(e).__name__, "message": str(e)}))
        yield emit(SSEEvent.create("done", {"awaiting_approval": False}))


async def stream_graph(
    *,
    graph: Graph,
    input_val: Any,
    config: RunnableConfig,
    callback_handler: ObservabilityCallbackHandler,
    is_approval_resume: bool,
    session_id: str,
) -> AsyncIterable[str]:
    """Stream SSE-formatted strings from a LangGraph execution."""
    async for ev in stream_graph_events(
        graph=graph,
        input_val=input_val,
        config=config,
        callback_handler=callback_handler,
        is_approval_resume=is_approval_resume,
        session_id=session_id,
    ):
        yield ": ka\n\n" if ev is KEEPALIVE else _sse(ev.type, ev)


def sse_response(event_stream: AsyncIterable[str]) -> StreamingResponse:
    """Wrap an SSE async generator in a StreamingResponse with correct headers."""
    return StreamingResponse(
        event_stream,
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
