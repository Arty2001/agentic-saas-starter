# Security

## Reporting

Please report suspected vulnerabilities privately via GitHub security
advisories (or a direct message to the maintainer) rather than a public
issue. You'll get an acknowledgement within a few days.

## Model and boundaries

This template's security posture, so you know what you're deploying:

- **Identity is never owned here.** The agent layer validates the token your
  SaaS issued (`AUTH_SERVICE_URL`) and forwards it on every tool call — your
  API keeps enforcing its own permissions. The agent layer adds no privilege.
- **Dev auth mode** (`IS_DEV=true`, no `AUTH_SERVICE_URL`) accepts any
  credentials by design. `assert_auth_configured()` refuses to start in
  production with dev mode on or no identity service configured. Never
  expose a dev-mode instance publicly.
- **Prompt injection**: adversarial/off-topic messages are triaged to a
  hardcoded refusal (no LLM in that path), and planners run against strict
  JSON contracts with capability ceilings. Treat these as mitigations, not
  guarantees — anything the tools can do, a sufficiently confused model can
  ask for, which is why destructive flows sit behind the approval interrupt.
- **Secrets** come from environment variables only; nothing is persisted to
  the observability tables beyond what the callback explicitly records.
  Review `observability/callback.py` truncation limits before pointing this
  at data with strict retention rules.
