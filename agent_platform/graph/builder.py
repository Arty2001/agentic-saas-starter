"""Unified graph builder.

Two modes:
- **Direct dispatch**: frontend picks a specific agent → START → dispatcher → END
- **Auto-route**: frontend sends agent_type=None → START → router → dispatcher → END
"""

from __future__ import annotations

from langgraph.checkpoint.base import BaseCheckpointSaver
from langgraph.graph import END, START, StateGraph
from langgraph.graph.state import CompiledStateGraph

from agent_platform.agents.registry import AgentRegistry, discover_agents
from agent_platform.graph.nodes.dispatcher import create_dispatcher_node
from agent_platform.graph.nodes.router import create_router_node
from agent_platform.graph.state import AgentState
from agent_platform.tools.registry import ToolRegistry, discover_tools

Graph = CompiledStateGraph[AgentState, None, AgentState, AgentState]


def _needs_routing(state: AgentState) -> str:
    """Conditional edge: skip router if an agent is already selected."""
    if state.get("selected_agent"):
        return "dispatcher"
    return "router"


def build_graph(
    checkpointer: BaseCheckpointSaver,
    tool_registry: ToolRegistry | None = None,
    agent_registry: AgentRegistry | None = None,
) -> Graph:
    """Build and compile the unified orchestration graph.

    Flow:
        START --(selected_agent set)--> dispatcher --> END
        START --(no agent)-----------> router --> dispatcher --> END
    """
    if tool_registry is None:
        tool_registry = discover_tools()
    if agent_registry is None:
        agent_registry = discover_agents()

    # Auto-discover graph builders from each agent's graph.py
    agent_registry.discover_graph_builders(tool_registry)

    router_node = create_router_node(agent_registry)
    dispatcher_node = create_dispatcher_node(
        agent_registry, tool_registry, checkpointer
    )

    graph = StateGraph(AgentState)

    graph.add_node("router", router_node)
    graph.add_node("dispatcher", dispatcher_node)

    graph.add_conditional_edges(
        START,
        _needs_routing,
        {
            "dispatcher": "dispatcher",
            "router": "router",
        },
    )
    graph.add_edge("router", "dispatcher")
    graph.add_edge("dispatcher", END)

    return graph.compile(checkpointer=checkpointer)
