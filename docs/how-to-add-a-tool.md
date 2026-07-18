# How to Add a Tool

Tools are auto-discovered at startup. Create a folder with 3 files, and the tool is available for usage.

## Quick Start

```
agent_platform/tools/my_tool/
├── __init__.py    # async run() function
├── schemas.py     # Pydantic InputSchema
└── prompt.yaml    # metadata (name, description, category, tags)
```

Restart the server. The tool is now:
- Available to agents via `tool_registry.get_tool("my_tool")`
- Visible in the playground Tools panel
- Included in the router/planner LLM prompts

---

## Step 1: `prompt.yaml`

Metadata that describes the tool to the LLM and categorises it for filtering.

```yaml
name: my_tool
version: "1.0"
category: planner
tags: [data, fetch]
description: >
  A clear description of what this tool does. This is injected into the
  LLM's system prompt so it knows when and how to use this tool.
  Be specific about inputs and outputs.
few_shot_examples:
  - user: "Example user request that would trigger this tool"
    tool_call:
      param_one: "example_value"
      param_two: 42
```

### Fields

| Field | Required | Purpose |
|-------|----------|---------|
| `name` | Yes | Must match the folder name. Used as the tool identifier everywhere. |
| `description` | Yes | Shown to the LLM in the planner/router prompts. Write it like you're explaining to a colleague what this function does. |
| `category` | Yes | Used to filter tools per agent. Agents declare which categories they access in `description.yaml` → `tool_access.categories`. |
| `tags` | No | Additional filtering. Agents can filter by tag via `tool_registry.get_tools_by_tag()`. |
| `version` | No | For your own tracking. Not used by the system. |
| `few_shot_examples` | No | Helps the LLM understand correct usage. Included in the planner prompt. |

---

## Step 2: `schemas.py`

A Pydantic model named `InputSchema` that validates the tool's arguments.
The schema is auto-extracted and shown in the playground UI.

```python
"""Schemas for my_tool."""

from __future__ import annotations

from pydantic import BaseModel, Field


class InputSchema(BaseModel):
    """Input schema for my_tool."""

    param_one: str = Field(
        ...,
        description="What this parameter is for",
    )
    param_two: int = Field(
        default=10,
        description="Optional parameter with a default",
    )
```

### Tips

- Use `Field(description=...)` on every field — these descriptions are shown to the LLM.
- Use `...` (Ellipsis) for required fields, provide a `default` for optional ones.
- Supported types: `str`, `int`, `float`, `bool`, `list[str]`, `dict`, `Literal["a", "b"]`, etc.
- Always include `from __future__ import annotations` for forward reference support.

---

## Step 3: `__init__.py`

An async `run()` function that implements the tool logic. The parameter names
**must match** the `InputSchema` fields exactly.

```python
"""My tool — does something useful."""

from __future__ import annotations


async def run(param_one: str, param_two: int = 10) -> dict:
    """Execute the tool.

    Args:
        param_one: What this parameter is for.
        param_two: Optional parameter with a default.

    Returns:
        Result dict with the tool's output.
    """
    # Your logic here — call APIs, query databases, compute results
    result = do_something(param_one, param_two)

    return {
        "status": "success",
        "output": result,
        "message": f"Processed {param_one} with value {param_two}",
    }
```

### Rules

- Function **must** be named `run`.
- Function **must** be `async`.
- Parameter names **must** match `InputSchema` field names.
- Return a `dict` — the agent receives this as the tool result.
- Timeout is 30 seconds by default (configured in `tools/executor.py`).
- Exceptions are caught and returned as error dicts — the agent sees the error and can retry or replan.

---

## What happens at startup

```
Server starts
  → ToolRegistry.discover() scans agent_platform/tools/
  → For each subdirectory with all 3 files:
      1. Loads prompt.yaml → metadata (name, description, category, tags)
      2. Dynamically imports __init__.py → gets the run() function
      3. Dynamically imports schemas.py → gets InputSchema class
      4. Rebuilds Pydantic model (resolves deferred annotations)
      5. Creates LangChain StructuredTool wrapping run() + InputSchema
      6. Registers in registry under the tool name
  → Tools are available via tool_registry.get_tool("name")
```

If any of the 3 files is missing, the tool is **skipped with a warning** — it won't crash the server.

---

## Where the tool appears

| Where | How |
|-------|-----|
| **Router prompt** | Auto-included via `tool_registry.get_schemas_summary()` |
| **Planner prompt** | Agent sees tool name, description, and args schema |
| **Playground Tools panel** | Click "Tools (N)" in the toolbar — shows all tools with editable descriptions |
| **`GET /api/tools`** | Returns all tool metadata as JSON |
| **`GET /api/playground/prompts`** | Includes tool definitions with args schemas |

---

## Filtering: which agents can use which tools

Agents declare which tool categories they can access in their `description.yaml`:

```yaml
# In agent_platform/agents/task_agent/description.yaml
tool_access:
  categories:
    - planner
```

Tools declare their category in `prompt.yaml`:

```yaml
# In agent_platform/tools/my_tool/prompt.yaml
category: planner
```

The planner node filters tools by category when building its prompt.

---

## Example: complete tool

### `agent_platform/tools/get_weather/prompt.yaml`

```yaml
name: get_weather
version: "1.0"
category: general
tags: [weather, api]
description: >
  Fetches current weather for a given city. Returns temperature,
  conditions, and humidity.
few_shot_examples:
  - user: "What's the weather in New York?"
    tool_call:
      city: "New York"
      units: "celsius"
```

### `agent_platform/tools/get_weather/schemas.py`

```python
from __future__ import annotations
from pydantic import BaseModel, Field

class InputSchema(BaseModel):
    city: str = Field(..., description="City name to look up weather for")
    units: str = Field(default="celsius", description="Temperature units: celsius or fahrenheit")
```

### `agent_platform/tools/get_weather/__init__.py`

```python
from __future__ import annotations

async def run(city: str, units: str = "celsius") -> dict:
    # In production, call a weather API here
    return {
        "city": city,
        "temperature": 22,
        "units": units,
        "conditions": "partly cloudy",
        "humidity": 65,
    }
```

Create the folder, restart the server. The tool appears in the playground and is available to any agent whose `tool_access.categories` includes `"general"`.
