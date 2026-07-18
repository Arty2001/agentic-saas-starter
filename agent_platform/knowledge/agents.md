# Agents

Three example agents ship with the template, each demonstrating a different
shape. Copy the one closest to what you're building.

## task_agent — plan-and-execute (the flagship)

For requests that DO things. The pipeline: a cheap triage classifier routes
between the planner, a friendly guide, and a hardcoded safety refusal. The
planner turns free text into a typed JSON plan (or a `needs_info` question).
The plan pauses on an approval `interrupt()`. Approved items fan out in
parallel via LangGraph's `Send` API, each in its own branch sub-graph. When
a tool can't resolve a fuzzy name it returns a clarification, the branch
interrupts, and the user's pick is merged into the retry — bounded to two
rounds. A final node summarizes every branch's outcome.

## support_agent — ReAct loop

For questions. The LLM drives: it decides what to search in the knowledge
base, reads the results, and answers with citations, looping up to three
searches per turn. The opposite control style from task_agent — there the
plan drives the tools; here the model does.

## echo_agent — minimal template

A single LLM node. Exists to show the smallest thing the registry can
discover. Copy it as the starting skeleton for any new agent.

## Adding your own

Create `agents/<name>/` with `description.yaml` (name, description, routing
hints, tool categories, node labels) and `graph.py` with
`build_<name>_graph(tool_registry)`. Restart — the registry discovers it,
the router can pick it, the playground renders its graph, and the Tests view
can target it. Optionally add `test_context.py` so evals can build
mock/real session contexts for it.
