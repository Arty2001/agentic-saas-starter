"""Router node -- LLM-based agent selector.

When the frontend doesn't specify an agent, the router uses the LLM to
pick the best agent from the registry. It sets `selected_agent` in state
so the dispatcher knows where to go.
"""

from __future__ import annotations

import logging
from typing import Any

from langchain_core.messages import SystemMessage, trim_messages
from langchain_core.runnables import RunnableConfig
from pydantic import BaseModel, Field

from agent_platform.agents.registry import AgentRegistry
from agent_platform.graph.state import AgentState
from agent_platform.llm.client import estimate_tokens, get_llm

logger = logging.getLogger(__name__)


class RouterDecision(BaseModel):
    selected_agent: str = Field(description="The agent name to route to")
    confidence: float = Field(ge=0.0, le=1.0)
    reasoning: str = Field(description="Why this agent was chosen")


def _build_router_prompt(agents: list[dict[str, Any]]) -> str:
    """Build the router system prompt from registry data."""
    agent_lines = []
    for agent in agents:
        name = agent.get("name", "unknown")
        desc = agent.get("description", "No description")
        hints = agent.get("routing_hints", {})
        keywords = hints.get("keywords", []) if isinstance(hints, dict) else hints
        hints_str = f" (keywords: {', '.join(keywords[:10])})" if keywords else ""
        agent_lines.append(f"  - {name}: {desc}{hints_str}")
    agents_section = (
        "\n".join(agent_lines) if agent_lines else "  (no agents registered)"
    )

    agent_names = [a.get("name", "") for a in agents if a.get("name")]
    agent_names_csv = ", ".join(agent_names) if agent_names else "(none)"

    return (
        "You are an intent classifier for an AI assistant. Your ONLY job is to "
        "pick the best AGENT to handle the user's request.\n\n"
        "Available agents (choose EXACTLY one of these names):\n"
        f"{agents_section}\n\n"
        "Rules:\n"
        f"- `selected_agent` MUST be one of: {agent_names_csv}. Nothing else.\n"
        "- Never return a tool name (e.g. 'create_task', "
        "'search_knowledge'). Tools are NOT agents.\n"
        "- If the user's request doesn't clearly match any agent, pick the one "
        "whose description is closest. The agent itself will handle clarification.\n"
        "- Set selected_agent to the EXACT agent name string from the agents list above."
    )


def create_router_node(
    agent_registry: AgentRegistry,
) -> Any:
    """Factory that creates the router node function with injected dependencies."""

    async def router_node(
        state: AgentState, config: RunnableConfig | None = None
    ) -> dict[str, Any]:
        agents = agent_registry.get_all_descriptions()
        prompt = _build_router_prompt(agents)
        logger.info("router prompt: %s", prompt.replace("\n", "\\n"))

        llm = get_llm()
        trimmed = trim_messages(
            state["messages"],
            max_tokens=8000,
            strategy="last",
            token_counter=estimate_tokens,
            allow_partial=False,
        )

        logger.info("router_llm_invoke: num_messages=%d", len(trimmed))
        structured_llm = llm.with_structured_output(RouterDecision)
        try:
            raw = await structured_llm.ainvoke(
                [SystemMessage(content=prompt), *trimmed]
            )
        except Exception as e:
            logger.error("router_llm_error: %s - %s", type(e).__name__, str(e))
            raise
        result = raw if isinstance(raw, RouterDecision) else RouterDecision.model_validate(raw)

        logger.info(
            "router_decision: agent=%s confidence=%.2f reason=%s",
            result.selected_agent,
            result.confidence,
            result.reasoning,
        )

        valid_agents = [a.get("name", "") for a in agents if a.get("name")]
        chosen = result.selected_agent
        if chosen not in valid_agents:
            fallback = valid_agents[0] if valid_agents else chosen
            logger.warning(
                "router_invalid_agent: picked=%r not in registry %r — falling back to %r",
                chosen, valid_agents, fallback,
            )
            chosen = fallback

        return {
            "selected_agent": chosen,
        }

    return router_node
