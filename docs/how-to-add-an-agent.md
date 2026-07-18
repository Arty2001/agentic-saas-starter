# How to Add an Agent

Everything is auto-discovered. Create a folder, restart the server, and the playground graph updates automatically.

## Quick Start

```
agent_platform/agents/my_agent/
├── description.yaml   # metadata + routing hints
├── graph.py           # subgraph definition
├── nodes.py           # node functions
├── prompts.py         # system prompts (optional)
└── test_context.py    # regression-test session contexts (recommended)
```

Restart the server. Done. No other files need to change.

---

## Step 1: `description.yaml`

Defines who this agent is, when to use it, and optional display/runtime settings.

```yaml
name: my_agent
description: >
  A short description of what this agent does. This is shown to the
  router LLM so it can decide when to dispatch to this agent.
capabilities:
  - thing it can do
  - another thing
routing_hints:
  keywords:
    - keyword1
    - keyword2
  patterns:
    - ".*regex_pattern.*"
  readiness_criteria: >
    Explain when this agent should be selected over others.

# Optional fields:
needs_checkpointer: false          # set true if any node uses interrupt()
tool_access:                       # which tools this agent can use
  categories:
    - planner
node_labels:                       # override auto-generated node labels
  my_node_id: My Custom Label
```

### Required fields

| Field | Purpose |
|-------|---------|
| `name` | Must match the folder name |
| `description` | Shown to the router LLM for agent selection |
| `routing_hints.keywords` | Words that suggest this agent should handle the request |
| `routing_hints.readiness_criteria` | When to pick this agent over others |

### Optional fields

| Field | Default | Purpose |
|-------|---------|---------|
| `needs_checkpointer` | `false` | Set `true` if any node calls `interrupt()` (e.g. for user approval) |
| `tool_access.categories` | none | Which tool categories this agent can use (see below) |
| `node_labels` | Auto-generated from snake_case | Override display labels in the playground graph |
| `capabilities` | `[]` | Listed in agent metadata endpoints |

### Tool access

Each tool declares a `category` in its `prompt.yaml` (e.g. `planner`, `general`).
Your agent declares which categories it can use via `tool_access.categories`:

```yaml
tool_access:
  categories:
    - planner
    - general
```

When your agent's planner/executor node calls `tool_registry.get_tools_by_category()`,
only tools matching these categories are returned. This prevents agents from seeing
tools they shouldn't use.

If your agent doesn't need tools, omit `tool_access` entirely — and don't add
`tool_registry` as a parameter to your `build_<name>_graph()` function.

---

## Step 2: `graph.py`

Defines the agent's subgraph using LangGraph's `StateGraph`.

**The function must be named `build_<agent_name>_graph`.**

```python
"""My agent subgraph."""

from langgraph.graph import END, StateGraph

from agent_platform.agents.my_agent.nodes import (
    create_step_one_node,
    create_step_two_node,
)
from agent_platform.graph.state import AgentState


def build_my_agent_graph() -> StateGraph:
    graph = StateGraph(AgentState)

    graph.add_node("step_one", create_step_one_node())
    graph.add_node("step_two", create_step_two_node())

    graph.set_entry_point("step_one")
    graph.add_edge("step_one", "step_two")
    graph.add_edge("step_two", END)

    return graph
```

### If your agent needs tools

Add `tool_registry` as the first parameter. The system detects this
automatically via `inspect.signature` and injects it at startup.

```python
from agent_platform.tools.registry import ToolRegistry

def build_my_agent_graph(tool_registry: ToolRegistry) -> StateGraph:
    # tool_registry is auto-injected — no manual wiring needed
    graph = StateGraph(AgentState)
    graph.add_node("worker", create_worker_node(tool_registry))
    ...
```

### If your agent needs user approval (interrupts)

Use `interrupt()` inside a node function and set `needs_checkpointer: true`
in `description.yaml`. The dispatcher reads this and compiles with a checkpointer.

---

## Step 3: `nodes.py`

Implement your node functions. Each returns a dict that updates the shared `AgentState`.

```python
"""Node functions for my_agent."""

from __future__ import annotations
from typing import Any

from langchain_core.messages import AIMessage
from langchain_core.runnables import RunnableConfig

from agent_platform.graph.state import AgentState


def create_step_one_node():
    async def step_one_node(
        state: AgentState, config: RunnableConfig = None
    ) -> dict[str, Any]:
        # Your logic here
        return {
            "messages": [AIMessage(content="Step one complete.")],
        }

    return step_one_node


def create_step_two_node():
    async def step_two_node(
        state: AgentState, config: RunnableConfig = None
    ) -> dict[str, Any]:
        return {
            "messages": [AIMessage(content="Done.")],
        }

    return step_two_node
```

### Prompt overrides from the playground

If your node uses a system prompt, check for playground overrides:

