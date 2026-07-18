"""Pydantic models and helpers for the regression testing framework."""

from __future__ import annotations

import hashlib
import json
from datetime import datetime
from typing import Annotated, Any, Literal

from pydantic import BaseModel, Field, field_validator

# Sentinel agent entry meaning "let the router LLM pick" (stored verbatim).
ROUTER_AGENT = "router"


def normalize_agent_types(values: list[str]) -> list[str]:
    """Trim, lowercase the router sentinel, and dedupe preserving order."""
    out: list[str] = []
    for value in values:
        name = (value or "").strip()
        if not name:
            continue
        if name.lower() == ROUTER_AGENT:
            name = ROUTER_AGENT
        if name not in out:
            out.append(name)
    return out

# ---------------------------------------------------------------------------
# Turn specs — protocol-level, agent-agnostic. Each maps 1:1 to a chat POST.
# ---------------------------------------------------------------------------


class MessageTurn(BaseModel):
    type: Literal["message"]
    text: str


class ApproveTurn(BaseModel):
    type: Literal["approve"]


class RejectTurn(BaseModel):
    type: Literal["reject"]


class EditTurn(BaseModel):
    """Natural-language planner feedback (approval_action='edit')."""

    type: Literal["edit"]
    text: str


class ClarificationTurn(BaseModel):
    """Answer to a clarification interrupt.

    `response` is passed raw: a dict like {"assigneeName": "Sam Torres"}, a string,
    or a LIST of such values to answer multiple simultaneous interrupts.
    """

    type: Literal["clarification"]
    response: Any


TurnSpec = Annotated[
    MessageTurn | ApproveTurn | RejectTurn | EditTurn | ClarificationTurn,
    Field(discriminator="type"),
]


# ---------------------------------------------------------------------------
# Snapshots — what a run captures (same surface the browser sees over SSE)
# ---------------------------------------------------------------------------


class TurnSnapshot(BaseModel):
    turn_index: int
    input: dict[str, Any]  # echo of the TurnSpec (display only, never diffed)
    router_decision: str | None = None
    tool_calls: list[dict[str, Any]] = []  # [{tool_name, arguments}]
    tool_results: list[dict[str, Any]] = []  # truncated; display only, never diffed
    plan: dict[str, Any] | None = None  # plan-approval interrupt payload verbatim
    tool_clarification: dict[str, Any] | None = None
    items_completed: list[dict[str, Any]] | None = None
    final_text: str = ""  # concatenated text_delta contents
    awaiting_approval: bool = False
    error: dict[str, Any] | None = None  # {error_type, message}
    run_id: str | None = None  # observability run id (volatile; links to /runs/:id)
    duration_ms: int | None = None


class TestSnapshot(BaseModel):
    meta: dict[str, Any]  # {captured_at, agent_type, mock_mode, context_mode, context_hash, thread_id}
    turns: list[TurnSnapshot]


class JudgeTurnVerdict(BaseModel):
    turn_index: int
    equivalent: bool | None = None  # None = judge errored → needs_review
    differences: str | None = None
    error: str | None = None
    # The compared texts (clipped) so the UI can show baseline vs new side by side.
    baseline_text: str | None = None
    actual_text: str | None = None


class JudgeReport(BaseModel):
    verdicts: list[JudgeTurnVerdict] = []


# ---------------------------------------------------------------------------
# API models
# ---------------------------------------------------------------------------


class RegressionTestCreate(BaseModel):
    name: str
    description: str | None = None
    tags: list[str] = []
    agent_types: list[str] = Field(
        min_length=1,
        description="Agents this test targets; 'router' = auto-route via LLM. "
        "Each agent runs the same turns/context and keeps its own baseline.",
    )
    context_mode: Literal["mock", "real"] = "mock"
    context_args: dict[str, Any] = Field(
        default_factory=dict,
        description="Args for each agent's build_test_context() (validated against its ContextArgs)",
    )
    turns: list[TurnSpec] = Field(min_length=1)
    on_unexpected_interrupt: Literal["fail", "auto_approve"] = "fail"
    ignore_paths: list[str] = []

    @field_validator("agent_types")
    @classmethod
    def _normalize_agents(cls, v: list[str]) -> list[str]:
        normalized = normalize_agent_types(v)
        if not normalized:
            raise ValueError("at least one agent is required")
        return normalized


class RegressionTestUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    tags: list[str] | None = None
    agent_types: list[str] | None = None
    context_mode: Literal["mock", "real"] | None = None
    context_args: dict[str, Any] | None = None
    turns: list[TurnSpec] | None = None
    on_unexpected_interrupt: Literal["fail", "auto_approve"] | None = None
    ignore_paths: list[str] | None = None

    @field_validator("agent_types")
    @classmethod
    def _normalize_agents(cls, v: list[str] | None) -> list[str] | None:
        if v is None:
            return None
        normalized = normalize_agent_types(v)
        if not normalized:
            raise ValueError("at least one agent is required")
        return normalized


