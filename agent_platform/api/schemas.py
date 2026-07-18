"""Pydantic request/response models for all API endpoints."""

from datetime import UTC, datetime
from typing import Any, Literal

from pydantic import BaseModel, Field


class SessionContext(BaseModel):
    """Session context injected by the frontend. Invisible to the AI — tools access it directly."""

    tenant_id: str = Field(description="Tenant identifier")
    workspace_id: str = Field(description="Active workspace ID")
    payload: dict[str, Any] | None = Field(
        default=None,
        description=(
            "Free-form snapshot of the active workspace your frontend sends "
            "(e.g. {team: [...], projects: [...]}). Planners use it to ground "
            "prompts in the tenant's real entity names; tools may forward it "
            "to the SaaS API."
        ),
    )
    user_role: str | None = Field(default=None, description="Role of the active user, e.g. 'Internal'")

    def run_metadata(self) -> dict[str, Any]:
        """Subset of session context persisted as Run metadata."""
        return {
            "tenant_id": self.tenant_id,
            "workspace_id": self.workspace_id,
            "user_role": self.user_role,
        }


class ChatRequest(BaseModel):
    """Request body for POST /api/chat."""

    message: str
    session_id: str = Field(description="UUID, maps directly to thread_id")
    session_context: SessionContext | None = Field(
        default=None, description="Client/dataset context injected by frontend, invisible to AI"
    )
    agent_type: str | None = Field(
        default=None,
        description="Which agent to invoke. None or 'router' = auto-route via LLM.",
    )
    approval_action: str | None = Field(
        default=None,
        description=(
            "Plan-approval action. One of: approve, reject, edit, "
            "clarification_response. 'edit' carries natural-language feedback "
            "in the `message` field and re-runs the planner."
        ),
    )
    modifications: list[dict] | None = Field(
        default=None,
        description="Answer payload(s) for 'clarification_response' (one entry per pending interrupt)",
    )

class GenerateRequest(BaseModel):
    """Request body for POST /api/generate."""

    message: str
    session_id: str = Field(description="UUID, maps directly to thread_id")
    session_context: SessionContext | None = Field(
        default=None, description="Client/dataset context injected by frontend, invisible to AI"
    )
    agent_type: str | None = Field(
        default=None,
        description="Which agent to invoke. None or 'router' = auto-route via LLM.",
    )



class FeedbackEnvironment(BaseModel):
    """Environment metadata stored alongside feedback."""

    tenant_id: str | None = None
    workspace_id: str | None = None


class FeedbackRequest(BaseModel):
    """Request body for POST /api/feedback."""

    run_id: str | None = Field(default=None, description="Run that produced the rated reply")
    rating: Literal["up", "down"] = Field(description="Thumbs up or thumbs down")
    category: str | None = Field(default=None, description="Thumbs-down reason; null for thumbs-up")
    comment: str | None = Field(default=None, description="Optional free-text detail")
    prompt_text: str | None = Field(default=None, description="The user prompt, as shown in the UI")
    ai_reply_text: str | None = Field(
        default=None, description="The AI reply the user rated, as rendered in the UI"
    )
    metadata: FeedbackEnvironment | None = Field(
        default=None, description="Environment: tenant_id, workspace_id"
    )


class SSEEvent(BaseModel):
    """Typed SSE event envelope for streaming responses."""

    type: str
    data: Any
    timestamp: str
    run_id: str | None = None

    @classmethod
    def create(cls, event_type: str, data: Any) -> "SSEEvent":
        """Create an SSE event with UTC timestamp."""
        return cls(
            type=event_type,
            data=data,
            timestamp=datetime.now(UTC).isoformat(),
        )



class ToolInfo(BaseModel):
    """Tool information for GET /api/tools."""

    name: str
    description: str
    category: str | None = None
    tags: list[str] = []
    args_schema: dict | None = None


class AgentInfo(BaseModel):
    """Agent information for GET /api/agents."""

    name: str
    description: str
    when_to_use: str | None = None


