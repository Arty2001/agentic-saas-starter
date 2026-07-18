# Evals and Observability

## Observability

A LangChain callback handler traces every run to Postgres: runs, per-node
steps, tool calls with arguments and results, LLM calls with token counts,
and conversation messages. The console's Runs view renders the full
execution trace; thumbs up/down feedback attaches to the exact run that
produced a reply.

## Evals (the Tests view)

Agent behavior is evaluated with scripted multi-turn tests, not assertions:

1. **Script** the conversation: user messages, plan approvals/rejections,
   and clarification answers, per turn.
2. **Baseline**: the first run records a snapshot of everything observable —
   routing decision, tool calls and args, the plan, clarifications, item
   results, final text.
3. **Diff**: later runs diff structurally against the baseline. Volatile
   values (ids, timestamps) and cosmetic LLM-authored labels are ignored;
   behavioral fields are not.
4. **Judge**: when only free text differs, an LLM judge decides whether the
   meaning changed, so wording drift doesn't fail suites.

Tests run in mock mode (deterministic, offline) or real mode (against the
live SaaS API). A test can target several agents at once and compare them
head-to-head on the same script.

## Playground

The playground fetches any agent's live graph topology, lets you edit any
node's system prompt, and re-runs it against real session history — prompt
iteration without redeploying.
