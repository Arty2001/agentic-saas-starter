"""Code generators for new agents and tools.

`python -m agent_platform new-agent my_agent` and
`python -m agent_platform new-tool my_tool --category my_category` drop
registry-ready skeletons into the package. The generated files are the
smallest thing the registries will discover — start there, then steal from
task_agent (plan-and-execute) or support_agent (ReAct) as you grow.
"""

from __future__ import annotations

import re
from pathlib import Path

_NAME_RE = re.compile(r"^[a-z][a-z0-9_]*$")

_PACKAGE_DIR = Path(__file__).resolve().parent


def _validate_name(name: str) -> None:
    if not _NAME_RE.match(name):
        raise ValueError(
            f"Invalid name {name!r}: use snake_case (lowercase letters, digits, underscores)."
        )


_AGENT_DESCRIPTION = """\
name: {name}
description: >
  TODO: one paragraph the router reads to decide when to pick this agent.
capabilities:
  - TODO
tool_access:
  categories: []
routing_hints:
  keywords:
    - TODO
  readiness_criteria: >
    TODO: when should the router choose this agent over the others?
needs_checkpointer: false
node_labels:
  respond: Responding
"""

_AGENT_GRAPH = '''\
"""{title} subgraph."""
from __future__ import annotations

from langgraph.graph import END, START, StateGraph

from agent_platform.agents.{name}.nodes import create_respond_node
from agent_platform.graph.state import AgentState


def build_{name}_graph() -> StateGraph:
    """Build the {name} subgraph.

    Flow:
        START -> respond -> END

    Growing beyond one node? task_agent shows plan/approve/fan-out;
    support_agent shows a ReAct tool loop.
    """
    graph = StateGraph(AgentState)
    graph.add_node("respond", create_respond_node())
    graph.add_edge(START, "respond")
    graph.add_edge("respond", END)
    return graph
'''

_AGENT_NODES = '''\
"""Node functions for {name}."""
from __future__ import annotations

import logging

from langchain_core.messages import AIMessage, SystemMessage, trim_messages
from langchain_core.runnables import RunnableConfig

from agent_platform.graph.state import AgentState
from agent_platform.llm.client import estimate_tokens, get_llm
from agent_platform.utils.progress import emit_message

logger = logging.getLogger(__name__)

_SYSTEM = "TODO: system prompt for {name}."


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
        return {{"messages": [AIMessage(content=content)]}}

    return respond_node
'''

_TOOL_INIT = '''\
"""{title} tool.

Follow the real/mock convention: call the SaaS API when configured, fall
back to an in-process mock otherwise. Return
{{"status": "clarification_needed", "answerKey": ..., "suggestedOptions": [...]}}
for fuzzy-name misses instead of hard-failing.
"""
from __future__ import annotations

from typing import Any

from langchain_core.runnables import RunnableConfig

from agent_platform.services import SaasApiClient


async def run(
    example_param: str,
    config: RunnableConfig | None = None,
) -> dict[str, Any]:
    resolved = SaasApiClient.try_from_config(config)
    if resolved is None:
        return _mock_run(example_param)
    client, ctx = resolved

    # TODO: call your SaaS API via `client`, using ctx["tenant_id"] /
    # ctx["workspace_id"] for addressing.
    return {{"status": "ok", "example_param": example_param}}


def _mock_run(example_param: str) -> dict[str, Any]:
    # TODO: deterministic fixture behavior for offline dev and mock-mode evals.
    return {{"status": "ok", "example_param": example_param, "mock": True}}
'''

_TOOL_SCHEMAS = '''\
"""Schemas for the {name} tool."""
from __future__ import annotations

from pydantic import BaseModel, Field


class InputSchema(BaseModel):
    """Input schema for {name} — this is exactly what the LLM sees."""

    example_param: str = Field(
        min_length=1,
        description="TODO: describe this parameter the way you'd brief a new teammate.",
    )
'''

_TOOL_PROMPT = """\
name: {name}
version: "1.0"
category: {category}
tags: []
description: >
  TODO: when should an agent call this tool, and what does it return?
few_shot_examples:
  - user: "TODO: an utterance that should trigger this tool"
    tool_call:
      example_param: "TODO"
"""


def create_agent(name: str, base_dir: Path | None = None) -> list[Path]:
    """Generate a registry-ready agent skeleton. Returns the created paths."""
    _validate_name(name)
    agents_dir = (base_dir or _PACKAGE_DIR / "agents") / name
    if agents_dir.exists():
        raise FileExistsError(f"Agent directory already exists: {agents_dir}")
    agents_dir.mkdir(parents=True)

    title = name.replace("_", " ").title()
    files = {
        "description.yaml": _AGENT_DESCRIPTION.format(name=name),
        "graph.py": _AGENT_GRAPH.format(name=name, title=title),
        "nodes.py": _AGENT_NODES.format(name=name),
        "__init__.py": f'"""{title} agent."""\n',
    }
    created = []
    for filename, content in files.items():
        path = agents_dir / filename
        path.write_text(content, encoding="utf-8")
        created.append(path)
    return created


def create_tool(name: str, category: str = "general", base_dir: Path | None = None) -> list[Path]:
    """Generate a registry-ready tool skeleton. Returns the created paths."""
    _validate_name(name)
    _validate_name(category)
    tool_dir = (base_dir or _PACKAGE_DIR / "tools") / name
    if tool_dir.exists():
        raise FileExistsError(f"Tool directory already exists: {tool_dir}")
    tool_dir.mkdir(parents=True)

    title = name.replace("_", " ").title()
    files = {
        "__init__.py": _TOOL_INIT.format(name=name, title=title),
        "schemas.py": _TOOL_SCHEMAS.format(name=name),
        "prompt.yaml": _TOOL_PROMPT.format(name=name, category=category),
    }
    created = []
    for filename, content in files.items():
        path = tool_dir / filename
        path.write_text(content, encoding="utf-8")
        created.append(path)
    return created
