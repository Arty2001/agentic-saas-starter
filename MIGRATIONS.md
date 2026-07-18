# Database Migrations

PostgreSQL schema for the observability, tenant, feedback, and eval tables.

- **Dev**: you don't need this file — with `IS_DEV=true` the app creates these
  tables from the SQLAlchemy models on startup, and the LangGraph checkpointer
  creates its own tables via `AsyncPostgresSaver.setup()`.
- **Production**: apply the SQL below explicitly (or generate equivalent
  Alembic revisions from `agent_platform/db/models.py`).

## 1. Database

```sql
CREATE DATABASE agent_platform ENCODING 'UTF8';
```

## 2. Observability Tables

```sql
-- runs (no FKs)
CREATE TABLE runs (
    id VARCHAR(36) PRIMARY KEY,
    thread_id VARCHAR(36) NOT NULL,
    user_id VARCHAR(200),
    agent_type VARCHAR(100),
    status VARCHAR(50) NOT NULL DEFAULT 'pending',
    started_at TIMESTAMP NOT NULL DEFAULT now(),
    ended_at TIMESTAMP,
    total_tokens INTEGER,
    error TEXT,
    metadata JSONB
);
CREATE INDEX ix_runs_thread_id ON runs (thread_id);
CREATE INDEX ix_runs_user_id ON runs (user_id);

-- steps (FK -> runs)
CREATE TABLE steps (
    id VARCHAR(36) PRIMARY KEY,
    run_id VARCHAR(36) NOT NULL REFERENCES runs(id),
    node_name VARCHAR(200) NOT NULL,
    input_state TEXT,
    output_state TEXT,
    started_at TIMESTAMP NOT NULL DEFAULT now(),
    ended_at TIMESTAMP,
    duration_ms INTEGER
);
CREATE INDEX ix_steps_run_id ON steps (run_id);

-- tool_calls (FK -> steps, runs)
CREATE TABLE tool_calls (
    id VARCHAR(36) PRIMARY KEY,
    step_id VARCHAR(36) NOT NULL REFERENCES steps(id),
    run_id VARCHAR(36) NOT NULL REFERENCES runs(id),
    tool_name VARCHAR(200) NOT NULL,
    arguments TEXT,
    result TEXT,
    error TEXT,
    started_at TIMESTAMP NOT NULL DEFAULT now(),
    duration_ms INTEGER
);
CREATE INDEX ix_tool_calls_step_id ON tool_calls (step_id);
CREATE INDEX ix_tool_calls_run_id ON tool_calls (run_id);

-- edges (FK -> runs)
CREATE TABLE edges (
    id VARCHAR(36) PRIMARY KEY,
    run_id VARCHAR(36) NOT NULL REFERENCES runs(id),
    from_node VARCHAR(200) NOT NULL,
    to_node VARCHAR(200) NOT NULL,
    condition VARCHAR(500),
    timestamp TIMESTAMP NOT NULL DEFAULT now()
);
CREATE INDEX ix_edges_run_id ON edges (run_id);

-- llm_calls (FK -> steps, runs)
CREATE TABLE llm_calls (
    id VARCHAR(36) PRIMARY KEY,
    step_id VARCHAR(36) NOT NULL REFERENCES steps(id),
    run_id VARCHAR(36) NOT NULL REFERENCES runs(id),
    provider VARCHAR(50) NOT NULL,
    model VARCHAR(200) NOT NULL,
    messages TEXT,
    response TEXT,
    input_tokens INTEGER,
    output_tokens INTEGER,
    started_at TIMESTAMP NOT NULL DEFAULT now(),
    duration_ms INTEGER
);
CREATE INDEX ix_llm_calls_step_id ON llm_calls (step_id);
CREATE INDEX ix_llm_calls_run_id ON llm_calls (run_id);

-- conversation_messages (FK -> runs)
CREATE TABLE conversation_messages (
    id VARCHAR(36) PRIMARY KEY,
    thread_id VARCHAR(36) NOT NULL,
    run_id VARCHAR(36) REFERENCES runs(id),
    role VARCHAR(50) NOT NULL,
    content TEXT,
    tool_calls TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT now()
);
CREATE INDEX ix_conversation_messages_thread_id ON conversation_messages (thread_id);

-- metadata_keys (no FKs): catalog of distinct run metadata keys, powers filter dropdowns
CREATE TABLE metadata_keys (
    key VARCHAR(200) PRIMARY KEY
);
```

