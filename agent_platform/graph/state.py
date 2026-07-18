"""Unified graph state shared by every agent.

Keep this minimal: agents that need private working state should carry it
in their own branch/sub-graph state (see task_agent's branch.py), not here.
"""

import operator
from typing import Annotated

from langchain_core.messages import BaseMessage
from langgraph.graph import add_messages
from typing_extensions import TypedDict


class AgentState(TypedDict):
    messages: Annotated[list[BaseMessage], add_messages]

    # Which agent the router (or the frontend) picked for this turn.
    selected_agent: str | None

    # --- plan-and-execute lifecycle (used by planning agents) --------------
    # The structured plan awaiting approval / being executed. One dict per
    # parallel work item.
    plan_items: list[dict] | None
    plan_approved: bool | None
    should_cancel: bool | None

    # Fan-out results: each parallel branch appends exactly one entry.
    item_results: Annotated[list[dict], operator.add]

    # --- sequential-plan bookkeeping (dispatcher/stream progress events) ---
    plan: list[dict] | None
    current_step_index: int
    past_steps: Annotated[list[tuple[str, str]], operator.add]

    # Triage bucket chosen by a triage node (agent-internal routing).
    triage_result: str | None
