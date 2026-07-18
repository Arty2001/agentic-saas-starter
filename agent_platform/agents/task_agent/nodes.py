"""Node functions for task_agent.

The per-item branch (create + clarify) lives in ``branch.py`` as its own
sub-graph so mid-flow ``interrupt()`` calls only replay their own step.
This module owns the surrounding orchestration: triage, planner, plan
approval, fan-out, and result formatting.
"""
from __future__ import annotations

import json
import logging
import re
from typing import Any

from langchain_core.messages import AIMessage, SystemMessage, trim_messages
from langchain_core.runnables import RunnableConfig
from langgraph.types import Send, interrupt

from agent_platform.agents.task_agent.prompts import (
    GUIDE_RESPOND_SYSTEM,
    PLANNER_SYSTEM,
    TRIAGE_SYSTEM,
)
from agent_platform.graph.state import AgentState
from agent_platform.llm.client import estimate_tokens, get_llm
from agent_platform.utils.progress import emit_message

logger = logging.getLogger(__name__)

_TRIAGE_CATEGORIES = ("plan", "greeting", "question", "off_topic")


def create_triage_node():
    """Classify the user message: plan | greeting | question | off_topic."""

    async def triage_node(state: AgentState, config: RunnableConfig | None = None) -> dict:
        llm = get_llm(enable_thinking=False)
        trimmed = trim_messages(
            state["messages"],
            max_tokens=6000,
            strategy="last",
            token_counter=estimate_tokens,
            allow_partial=False,
        )
        response = await llm.ainvoke([SystemMessage(content=TRIAGE_SYSTEM), *trimmed])
        raw = response.content.strip().lower() if isinstance(response.content, str) else ""

        # Priority matters: "plan" wins if present; "off_topic" is the default.
        category = "off_topic"
        for candidate in _TRIAGE_CATEGORIES:
            if candidate in raw:
                category = candidate
                break

        logger.info("triage_result: %s (raw=%s)", category, raw[:50])
        return {"triage_result": category}

    return triage_node


def triage_route(state: AgentState) -> str:
    result = state.get("triage_result")
    if result == "plan":
        return "planner"
    if result in ("greeting", "question"):
        return "guide_respond"
    return "safety_respond"


# Deterministic refusal for off-topic / adversarial / injection messages.
# Hardcoded on purpose: it can't be steered by the user's input and never
# hallucinates capabilities. Greetings and in-scope questions go through
# the LLM-backed guide node instead.
_SAFETY_RESPONSE = (
    "I can't help with that — I only plan and create tasks in the tracker.\n\n"
    "What I can do:\n"
    "  • Plan and create tasks (with your approval first)\n"
    "  • Assign people, projects, due dates, and priorities\n"
    "  • Summarize a project's current state\n\n"
    "Try something like: \"Create tasks for the launch: draft announcement "
    "(Sam), QA pass (Jordan) — due Friday.\""
)


def create_safety_respond_node():
    """Deterministic refusal — no LLM call, so prompt injection has no lever."""

    async def safety_respond_node(state: AgentState, config: RunnableConfig | None = None) -> dict:
        logger.info("safety_respond: triage=%s", state.get("triage_result"))
        emit_message("text_delta", "safety", _SAFETY_RESPONSE)
        return {
            "messages": [AIMessage(content=_SAFETY_RESPONSE)],
            "should_cancel": True,
            "plan_approved": False,
        }

    return safety_respond_node


def create_guide_respond_node():
    """LLM-backed friendly guide for greetings and in-scope questions."""

    async def guide_respond_node(state: AgentState, config: RunnableConfig | None = None) -> dict:
        llm = get_llm(enable_thinking=False)

        prompt_overrides = (config or {}).get("configurable", {}).get("prompt_overrides", {})
        base_prompt = prompt_overrides.get("guide_respond", GUIDE_RESPOND_SYSTEM)
        system_prompt = base_prompt + _options_section_from_config(config)

        trimmed = trim_messages(
            state["messages"],
            max_tokens=6000,
            strategy="last",
            token_counter=estimate_tokens,
            allow_partial=False,
        )
        response = await llm.ainvoke([SystemMessage(content=system_prompt), *trimmed])
        content = _strip_thinking(response.content)

        # Guardrail: if the model returned nothing usable, fall back to the
        # deterministic safety message so the user still sees something.
        # (No emit here — guide_respond streams token-by-token via the
        # "messages" channel; see streaming._STREAMABLE_NODES.)
        if not content:
            logger.warning("guide_respond: empty LLM response — using safety fallback")
            content = _SAFETY_RESPONSE

        return {
            "messages": [AIMessage(content=content)],
            "should_cancel": True,
            "plan_approved": False,
        }

    return guide_respond_node


