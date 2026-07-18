"""Feedback API: capture thumbs up/down and power the feedback dashboard."""

import csv
import io
import json
import logging
import uuid
from datetime import UTC, datetime
from typing import Any

from fastapi import APIRouter, Depends, Query, Request, Response
from sqlalchemy import ColumnElement, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from agent_platform.api.dependencies import get_session_factory
from agent_platform.api.schemas import (
    FeedbackCategoryCount,
    FeedbackItem,
    FeedbackListResponse,
    FeedbackRequest,
    FeedbackStats,
)
from agent_platform.auth import _get_user_and_token
from agent_platform.db.models import Feedback, Run

logger = logging.getLogger(__name__)

router = APIRouter(tags=["feedback"])


def _feedback_filters(
    *,
    feedback_type: str | None,
    category: str | None,
    username: str | None,
    search: str | None,
    start_date: datetime | None,
    end_date: datetime | None,
    created_after: datetime | None,
) -> list[ColumnElement[bool]]:
    """Build the shared WHERE conditions for the list / stats / export queries."""
    conditions: list[ColumnElement[bool]] = []
    if feedback_type in ("up", "down"):
        conditions.append(Feedback.feedback_type == feedback_type)
    if category:
        conditions.append(Feedback.category == category)
    if username:
        conditions.append(Feedback.username == username)
    if search:
        like = f"%{search}%"
        conditions.append(
            or_(
                Feedback.comment.like(like),
                Feedback.prompt_text.like(like),
                Feedback.ai_reply_text.like(like),
                Feedback.username.like(like),
                Feedback.category.like(like),
            )
        )
    if start_date is not None:
        conditions.append(Feedback.created_at >= start_date)
    if end_date is not None:
        conditions.append(Feedback.created_at <= end_date)
    if created_after is not None:
        conditions.append(Feedback.created_at > created_after)
    return conditions


def _meta_cell(v: Any) -> str:
    """Stringify a metadata value for a CSV cell (dicts/lists -> JSON)."""
    if v is None:
        return ""
    if isinstance(v, str):
        return v
    if isinstance(v, bool | int | float):
        return str(v)
    return json.dumps(v)


def _to_item(row: Feedback) -> FeedbackItem:
    return FeedbackItem(
        id=row.id,
        run_id=row.run_id,
        username=row.username,
        feedback_type=row.feedback_type,
        category=row.category,
        comment=row.comment,
        prompt_text=row.prompt_text,
        ai_reply_text=row.ai_reply_text,
        metadata=row.feedback_metadata,
        created_at=row.created_at,
    )


@router.post("/feedback")
async def submit_feedback(
    request_body: FeedbackRequest,
    request: Request,
    session_factory: Any = Depends(get_session_factory),
) -> dict[str, str]:
    auth_user, _ = _get_user_and_token(request)

    env = request_body.metadata
    metadata = (
        {
            "tenant_id": env.tenant_id,
            "workspace_id": env.workspace_id,
        }
        if env is not None
        else None
    )

    async with session_factory() as session:
        # Drop the FK if the run is unknown so feedback is never lost to a 500.
        run_id = request_body.run_id
        if run_id and not await session.scalar(select(Run.id).where(Run.id == run_id)):
            run_id = None

        # One feedback per run: overwrite any existing rating for the same run
        # rather than piling up duplicate rows.
        row = None
        if run_id:
            row = await session.scalar(select(Feedback).where(Feedback.run_id == run_id))

        if row is not None:
            row.username = auth_user
            row.feedback_type = request_body.rating
            row.category = request_body.category
            row.comment = request_body.comment or None
            row.prompt_text = request_body.prompt_text or None
            row.ai_reply_text = request_body.ai_reply_text or None
            row.feedback_metadata = metadata
            row.created_at = datetime.now(UTC)
        else:
            row = Feedback(
                id=str(uuid.uuid4()),
                run_id=run_id,
                username=auth_user,
                feedback_type=request_body.rating,
                category=request_body.category,
                comment=request_body.comment or None,
                prompt_text=request_body.prompt_text or None,
                ai_reply_text=request_body.ai_reply_text or None,
                feedback_metadata=metadata,
                created_at=datetime.now(UTC),
            )
            session.add(row)
        await session.commit()
        feedback_id = row.id

    logger.info(
        "feedback_saved: id=%s run_id=%s rating=%s user=%s",
        feedback_id,
        run_id,
        request_body.rating,
        auth_user,
    )
    return {"id": feedback_id, "status": "ok"}


