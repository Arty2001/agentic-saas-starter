"""Session-related API routes."""

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from agent_platform.api.dependencies import get_session_factory
from agent_platform.api.schemas import MessageResponse
from agent_platform.db.models import ConversationMessage

router = APIRouter(tags=["sessions"])


@router.get("/sessions/{session_id}/history", response_model=list[MessageResponse])
async def get_session_history(
    session_id: str,
    session_factory: async_sessionmaker[AsyncSession] = Depends(get_session_factory),
) -> list[MessageResponse]:
    """Return all conversation messages for a session ordered by created_at.

    Returns an empty list if no messages found.
    """
    stmt = (
        select(ConversationMessage)
        .where(ConversationMessage.thread_id == session_id)
        .order_by(ConversationMessage.created_at.asc())
    )

    async with session_factory() as session:
        result = await session.execute(stmt)
        rows = result.scalars().all()

    return [
        MessageResponse(
            id=row.id,
            thread_id=row.thread_id,
            role=row.role,
            content=row.content,
            tool_calls=row.tool_calls,
            created_at=row.created_at,
        )
        for row in rows
    ]
