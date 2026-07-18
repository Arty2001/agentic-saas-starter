"""Run-related API routes."""

import re
from collections import defaultdict
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import String, cast, delete, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from agent_platform.api.dependencies import get_session_factory
from agent_platform.api.schemas import (
    EdgeDetail,
    LLMCallDetail,
    RunDetail,
    RunFeedback,
    RunsListResponse,
    RunSummary,
    StepDetail,
    ToolCallDetail,
)
from agent_platform.db.models import ConversationMessage, Edge, Feedback, LLMCall, MetadataKey, Run, Step, ToolCall

router = APIRouter(tags=["runs"])

# Metadata keys come from a user-supplied query param and are interpolated into a
# JSON path, so restrict them to a safe character set to prevent path injection
_VALID_METADATA_KEY = re.compile(r"^[A-Za-z0-9_.]+$")


def _to_feedback(row: Feedback | None) -> RunFeedback | None:
    """Map a Feedback ORM row to the trimmed RunFeedback schema (or None)."""
    if row is None:
        return None
    return RunFeedback(
        feedback_type=row.feedback_type,
        category=row.category,
        comment=row.comment,
    )


@router.get("/metadata-keys", response_model=list[str])
async def list_metadata_keys(
    session_factory: async_sessionmaker[AsyncSession] = Depends(get_session_factory),
) -> list[str]:
    """Return the distinct metadata keys seen across runs, sorted alphabetically.

    Powers the metadata filter dropdowns in the dashboard.
    """
    async with session_factory() as session:
        result = await session.execute(
            select(MetadataKey.key_name).order_by(MetadataKey.key_name.asc())
        )
        return list(result.scalars().all())


@router.get("/run-statuses", response_model=list[str])
async def list_run_statuses(
    session_factory: async_sessionmaker[AsyncSession] = Depends(get_session_factory),
) -> list[str]:
    """Return the distinct run statuses present in the data, sorted alphabetically.

    Powers the status filter dropdown so its options stay in sync with reality
    instead of being hard-coded.
    """
    async with session_factory() as session:
        result = await session.execute(
            select(Run.status).distinct().order_by(Run.status.asc())
        )
        return [s for s in result.scalars().all() if s]


