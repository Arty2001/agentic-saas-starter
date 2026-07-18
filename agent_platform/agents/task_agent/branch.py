"""Per-item branch sub-graph for the Send fan-out.

Each approved plan item runs through this mini-graph in its own parallel
branch. Keeping it a sub-graph (rather than one big node) is what makes
mid-flow ``interrupt()`` cheap: on resume, LangGraph replays only the
interrupted node — sibling branches and completed steps are untouched.

Flow: START -> create -> finalize -> END
"""
from __future__ import annotations

import json
import logging
import operator
from typing import Annotated, Any

from langchain_core.runnables import RunnableConfig
from langgraph.graph import END, START, StateGraph
from langgraph.types import interrupt
from typing_extensions import TypedDict

from agent_platform.tools.executor import execute_tool, extract_error_message, is_tool_error
from agent_platform.tools.registry import ToolRegistry

logger = logging.getLogger(__name__)

CREATE_TASK = "create_task"

# Clarification answers accepted for one tool call before the branch gives
# up. Round 2's interrupt tells the user their previous answer didn't match.
_MAX_CLARIFY_ROUNDS = 2


class BranchState(TypedDict, total=False):
    # --- inputs (set by the Send fan-out) ---
    plan_item: dict
    item_index: int

    # --- progress ---
    task_result: dict | None

    # --- short-circuit slot: any step can write this to skip to finalize ---
    branch_error: dict | None

    # --- surfaced back to the parent AgentState (reducer is operator.add) ---
    item_results: Annotated[list[dict], operator.add]


def _item_title(state: BranchState) -> str:
    item = state.get("plan_item") or {}
    return item.get("title", f"Task {state.get('item_index', 0) + 1}")


def _ensure_dict(result: Any) -> dict:
    if isinstance(result, dict):
        return result
    if isinstance(result, str):
        try:
            parsed = json.loads(result)
            if isinstance(parsed, dict):
                return parsed
        except (json.JSONDecodeError, TypeError):
            pass
    return {"raw": result}


def _needs_clarification(result: dict) -> bool:
    return isinstance(result, dict) and result.get("status") == "clarification_needed"


def _normalize_answer(user_answer: Any) -> dict:
    """Resume payloads from ``interrupt()`` may arrive as a list of one item."""
    if isinstance(user_answer, list):
        user_answer = user_answer[0] if user_answer else {}
    return user_answer if isinstance(user_answer, dict) else {}


async def _execute_with_clarification(
    tool: Any,
    params: dict,
    *,
    config: RunnableConfig | None,
    state: BranchState,
    tool_name: str,
) -> dict:
    """Run a clarifiable tool call, re-interrupting while it keeps asking.

    Each round pauses on ``interrupt()``; the tool's ``answerKey`` tells the
    UI which param the picked option corrects, and the answer is merged into
    the original params for the retry. Returns the final tool result —
    possibly still a clarification if no answer matched (the caller turns
    that into a branch error rather than silently treating it as success).
    """
    title = _item_title(state)
    result = _ensure_dict(await execute_tool(tool, params, config=config))
    rounds = 0
    while _needs_clarification(result) and rounds < _MAX_CLARIFY_ROUNDS:
        rounds += 1
        logger.info(
            "Item %s: %s needs clarification (round %d) — %s",
            title, tool_name, rounds, result.get("message"),
        )
        retry_note = (
            " The previous answer still didn't match; please pick one of the suggestions."
            if rounds > 1
            else ""
        )
        user_answer = _normalize_answer(interrupt({
            "type": "clarification",
            "item_name": title,
            "item_index": state.get("item_index", 0),
            "tool": tool_name,
            "answer_key": result.get("answerKey"),
            "original_request": params,
            "tool_response": result,
            "clarification_round": rounds,
            "message": f"For task '{title}', {tool_name} needs clarification.{retry_note}",
        }))
        params = {**params, **user_answer}
        result = _ensure_dict(await execute_tool(tool, params, config=config))
    return result


def _create_branch_create_node(tool_registry: ToolRegistry):
    """Node: call create_task for this plan item, clarifying names as needed."""

    async def create_node(state: BranchState, config: RunnableConfig | None = None) -> dict:
        item = state.get("plan_item") or {}
        title = _item_title(state)

        tool = tool_registry.get_tool(CREATE_TASK)
        if tool is None:
            return {"branch_error": {"failed_step": CREATE_TASK,
                                     "error": f"Tool '{CREATE_TASK}' not found in registry"}}

        params = {
            key: item[key]
            for key in ("title", "projectName", "assigneeName", "dueDate", "priority")
            if item.get(key) is not None
        }
        params.setdefault("title", title)

        result = await _execute_with_clarification(
            tool, params, config=config, state=state, tool_name=CREATE_TASK,
        )

        if _needs_clarification(result):
            return {"branch_error": {
                "failed_step": CREATE_TASK,
                "error": (
                    f"Couldn't resolve a name after {_MAX_CLARIFY_ROUNDS} "
                    f"clarification answers — {extract_error_message(result)}"
                ),
                "tool_response": result,
            }}
        if is_tool_error(result):
            logger.error("Item %s: create_task failed: %s", title, extract_error_message(result))
            return {"branch_error": {
                "failed_step": CREATE_TASK,
                "error": extract_error_message(result),
                "tool_response": result,
            }}

        return {"task_result": result}

    return create_node


def _create_branch_finalize_node():
    """Node: emit this branch's single item_results entry."""

    async def finalize_node(state: BranchState) -> dict:
        error = state.get("branch_error")
        if error is not None:
            return {"item_results": [{
                "index": state.get("item_index", 0),
                "name": _item_title(state),
                "status": "error",
                **error,
            }]}

        task = state.get("task_result") or {}
        return {"item_results": [{
            "index": state.get("item_index", 0),
            "name": _item_title(state),
            "status": "success",
            "taskId": task.get("taskId"),
            "project": task.get("project"),
            "assignee": task.get("assignee"),
        }]}

    return finalize_node


def build_branch_subgraph(tool_registry: ToolRegistry) -> StateGraph:
    """Build the per-item sub-graph used by the Send fan-out."""
    graph = StateGraph(BranchState)
    graph.add_node("create", _create_branch_create_node(tool_registry))
    graph.add_node("finalize", _create_branch_finalize_node())
    graph.add_edge(START, "create")
    graph.add_edge("create", "finalize")
    graph.add_edge("finalize", END)
    return graph
