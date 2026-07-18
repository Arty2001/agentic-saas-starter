"""Support agent subgraph — the canonical ReAct tool loop.

Deliberately the opposite style from task_agent: there the plan is
decomposed up front and tools run imperatively; here the LLM drives —
it emits tool calls, reads the results, and decides when it has enough
to answer.

Flow:
    START -> agent --(tool_calls)--> tools -> agent ... -> END
"""
from __future__ import annotations

from langgraph.graph import END, START, StateGraph
from langgraph.prebuilt import ToolNode, tools_condition

from agent_platform.agents.support_agent.nodes import create_agent_node
from agent_platform.graph.state import AgentState
from agent_platform.tools.registry import ToolRegistry


def build_support_agent_graph(tool_registry: ToolRegistry) -> StateGraph:
    """Build the support_agent subgraph."""
    tools = tool_registry.get_tools_by_category("knowledge")

    graph = StateGraph(AgentState)
    graph.add_node("agent", create_agent_node(tools))
    graph.add_node("tools", ToolNode(tools))

    graph.add_edge(START, "agent")
    graph.add_conditional_edges("agent", tools_condition, {
        "tools": "tools",
        END: END,
    })
    graph.add_edge("tools", "agent")

    return graph
