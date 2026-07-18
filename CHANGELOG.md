# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/) and the project adheres to
[Semantic Versioning](https://semver.org/).

## [0.1.0] - 2026-07-18

Initial public release.

### Added

- **Core orchestration**: LLM router → dispatcher over filesystem-discovered
  agent sub-graphs, shared `AgentState`, Postgres-checkpointed interrupts.
- **Three reference agents**: `task_agent` (plan → approve → parallel Send
  fan-out → clarification round-trips), `support_agent` (ReAct loop over the
  bundled knowledge base with cited answers), `echo_agent` (minimal skeleton).
- **Tool convention**: real SaaS-API branch + offline mock branch per tool,
  self-describing clarification envelope (`answerKey`, `suggestedOptions`),
  shared fuzzy matcher.
- **Auth bridge**: validates and forwards your SaaS's own tokens; dev mode
  for zero-config local runs; production guardrails.
- **Observability**: runs, steps, tool calls, LLM calls, and conversation
  messages persisted to Postgres; per-reply feedback capture.
- **Eval harness**: scripted multi-turn tests, versioned baselines,
  volatile-key-normalized structural diffing, LLM judge for text drift,
  mock/real context modes.
- **Dev console** (React + Vite): SSE chat with plan approval and
  clarification cards, run traces, eval suites, live graph playground with
  per-request prompt overrides.
- **Scaffolding**: `python -m agent_platform new-agent` / `new-tool`.
- **Quality gates**: ruff, mypy, pytest (Postgres-aware skips) in CI;
  one-command `docker compose up` runtime.
