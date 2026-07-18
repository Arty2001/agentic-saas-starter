"""Tool execution wrapper with error handling and retry."""

from __future__ import annotations

import asyncio
import logging
from typing import Any

from langchain_core.runnables import RunnableConfig
from langchain_core.tools import StructuredTool
from tenacity import (
    retry,
    retry_if_exception_type,
    stop_after_attempt,
    wait_exponential,
)

logger = logging.getLogger(__name__)


class ToolExecutionError(Exception):
    """Raised when tool execution fails after retries."""

    def __init__(self, tool_name: str, message: str) -> None:
        self.tool_name = tool_name
        super().__init__(f"Tool '{tool_name}' failed: {message}")


def is_tool_error(result: Any) -> bool:
    """A hard tool error (clarifications are not errors)."""
    if not isinstance(result, dict):
        return False
    if result.get("status") == "clarification_needed":
        return False
    return bool(result.get("error")) or result.get("status") == "error"


def extract_error_message(result: Any) -> str:
    if not isinstance(result, dict):
        return "Unknown error"
    return (
        result.get("message")
        or (result.get("error") if isinstance(result.get("error"), str) else None)
        or "Tool returned an error without a message."
    )


async def execute_tool(
    tool: StructuredTool,
    args: dict[str, Any],
    *,
    config: RunnableConfig | None = None,
    max_retries: int = 2,
    timeout_seconds: float | None = 30.0,
) -> dict[str, Any]:
    """Execute a tool with error handling, retry, and timeout.

    `config` is forwarded to `tool.ainvoke` so langchain auto-injects it
    into any tool that declares a `config: RunnableConfig` parameter.

    Tools with `long_running: true` in their prompt.yaml metadata skip the
    outer timeout and retries — they manage their own deadlines (e.g. a
    job-queue waiter) and retrying would spawn duplicate jobs.

    Returns the tool result dict on success, or an error dict on failure:
    {"error": True, "tool_name": str, "message": str}
    """
    tool_name = tool.name

    metadata = getattr(tool, "metadata", None) or {}
    is_long_running = bool(metadata.get("long_running"))

    effective_timeout = None if is_long_running else timeout_seconds
    effective_retries = 1 if is_long_running else max_retries

    @retry(
        stop=stop_after_attempt(effective_retries),
        wait=wait_exponential(multiplier=0.5, min=0.5, max=5),
        retry=retry_if_exception_type((TimeoutError, ConnectionError, OSError)),
        reraise=True,
    )
    async def _attempt() -> Any:
        if effective_timeout is None:
            return await tool.ainvoke(args, config=config)
        return await asyncio.wait_for(
            tool.ainvoke(args, config=config),
            timeout=effective_timeout,
        )

    try:
        result = await _attempt()
        return result if isinstance(result, dict) else {"result": result}
    except TimeoutError:
        logger.error("tool_timeout: tool_name=%s timeout=%s", tool_name, effective_timeout)
        return {"error": True, "tool_name": tool_name, "message": f"Tool timed out after {effective_timeout}s"}
    except Exception as exc:
        logger.error("tool_execution_failed: tool_name=%s error=%s", tool_name, str(exc))
        return {"error": True, "tool_name": tool_name, "message": str(exc)}