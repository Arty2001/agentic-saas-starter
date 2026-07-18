"""Echo agent subgraph — the minimal agent shape.

The registry auto-discovers any agents/<name>/ directory containing a
description.yaml and a graph.py exposing build_<name>_graph. This one is a
single LLM node; copy this package as the starting point for a new agent.
"""
from __future__ import annotations

from langgraph.graph import END, START, StateGraph

from agent_platform.agents.echo_agent.nodes import create_respond_node
from agent_platform.graph.state import AgentState


def build_echo_agent_graph() -> StateGraph:
    """Build the echo_agent subgraph.

    Flow:
        START -> respond -> END
    """
    graph = StateGraph(AgentState)
    graph.add_node("respond", create_respond_node())
    graph.add_edge(START, "respond")
    graph.add_edge("respond", END)
    return graph
