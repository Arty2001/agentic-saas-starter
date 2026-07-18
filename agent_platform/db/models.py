"""SQLAlchemy ORM models for observability tables."""

import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    """Base class for all ORM models."""


class Run(Base):
    """A single agent execution run."""

    __tablename__ = "runs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    thread_id: Mapped[str] = mapped_column(String(36), index=True)
    user_id: Mapped[str | None] = mapped_column(String(200), index=True)
    agent_type: Mapped[str | None] = mapped_column(String(100))
    status: Mapped[str] = mapped_column(String(50), default="pending")
    started_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    ended_at: Mapped[datetime | None] = mapped_column(DateTime)
    total_tokens: Mapped[int | None] = mapped_column()
    error: Mapped[str | None] = mapped_column(Text)
    run_metadata: Mapped[dict | None] = mapped_column("metadata", JSONB)


class Step(Base):
    """A single node execution within a run."""

    __tablename__ = "steps"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    run_id: Mapped[str] = mapped_column(String(36), ForeignKey("runs.id"), index=True)
    node_name: Mapped[str] = mapped_column(String(200))
    input_state: Mapped[str | None] = mapped_column(Text)
    output_state: Mapped[str | None] = mapped_column(Text)
    started_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    ended_at: Mapped[datetime | None] = mapped_column(DateTime)
    duration_ms: Mapped[int | None] = mapped_column()


class ToolCall(Base):
    """A tool invocation within a step."""

    __tablename__ = "tool_calls"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    step_id: Mapped[str] = mapped_column(String(36), ForeignKey("steps.id"), index=True)
    run_id: Mapped[str] = mapped_column(String(36), ForeignKey("runs.id"), index=True)
    tool_name: Mapped[str] = mapped_column(String(200))
    arguments: Mapped[str | None] = mapped_column(Text)
    result: Mapped[str | None] = mapped_column(Text)
    error: Mapped[str | None] = mapped_column(Text)
    started_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    duration_ms: Mapped[int | None] = mapped_column()


class Edge(Base):
    """A graph edge traversal within a run."""

    __tablename__ = "edges"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    run_id: Mapped[str] = mapped_column(String(36), ForeignKey("runs.id"), index=True)
    from_node: Mapped[str] = mapped_column(String(200))
    to_node: Mapped[str] = mapped_column(String(200))
    condition: Mapped[str | None] = mapped_column(String(500))
    timestamp: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())


class LLMCall(Base):
    """An LLM API invocation within a step."""

    __tablename__ = "llm_calls"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    step_id: Mapped[str] = mapped_column(String(36), ForeignKey("steps.id"), index=True)
    run_id: Mapped[str] = mapped_column(String(36), ForeignKey("runs.id"), index=True)
    provider: Mapped[str] = mapped_column(String(50))
    model: Mapped[str] = mapped_column(String(200))
    messages: Mapped[str | None] = mapped_column(Text)
    response: Mapped[str | None] = mapped_column(Text)
    input_tokens: Mapped[int | None] = mapped_column()
    output_tokens: Mapped[int | None] = mapped_column()
    started_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    duration_ms: Mapped[int | None] = mapped_column()


class ConversationMessage(Base):
    """A message in a conversation thread (for dashboarding, not state)."""

    __tablename__ = "conversation_messages"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    thread_id: Mapped[str] = mapped_column(String(36), index=True)
    run_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("runs.id"))
    role: Mapped[str] = mapped_column(String(50))
    content: Mapped[str | None] = mapped_column(Text)
    tool_calls: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())



class RegressionTest(Base):
    """A scripted multi-turn regression test (snapshot/baseline model).

    One test targets N agents: every agent runs the same turns/context and
    keeps its own baseline, so a run's results compare agents head-to-head.
    """

    __tablename__ = "regression_tests"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    name: Mapped[str] = mapped_column(String(500))
    description: Mapped[str | None] = mapped_column(Text)
    tags: Mapped[str | None] = mapped_column(Text)  # JSON array of strings
    agent_types: Mapped[str] = mapped_column(Text)  # JSON array of agent names; 'router' = LLM routes
    context_mode: Mapped[str] = mapped_column(String(10), default="mock")  # 'mock' | 'real'
    context_args: Mapped[str | None] = mapped_column(Text)  # JSON args for build_test_context()
    turns: Mapped[str] = mapped_column(Text)  # JSON array of TurnSpec
    on_unexpected_interrupt: Mapped[str] = mapped_column(String(20), default="fail")
    ignore_paths: Mapped[str | None] = mapped_column(Text)  # JSON array of extra volatile paths
    definition_hash: Mapped[str] = mapped_column(String(64))  # excludes the agent list
    created_by: Mapped[str | None] = mapped_column(String(200))
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())