## 3. Tenant Config

```sql
-- per-tenant configs
CREATE TABLE tenant_config (
    id VARCHAR(36) PRIMARY KEY,
    code VARCHAR(36) NOT NULL,
    model VARCHAR(200) NOT NULL,
    provider VARCHAR(50) NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT now()
);
CREATE INDEX ix_tenant_config_code ON tenant_config (code);
```

## 4. Feedback Table

```sql
-- feedback: a user's thumbs up/down on a specific AI reply (FK -> runs)
CREATE TABLE feedback (
    id VARCHAR(36) PRIMARY KEY,
    run_id VARCHAR(36) REFERENCES runs(id),      -- run that produced the rated reply
    username VARCHAR(200),
    feedback_type VARCHAR(20) NOT NULL,          -- 'up' | 'down'
    category VARCHAR(100),                       -- thumbs-down reason; NULL for thumbs-up
    comment TEXT,                                -- optional free-text detail
    ai_reply_text TEXT,                          -- the AI reply being rated
    prompt_text TEXT,                            -- user prompt immediately before that reply
    metadata JSONB,                              -- environment: { tenant_id, workspace_id }
    created_at TIMESTAMP NOT NULL DEFAULT now()
);
-- run_id is unique: at most one feedback per run (submitting again overwrites).
-- Postgres allows multiple NULLs, so feedback for unknown runs still stacks.
CREATE UNIQUE INDEX ix_feedback_run_id ON feedback (run_id);
CREATE INDEX ix_feedback_username ON feedback (username);
```

## 5. Regression / Eval Tables

A test targets one or more agents (`agent_types` JSON array). Every agent runs
the same turns/context and is diffed against the test's single shared baseline;
results are tagged per agent so a run can compare agents head-to-head.

