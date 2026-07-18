"""Node functions for echo_agent."""
from __future__ import annotations

import logging

from langchain_core.messages import AIMessage, SystemMessage, trim_messages
from langchain_core.runnables import RunnableConfig

from agent_platform.graph.state import AgentState
from agent_platform.llm.client import estimate_tokens, get_llm
from agent_platform.utils.progress import emit_message

logger = logging.getLogger(__name__)

_SYSTEM = (
    "You are a concise, friendly assistant embedded in a SaaS product. "
    "Answer the user's message directly in a few sentences. If they ask "
    "what you can do, tell them to pick a specialized agent (for example "
    "the task agent) for real work."
)


def create_respond_node():
    """Single LLM call: system prompt + trimmed history -> one reply."""

    async def respond_node(state: AgentState, config: RunnableConfig | None = None) -> dict:
        llm = get_llm(enable_thinking=False)
        trimmed = trim_messages(
            state["messages"],
            max_tokens=6000,
            strategy="last",
            token_counter=estimate_tokens,
            allow_partial=False,
        )
        response = await llm.ainvoke([SystemMessage(content=_SYSTEM), *trimmed])
        content = response.content if isinstance(response.content, str) else str(response.content)
        emit_message("text_delta", "respond", content)
        return {"messages": [AIMessage(content=content)]}

    return respond_node
