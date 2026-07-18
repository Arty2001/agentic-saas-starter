"""FastAPI dependency injection functions."""

from fastapi import Request
from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from agent_platform.agents.registry import AgentRegistry
from agent_platform.graph.builder import Graph
from agent_platform.tools.registry import ToolRegistry


def get_graph(request: Request) -> Graph:
    return request.app.state.graph


def get_tool_registry(request: Request) -> ToolRegistry:
    return request.app.state.tool_registry


def get_agent_registry(request: Request) -> AgentRegistry:
    return request.app.state.agent_registry


def get_session_factory(request: Request) -> async_sessionmaker[AsyncSession]:
    return request.app.state.session_factory


def get_checkpointer_dep(request: Request) -> AsyncPostgresSaver:
    return request.app.state.checkpointer
