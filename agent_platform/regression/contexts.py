"""Per-agent test-context discovery and building.

Convention: an agent folder may ship ``test_context.py`` exposing

    class ContextArgs(BaseModel): ...          # what the UI collects
    async def build_test_context(mode, args, client) -> dict | None

``mode`` is "mock" or "real". In real mode ``client`` is a SaasApiClient
authenticated as the user who triggered the run, so the builder can call the
platform's existing APIs to assemble a real session_context. In mock mode
``client`` is None and the builder returns the agent's fixture.

Missing module / invalid shape never crashes anything — the agent simply has
no context form and its tests run without a session_context.
"""

from __future__ import annotations

import asyncio
import importlib
import inspect
import logging
from typing import Any

from pydantic import BaseModel

from agent_platform.config import get_settings
from agent_platform.services.saas_api_client import SaasApiClient

logger = logging.getLogger(__name__)

_BUILD_TIMEOUT_S = 60


class ContextBuildError(Exception):
    """The agent's build_test_context failed — surfaces as a result error."""


def _load_module(agent_name: str) -> Any | None:
    """Import agent_platform.agents.<name>.test_context, tolerantly."""
    if not agent_name or agent_name.lower() == "router":
        return None
    module_path = f"agent_platform.agents.{agent_name}.test_context"
    try:
        return importlib.import_module(module_path)
    except ModuleNotFoundError:
        logger.info("test_context missing for agent=%s — no context presets", agent_name)
        return None
    except Exception:
        logger.warning("test_context import failed for agent=%s", agent_name, exc_info=True)
        return None


def _get_args_model(module: Any) -> type[BaseModel] | None:
    args_model = getattr(module, "ContextArgs", None)
    if inspect.isclass(args_model) and issubclass(args_model, BaseModel):
        return args_model
    return None


def validate_context_args(agent_name: str | None, args: dict[str, Any] | None) -> str | None:
    """Parse args against the agent's ContextArgs; returns an error string or None.

    Agents without a test_context.py accept anything (the args are unused).
    """
    module = _load_module(agent_name or "")
    args_model = _get_args_model(module) if module else None
    if args_model is None:
        return None
    try:
        args_model(**(args or {}))
        return None
    except Exception as e:
        return str(e)


def get_context_spec(agent_name: str | None) -> dict[str, Any] | None:
    """Return {"args_schema": ..., "defaults": ...} for the UI, or None."""
    module = _load_module(agent_name or "")
    if module is None:
        return None
    args_model = _get_args_model(module)
    builder = getattr(module, "build_test_context", None)
    if args_model is None or not callable(builder):
        logger.warning(
            "test_context for agent=%s missing ContextArgs or build_test_context — skipped",
            agent_name,
        )
        return None
    try:
        defaults = args_model().model_dump()
    except Exception:
        defaults = {}
    return {"args_schema": args_model.model_json_schema(), "defaults": defaults}


async def build_context(
    agent_name: str | None,
    mode: str,
    args: dict[str, Any] | None,
    auth_user: str | None,
    auth_token: str | None,
) -> dict[str, Any] | None:
    """Build the session_context for a test run via the agent's builder.

    Returns None when the agent has no test_context.py (test runs without a
    session_context). Raises ContextBuildError on any builder failure.
    """
    module = _load_module(agent_name or "")
    if module is None:
        return None
    args_model = _get_args_model(module)
    builder = getattr(module, "build_test_context", None)
    if args_model is None or not callable(builder):
        return None

    try:
        parsed_args = args_model(**(args or {}))
    except Exception as e:
        raise ContextBuildError(f"invalid context args for agent '{agent_name}': {e}") from e

    client: SaasApiClient | None = None
    if mode == "real":
        base_url = get_settings().saas_api_url
        if not (auth_token and auth_user and base_url):
            raise ContextBuildError(
                "real context mode needs saas_api_url and the triggering user's auth "
                f"(url={bool(base_url)}, user={bool(auth_user)}, token={bool(auth_token)})"
            )
        client = SaasApiClient(base_url=base_url, token=auth_token, user=auth_user)

    try:
        result = await asyncio.wait_for(
            builder(mode, parsed_args, client), timeout=_BUILD_TIMEOUT_S
        )
    except ContextBuildError:
        raise
    except TimeoutError as e:
        raise ContextBuildError(
            f"build_test_context for agent '{agent_name}' timed out after {_BUILD_TIMEOUT_S}s"
        ) from e
    except Exception as e:
        raise ContextBuildError(
            f"build_test_context for agent '{agent_name}' failed: {e}"
        ) from e

    if result is not None and not isinstance(result, dict):
        raise ContextBuildError(
            f"build_test_context for agent '{agent_name}' returned {type(result).__name__}, expected dict or None"
        )
    return result
