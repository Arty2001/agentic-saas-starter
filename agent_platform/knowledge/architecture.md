# Architecture

The platform is an agent layer that sits on top of an existing SaaS. One
chat endpoint, many agents, every action landing on the SaaS's own REST API.

## Core graph

Every chat turn enters a two-node LangGraph: a **router** and a
**dispatcher**. If the frontend pinned an agent, the router is skipped.
Otherwise an LLM reads each registered agent's description and routing
hints and picks one. The dispatcher then compiles and invokes that agent's
own sub-graph.

## Registries

Agents and tools are discovered from the filesystem at startup — the
directory IS the registry:

- `agents/<name>/` needs a `description.yaml` and a `graph.py` exposing
  `build_<name>_graph`.
- `tools/<name>/` needs `__init__.py` (async `run()`), `schemas.py`
  (`InputSchema`), and `prompt.yaml` (metadata + few-shots).

Agents request tools by category (`tool_access.categories` in their
description), never by hard-coded imports.

## State and persistence

All agents share one `AgentState` (messages plus plan-lifecycle fields).
Graph state is checkpointed to Postgres, which is what makes `interrupt()`
(plan approvals, clarifications) resumable across requests — the graph
pauses, the API returns, and the user's answer resumes exactly the
interrupted node.

## Streaming

Responses stream over SSE. The event vocabulary is small: `router_decision`,
`node_progress`, `text_delta`, `plan`, `tool_clarification`, `step_complete`,
`items_completed`, `tool_call`/`tool_result`, `error`, `done`. The regression
framework captures this same event stream, so evals see exactly what the
browser sees.
