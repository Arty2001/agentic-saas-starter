"""AsyncPostgresSaver checkpointer lifecycle management."""

from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver
from psycopg import AsyncConnection
from psycopg.rows import dict_row
from psycopg_pool import AsyncConnectionPool

from agent_platform.config import get_settings


@asynccontextmanager
async def get_checkpointer() -> AsyncIterator[AsyncPostgresSaver]:
    """Create and initialize the async Postgres checkpointer.

    Uses a connection pool instead of a single connection so stale
    connections are recycled automatically. autocommit + dict_row are
    required by AsyncPostgresSaver's setup/migration queries.
    """
    settings = get_settings()
    # Fail fast with the real error (bad credentials, missing database)
    # instead of letting the pool time out silently retrying.
    probe = await AsyncConnection.connect(settings.checkpoint_conn_string, connect_timeout=10)
    await probe.close()
    pool = AsyncConnectionPool(
        settings.checkpoint_conn_string,
        min_size=1,
        max_size=5,
        max_idle=1800,
        timeout=10,
        open=False,
        kwargs={"autocommit": True, "row_factory": dict_row, "prepare_threshold": 0},
    )
    await pool.open()
    # kwargs sets row_factory=dict_row at runtime; the pool's generic can't express that.
    checkpointer = AsyncPostgresSaver(pool)  # type: ignore[arg-type]
    await checkpointer.setup()
    try:
        yield checkpointer
    finally:
        await pool.close()
