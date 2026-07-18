"""Summarize a project's current state.

Real: GET .../tenant/{t}/workspace/{w}/projects/{name}/summary.
Mock: fixture stats with the same fuzzy-match + clarification behavior.
"""
from __future__ import annotations

import logging
from typing import Any

from langchain_core.runnables import RunnableConfig

from agent_platform.services import SaasApiClient, SaasApiError
from agent_platform.tools.matching import resolve

logger = logging.getLogger(__name__)

_MOCK_SUMMARIES: dict[str, dict[str, Any]] = {
    "Website Redesign": {"openTasks": 14, "completedTasks": 32, "overdue": 2, "members": 4},
    "Mobile App": {"openTasks": 22, "completedTasks": 57, "overdue": 5, "members": 6},
    "Q3 Launch": {"openTasks": 9, "completedTasks": 3, "overdue": 0, "members": 5},
    "Internal Tools": {"openTasks": 4, "completedTasks": 18, "overdue": 1, "members": 2},
    "General": {"openTasks": 7, "completedTasks": 41, "overdue": 0, "members": 6},
}


async def run(
    projectName: str,
    config: RunnableConfig | None = None,
) -> dict[str, Any]:
    resolved = SaasApiClient.try_from_config(config)
    if resolved is None:
        return _mock_run(projectName)
    client, ctx = resolved

    tenant_id = ctx.get("tenant_id")
    workspace_id = ctx.get("workspace_id")
    if not (tenant_id and workspace_id):
        return {"error": True, "message": "session_context missing tenant_id/workspace_id."}

    try:
        return await client.get_project_summary(tenant_id, workspace_id, projectName)
    except SaasApiError as e:
        if e.status_code == 400 and e.payload.get("suggestedOptions"):
            return {
                "status": "clarification_needed",
                "message": e.message,
                "answerKey": "projectName",
                "suggestedOptions": e.payload["suggestedOptions"],
                "requestedNames": e.payload.get("requestedNames") or [],
            }
        return {"error": True, "message": e.message, "errorCode": e.error_code}


def _mock_run(projectName: str) -> dict[str, Any]:
    project, suggestions = resolve(projectName, list(_MOCK_SUMMARIES))
    if project is None:
        return {
            "status": "clarification_needed",
            "reason": "projectName_not_resolved",
            "message": f"Couldn't uniquely match project '{projectName}'. Pick one of the suggestions.",
            "answerKey": "projectName",
            "requestedNames": [projectName],
            "suggestedOptions": suggestions,
        }
    return {"status": "ok", "project": project, **_MOCK_SUMMARIES[project]}
