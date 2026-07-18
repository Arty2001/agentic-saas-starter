"""LangGraph callback handler for automatic observability tracing."""

from __future__ import annotations

import json
import logging
import time
import uuid
from datetime import UTC, datetime
from typing import Any

from langchain_core.callbacks import AsyncCallbackHandler
from langchain_core.messages import AIMessage, BaseMessage
from langchain_core.outputs import LLMResult
from sqlalchemy import update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from agent_platform.config import get_settings
from agent_platform.db.models import (
    ConversationMessage,
    Edge,
    LLMCall,
    MetadataKey,
    Run,
    Step,
    ToolCall,
)
from agent_platform.tools.executor import extract_error_message, is_tool_error

logger = logging.getLogger(__name__)

# Cap stored strings well below any practical column size
# that to leave headroom for multi-byte UTF-8 characters.
_MAX_TEXT_CHARS = 60_000


def _truncate(s: str) -> str:
    if len(s) <= _MAX_TEXT_CHARS:
        return s
    return s[:_MAX_TEXT_CHARS] + f"... [truncated {len(s) - _MAX_TEXT_CHARS} chars]"

class ObservabilityCallbackHandler(AsyncCallbackHandler):
    """Async callback handler that traces graph executions to Postgres."""

    def __init__(
        self,
        session_factory: async_sessionmaker[AsyncSession],
        thread_id: str,
        user_id: str | None = None,
        run_metadata: dict[str, Any] | None = None,
    ) -> None:
        super().__init__()
        self.session_factory = session_factory
        self.thread_id = thread_id
        self.user_id = user_id
        self.run_metadata = run_metadata
        self.run_id: str | None = None

        # Internal tracking maps
        self._chain_to_step: dict[str, str] = {}
        self._step_start_times: dict[str, float] = {}
        self._tool_start_times: dict[str, float] = {}
        self._tool_id_map: dict[str, str] = {}  # LG run_id -> our ToolCall.id
        self._llm_start_times: dict[str, float] = {}
        self._llm_step_map: dict[str, str] = {}  # LG run_id -> step_id
        self._llm_messages_map: dict[str, str] = {}  # LG run_id -> serialized messages
        self._parent_map: dict[str, str] = {}  # child run_id -> parent run_id
        self._previous_node: str | None = None
        self._actual_step_runs: set[str] = set()  # run_ids that created Step rows
        self._last_step_id: str | None = None  # most recently created step_id
        self._total_input_tokens: int = 0
        self._total_output_tokens: int = 0
        self._current_node_name: str | None = None  # Track current executing node
        self._tool_name_map: dict[str, str] = {}  # LG run_id -> tool_name
        self._tool_arguments_map: dict[str, str] = {}  # LG run_id -> arguments
        self._tool_errors: list[tuple[str, str, str, str]] = []  # List of (node, tool_name, arguments, error_msg)

    def _find_step_id(self, run_id: str) -> str:
        """Walk up the parent chain to find the step_id for a given run_id."""
        visited: set[str] = set()
        current = run_id
        while current and current not in visited:
            if current in self._chain_to_step:
                return self._chain_to_step[current]
            visited.add(current)
            current = self._parent_map.get(current, "")
        # Fallback: assign to the most recently created step
        return self._last_step_id or "unknown"

    async def _safe_write(self, coro_name: str, coro: Any) -> None:
        """Execute a DB write coroutine, swallowing errors to avoid crashing the graph."""
        try:
            await coro
        except Exception:
            logger.exception("observability_write_failed: operation=%s", coro_name)

    async def on_chain_start(
        self,
        serialized: dict[str, Any] | None,
        inputs: dict[str, Any],
        *,
        run_id: uuid.UUID,
        parent_run_id: uuid.UUID | None = None,
        tags: list[str] | None = None,
        name: str | None = None,
        **kwargs: Any,
    ) -> None:
        # LangGraph may pass serialized=None; prefer the `name` kwarg
        node_name = name or (serialized.get("name", "unknown") if serialized else "unknown")
        logger.info(
            "on_chain_start: node_name=%s run_id=%s parent_run_id=%s",
            node_name, str(run_id), str(parent_run_id) if parent_run_id else None,
        )
        _INTERNAL_NAMES = {
            "RunnableSequence", "RunnableLambda", "RunnableParallel",
            "RunnablePassthrough", "RunnableBranch", "RunnableWithFallbacks",
            "ChannelWrite", "ChannelRead", "route_decision",
            "should_continue_after_approval", "should_continue_after_replan",
            "LangGraph",
        }

        if parent_run_id:
            self._parent_map[str(run_id)] = str(parent_run_id)

        if parent_run_id is None:
            self.run_id = str(run_id)
            await self._safe_write("create_run", self._create_run())
            await self._safe_write("record_metadata_keys", self._record_metadata_keys())
        elif self.run_id is not None and node_name not in _INTERNAL_NAMES:
            step_id = str(uuid.uuid4())
            self._chain_to_step[str(run_id)] = step_id
            self._step_start_times[step_id] = time.monotonic()
            self._actual_step_runs.add(str(run_id))
            self._last_step_id = step_id
            self._current_node_name = node_name
            await self._safe_write(
                "create_step",
                self._create_step(step_id, node_name),
            )

    async def _create_run(self) -> None:
        async with self.session_factory() as session:
            run = Run(
                id=self.run_id,
                thread_id=self.thread_id,
                user_id=self.user_id,
                status="running",
                started_at=datetime.now(UTC),
                run_metadata=self.run_metadata,
            )
            session.add(run)
            await session.commit()

    async def _record_metadata_keys(self) -> None:
        """Catalog the distinct top-level metadata keys for this run.

        Uses ``INSERT IGNORE`` so already-seen keys are silently skipped. 
        Runs in its own session/transaction so a failure here never affects run creation.
        """
        if not self.run_metadata:
            return
        keys = [k for k in self.run_metadata if isinstance(k, str) and k]
        if not keys:
            return
        async with self.session_factory() as session:
            stmt = (
                pg_insert(MetadataKey)
                .values([{"key_name": k} for k in keys])
                .on_conflict_do_nothing()
            )
            await session.execute(stmt)
            await session.commit()

    async def _create_step(self, step_id: str, node_name: str) -> None:
        now = datetime.now(UTC)
        async with self.session_factory() as session:
            step = Step(
                id=step_id,
                run_id=self.run_id,
                node_name=node_name,
                started_at=now,
            )
            session.add(step)

            if self._previous_node is not None and self.run_id is not None:
                edge = Edge(
                    id=str(uuid.uuid4()),
                    run_id=self.run_id,
                    from_node=self._previous_node,
                    to_node=node_name,
                    timestamp=now,
                )
                session.add(edge)

            await session.commit()
        self._previous_node = node_name

    async def on_chain_end(
        self,
        outputs: dict[str, Any],
        *,
        run_id: uuid.UUID,
        parent_run_id: uuid.UUID | None = None,
        **kwargs: Any,
    ) -> None:
        if parent_run_id is None:
            total = self._total_input_tokens + self._total_output_tokens
            await self._safe_write(
                "complete_run",
                self._complete_run(total if total > 0 else None),
            )

            messages = outputs.get("messages", [])
            if messages:
                last_msg = messages[-1]
                if isinstance(last_msg, AIMessage) and last_msg.content:
                    content = last_msg.content if isinstance(last_msg.content, str) else str(last_msg.content)
                    await self._safe_write(
                        "write_assistant_message",
                        self.write_conversation_message("assistant", content),
                    )
        elif str(run_id) in self._actual_step_runs:
            step_id = self._chain_to_step[str(run_id)]
            elapsed = self._step_start_times.get(step_id)
            duration_ms = int((time.monotonic() - elapsed) * 1000) if elapsed else None
            await self._safe_write(
                "complete_step",
                self._complete_step(step_id, duration_ms),
            )

    async def _complete_run(self, total_tokens: int | None) -> None:
        error_msg = None
        if self._tool_errors:
            error_lines = [f"{arguments}, Node {node}, {tool_name}: {msg}" for node, tool_name, arguments, msg in self._tool_errors]
            error_msg = "\n".join(error_lines)
            if len(error_msg) > _MAX_TEXT_CHARS:
                error_msg = error_msg[:_MAX_TEXT_CHARS] + f"... [truncated {len(error_msg) - _MAX_TEXT_CHARS} chars]"
        status = "error" if error_msg else "completed"
        async with self.session_factory() as session:
            await session.execute(
                update(Run)
                .where(Run.id == self.run_id)
                .where(Run.status != "pending_approval")
                .values(
                    status=status,
                    error=error_msg,
                    ended_at=datetime.now(UTC),
                    total_tokens=total_tokens,
                )
            )
            await session.commit()

    async def _complete_step(self, step_id: str, duration_ms: int | None) -> None:
        async with self.session_factory() as session:
            await session.execute(
                update(Step)
                .where(Step.id == step_id)
                .values(
                    ended_at=datetime.now(UTC),
                    duration_ms=duration_ms,
                )
            )
            await session.commit()

    async def on_chain_error(
        self,
        error: BaseException,
        *,
        run_id: uuid.UUID,
        parent_run_id: uuid.UUID | None = None,
        **kwargs: Any,
    ) -> None:
        error_type = type(error).__name__
        error_mro = [c.__name__ for c in type(error).__mro__]
        error_str = str(error)
        logger.info(
            "on_chain_error: error_type=%s error_mro=%s error_str_len=%d parent_run_id=%s",
            error_type, error_mro, len(error_str), str(parent_run_id) if parent_run_id else None,
        )
        if parent_run_id is None and self.run_id is not None:
            # GraphInterrupt and related interrupt types are expected for plan approval.
            is_interrupt = (
                "Interrupt" in error_type
                or "BubbleUp" in error_type
                or any("Interrupt" in name or "BubbleUp" in name for name in error_mro)
            )
            if is_interrupt:
                logger.info("on_chain_error: interrupt detected, skipping fail")
                return
            await self._safe_write("fail_run", self._fail_run(error_str))

    async def _fail_run(self, error_msg: str) -> None:
        async with self.session_factory() as session:
            await session.execute(
                update(Run)
                .where(Run.id == self.run_id)
                .where(Run.status != "pending_approval")
                .values(
                    status="failed",
                    error=error_msg,
                    ended_at=datetime.now(UTC),
                )
            )
            await session.commit()

    async def on_tool_start(
        self,
        serialized: dict[str, Any] | None,
        input_str: str,
        *,
        run_id: uuid.UUID,
        parent_run_id: uuid.UUID | None = None,
        **kwargs: Any,
    ) -> None:
        if parent_run_id:
            self._parent_map[str(run_id)] = str(parent_run_id)
        step_id = self._find_step_id(str(parent_run_id)) if parent_run_id else None
        tool_call_id = str(uuid.uuid4())
        tool_name = serialized.get("name", "unknown") if serialized else "unknown"
        self._tool_id_map[str(run_id)] = tool_call_id
        self._tool_name_map[str(run_id)] = tool_name
        self._tool_arguments_map[str(run_id)] = input_str
        self._tool_start_times[str(run_id)] = time.monotonic()

        await self._safe_write(
            "create_tool_call",
            self._create_tool_call(
                tool_call_id,
                step_id or "unknown",
                tool_name,
                input_str,
            ),
        )

    async def _create_tool_call(
        self, tool_call_id: str, step_id: str, tool_name: str, arguments: str
    ) -> None:
        async with self.session_factory() as session:
            tc = ToolCall(
                id=tool_call_id,
                step_id=step_id,
                run_id=self.run_id,
                tool_name=tool_name,
                arguments=arguments,
                started_at=datetime.now(UTC),
            )
            session.add(tc)
            await session.commit()

    async def on_tool_end(
        self,
        output: str,
        *,
        run_id: uuid.UUID,
        **kwargs: Any,
    ) -> None:
        tc_id = self._tool_id_map.get(str(run_id))
        if not tc_id:
            return
        start = self._tool_start_times.get(str(run_id))
        duration_ms = int((time.monotonic() - start) * 1000) if start else None
        if output and is_tool_error(output):
            node = self._current_node_name or "unknown"
            tool_name = self._tool_name_map.get(str(run_id), "unknown")
            arguments = self._tool_arguments_map.get(str(run_id), "")
            error_msg = extract_error_message(output)
            self._tool_errors.append((node, tool_name, arguments, error_msg))
        await self._safe_write(
            "complete_tool_call",
            self._update_tool_call(tc_id, result=_truncate(str(output)), duration_ms=duration_ms),
        )

    async def on_tool_error(
        self,
        error: BaseException,
        *,
        run_id: uuid.UUID,
        **kwargs: Any,
    ) -> None:
        tc_id = self._tool_id_map.get(str(run_id))
        if not tc_id:
            return
        start = self._tool_start_times.get(str(run_id))
        duration_ms = int((time.monotonic() - start) * 1000) if start else None
        error_str = _truncate(str(error))
        node = self._current_node_name or "unknown"
        tool_name = self._tool_name_map.get(str(run_id), "unknown")
        arguments = self._tool_arguments_map.get(str(run_id), "")
        self._tool_errors.append((node, tool_name, arguments, error_str))
        await self._safe_write(
            "error_tool_call",
            self._update_tool_call(tc_id, error=error_str, duration_ms=duration_ms),
        )

    async def _update_tool_call(
        self,
        tc_id: str,
        result: str | None = None,
        error: str | None = None,
        duration_ms: int | None = None,
    ) -> None:
        values: dict[str, Any] = {"duration_ms": duration_ms}
        if result is not None:
            values["result"] = result
        if error is not None:
            values["error"] = error
        async with self.session_factory() as session:
            await session.execute(
                update(ToolCall).where(ToolCall.id == tc_id).values(**values)
            )
            await session.commit()

    async def on_llm_start(
        self,
        serialized: dict[str, Any] | None,
        prompts: list[str],
        *,
        run_id: uuid.UUID,
        parent_run_id: uuid.UUID | None = None,
        **kwargs: Any,
    ) -> None:
        self._llm_start_times[str(run_id)] = time.monotonic()
        if parent_run_id:
            self._parent_map[str(run_id)] = str(parent_run_id)
        step_id = self._find_step_id(str(parent_run_id)) if parent_run_id else "unknown"
        self._llm_step_map[str(run_id)] = step_id
        self._llm_messages_map[str(run_id)] = json.dumps(prompts, default=str)

    async def on_chat_model_start(
        self,
        serialized: dict[str, Any] | None,
        messages: list[list[BaseMessage]],
        *,
        run_id: uuid.UUID,
        parent_run_id: uuid.UUID | None = None,
        **kwargs: Any,
    ) -> None:
        logger.info(
            "on_chat_model_start: run_id=%s parent_run_id=%s num_messages=%d",
            str(run_id), str(parent_run_id) if parent_run_id else None, sum(len(ml) for ml in messages),
        )
        self._llm_start_times[str(run_id)] = time.monotonic()
        if parent_run_id:
            self._parent_map[str(run_id)] = str(parent_run_id)
        step_id = self._find_step_id(str(parent_run_id))
        self._llm_step_map[str(run_id)] = step_id
        try:
            serialized_msgs = [
                [{"role": getattr(m, "type", "unknown"), "content": m.content} for m in msg_list]
                for msg_list in messages
            ]
            self._llm_messages_map[str(run_id)] = json.dumps(serialized_msgs, default=str)
        except Exception:
            self._llm_messages_map[str(run_id)] = "[]"

    async def on_llm_end(
        self,
        response: LLMResult,
        *,
        run_id: uuid.UUID,
        **kwargs: Any,
    ) -> None:
        start = self._llm_start_times.get(str(run_id))
        duration_ms = int((time.monotonic() - start) * 1000) if start else None
        step_id = self._llm_step_map.get(str(run_id), "unknown")

        input_tokens: int | None = None
        output_tokens: int | None = None
        model_name = "unknown"
        provider = "unknown"

        try:
            gen_message = response.generations[0][0].message  # type: ignore[union-attr]

            usage = getattr(gen_message, "usage_metadata", None) or {}
            if usage:
                input_tokens = usage.get("input_tokens")
                output_tokens = usage.get("output_tokens")

            resp_meta = getattr(gen_message, "response_metadata", {}) or {}
            if input_tokens is None:
                token_usage = resp_meta.get("token_usage", {}) or {}
                input_tokens = token_usage.get("prompt_tokens")
                output_tokens = token_usage.get("completion_tokens")

            model_name = (
                resp_meta.get("model_name")
                or resp_meta.get("model")
                or model_name
            )
        except (IndexError, AttributeError):
            pass

        if input_tokens is None and response.llm_output:
            token_usage = response.llm_output.get("token_usage", {}) or {}
            input_tokens = token_usage.get("prompt_tokens")
            output_tokens = token_usage.get("completion_tokens")

        if model_name == "unknown" and response.llm_output:
            model_name = (
                response.llm_output.get("model_name")
                or response.llm_output.get("model")
                or model_name
            )

        mn = model_name.lower()
        if "gpt" in mn:
            provider = "openai"
        elif "claude" in mn:
            provider = "anthropic"
        elif "deepseek" in mn:
            provider = "deepseek"
        else:
            provider = get_settings().default_llm_provider

        response_text: str | None = None
        try:
            gen = response.generations[0][0]
            response_text = gen.text or getattr(getattr(gen, "message", None), "content", None)
        except (IndexError, AttributeError):
            pass

        messages_text = self._llm_messages_map.pop(str(run_id), None)

        self._total_input_tokens += input_tokens or 0
        self._total_output_tokens += output_tokens or 0

        if self.run_id is not None:
            await self._safe_write(
                "create_llm_call",
                self._create_llm_call(
                    step_id=step_id,
                    provider=provider,
                    model=model_name,
                    messages=_truncate(messages_text) if messages_text else messages_text,
                    response=_truncate(response_text) if response_text else response_text,
                    input_tokens=input_tokens,
                    output_tokens=output_tokens,
                    duration_ms=duration_ms,
                ),
            )
        else:
            logger.warning("skipping_llm_call_write: run_id is None")

    async def _create_llm_call(
        self,
        step_id: str,
        provider: str,
        model: str,
        messages: str | None,
        response: str | None,
        input_tokens: int | None,
        output_tokens: int | None,
        duration_ms: int | None,
    ) -> None:
        async with self.session_factory() as session:
            llm_call = LLMCall(
                id=str(uuid.uuid4()),
                step_id=step_id,
                run_id=self.run_id,
                provider=provider,
                model=model,
                messages=messages,
                response=response,
                input_tokens=input_tokens,
                output_tokens=output_tokens,
                started_at=datetime.now(UTC),
                duration_ms=duration_ms,
            )
            session.add(llm_call)
            await session.commit()

    async def write_conversation_message(
        self, role: str, content: str | None, run_id: str | None = None
    ) -> None:
        async with self.session_factory() as session:
            msg = ConversationMessage(
                id=str(uuid.uuid4()),
                thread_id=self.thread_id,
                run_id=run_id or self.run_id,
                role=role,
                content=_truncate(content) if content else content,
                created_at=datetime.now(UTC),
            )
            session.add(msg)
            await session.commit()

    async def set_agent_type(self, agent_type: str) -> None:
        if self.run_id is None:
            return
        async with self.session_factory() as session:
            await session.execute(
                update(Run)
                .where(Run.id == self.run_id)
                .values(agent_type=agent_type)
            )
            await session.commit()

    async def set_run_status(self, status: str) -> None:
        if self.run_id is None:
            return
        async with self.session_factory() as session:
            await session.execute(
                update(Run)
                .where(Run.id == self.run_id)
                .values(status=status)
            )
            await session.commit()
