"""Create a task in the tracker, resolving fuzzy people/project names.

Real: POST .../tenant/{t}/workspace/{w}/tasks — the SaaS API resolves names
itself and returns a structured 400 with suggestedOptions on a failed match.
Mock: in-process fuzzy matching against a fixture roster, producing the same
clarification envelope, so the interrupt → answer → retry loop is fully
exercisable offline.
"""
from __future__ import annotations

import logging
from typing import Any

from langchain_core.runnables import RunnableConfig

from agent_platform.services import SaasApiClient, SaasApiError
from agent_platform.tools.matching import resolve

logger = logging.getLogger(__name__)

MOCK_TEAM = [
    "Alex Chen",
    "Sam Torres",
    "Samir Khan",
    "Jordan Lee",
    "Priya Patel",
    "Morgan Reyes",
]

MOCK_PROJECTS = [
    "Website Redesign",
    "Mobile App",
    "Q3 Launch",
    "Internal Tools",
    "General",
]

_mock_task_counter = 1041


async def run(
    title: str,
    projectName: str | None = None,
    assigneeName: str | None = None,
    dueDate: str | None = None,
    priority: str | None = None,
    config: RunnableConfig | None = None,
) -> dict[str, Any]:
    resolved = SaasApiClient.try_from_config(config)
    if resolved is None:
        return _mock_run(title, projectName, assigneeName, dueDate, priority)
    client, ctx = resolved

    tenant_id = ctx.get("tenant_id")
    workspace_id = ctx.get("workspace_id")
    if not (tenant_id and workspace_id):
        return {"error": True, "message": "session_context missing tenant_id/workspace_id."}

    body: dict[str, Any] = {"title": title}
    if projectName is not None:
        body["projectName"] = projectName
    if assigneeName is not None:
        body["assigneeName"] = assigneeName
    if dueDate is not None:
        body["dueDate"] = dueDate
    if priority is not None:
        body["priority"] = priority

    try:
        return await client.create_task(tenant_id, workspace_id, body)
    except SaasApiError as e:
        if e.status_code == 400 and e.payload.get("suggestedOptions"):
            return {
                "status": "clarification_needed",
                "message": e.message,
                "reason": e.payload.get("reason"),
                "answerKey": e.payload.get("field") or "assigneeName",
                "suggestedOptions": e.payload["suggestedOptions"],
                "requestedNames": e.payload.get("requestedNames") or [],
            }
        logger.warning("create_task failed: %s | body=%s", e.message, body)
        return {"error": True, "message": e.message, "errorCode": e.error_code}


def _clarify(field: str, requested: str, options: list[str], noun: str) -> dict[str, Any]:
    return {
        "status": "clarification_needed",
        "reason": f"{field}_not_resolved",
        "message": f"Couldn't uniquely match {noun} '{requested}'. Pick one of the suggestions.",
        "answerKey": field,
        "requestedNames": [requested],
        "suggestedOptions": options,
    }


def _mock_run(
    title: str,
    projectName: str | None,
    assigneeName: str | None,
    dueDate: str | None,
    priority: str | None,
) -> dict[str, Any]:
    global _mock_task_counter

    assignee: str | None = None
    if assigneeName:
        matched_assignee, suggestions = resolve(assigneeName, MOCK_TEAM)
        if matched_assignee is None:
            return _clarify("assigneeName", assigneeName, suggestions, "team member")
        assignee = matched_assignee

    project = "General"
    if projectName:
        matched_project, suggestions = resolve(projectName, MOCK_PROJECTS)
        if matched_project is None:
            return _clarify("projectName", projectName, suggestions, "project")
        project = matched_project

    _mock_task_counter += 1
    return {
        "status": "created",
        "taskId": _mock_task_counter,
        "title": title,
        "project": project,
        "assignee": assignee,
        "dueDate": dueDate,
        "priority": priority or "medium",
        "message": f"Task '{title}' created in {project}"
        + (f", assigned to {assignee}" if assignee else "")
        + ".",
    }
