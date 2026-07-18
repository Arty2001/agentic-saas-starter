"""Regression-test session contexts for task_agent.

Part of the agent contract for the Tests framework: `ContextArgs` declares
what the test editor collects; `build_test_context` turns those args into a
session_context — a code fixture in mock mode, or in real mode the same
workspace snapshot a production frontend would send, fetched live from the
SaaS API.
"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field

from agent_platform.services.saas_api_client import SaasApiClient

# Names deliberately match the hard-coded mock data in the task tools
# (tools/create_task.MOCK_TEAM / MOCK_PROJECTS) so planner grounding and
# mock tool responses agree.
_MOCK_TEAM = [
    "Alex Chen",
    "Sam Torres",
    "Samir Khan",
    "Jordan Lee",
    "Priya Patel",
    "Morgan Reyes",
]
_MOCK_PROJECTS = ["Website Redesign", "Mobile App", "Q3 Launch", "Internal Tools", "General"]

_MOCK_PAYLOAD: dict[str, Any] = {
    "team": [{"name": name} for name in _MOCK_TEAM],
    "projects": [{"name": name} for name in _MOCK_PROJECTS],
}


class ContextArgs(BaseModel):
    """Arguments the test editor collects for task_agent tests."""

    tenant_id: str = Field(default="demo_tenant", description="Tenant id")
    workspace_id: str = Field(default="demo_workspace", description="Workspace id")


async def build_test_context(
    mode: Literal["mock", "real"],
    args: ContextArgs,
    client: SaasApiClient | None,
) -> dict[str, Any] | None:
    base: dict[str, Any] = {
        "tenant_id": args.tenant_id,
        "workspace_id": str(args.workspace_id),
        "user_role": "Internal",
    }
    if mode == "mock" or client is None:
        return {**base, "payload": _MOCK_PAYLOAD}

    workspace = await client.get_workspace(args.tenant_id, args.workspace_id)
    return {
        **base,
        "payload": {
            "team": workspace.get("team") or [],
            "projects": workspace.get("projects") or [],
        },
    }