class MessageResponse(BaseModel):
    """A single conversation message."""

    id: str
    thread_id: str
    role: str
    content: str | None
    tool_calls: str | None
    created_at: datetime


class ToolCallDetail(BaseModel):
    """Tool call detail within a step."""

    id: str
    tool_name: str
    arguments: str | None
    result: str | None
    error: str | None
    started_at: datetime
    duration_ms: int | None


class LLMCallDetail(BaseModel):
    """LLM call detail within a step."""

    id: str
    provider: str
    model: str
    messages: str | None
    response: str | None
    input_tokens: int | None
    output_tokens: int | None
    started_at: datetime
    duration_ms: int | None


class StepDetail(BaseModel):
    """Step detail within a run."""

    id: str
    node_name: str
    input_state: str | None
    output_state: str | None
    started_at: datetime
    ended_at: datetime | None
    duration_ms: int | None
    tool_calls: list[ToolCallDetail]
    llm_calls: list[LLMCallDetail]


class EdgeDetail(BaseModel):
    """Edge detail within a run."""

    id: str
    from_node: str
    to_node: str
    condition: str | None
    timestamp: datetime


class RunFeedback(BaseModel):
    """A user's rating attached to a run (thumbs up/down + optional reason)."""

    feedback_type: str  # 'up' | 'down'
    category: str | None = None
    comment: str | None = None


class RunSummary(BaseModel):
    """Run summary for list endpoints."""

    id: str
    thread_id: str
    user_id: str | None
    agent_type: str | None
    status: str
    started_at: datetime
    ended_at: datetime | None
    total_tokens: int | None
    run_metadata: dict[str, Any] | None = None
    feedback: RunFeedback | None = None


class RunDetail(RunSummary):
    """Full run detail with nested steps and edges."""

    error: str | None
    steps: list[StepDetail]
    edges: list[EdgeDetail]


class RunsListResponse(BaseModel):
    """Paginated list of runs."""

    runs: list[RunSummary]
    total: int
    limit: int
    offset: int


class FeedbackItem(BaseModel):
    """A single feedback row for the dashboard (mirrors the feedback table)."""

    id: str
    run_id: str | None
    username: str | None
    feedback_type: str  # 'up' | 'down'
    category: str | None
    comment: str | None
    prompt_text: str | None
    ai_reply_text: str | None
    metadata: dict[str, Any] | None = None
    created_at: datetime


class FeedbackListResponse(BaseModel):
    """Paginated feedback list with sentiment counts over the filtered set."""

    items: list[FeedbackItem]
    total: int
    up_count: int
    down_count: int
    limit: int
    offset: int


class FeedbackCategoryCount(BaseModel):
    """Count of thumbs-down feedback for a single reason category."""

    category: str
    count: int


class FeedbackStats(BaseModel):
    """Global feedback aggregates plus distinct values for the filter dropdowns."""

    total: int
    up_count: int
    down_count: int
    by_category: list[FeedbackCategoryCount]
    usernames: list[str]
    categories: list[str]


Provider = Literal["vllm", "openai", "gemini"]

class TenantConfigResponse(BaseModel):
    """Response for getting a client config."""

    code: str
    provider: Provider = Field(
        description='who is hosting the model one of ("vllm", "openai", "gemini")',
        default='vllm',
    )
    model: str = Field(
        description='name of the model hosted by the provider',
        default='',
    )

class TenantConfigCreate(BaseModel):
    """Payload for creating a client config."""

    provider: Provider = Field(
        description='who is hosting the model one of ("vllm", "openai", "gemini")',
        default='vllm',
    )
    model: str = Field(
        description='name of the model hosted by the provider',
        default='',
    )

class TenantConfigUpdate(TenantConfigCreate):
    """Payload for updating a client config."""

    provider: Provider = Field(
        description='who is hosting the model one of ("vllm", "openai", "gemini")',
        default='vllm',
    )
    model: str = Field(
        description='name of the model hosted by the provider',
        default='',
    )