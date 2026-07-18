"""Shared pytest plumbing.

Integration tests need real services (Postgres, an LLM key). Instead of
failing on a laptop without them, they self-skip with a clear reason —
`pytest` is green everywhere, and CI provisions Postgres so the
integration paths actually run there.
"""

from __future__ import annotations

import asyncio
import os
import sys

import psycopg
import pytest

from agent_platform.config import get_settings

if sys.platform == "win32":
    # psycopg's async mode can't run on Windows' default ProactorEventLoop.
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())


def _db_reachable(timeout: int = 2) -> bool:
    """True only if we can actually authenticate — a listening socket with
    wrong credentials (someone else's local Postgres) still means skip."""
    try:
        with psycopg.connect(get_settings().checkpoint_conn_string, connect_timeout=timeout):
            return True
    except Exception:
        return False


_DB_UP = _db_reachable()

requires_db = pytest.mark.skipif(
    not _DB_UP,
    reason="requires a reachable Postgres (set AGENT_DB / start `docker compose up db`)",
)

requires_llm_key = pytest.mark.skipif(
    not (os.getenv("OPENAI_API_KEY") or os.getenv("DEFAULT_LLM_BASE_URL")),
    reason="requires OPENAI_API_KEY or a local OpenAI-compatible endpoint",
)