```python
def create_my_node():
    async def my_node(state: AgentState, config: RunnableConfig = None) -> dict:
        overrides = (config or {}).get("configurable", {}).get("prompt_overrides", {})
        prompt = overrides.get("my_node", MY_NODE_SYSTEM)  # fallback to production
        ...
```

---

## Step 4: `prompts.py` (optional)

Define system prompts as constants ending in `_SYSTEM`. They are auto-discovered
and appear as editable prompts in the playground.

```python
"""Prompts for my_agent."""

STEP_ONE_SYSTEM = (
    "You are a helpful assistant that does step one.\n\n"
    "Context:\n{some_context}\n\n"
    "Do the thing."
)

STEP_TWO_SYSTEM = (
    "You summarise the results from step one.\n\n"
    "Results:\n{results}"
)
```

### Convention

| Constant | Node ID | Playground label |
|----------|---------|-----------------|
| `STEP_ONE_SYSTEM` | `step_one` | Step One |
| `MY_FETCHER_SYSTEM` | `my_fetcher` | My Fetcher |

Template variables like `{some_context}` are auto-extracted and shown in the
playground UI so users know which values get injected at runtime.

---

## What gets auto-discovered

| What | How | Where |
|------|-----|-------|
| Agent metadata | `description.yaml` scanned at startup | `AgentRegistry.discover()` |
| Graph builder | `build_<name>_graph()` in `graph.py` | `AgentRegistry.discover_graph_builders()` |
| Tool injection | `tool_registry` param detected via `inspect.signature` | `AgentRegistry.discover_graph_builders()` |
| Checkpointer | `needs_checkpointer: true` in `description.yaml` | `dispatcher.py` |
| Prompts | `*_SYSTEM` constants in `prompts.py` | `playground.py._discover_agent_prompts()` |
| Template vars | `{placeholder}` patterns in prompt strings | `playground.py._discover_agent_prompts()` |
| Graph topology | Introspected from compiled `StateGraph` | `playground.py.get_graph_topology()` |
| Node labels | snake_case auto-titled, or `node_labels` in YAML | `playground.py._extract_graph_topology()` |
| Frontend graph | Fetched from `/api/playground/graph`, layout computed client-side | `graphDefinition.ts` |
| Test contexts | `ContextArgs` + `build_test_context()` in `test_context.py` | `regression/contexts.py` (lazy, per request) |

---

## Step 5: `test_context.py` (recommended — Tests Beta)

Lets the eval framework (the **Tests** tab) run scripted tests
against your agent with a meaningful session context and zero UI wiring.

```python
from typing import Any, Literal
from pydantic import BaseModel, Field
from agent_platform.services.saas_api_client import SaasApiClient

class ContextArgs(BaseModel):
    """Fields the test editor renders for this agent (from the JSON schema)."""
    tenant_id: str = Field(default="prod_sandbox")
    workspace_id: str = Field(default="202501")
    workspace_id: str = Field(default="demo_workspace")

async def build_test_context(
    mode: Literal["mock", "real"],
    args: ContextArgs,
    client: SaasApiClient | None,   # authed as the user who clicked Run; None in mock mode
) -> dict[str, Any] | None:
    if mode == "mock":
        return {..., "payload": MY_FIXTURE}   # keep consistent with your tools' mock data
    # real mode: call the platform APIs to assemble a real context
    options = await client.get_dataset_options(args.tenant_id, args.workspace_id)
    return {...}
```

Rules:
- **mock** is the default for new tests; the executor passes no `auth_context`
  in mock mode so every tool deterministically takes its mock branch.
- **real** receives a `SaasApiClient` built with the triggering user's
  auth — raise on bad ids so the test fails loudly.
- No `test_context.py` = the agent's tests run without a session context
  (real mode unavailable). Nothing crashes.

---

## Example: minimal 2-node agent

### `agent_platform/agents/echo/description.yaml`

```yaml
name: echo
description: Echoes the user's message back. Useful for testing.
routing_hints:
  keywords: [echo, repeat, parrot]
  readiness_criteria: Use when the user says "echo" or asks to repeat something.
```

### `agent_platform/agents/echo/graph.py`

```python
from langgraph.graph import END, StateGraph
from agent_platform.agents.echo.nodes import create_echo_node
from agent_platform.graph.state import AgentState

def build_echo_graph() -> StateGraph:
    graph = StateGraph(AgentState)
    graph.add_node("echo", create_echo_node())
    graph.set_entry_point("echo")
    graph.add_edge("echo", END)
    return graph
```

### `agent_platform/agents/echo/nodes.py`

```python
from langchain_core.messages import AIMessage
from agent_platform.graph.state import AgentState

def create_echo_node():
    async def echo_node(state: AgentState, config=None) -> dict:
        last_msg = state["messages"][-1].content if state["messages"] else ""
        return {"messages": [AIMessage(content=f"Echo: {last_msg}")]}
    return echo_node
```

Restart the server. The playground graph now shows an `echo` subgraph with one node. No other files touched.
