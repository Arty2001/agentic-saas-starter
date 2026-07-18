# Contributing

Thanks for wanting to improve the starter! The bar for changes:

## Ground rules

- **Keep the demo domain tiny.** The task tracker exists to exercise the
  framework, not to become a product. New framework capabilities should come
  with the smallest demo surface that proves them.
- **Every tool keeps the real/mock split** and returns the clarification
  envelope (`answerKey` + `suggestedOptions`) for fuzzy-name misses.
- **Agents are registry-discovered.** No hardwired imports between the core
  graph and agent packages.

## Workflow

```bash
pip install -e ".[dev]"
docker compose up db -d      # integration tests self-skip without it

ruff check agent_platform tests   # lint
mypy agent_platform               # types
pytest                            # tests
```

All three run in CI and must pass. For frontend changes, `npm run build`
must pass (`tsc` is part of the build).

## Commits and PRs

- Conventional commits (`feat:`, `fix:`, `docs:`, `refactor:`, `test:`).
- One logical change per PR; include tests for behavior you add.
- If you change agent behavior, update or add an eval in the Tests view and
  mention the baseline impact in the PR description.

## Adding examples

Use the scaffolds (`python -m agent_platform new-agent` / `new-tool`) as the
starting point so conventions stay uniform.
