"""Node functions for support_agent."""
from __future__ import annotations

import logging

from langchain_core.messages import (
    AIMessage,
    HumanMessage,
    SystemMessage,
    ToolMessage,
    trim_messages,
)
from langchain_core.runnables import RunnableConfig
from langchain_core.tools import StructuredTool

from agent_platform.graph.state import AgentState
from agent_platform.llm.client import estimate_tokens, get_llm
from agent_platform.utils.progress import emit_message

logger = logging.getLogger(__name__)

# Search rounds allowed per user turn before the model must answer with
# whatever it has. Prevents runaway tool loops from burning tokens.
_MAX_SEARCH_ROUNDS = 3

_SYSTEM = """\
You are the built-in guide for this agent platform template.

Answer questions about how the platform works: the router and dispatcher,
agents and tools, plan approvals, clarifications, evals, observability,
and the playground.

Rules:
- Ground every answer in the documentation. Use the search_knowledge tool
  before answering anything you are not certain the docs cover; search with
  concept keywords, not the user's full sentence.
- Cite the source document name(s) you used, e.g. (architecture.md).
- If the docs don't cover the topic, say so plainly — never guess or invent
  platform behavior.
- You only EXPLAIN the platform. If the user wants something DONE in the
  demo tracker (create or plan tasks, check a project), tell them to ask
  the task agent — e.g. "Create tasks for the launch: draft announcement
  (Sam), QA pass (Jordan)."
- Keep answers short: a few sentences, or a short list for multi-part
  questions.
- Off-topic requests (code, general knowledge, anything not about this
  platform): decline in one line and restate what you can help with.
"""


def _search_rounds_this_turn(messages: list) -> int:
    """Count tool exchanges since the latest user message."""
    rounds = 0
    for message in reversed(messages):
        if isinstance(message, HumanMessage):
            break
        if isinstance(message, ToolMessage):
            rounds += 1
    return rounds


def create_agent_node(tools: list[StructuredTool]):
    """LLM node of the ReAct loop: answer, or emit tool calls to search docs."""

    async def agent_node(state: AgentState, config: RunnableConfig | None = None) -> dict:
        trimmed = trim_messages(
            state["messages"],
            max_tokens=8000,
            strategy="last",
            token_counter=estimate_tokens,
            allow_partial=False,
        )

        exhausted = _search_rounds_this_turn(trimmed) >= _MAX_SEARCH_ROUNDS
        llm = get_llm(enable_thinking=False)
        model = llm if exhausted else llm.bind_tools(tools)
        if exhausted:
            logger.info("support_agent: search budget exhausted — forcing final answer")

        response = await model.ainvoke([SystemMessage(content=_SYSTEM), *trimmed])

        if not getattr(response, "tool_calls", None):
            content = response.content if isinstance(response.content, str) else str(response.content)
            emit_message("text_delta", "agent", content)
            return {"messages": [AIMessage(content=content)]}

        return {"messages": [response]}

    return agent_node
