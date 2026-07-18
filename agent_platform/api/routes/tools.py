"""Tool-related API routes."""

from fastapi import APIRouter, Depends

from agent_platform.api.dependencies import get_tool_registry
from agent_platform.api.schemas import ToolInfo
from agent_platform.tools.registry import ToolRegistry

router = APIRouter(tags=["tools"])


@router.get("/tools", response_model=list[ToolInfo])
async def list_tools(
    tool_registry: ToolRegistry = Depends(get_tool_registry),
) -> list[ToolInfo]:
    """Return all registered tools with name, description, category, tags, and args schema."""
    summaries = tool_registry.get_schemas_summary()
    return [
        ToolInfo(
            name=d["name"],
            description=d.get("description", ""),
            category=d.get("category"),
            tags=d.get("tags", []),
            args_schema=d.get("parameters"),
        )
        for d in summaries
    ]
