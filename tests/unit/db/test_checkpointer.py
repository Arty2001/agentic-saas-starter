from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver

from agent_platform.db.checkpointer import get_checkpointer
from tests.conftest import requires_db

pytestmark = requires_db


async def test_get_checkpointer() -> None:
    async with get_checkpointer() as checkpointer:
        assert checkpointer is not None
        assert isinstance(checkpointer, AsyncPostgresSaver)