```sql
-- regression_tests: scripted multi-turn test definitions (snapshot/baseline model)
CREATE TABLE regression_tests (
    id VARCHAR(36) PRIMARY KEY,
    name VARCHAR(500) NOT NULL,
    description TEXT,
    tags TEXT,                                        -- JSON array of strings
    agent_types TEXT NOT NULL,                        -- JSON array of agent names; 'router' = LLM routes
    context_mode VARCHAR(10) NOT NULL DEFAULT 'mock', -- 'mock' | 'real'
    context_args TEXT,                                -- JSON args for each agent's build_test_context()
    turns TEXT NOT NULL,                              -- JSON array of TurnSpec
    on_unexpected_interrupt VARCHAR(20) NOT NULL DEFAULT 'fail', -- 'fail' | 'auto_approve'
    ignore_paths TEXT,                                -- JSON array of extra volatile diff paths
    definition_hash VARCHAR(64) NOT NULL,             -- sha256 of behavior-relevant fields (excludes agent list)
    created_by VARCHAR(200),
    created_at TIMESTAMP NOT NULL DEFAULT now(),
    updated_at TIMESTAMP NOT NULL DEFAULT now()
);

-- regression_baselines: promoted snapshots, versioned per test (shared by all its agents)
CREATE TABLE regression_baselines (
    id VARCHAR(36) PRIMARY KEY,
    test_id VARCHAR(36) NOT NULL REFERENCES regression_tests(id),
    version INTEGER NOT NULL,
    snapshot TEXT NOT NULL,                           -- JSON TestSnapshot (meta names the agent it came from)
    definition_hash VARCHAR(64) NOT NULL,             -- hash of the definition it was captured under
    source_result_id VARCHAR(36),                     -- result promoted from (NULL for auto-created)
    is_active BOOLEAN NOT NULL DEFAULT TRUE,          -- exactly one active row per test
    promoted_by VARCHAR(200),
    promoted_at TIMESTAMP NOT NULL DEFAULT now(),
    created_at TIMESTAMP NOT NULL DEFAULT now(),
    CONSTRAINT ux_regression_baselines_test_version UNIQUE (test_id, version)
);
CREATE INDEX ix_regression_baselines_test_id ON regression_baselines (test_id);

-- regression_runs: batch execution tracking (counters are per test×agent execution)
CREATE TABLE regression_runs (
    id VARCHAR(36) PRIMARY KEY,
    status VARCHAR(50) NOT NULL DEFAULT 'pending',    -- pending/running/completed/cancelled/error
    mode VARCHAR(20) NOT NULL DEFAULT 'regression',   -- 'regression' | 'rebaseline'
    agent_type VARCHAR(100),                          -- scope: only this agent ran (NULL = all agents)
    total_tests INTEGER NOT NULL DEFAULT 0,           -- number of test×agent executions
    completed_tests INTEGER NOT NULL DEFAULT 0,
    passed INTEGER NOT NULL DEFAULT 0,
    failed INTEGER NOT NULL DEFAULT 0,                -- structural_diff + text_diff + error
    needs_review INTEGER NOT NULL DEFAULT 0,
    baselines_created INTEGER NOT NULL DEFAULT 0,
    triggered_by VARCHAR(200),
    cancel_requested BOOLEAN NOT NULL DEFAULT FALSE,  -- cross-worker cancel flag
    started_at TIMESTAMP NOT NULL DEFAULT now(),
    ended_at TIMESTAMP,
    duration_ms INTEGER
);

-- regression_results: per test×agent per run — captured snapshot, diff, judge verdict
CREATE TABLE regression_results (
    id VARCHAR(36) PRIMARY KEY,
    run_id VARCHAR(36) NOT NULL REFERENCES regression_runs(id),
    test_id VARCHAR(36) NOT NULL REFERENCES regression_tests(id),
    agent_type VARCHAR(100) NOT NULL,                 -- agent this execution ran as ('router' = LLM routes)
    baseline_id VARCHAR(36),                          -- baseline diffed against (NULL when created)
    status VARCHAR(30) NOT NULL DEFAULT 'pending',
        -- passed | structural_diff | text_diff | baseline_created | needs_review | error | skipped
    snapshot TEXT,                                    -- JSON TestSnapshot captured this run
    diff TEXT,                                        -- JSON array of DiffEntry
    judge TEXT,                                       -- JSON JudgeReport
    error TEXT,
    mock_mode BOOLEAN NOT NULL DEFAULT TRUE,
    duration_ms INTEGER,
    created_at TIMESTAMP NOT NULL DEFAULT now()
);
CREATE INDEX ix_regression_results_run_id ON regression_results (run_id);
CREATE INDEX ix_regression_results_test_id ON regression_results (test_id);
```

## Drop All (if needed)

```sql
-- Drop in reverse FK order
DROP TABLE IF EXISTS regression_results;
DROP TABLE IF EXISTS regression_baselines;
DROP TABLE IF EXISTS regression_runs;
DROP TABLE IF EXISTS regression_tests;
DROP TABLE IF EXISTS feedback;
DROP TABLE IF EXISTS tenant_config;
DROP TABLE IF EXISTS metadata_keys;
DROP TABLE IF EXISTS conversation_messages;
DROP TABLE IF EXISTS llm_calls;
DROP TABLE IF EXISTS edges;
DROP TABLE IF EXISTS tool_calls;
DROP TABLE IF EXISTS steps;
DROP TABLE IF EXISTS runs;
```
