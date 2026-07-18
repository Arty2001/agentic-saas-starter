"""Task agent subgraph — the template's plan-and-execute reference.

Flow:
    START -> triage
        --(plan)-----------------> planner
              --(has plan)------> present_plan (interrupt for approval)
              |                    -> dispatch_items -> [execute_item x N]
              |                    -> format_results -> END
              --(needs info)----> END (asks a question; user replies → new turn)
        --(greeting | question)-> guide_respond -> END
        --(off_topic)-----------> safety_respond -> END (deterministic refusal)

The three patterns to study here: the planner's strict JSON contract
(plan vs needs_info), the approval interrupt in present_plan, and the
Send fan-out in dispatch_items with per-item clarification interrupts
inside the branch sub-graph.
"""
from __future__ import annotations

from langgraph.graph import END, START, StateGraph

from agent_platform.agents.task_agent.branch import build_branch_subgraph
from agent_platform.agents.task_agent.nodes import (
    create_format_results_node,
    create_guide_respond_node,
    create_planner_node,
    create_present_plan_node,
    create_safety_respond_node,
    create_triage_node,
    dispatch_items,
    planner_route,
    triage_route,
)
from agent_platform.graph.state import AgentState
from agent_platform.tools.registry import ToolRegistry


def build_task_agent_graph(tool_registry: ToolRegistry) -> StateGraph:
    """Build the task_agent subgraph."""
    graph = StateGraph(AgentState)

    graph.add_node("triage", create_triage_node())
    graph.add_node("guide_respond", create_guide_respond_node())
    graph.add_node("safety_respond", create_safety_respond_node())
    graph.add_node("planner", create_planner_node())
    graph.add_node("present_plan", create_present_plan_node())
    graph.add_node("execute_item", build_branch_subgraph(tool_registry).compile())
    graph.add_node("format_results", create_format_results_node(), defer=True)

    graph.add_edge(START, "triage")
    graph.add_conditional_edges("triage", triage_route, {
        "planner": "planner",
        "guide_respond": "guide_respond",
        "safety_respond": "safety_respond",
    })
    graph.add_edge("guide_respond", END)
    graph.add_edge("safety_respond", END)
    graph.add_conditional_edges("planner", planner_route, {
        "present_plan": "present_plan",
        "__end__": END,
    })
    graph.add_conditional_edges("present_plan", dispatch_items)
    graph.add_edge("execute_item", "format_results")
    graph.add_edge("format_results", END)

    return graph
