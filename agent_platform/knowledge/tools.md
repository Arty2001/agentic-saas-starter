# Tools

A tool is one directory under `tools/` with three files:

- `__init__.py` — an async `run(...)` returning a dict
- `schemas.py` — a Pydantic `InputSchema` (this is what the LLM sees)
- `prompt.yaml` — name, category, description, few-shot examples

## The real/mock split

Every tool that touches the SaaS follows one convention: it asks
`SaasApiClient.try_from_config(config)` for a client. If auth and
`SAAS_API_URL` are present it calls the real API, forwarding the user's own
token so the SaaS enforces its own permissions. If not, it runs an
in-process mock against fixture data. That's why the whole platform works
offline: no API configured means every tool silently uses its mock branch.

## The clarification envelope

Tools never hard-fail on a fuzzy name. When a name can't be resolved
uniquely, the tool returns:

    { "status": "clarification_needed",
      "message": "...",
      "answerKey": "assigneeName",
      "suggestedOptions": ["Sam Torres", "Samir Khan"] }

The executing branch turns this into an `interrupt()`; the UI shows the
options as chips; the picked value is merged into the original params under
`answerKey` and the tool is retried. Mocks produce the same envelope as the
real API, so the loop is fully testable offline.

## Categories

Agents request tools by category (`tasks`, `knowledge`, ...) declared in
`prompt.yaml`. Adding a tool to a category makes it available to every
agent that requests that category — no imports to wire.
