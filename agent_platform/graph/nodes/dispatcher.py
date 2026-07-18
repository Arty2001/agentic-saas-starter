"""Dispatcher node -- agent subgraph invoker.

This is now the only orchestration node. It invokes the selected agent's
subgraph and cleans up state afterward.
"""

from __future__ import annotations

import logging
from typing import Any

from langchain_core.messages import AIMessage
from langchain_core.runnables import RunnableConfig
from langgraph.checkpoint.base import BaseCheckpointSaver

from agent_platform.agents.registry import AgentRegistry
from agent_platform.graph.state import AgentState
from agent_platform.tools.registry import ToolRegistry

logger = logging.getLogger(__name__)

_STATE_CLEANUP = {
    "plan": None,
    "plan_approved": None,
    "should_cancel": None,
    "current_step_index": 0,
    "selected_agent": None,
}


def create_dispatcher_node(
    agent_registry: AgentRegistry,
    tool_registry: ToolRegistry,
    checkpointer: BaseCheckpointSaver,
) -> Any:
    """Factory that creates the dispatcher node with injected dependencies."""

    async def dispatcher_node(state: AgentState, config: RunnableConfig | None = None) -> dict[str, Any]:
        agent_name = state["selected_agent"]
        if not agent_name:
            logger.error("Dispatcher called with no selected_agent")
            return {
                "messages": [
                    AIMessage(content="No agent was selected. Please choose an agent and try again.")
                ],
            }

        builder = agent_registry.get_graph_builder(agent_name)
        if builder is None:
            logger.error("No graph builder registered for agent: %s", agent_name)
            return {
                "messages": [
                    AIMessage(
                        content=f"Agent '{agent_name}' is not available. "
                        "Please try a different request."
                    )
                ],
            }

        # Build the subgraph
        try:
            subgraph = builder()
        except TypeError:
            subgraph = builder(tool_registry)

        # Check description.yaml for whether this agent needs a checkpointer
        desc = agent_registry.get_description(agent_name)
        needs_cp = desc.get("needs_checkpointer", False) if desc else False

        if needs_cp:
            compiled = subgraph.compile(checkpointer=checkpointer)
        else:
            compiled = subgraph.compile()

        logger.info("Dispatching to agent: %s", agent_name)

        invoke_kwargs: dict[str, Any] = {"config": config}
        if needs_cp:
            invoke_kwargs["durability"] = "exit"
        result = await compiled.ainvoke(dict(state), **invoke_kwargs)

        updates: dict[str, Any] = {
            "messages": result.get("messages", []),
        }

        # Forward plan-related fields if present
        for field in ("plan", "past_steps", "plan_approved", "should_cancel", "current_step_index"):
            if field in result:
                updates[field] = result[field]

        # Clean up plan state if the plan lifecycle is complete
        plan_done = (
            result.get("plan_approved") is not None
            and result.get("should_cancel") is not True
        )
        plan_cancelled = result.get("should_cancel") is True

        if plan_done or plan_cancelled:
            updates.update(_STATE_CLEANUP)
            logger.info("Dispatcher cleaning up plan state (done=%s, cancelled=%s)", plan_done, plan_cancelled)
        else:
            # Always clear selected_agent after execution
            updates["selected_agent"] = None

        return updates

    return dispatcher_node