def _strip_thinking(content: Any) -> str:
    """Drop <think>...</think> blocks some models emit, keep the answer."""
    text = content if isinstance(content, str) else str(content)
    think_end = text.rfind("</think>")
    if think_end != -1:
        text = text[think_end + len("</think>"):]
    return text.strip()


def create_planner_node():
    """Decompose the request into plan items (or ask for clarification)."""

    async def planner_node(state: AgentState, config: RunnableConfig | None = None) -> dict:
        llm = get_llm()

        prompt_overrides = (config or {}).get("configurable", {}).get("prompt_overrides", {})
        base_prompt = prompt_overrides.get("planner", PLANNER_SYSTEM)
        system_prompt = base_prompt + _options_section_from_config(config)

        trimmed = trim_messages(
            state["messages"],
            max_tokens=20000,
            strategy="last",
            token_counter=estimate_tokens,
            allow_partial=False,
        )
        response = await llm.ainvoke([SystemMessage(content=system_prompt), *trimmed])

        content = _strip_thinking(response.content)
        content = re.sub(r"^```(?:json)?\s*", "", content)
        content = re.sub(r"\s*```$", "", content).strip()

        try:
            parsed = json.loads(content)
        except json.JSONDecodeError:
            logger.warning("planner_json_parse_failed: content=%s", content[:200])
            message = (
                "I couldn't turn that into a valid task plan. Could you rephrase "
                "what you'd like me to set up?"
            )
            emit_message("text_delta", "planner", message)
            return {
                "messages": [AIMessage(content=message)],
                "plan_items": None,
                "should_cancel": True,
                "plan_approved": False,
            }

        if isinstance(parsed, dict) and parsed.get("needs_info"):
            question = parsed.get("question", "Could you tell me more about what you'd like to set up?")
            understood = parsed.get("understood_so_far", "")
            parts = ([f"Here's what I understood so far: {understood}\n"] if understood else []) + [question]
            message = "\n".join(parts)
            emit_message("text_delta", "planner", message)
            # No should_cancel: the conversation continues — the next user
            # message goes through triage → planner again with full history.
            return {"messages": [AIMessage(content=message)], "plan_items": None}

        items = parsed.get("tasks", parsed) if isinstance(parsed, dict) else parsed
        if not isinstance(items, list):
            items = [items]
        items = [item for item in items if isinstance(item, dict) and item.get("title")]

        if not items:
            message = "I couldn't find any concrete tasks in that request. What should I create?"
            emit_message("text_delta", "planner", message)
            return {"messages": [AIMessage(content=message)], "plan_items": None}

        display = f"I've planned {len(items)} task(s). Awaiting your approval."
        emit_message("text_delta", "planner", display)
        summary = "\n".join(
            f"{i}. {_summarize_item(item)}" for i, item in enumerate(items, 1)
        )
        return {
            "plan_items": items,
            "messages": [AIMessage(content=f"{display}\nPlan:\n{summary}")],
        }

    return planner_node


def _summarize_item(item: dict) -> str:
    """One-line plan-item summary for the conversation history."""
    parts = [f'"{item.get("title", "task")}"']
    if item.get("projectName"):
        parts.append(f'in {item["projectName"]}')
    if item.get("assigneeName"):
        parts.append(f'→ {item["assigneeName"]}')
    if item.get("dueDate"):
        parts.append(f'due {item["dueDate"]}')
    if item.get("priority"):
        parts.append(f'[{item["priority"]}]')
    return " ".join(parts)


def planner_route(state: AgentState) -> str:
    """After planner: approval if we have items, END if a question was asked."""
    if state.get("plan_items"):
        return "present_plan"
    return "__end__"


