from agent_platform.db.engine import (
    AsyncEngine,
    AsyncSession,
    create_engine,
    get_session,
)


def test_create_engine() -> None:
    engine = create_engine()
    assert engine is not None 
    assert isinstance(engine, AsyncEngine)

async def test_get_session() -> None:
    async for session in get_session():
        assert session is not None 
        assert isinstance(session, AsyncSession)