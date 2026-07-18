# Agent Dev Console

React + TypeScript (Vite) console for developing, observing, and evaluating
the agents in this repo. It is a **developer tool**, not the end-user product
surface — in a real conversion your SaaS's own frontend embeds the chat and
sends `session_context` with each request.

## Views

| View       | What it does                                                                    |
| ---------- | ------------------------------------------------------------------------------- |
| Chat       | SSE chat with agent picker (or LLM router), plan-approval cards, clarifications  |
| Runs       | Every execution: node timeline, tool calls, LLM calls, tokens, errors            |
| Feedback   | Thumbs up/down captured per AI reply, with the surrounding context               |
| Tests      | Multi-turn eval suites: scripted turns, baseline snapshots, diffs, LLM judge     |
| Playground | Edit any node's system prompt and re-run it against real session history         |

## Run

```bash
npm install
npm run dev          # expects the backend on :8080 (see vite.config.ts proxy)
```

`npm run build` outputs to `dist/`, which the FastAPI backend serves in
production (see the root `Dockerfile`).