def create_present_plan_node():
    """Pause for user approval.

    interrupt() must be called unconditionally and never wrapped in
    try/except — LangGraph raises through it to pause the graph.
    """

    async def present_plan_node(state: AgentState) -> dict:
        user_decision = interrupt({
            "type": "plan_approval",
            "items": state["plan_items"],
            "message": "Review these tasks before I create them.",
        })

        action = user_decision.get("action", "reject")
        if action == "approve":
            n = len(state.get("plan_items") or [])
            emit_message("node_progress", "execute_item", f"Creating {n} task{'s' if n != 1 else ''}…")
            return {"plan_approved": True}

        return {
            "should_cancel": True,
            "plan_approved": False,
            "messages": [AIMessage(content="Cancelled. Tell me what to change and I'll replan.")],
        }

    return present_plan_node


def dispatch_items(state: AgentState):
    """Conditional edge: fan out one Send per approved plan item."""
    if state.get("should_cancel"):
        return "format_results"

    items = state.get("plan_items")
    if not items:
        return "format_results"

    return [
        Send("execute_item", {"plan_item": item, "item_index": i})
        for i, item in enumerate(items)
    ]


def create_format_results_node():
    """Summarize every branch's outcome once all Sends have finished."""

    async def format_results_node(state: AgentState) -> dict:
        emit_message("node_progress", "format_results", "Summarizing results…")

        cleanup: dict[str, Any] = {
            "plan_items": None,
            "item_results": [],
            "plan_approved": None,
            "should_cancel": None,
        }

        if state.get("should_cancel"):
            return {"messages": [AIMessage(content="Cancelled before any tasks were created.")], **cleanup}

        results = sorted(state.get("item_results", []), key=lambda r: r.get("index", 0))
        if not results:
            return {"messages": [AIMessage(content="No tasks were created.")], **cleanup}

        items_payload: list[dict[str, Any]] = []
        lines = [f"Created {sum(1 for r in results if r['status'] == 'success')} of {len(results)} task(s):", ""]
        for r in results:
            num = r.get("index", 0) + 1
            if r.get("status") == "success":
                detail = f"{num}. {r['name']} (id {r.get('taskId', '?')})"
                if r.get("assignee"):
                    detail += f" → {r['assignee']}"
                lines.append(detail)
                items_payload.append({
                    "id": r.get("taskId"), "name": r.get("name"),
                    "severity": "ok", "message": None, "failedStep": None,
                })
            else:
                err = r.get("error", "unknown error")
                lines.append(f"{num}. {r['name']}: failed — {err}")
                items_payload.append({
                    "id": r.get("taskId"), "name": r.get("name"),
                    "severity": "error", "message": err,
                    "failedStep": r.get("failed_step"),
                })

        additional_kwargs: dict[str, Any] = {
            "display": "items_completed",
            "items": items_payload,
        }
        return {
            "messages": [AIMessage(content="\n".join(lines), additional_kwargs=additional_kwargs)],
            **cleanup,
        }

    return format_results_node


def _options_section_from_config(config: RunnableConfig | None) -> str:
    """Grounding fragment built from session_context.payload.

    Your frontend sends a workspace snapshot ({team: [...], projects: [...]})
    with each chat request; surfacing those names to the planner avoids
    clarification round-trips without ever letting the LLM invent options.
    Returns "" when no payload was supplied (prompt stays unchanged).
    """
    session_context = (config or {}).get("configurable", {}).get("session_context", {}) or {}
    payload = session_context.get("payload") or {}

    def _names(value: Any) -> list[str]:
        if not isinstance(value, list):
            return []
        out: list[str] = []
        seen: set[str] = set()
        for entry in value:
            name = entry.get("name") if isinstance(entry, dict) else entry
            if isinstance(name, str) and name.strip() and name.strip() not in seen:
                seen.add(name.strip())
                out.append(name.strip())
        return out

    team = _names(payload.get("team"))
    projects = _names(payload.get("projects"))
    if not (team or projects):
        return ""

    lines = ["", "=== AVAILABLE OPTIONS IN THIS WORKSPACE ==="]
    if team:
        lines.append(f"Team: {', '.join(team)}")
    if projects:
        lines.append(f"Projects: {', '.join(projects)}")
    lines.append(
        "Prefer these exact names when the user is ambiguous; fuzzy matching "
        "still happens downstream, but exact names avoid clarification "
        "round-trips. Never invent names that aren't listed."
    )
    return "\n".join(lines)