class RegressionBaseline(Base):
    """A promoted snapshot a test's future runs are diffed against (versioned).

    One baseline per test — shared by every agent the test targets; each
    agent's run is compared against this same reference.
    """

    __tablename__ = "regression_baselines"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    test_id: Mapped[str] = mapped_column(String(36), ForeignKey("regression_tests.id"), index=True)
    version: Mapped[int] = mapped_column()
    snapshot: Mapped[str] = mapped_column(Text)  # JSON TestSnapshot (meta names the agent it was captured from)
    definition_hash: Mapped[str] = mapped_column(String(64))
    source_result_id: Mapped[str | None] = mapped_column(String(36))  # NULL for auto-created
    is_active: Mapped[bool] = mapped_column(default=True)  # exactly one active row per test
    promoted_by: Mapped[str | None] = mapped_column(String(200))
    promoted_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())


class RegressionRun(Base):
    """A batch execution of regression tests."""

    __tablename__ = "regression_runs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    status: Mapped[str] = mapped_column(String(50), default="pending")  # pending/running/completed/cancelled/error
    mode: Mapped[str] = mapped_column(String(20), default="regression")  # 'regression' | 'rebaseline'
    agent_type: Mapped[str | None] = mapped_column(String(100))  # scope: only this agent ran (NULL = all)
    total_tests: Mapped[int] = mapped_column(default=0)  # number of test×agent executions
    completed_tests: Mapped[int] = mapped_column(default=0)
    passed: Mapped[int] = mapped_column(default=0)
    failed: Mapped[int] = mapped_column(default=0)  # structural_diff + text_diff + error
    needs_review: Mapped[int] = mapped_column(default=0)
    baselines_created: Mapped[int] = mapped_column(default=0)
    triggered_by: Mapped[str | None] = mapped_column(String(200))
    cancel_requested: Mapped[bool] = mapped_column(default=False)  # cross-worker cancel flag
    started_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    ended_at: Mapped[datetime | None] = mapped_column(DateTime)
    duration_ms: Mapped[int | None] = mapped_column()


class RegressionResult(Base):
    """Result of one test+agent within a regression run: snapshot, diff, judge verdict."""

    __tablename__ = "regression_results"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    run_id: Mapped[str] = mapped_column(String(36), ForeignKey("regression_runs.id"), index=True)
    test_id: Mapped[str] = mapped_column(String(36), ForeignKey("regression_tests.id"), index=True)
    agent_type: Mapped[str] = mapped_column(String(100))  # 'router' = LLM routes
    baseline_id: Mapped[str | None] = mapped_column(String(36))  # NULL when baseline_created
    # passed | structural_diff | text_diff | baseline_created | needs_review | error | skipped
    status: Mapped[str] = mapped_column(String(30), default="pending")
    snapshot: Mapped[str | None] = mapped_column(Text)  # JSON TestSnapshot
    diff: Mapped[str | None] = mapped_column(Text)  # JSON array of DiffEntry
    judge: Mapped[str | None] = mapped_column(Text)  # JSON JudgeReport
    error: Mapped[str | None] = mapped_column(Text)
    mock_mode: Mapped[bool] = mapped_column(default=True)
    duration_ms: Mapped[int | None] = mapped_column()
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())


class TenantConfig(Base):
    """Per client configs."""

    __tablename__ = "tenant_config"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()), index=True)
    code: Mapped[str] = mapped_column(String(36), index=True)
    model: Mapped[str] = mapped_column(String(200), default=lambda: '')
    provider: Mapped[str] = mapped_column(String(50))
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())


class MetadataKey(Base):
    """Catalog of distinct metadata keys seen across runs (powers filter dropdowns)."""

    __tablename__ = "metadata_keys"

    key_name: Mapped[str] = mapped_column("key", String(200), primary_key=True)


class Feedback(Base):
    """A user's thumbs up/down on a specific AI reply."""

    __tablename__ = "feedback"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    # Unique so a run has at most one feedback row (Postgres permits multiple
    # NULLs for unknown runs). Submitting again overwrites the prior rating.
    run_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("runs.id"), unique=True)
    username: Mapped[str | None] = mapped_column(String(200), index=True)
    feedback_type: Mapped[str] = mapped_column(String(20))  # 'up' | 'down'
    category: Mapped[str | None] = mapped_column(String(100))  # thumbs-down reason; NULL for thumbs-up
    comment: Mapped[str | None] = mapped_column(Text)
    ai_reply_text: Mapped[str | None] = mapped_column(Text)
    prompt_text: Mapped[str | None] = mapped_column(Text)
    # Attribute can't be named `metadata` (reserved on DeclarativeBase); column is.
    feedback_metadata: Mapped[dict | None] = mapped_column("metadata", JSONB)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())