@router.get("/feedback", response_model=FeedbackListResponse)
async def list_feedback(
    feedback_type: str | None = Query(default=None, description="'up' or 'down'"),
    category: str | None = Query(default=None),
    username: str | None = Query(default=None),
    search: str | None = Query(default=None, description="Substring across comment/prompt/reply/user/category"),
    start_date: datetime | None = Query(default=None),
    end_date: datetime | None = Query(default=None),
    created_after: datetime | None = Query(default=None, description="Only feedback newer than this (unread count)"),
    limit: int = Query(default=50, le=5000),
    offset: int = Query(default=0, ge=0),
    session_factory: async_sessionmaker[AsyncSession] = Depends(get_session_factory),
) -> FeedbackListResponse:
    """Paginated feedback, newest first, with up/down counts over the filtered set."""
    conditions = _feedback_filters(
        feedback_type=feedback_type,
        category=category,
        username=username,
        search=search,
        start_date=start_date,
        end_date=end_date,
        created_after=created_after,
    )

    rows_stmt = (
        select(Feedback)
        .where(*conditions)
        .order_by(Feedback.created_at.desc(), Feedback.id.asc())
        .offset(offset)
        .limit(limit)
    )
    counts_stmt = (
        select(Feedback.feedback_type, func.count())
        .where(*conditions)
        .group_by(Feedback.feedback_type)
    )

    async with session_factory() as session:
        rows = (await session.execute(rows_stmt)).scalars().all()
        counts: dict[str, int] = {row[0]: row[1] for row in (await session.execute(counts_stmt)).all()}

    up_count = int(counts.get("up", 0))
    down_count = int(counts.get("down", 0))
    return FeedbackListResponse(
        items=[_to_item(r) for r in rows],
        total=up_count + down_count,
        up_count=up_count,
        down_count=down_count,
        limit=limit,
        offset=offset,
    )


@router.get("/feedback/stats", response_model=FeedbackStats)
async def feedback_stats(
    session_factory: async_sessionmaker[AsyncSession] = Depends(get_session_factory),
) -> FeedbackStats:
    """Global aggregates plus distinct usernames/categories for the filter dropdowns."""
    async with session_factory() as session:
        counts: dict[str, int] = {
            row[0]: row[1]
            for row in (
                await session.execute(
                    select(Feedback.feedback_type, func.count()).group_by(Feedback.feedback_type)
                )
            ).all()
        }
        by_category_rows = (
            await session.execute(
                select(Feedback.category, func.count())
                .where(Feedback.category.isnot(None))
                .group_by(Feedback.category)
                .order_by(func.count().desc())
            )
        ).all()
        usernames = [
            u
            for u in (
                await session.execute(
                    select(Feedback.username).distinct().order_by(Feedback.username.asc())
                )
            ).scalars().all()
            if u
        ]

    up_count = int(counts.get("up", 0))
    down_count = int(counts.get("down", 0))
    by_category = [FeedbackCategoryCount(category=c, count=int(n)) for c, n in by_category_rows]
    return FeedbackStats(
        total=up_count + down_count,
        up_count=up_count,
        down_count=down_count,
        by_category=by_category,
        usernames=usernames,
        categories=[c.category for c in by_category],
    )


@router.get("/feedback/export.csv")
async def export_feedback(
    feedback_type: str | None = Query(default=None),
    category: str | None = Query(default=None),
    username: str | None = Query(default=None),
    search: str | None = Query(default=None),
    start_date: datetime | None = Query(default=None),
    end_date: datetime | None = Query(default=None),
    session_factory: async_sessionmaker[AsyncSession] = Depends(get_session_factory),
) -> Response:
    """Download the (filtered) feedback as CSV — every stored field, all rows."""
    conditions = _feedback_filters(
        feedback_type=feedback_type,
        category=category,
        username=username,
        search=search,
        start_date=start_date,
        end_date=end_date,
        created_after=None,
    )
    stmt = select(Feedback).where(*conditions).order_by(Feedback.created_at.desc(), Feedback.id.asc())

    async with session_factory() as session:
        rows = (await session.execute(stmt)).scalars().all()

    # Metadata columns are whatever keys are actually present, unioned across rows,
    # so the export follows the backend without frontend/schema changes.
    meta_keys = sorted({k for r in rows for k in (r.feedback_metadata or {})})

    base_cols = ["created_at", "username", "feedback_type", "category", "comment", "prompt_text", "ai_reply_text", "run_id"]
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow([*base_cols, *meta_keys])
    for r in rows:
        meta = r.feedback_metadata or {}
        writer.writerow(
            [
                r.created_at.isoformat() if r.created_at else "",
                r.username or "",
                r.feedback_type,
                r.category or "",
                r.comment or "",
                r.prompt_text or "",
                r.ai_reply_text or "",
                r.run_id or "",
                *[_meta_cell(meta.get(k)) for k in meta_keys],
            ]
        )

    return Response(
        content=buf.getvalue(),
        media_type="text/csv",
        headers={"Content-Disposition": 'attachment; filename="feedback.csv"'},
    )
