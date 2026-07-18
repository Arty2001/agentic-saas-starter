"""Agent-related API routes."""

from fastapi import APIRouter, Depends

from agent_platform.agents.registry import AgentRegistry
from agent_platform.api.dependencies import get_agent_registry
from agent_platform.api.schemas import AgentInfo

router = APIRouter(tags=["agents"])


@router.get("/agents", response_model=list[AgentInfo])
async def list_agents(
    agent_registry: AgentRegistry = Depends(get_agent_registry),
) -> list[AgentInfo]:
    """Return all registered agents with name, description, and when_to_use."""
    descriptions = agent_registry.get_all_descriptions()
    return [
        AgentInfo(
            name=d.get("name", "unknown"),
            description=d.get("description", ""),
            when_to_use=d.get("when_to_use"),
        )
        for d in descriptions
    ]