class LastResultSummary(BaseModel):
    run_id: str
    result_id: str
    status: str
    created_at: datetime


class AgentTestState(BaseModel):
    """Per-agent result status of a test (one entry per agent_types item)."""

    agent_type: str
    last_result: LastResultSummary | None = None


class RegressionTestResponse(BaseModel):
    id: str
    name: str
    description: str | None
    tags: list[str]
    agent_types: list[str]
    context_mode: str
    context_args: dict[str, Any]
    turns: list[dict[str, Any]]
    on_unexpected_interrupt: str
    ignore_paths: list[str]
    definition_hash: str
    baseline_version: int | None = None
    baseline_stale: bool = False  # active baseline captured under a different definition
    agents: list[AgentTestState] = []
    created_by: str | None
    created_at: datetime
    updated_at: datetime


class RegressionTestListResponse(BaseModel):
    tests: list[RegressionTestResponse]
    total: int


class ContextSpec(BaseModel):
    """What the UI needs to render an agent's context-args form."""

    args_schema: dict[str, Any]  # JSON schema of the agent's ContextArgs
    defaults: dict[str, Any]


class RegressionAgentInfo(BaseModel):
    name: str
    description: str
    context: ContextSpec | None = None  # None = agent has no test_context.py


class RegressionRunRequest(BaseModel):
    test_ids: list[str] = Field(default=[], description="Empty = run all tests")
    agent_type: str | None = Field(
        default=None,
        description=(
            "Only execute this agent's runs (tests not targeting it are excluded). "
            "None = every agent of every selected test."
        ),
    )
    mode: Literal["regression", "rebaseline"] = "regression"
    auth_mode: Literal["user", "service"] = Field(
        default="user",
        description=(
            "Whose credentials real-mode tests use against saas-api: "
            "'user' = whoever triggered the run (session token, can expire mid-run); "
            "'service' = the platform service account (application_token + service_account_user, never expires)"
        ),
    )


class RegressionRunSummary(BaseModel):
    id: str
    status: str
    mode: str
    agent_type: str | None = None  # scope: only this agent ran (None = all agents)
    total_tests: int  # number of test×agent executions
    completed_tests: int
    passed: int
    failed: int
    needs_review: int
    baselines_created: int
    triggered_by: str | None
    started_at: datetime
    ended_at: datetime | None
    duration_ms: int | None


class RegressionRunListResponse(BaseModel):
    runs: list[RegressionRunSummary]
    total: int


class RegressionResultResponse(BaseModel):
    id: str
    run_id: str
    test_id: str
    test_name: str
    test_tags: list[str] = []
    agent_type: str
    baseline_id: str | None
    status: str
    snapshot: dict[str, Any] | None = None
    diff: list[dict[str, Any]] = []
    judge: dict[str, Any] | None = None
    error: str | None
    mock_mode: bool
    duration_ms: int | None
    created_at: datetime


class RegressionRunDetail(RegressionRunSummary):
    results: list[RegressionResultResponse]


class BaselineInfo(BaseModel):
    id: str
    version: int
    definition_hash: str
    source_result_id: str | None
    is_active: bool
    promoted_by: str | None
    promoted_at: datetime


class BaselineResponse(BaseModel):
    baseline: dict[str, Any] | None = None  # BaselineInfo + snapshot for the active one
    versions: list[BaselineInfo] = []


class PromoteRequest(BaseModel):
    result_id: str


class PromoteResponse(BaseModel):
    baseline_id: str
    version: int


# ---------------------------------------------------------------------------
# Definition hash — behavior-relevant fields only
# ---------------------------------------------------------------------------


def definition_hash(
    context_mode: str,
    context_args: dict[str, Any] | None,
    turns: list[dict[str, Any]],
    on_unexpected_interrupt: str,
) -> str:
    """Hash of the fields that change what a test run *does*.

    Name/description/tags/ignore_paths are excluded — editing those must not
    invalidate the baseline. The agent list is excluded too: adding or removing
    an agent must not invalidate the other agents' baselines (baselines are
    kept per agent).
    """
    payload = {
        "context_mode": context_mode,
        "context_args": context_args or {},
        "turns": turns,
        "on_unexpected_interrupt": on_unexpected_interrupt,
    }
    blob = json.dumps(payload, sort_keys=True, default=str)
    return hashlib.sha256(blob.encode("utf-8")).hexdigest()