@router.get("/runs", response_model=RunsListResponse)
async def list_runs(
    session_id: str | None = Query(default=None),
    status: str | None = Query(default=None),
    agent_type: str | None = Query(default=None),
    start_date: datetime | None = Query(default=None),
    end_date: datetime | None = Query(default=None),
    search: str | None = Query(default=None, description="Free-text substring match"),
    feedback: str | None = Query(
        default=None,
        description="Feedback filter: 'any' (has feedback), 'up', or 'down'",
    ),
    facet: list[str] = Query(
        default=[],
        description="Metadata facet filters, each 'key:value' (substring match on the metadata value)",
    ),
    include_tests: bool = Query(
        default=False,
        description="Include regression-test runs (metadata source=regression); hidden by default",
    ),
    limit: int = Query(default=50, le=5000),
    offset: int = Query(default=0, ge=0),
    session_factory: async_sessionmaker[AsyncSession] = Depends(get_session_factory),
) -> RunsListResponse:
    """Return paginated list of runs with optional filters.

    Filters: session_id, status, agent_type, start_date, end_date, a free-text
    ``search`` across the main columns, metadata, and conversation messages, and
    zero or more ``facet`` filters (``key:value``) matching run-metadata values.
    All filtering happens in SQL *before* the limit, so results are never
    silently dropped by paging. When ``limit`` is omitted, every match is
    returned. Results ordered by started_at descending (most recent first).
    """
    stmt = select(Run).order_by(Run.started_at.desc(), Run.id.asc())

    # Regression-test runs are recorded like any other run (so their traces are
    # inspectable) but hidden from the dashboard unless explicitly requested.
    if not include_tests:
        stmt = stmt.where(
            or_(
                Run.run_metadata.is_(None),
                func.json_unquote(func.json_extract(Run.run_metadata, "$.source")).is_(None),
                func.json_unquote(func.json_extract(Run.run_metadata, "$.source")) != "regression",
            )
        )

    if session_id is not None:
        stmt = stmt.where(Run.thread_id == session_id)
    if status is not None:
        stmt = stmt.where(Run.status == status)
    if agent_type is not None:
        stmt = stmt.where(Run.agent_type == agent_type)
    if start_date is not None:
        stmt = stmt.where(Run.started_at >= start_date)
    if end_date is not None:
        stmt = stmt.where(Run.started_at <= end_date)

    if search:
        like = f"%{search}%"
        message_match = select(ConversationMessage.thread_id).where(
            or_(
                ConversationMessage.content.like(like),
                ConversationMessage.tool_calls.like(like),
            ),
        )
        stmt = stmt.where(
            or_(
                Run.id.like(like),
                Run.thread_id.like(like),
                Run.user_id.like(like),
                Run.agent_type.like(like),
                Run.status.like(like),
                cast(Run.run_metadata, String).like(like),
                Run.thread_id.in_(message_match),
            )
        )

    # Feedback filter — 'any' keeps runs that have a rating; 'up'/'down' narrow
    # to that thumb. run_id is unique in feedback, so this is a simple subquery.
    if feedback in ("any", "up", "down"):
        fb_runs = select(Feedback.run_id).where(Feedback.run_id.isnot(None))
        if feedback in ("up", "down"):
            fb_runs = fb_runs.where(Feedback.feedback_type == feedback)
        stmt = stmt.where(Run.id.in_(fb_runs))

    # Metadata facet filters — substring match on the value at the given JSON key.
    for raw in facet:
        key, sep, value = raw.partition(":")
        if not sep or not value or not _VALID_METADATA_KEY.match(key):
            continue
        stmt = stmt.where(
            func.json_unquote(func.json_extract(Run.run_metadata, f"$.{key}")).like(
                f"%{value}%"
            )
        )

    count_stmt = select(func.count()).select_from(stmt.subquery())
    paginated_stmt = stmt.offset(offset)
    if limit is not None:
        paginated_stmt = paginated_stmt.limit(limit)

    async with session_factory() as session:
        total_result = await session.execute(count_stmt)
        total = total_result.scalar() or 0

        rows_result = await session.execute(paginated_stmt)
        rows = rows_result.scalars().all()

        # One feedback row per run at most (run_id is unique) — fetch for this page.
        fb_by_run: dict[str, Feedback] = {}
        run_ids = [r.id for r in rows]
        if run_ids:
            fb_result = await session.execute(
                select(Feedback).where(Feedback.run_id.in_(run_ids))
            )
            for f in fb_result.scalars().all():
                if f.run_id:
                    fb_by_run[f.run_id] = f

    runs = [
        RunSummary(
            id=r.id,
            thread_id=r.thread_id,
            user_id=r.user_id,
            agent_type=r.agent_type,
            status=r.status,
            started_at=r.started_at,
            ended_at=r.ended_at,
            total_tokens=r.total_tokens,
            run_metadata=r.run_metadata,
            feedback=_to_feedback(fb_by_run.get(r.id)),
        )
        for r in rows
    ]

    return RunsListResponse(
        runs=runs, total=total, limit=limit if limit is not None else total, offset=offset
    )


