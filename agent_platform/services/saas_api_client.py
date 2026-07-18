"""HTTP client for your SaaS backend's agent-facing routes.

This is the bridge between the agent layer and the product it automates:
every tool call ultimately lands on a normal REST endpoint of your existing
SaaS. Point `SAAS_API_URL` at that API and replace the demo endpoints below
(a minimal task tracker) with your own.

`try_from_config` returns None when auth/url is missing — the signal for
playground/dev runs, where tools fall back to their in-process mock branch.
That convention is what lets the whole starter run with zero external
services.
"""

from __future__ import annotations

import logging
from typing import Any

import httpx
from langchain_core.runnables import RunnableConfig

from agent_platform.config import get_settings

logger = logging.getLogger(__name__)


class SaasApiError(Exception):
    """The SaaS API returned an error envelope or non-2xx status.

    `payload` carries the API's structured error payload (e.g.
    `{requestedNames, suggestedOptions}` for a failed fuzzy match) so tools
    can build a clarification response without an extra round-trip.
    """

    def __init__(
        self,
        message: str,
        *,
        status_code: int | None = None,
        error_code: str | None = None,
        payload: dict[str, Any] | None = None,
    ) -> None:
        super().__init__(message)
        self.message = message
        self.status_code = status_code
        self.error_code = error_code
        self.payload = payload or {}


class SaasApiClient:
    """Async client for the SaaS backend's agent routes.

    Addressing follows a typical multi-tenant SaaS shape:
    tenant → workspace → resources. Adapt to your own hierarchy.
    """

    def __init__(
        self,
        base_url: str,
        token: str,
        user: str,
        *,
        timeout: float = 30.0,
    ) -> None:
        self._base_url = base_url.rstrip("/")
        self._headers = {
            "Content-Type": "application/json",
            "X-HTTP-AUTH-TOKEN": token,
            "X-HTTP-AUTH-USER": user,
        }
        self._timeout = timeout

    @classmethod
    def try_from_config(
        cls, config: RunnableConfig | None
    ) -> tuple[SaasApiClient, dict[str, Any]] | None:
        """Build (client, session_context) from RunnableConfig, or None if auth/url missing."""
        configurable = (config or {}).get("configurable") or {}
        auth = configurable.get("auth_context") or {}
        token = auth.get("token")
        user = auth.get("user")
        base_url = get_settings().saas_api_url

        if not (token and user and base_url):
            logger.info(
                "saas_api unavailable: token=%s user=%s base_url=%s — using mock",
                bool(token), bool(user), bool(base_url),
            )
            return None

        return cls(base_url=base_url, token=token, user=user), (
            configurable.get("session_context") or {}
        )

    # -- Demo endpoints (task tracker) — replace with your product's --------

    async def get_workspace(
        self,
        tenant_id: str,
        workspace_id: int | str,
    ) -> dict[str, Any]:
        """Workspace snapshot: team members, projects, settings."""
        return await self._request(
            "GET",
            f"tenant/{tenant_id}/workspace/{workspace_id}",
        )

    async def create_task(
        self,
        tenant_id: str,
        workspace_id: int | str,
        body: dict[str, Any],
    ) -> dict[str, Any]:
        return await self._request(
            "POST",
            f"tenant/{tenant_id}/workspace/{workspace_id}/tasks",
            json=body,
        )

    async def get_project_summary(
        self,
        tenant_id: str,
        workspace_id: int | str,
        project_name: str,
    ) -> dict[str, Any]:
        return await self._request(
            "GET",
            f"tenant/{tenant_id}/workspace/{workspace_id}"
            f"/projects/{project_name}/summary",
        )

    # -- Plumbing ------------------------------------------------------------

    async def _request(
        self,
        method: str,
        path: str,
        *,
        json: dict[str, Any] | None = None,
        headers: dict[str, str] | None = None,
    ) -> dict[str, Any]:
        url = f"{self._base_url}/{path.lstrip('/')}"
        logger.info("saas_api_request: method=%s url=%s", method, url)
        merged_headers = {**self._headers, **(headers or {})}
        async with httpx.AsyncClient(timeout=self._timeout) as client:
            response = await client.request(method, url, headers=merged_headers, json=json)
        return self._unwrap(response)

    @staticmethod
    def _unwrap(response: httpx.Response) -> dict[str, Any]:
        """Parse the API's `{result, data}` envelope.

        Adapt this to your API's error convention. The important part is
        raising SaasApiError with a structured `payload` on 4xx so tools
        can distinguish "needs clarification" from a hard failure.
        """
        try:
            body = response.json()
        except ValueError:
            raise SaasApiError(
                f"Non-JSON response from SaaS API (HTTP {response.status_code})",
                status_code=response.status_code,
            ) from None

        result = body.get("result") or {}

        if response.status_code >= 400 or result.get("error"):
            raise SaasApiError(
                result.get("description")
                or result.get("errorMessage")
                or f"SaaS API error (HTTP {response.status_code})",
                status_code=response.status_code,
                error_code=result.get("errorCode"),
                payload=result.get("errorInfo") or body.get("data") or {},
            )

        return body.get("data") or {}
