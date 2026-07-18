"""Agentic SaaS Starter FastAPI application."""

import asyncio
import logging
import pathlib
import sys
from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager

if sys.platform == "win32":
    # psycopg's async mode can't run on Windows' default ProactorEventLoop.
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

logging.basicConfig(
    level=logging.INFO,
    stream=sys.stdout,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s"
)

from fastapi import Depends, FastAPI, Request
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from agent_platform.agents.registry import discover_agents
from agent_platform.api.routes.chat import router as chat_router
from agent_platform.auth import assert_auth_configured, require_auth
from agent_platform.config import bootstrap_config, get_settings
from agent_platform.db.checkpointer import get_checkpointer
from agent_platform.db.engine import async_session_factory, engine
from agent_platform.db.models import Base
from agent_platform.graph.builder import build_graph
from agent_platform.tools.registry import discover_tools

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    bootstrap_config()

    settings = get_settings()
    logger.info("starting_up: host=%s port=%s", settings.server_host, settings.server_port)
    assert_auth_configured()

    if settings.is_dev:
        # Dev convenience: create observability tables so a fresh database
        # works immediately. Production applies MIGRATIONS.md explicitly.
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        logger.info("dev_schema_ready")

    async with get_checkpointer() as checkpointer:
        logger.info("checkpointer_ready")

        tool_registry = discover_tools()
        agent_registry = discover_agents()
        logger.info("registries_ready: tools=%d agents=%d", len(tool_registry.tools), len(agent_registry.agent_names))

        graph = build_graph(checkpointer, tool_registry, agent_registry)
        logger.info("graph_compiled")

        app.state.graph = graph
        app.state.checkpointer = checkpointer
        app.state.tool_registry = tool_registry
        app.state.agent_registry = agent_registry
        app.state.session_factory = async_session_factory

        yield

        logger.info("shutting_down")


app = FastAPI(
    title="Agentic SaaS Starter",
    description="Agent layer for an existing SaaS: LangGraph orchestration, SSE chat, observability, and agent evals.",
    version="0.1.0",
    lifespan=lifespan,
)


from agent_platform.api.routes.agents import router as agents_router
from agent_platform.api.routes.auth import router as auth_router
from agent_platform.api.routes.feedback import router as feedback_router
from agent_platform.api.routes.generate import router as generate_router
from agent_platform.api.routes.playground import router as playground_router
from agent_platform.api.routes.regression import router as regression_router
from agent_platform.api.routes.runs import router as runs_router
from agent_platform.api.routes.sessions import router as sessions_router
from agent_platform.api.routes.tenant.config import router as tenant_config_router
from agent_platform.api.routes.tools import router as tools_router

_api_deps = [Depends(require_auth)]

app.include_router(auth_router, prefix="/api")
app.include_router(chat_router, prefix="/api", dependencies=_api_deps)
app.include_router(sessions_router, prefix="/api", dependencies=_api_deps)
app.include_router(tools_router, prefix="/api", dependencies=_api_deps)
app.include_router(agents_router, prefix="/api", dependencies=_api_deps)
app.include_router(runs_router, prefix="/api", dependencies=_api_deps)
app.include_router(regression_router, prefix="/api", dependencies=_api_deps)
app.include_router(playground_router, prefix="/api", dependencies=_api_deps)
app.include_router(generate_router, prefix="/api", dependencies=_api_deps)
app.include_router(feedback_router, prefix="/api", dependencies=_api_deps)
app.include_router(tenant_config_router, prefix="/api", dependencies=_api_deps)


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


# --- Serve static frontend for debug UI ---
_FRONTEND_DIR = pathlib.Path.cwd() / "frontend" / "dist"

if not _FRONTEND_DIR.is_dir():
    _cwd = pathlib.Path.cwd()
    _cwd_contents = [p.name for p in _cwd.iterdir()]
    _parent = _FRONTEND_DIR.parent
    _parent_contents = [p.name for p in _parent.iterdir()] if _parent.is_dir() else []
    logger.warning(
        f"Frontend dist not found.\n"
        f"  cwd: {_cwd}\n"
        f"  cwd contents: {_cwd_contents}\n"
        f"  expected dist at: {_FRONTEND_DIR}\n"
        f"  frontend/ exists: {_parent.is_dir()}\n"
        f"  frontend/ contents: {_parent_contents}"
    )
else:
    app.mount("/assets", StaticFiles(directory=_FRONTEND_DIR / "assets"), name="frontend-assets")

    @app.get("/favicon.svg")
    async def favicon():
        return FileResponse(_FRONTEND_DIR / "favicon.svg")

    @app.get("/{full_path:path}")
    async def serve_spa(request: Request, full_path: str):
        """Catch-all: serve index.html for any non-API, non-health route (SPA client-side routing)."""
        return FileResponse(_FRONTEND_DIR / "index.html")