@router.get("/runs/{run_id}", response_model=RunDetail)
async def get_run_detail(
    run_id: str,
    session_factory: async_sessionmaker[AsyncSession] = Depends(get_session_factory),
) -> RunDetail:
    """Return full execution trace for a run.

    Includes nested steps (with tool_calls and llm_calls) and edges.
    Returns 404 if run not found.
    """
    async with session_factory() as session:
        # Fetch the run
        run_result = await session.execute(
            select(Run).where(Run.id == run_id)
        )
        run = run_result.scalar_one_or_none()
        if run is None:
            raise HTTPException(status_code=404, detail=f"Run {run_id} not found")

        # Fetch steps, tool calls, llm calls, and edges in parallel queries
        steps_result = await session.execute(
            select(Step).where(Step.run_id == run_id).order_by(Step.started_at.asc())
        )
        steps = steps_result.scalars().all()

        tc_result = await session.execute(
            select(ToolCall).where(ToolCall.run_id == run_id).order_by(ToolCall.started_at.asc())
        )
        tool_calls = tc_result.scalars().all()

        llm_result = await session.execute(
            select(LLMCall).where(LLMCall.run_id == run_id).order_by(LLMCall.started_at.asc())
        )
        llm_calls = llm_result.scalars().all()

        edges_result = await session.execute(
            select(Edge).where(Edge.run_id == run_id).order_by(Edge.timestamp.asc())
        )
        edges = edges_result.scalars().all()

        feedback_row = await session.scalar(
            select(Feedback).where(Feedback.run_id == run_id)
        )

    # Group tool_calls and llm_calls by step_id
    tc_by_step: dict[str, list[ToolCallDetail]] = defaultdict(list)
    for tc in tool_calls:
        tc_by_step[tc.step_id].append(
            ToolCallDetail(
                id=tc.id,
                tool_name=tc.tool_name,
                arguments=tc.arguments,
                result=tc.result,
                error=tc.error,
                started_at=tc.started_at,
                duration_ms=tc.duration_ms,
            )
        )

    llm_by_step: dict[str, list[LLMCallDetail]] = defaultdict(list)
    for lc in llm_calls:
        llm_by_step[lc.step_id].append(
            LLMCallDetail(
                id=lc.id,
                provider=lc.provider,
                model=lc.model,
                messages=lc.messages,
                response=lc.response,
                input_tokens=lc.input_tokens,
                output_tokens=lc.output_tokens,
                started_at=lc.started_at,
                duration_ms=lc.duration_ms,
            )
        )

    # Build step details with nested calls
    step_details = [
        StepDetail(
            id=s.id,
            node_name=s.node_name,
            input_state=s.input_state,
            output_state=s.output_state,
            started_at=s.started_at,
            ended_at=s.ended_at,
            duration_ms=s.duration_ms,
            tool_calls=tc_by_step.get(s.id, []),
            llm_calls=llm_by_step.get(s.id, []),
        )
        for s in steps
    ]

    # Build edge details
    edge_details = [
        EdgeDetail(
            id=e.id,
            from_node=e.from_node,
            to_node=e.to_node,
            condition=e.condition,
            timestamp=e.timestamp,
        )
        for e in edges
    ]

    return RunDetail(
        id=run.id,
        thread_id=run.thread_id,
        user_id=run.user_id,
        agent_type=run.agent_type,
        status=run.status,
        started_at=run.started_at,
        ended_at=run.ended_at,
        total_tokens=run.total_tokens,
        run_metadata=run.run_metadata,
        feedback=_to_feedback(feedback_row),
        error=run.error,
        steps=step_details,
        edges=edge_details,
    )


@router.delete("/runs/{run_id}", status_code=204)
async def delete_run(
    run_id: str,
    session_factory: async_sessionmaker[AsyncSession] = Depends(get_session_factory),
) -> None:
    """Delete a run and all associated child records."""
    async with session_factory() as session:
        # Verify run exists
        result = await session.execute(select(Run.id).where(Run.id == run_id))
        if result.scalar_one_or_none() is None:
            raise HTTPException(status_code=404, detail=f"Run {run_id} not found")

        # Delete children first (FK order), then the run
        await session.execute(delete(ToolCall).where(ToolCall.run_id == run_id))
        await session.execute(delete(LLMCall).where(LLMCall.run_id == run_id))
        await session.execute(delete(Step).where(Step.run_id == run_id))
        await session.execute(delete(Edge).where(Edge.run_id == run_id))
        await session.execute(delete(ConversationMessage).where(ConversationMessage.run_id == run_id))
        await session.execute(delete(Run).where(Run.id == run_id))
        await session.commit()
