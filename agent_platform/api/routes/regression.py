"""Regression testing (Tests Beta) API routes.

CRUD for scripted multi-turn tests, baseline management, and run execution.
All endpoints live under /api/regression/*.
"""

from __future__ import annotations

import asyncio
import json
import logging
import uuid
from typing import Any, cast

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy import delete, func, select
from sqlalchemy import update as sa_update
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from agent_platform.agents.registry import AgentRegistry
from agent_platform.api.dependencies import (
    Graph,
    get_agent_registry,
    get_checkpointer_dep,
    get_graph,
    get_session_factory,
)
from agent_platform.auth import _get_user_and_token
from agent_platform.config import get_settings
from agent_platform.db.models import (
    RegressionBaseline,
    RegressionResult,
    RegressionRun,
    RegressionTest,
)
from agent_platform.regression.contexts import get_context_spec, validate_context_args
from agent_platform.regression.executor import execute_regression_run
from agent_platform.regression.schemas import (
    ROUTER_AGENT,
    AgentTestState,
    BaselineInfo,
    BaselineResponse,
    ContextSpec,
    LastResultSummary,
    PromoteRequest,
    PromoteResponse,
    RegressionAgentInfo,
    RegressionResultResponse,
    RegressionRunDetail,
    RegressionRunListResponse,
    RegressionRunRequest,
    RegressionRunSummary,
    RegressionTestCreate,
    RegressionTestListResponse,
    RegressionTestResponse,
    RegressionTestUpdate,
    definition_hash,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/regression", tags=["regression"])

# Track running regression tasks so the local worker can cancel promptly;
# the DB cancel_requested flag covers the cross-worker case.
_running_tasks: dict[str, asyncio.Task] = {}
_cancel_signals: dict[str, asyncio.Event] = {}


def _log_task_exception(task: asyncio.Task) -> None:
    if not task.cancelled() and task.exception():
        logger.error("regression_task_failed: error=%s", str(task.exception()))


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _validate_definition(
    body: RegressionTestCreate, agent_registry: AgentRegistry
) -> None:
    for agent in body.agent_types:
        if agent != ROUTER_AGENT and agent_registry.get_description(agent) is None:
            raise HTTPException(status_code=400, detail=f"unknown agent_type '{agent}'")
    if body.turns[0].type != "message":
        raise HTTPException(status_code=400, detail="the first turn must be a 'message' turn")
    if body.context_mode == "real":
        without_context = [a for a in body.agent_types if get_context_spec(a) is None]
        if without_context:
            raise HTTPException(
                status_code=400,
                detail=(
                    f"real context mode unavailable: no test_context.py for "
                    f"{', '.join(repr(a) for a in without_context)}"
                ),
            )
    for agent in body.agent_types:
        args_error = validate_context_args(agent, body.context_args)
        if args_error:
            raise HTTPException(
                status_code=400, detail=f"invalid context_args for agent '{agent}': {args_error}"
            )


def _row_hash(test: RegressionTest) -> str:
    return definition_hash(
        test.context_mode,
        json.loads(test.context_args) if test.context_args else {},
        json.loads(test.turns),
        test.on_unexpected_interrupt,
    )


def _row_agents(test: RegressionTest) -> list[str]:
    return json.loads(test.agent_types) if test.agent_types else [ROUTER_AGENT]


def _last_result_summary(result: RegressionResult | None) -> LastResultSummary | None:
    if result is None:
        return None
    return LastResultSummary(
        run_id=result.run_id,
        result_id=result.id,
        status=result.status,
        created_at=result.created_at,
    )


def _test_to_response(
    test: RegressionTest,
    baseline: RegressionBaseline | None = None,
    last_results: dict[str, RegressionResult] | None = None,
) -> RegressionTestResponse:
    agent_types = _row_agents(test)
    return RegressionTestResponse(
        id=test.id,
        name=test.name,
        description=test.description,
        tags=json.loads(test.tags) if test.tags else [],
        agent_types=agent_types,
        context_mode=test.context_mode,
        context_args=json.loads(test.context_args) if test.context_args else {},
        turns=json.loads(test.turns),
        on_unexpected_interrupt=test.on_unexpected_interrupt,
        ignore_paths=json.loads(test.ignore_paths) if test.ignore_paths else [],
        definition_hash=test.definition_hash,
        baseline_version=baseline.version if baseline else None,
        baseline_stale=bool(baseline and baseline.definition_hash != test.definition_hash),
        agents=[
            AgentTestState(
                agent_type=agent,
                last_result=_last_result_summary((last_results or {}).get(agent)),
            )
            for agent in agent_types
        ],
        created_by=test.created_by,
        created_at=test.created_at,
        updated_at=test.updated_at,
    )


def _result_to_response(result: RegressionResult, test_name: str, test_tags: list[str]) -> RegressionResultResponse:
    return RegressionResultResponse(
        id=result.id,
        run_id=result.run_id,
        test_id=result.test_id,
        test_name=test_name,
        test_tags=test_tags,
        agent_type=result.agent_type,
        baseline_id=result.baseline_id,
        status=result.status,
        snapshot=json.loads(result.snapshot) if result.snapshot else None,
        diff=json.loads(result.diff) if result.diff else [],
        judge=json.loads(result.judge) if result.judge else None,
        error=result.error,
        mock_mode=result.mock_mode,
        duration_ms=result.duration_ms,
        created_at=result.created_at,
    )


def _run_to_summary(run: RegressionRun) -> RegressionRunSummary:
    return RegressionRunSummary(
        id=run.id,
        status=run.status,
        mode=run.mode,
        agent_type=run.agent_type,
        total_tests=run.total_tests,
        completed_tests=run.completed_tests,
        passed=run.passed,
        failed=run.failed,
        needs_review=run.needs_review,
        baselines_created=run.baselines_created,
        triggered_by=run.triggered_by,
        started_at=run.started_at,
        ended_at=run.ended_at,
        duration_ms=run.duration_ms,
    )


async def _active_baselines(
    session: AsyncSession, test_ids: list[str]
) -> dict[str, RegressionBaseline]:
    if not test_ids:
        return {}
    rows = (
        await session.execute(
            select(RegressionBaseline).where(
                RegressionBaseline.test_id.in_(test_ids),
                RegressionBaseline.is_active.is_(True),
            )
        )
    ).scalars().all()
    return {b.test_id: b for b in rows}


async def _last_results(
    session: AsyncSession, test_ids: list[str]
) -> dict[str, dict[str, RegressionResult]]:
    """Latest result per (test, agent): {test_id: {agent_type: result}}."""
    if not test_ids:
        return {}
    rows = (
        await session.execute(
            select(RegressionResult)
            .where(RegressionResult.test_id.in_(test_ids))
            .order_by(RegressionResult.created_at.desc(), RegressionResult.id.desc())
        )
    ).scalars().all()
    latest: dict[str, dict[str, RegressionResult]] = {}
    for r in rows:
        latest.setdefault(r.test_id, {}).setdefault(r.agent_type, r)
    return latest


# ---------------------------------------------------------------------------
# Agents + contexts (drives the editor's agent dropdown and context form)
# ---------------------------------------------------------------------------


@router.get("/agents", response_model=list[RegressionAgentInfo])
async def list_regression_agents(
    agent_registry: AgentRegistry = Depends(get_agent_registry),
) -> list[RegressionAgentInfo]:
    out: list[RegressionAgentInfo] = []
    for desc in agent_registry.get_all_descriptions():
        name = desc.get("name", "unknown")
        spec = get_context_spec(name)
        out.append(
            RegressionAgentInfo(
                name=name,
                description=desc.get("description", ""),
                context=ContextSpec(**spec) if spec else None,
            )
        )
    return out


# ---------------------------------------------------------------------------
# Test CRUD
# ---------------------------------------------------------------------------


@router.post("/tests", response_model=RegressionTestResponse, status_code=201)
async def create_test(
    body: RegressionTestCreate,
    request: Request,
    session_factory: async_sessionmaker[AsyncSession] = Depends(get_session_factory),
    agent_registry: AgentRegistry = Depends(get_agent_registry),
) -> RegressionTestResponse:
    _validate_definition(body, agent_registry)
    auth_user, _ = _get_user_and_token(request)
    turns_raw = [t.model_dump() for t in body.turns]
    test = RegressionTest(
        id=str(uuid.uuid4()),
        name=body.name,
        description=body.description,
        tags=json.dumps(body.tags),
        agent_types=json.dumps(body.agent_types),
        context_mode=body.context_mode,
        context_args=json.dumps(body.context_args),
        turns=json.dumps(turns_raw),
        on_unexpected_interrupt=body.on_unexpected_interrupt,
        ignore_paths=json.dumps(body.ignore_paths),
        definition_hash=definition_hash(
            body.context_mode, body.context_args, turns_raw, body.on_unexpected_interrupt
        ),
        created_by=auth_user,
    )
    async with session_factory() as session:
        session.add(test)
        await session.commit()
        await session.refresh(test)
    return _test_to_response(test)


@router.get("/tests", response_model=RegressionTestListResponse)
async def list_tests(
    tag: str | None = Query(default=None),
    search: str | None = Query(default=None),
    limit: int = Query(default=1000, le=10000),
    offset: int = Query(default=0, ge=0),
    session_factory: async_sessionmaker[AsyncSession] = Depends(get_session_factory),
) -> RegressionTestListResponse:
    stmt = select(RegressionTest).order_by(RegressionTest.created_at.desc())
    if tag:
        stmt = stmt.where(RegressionTest.tags.contains(f'"{tag}"'))
    if search:
        pattern = f"%{search}%"
        stmt = stmt.where(
            RegressionTest.name.ilike(pattern) | RegressionTest.description.ilike(pattern)
        )
    count_stmt = select(func.count()).select_from(stmt.subquery())
    async with session_factory() as session:
        total = (await session.execute(count_stmt)).scalar() or 0
        rows = (await session.execute(stmt.offset(offset).limit(limit))).scalars().all()
        ids = [t.id for t in rows]
        baselines = await _active_baselines(session, ids)
        last = await _last_results(session, ids)
    return RegressionTestListResponse(
        tests=[_test_to_response(t, baselines.get(t.id), last.get(t.id)) for t in rows],
        total=total,
    )


@router.get("/tests/{test_id}", response_model=RegressionTestResponse)
async def get_test(
    test_id: str,
    session_factory: async_sessionmaker[AsyncSession] = Depends(get_session_factory),
) -> RegressionTestResponse:
    async with session_factory() as session:
        test = await session.get(RegressionTest, test_id)
        if test is None:
            raise HTTPException(status_code=404, detail="Test not found")
        baselines = await _active_baselines(session, [test_id])
        last = await _last_results(session, [test_id])
    return _test_to_response(test, baselines.get(test_id), last.get(test_id))


@router.put("/tests/{test_id}", response_model=RegressionTestResponse)
async def update_test(
    test_id: str,
    body: RegressionTestUpdate,
    session_factory: async_sessionmaker[AsyncSession] = Depends(get_session_factory),
    agent_registry: AgentRegistry = Depends(get_agent_registry),
) -> RegressionTestResponse:
    async with session_factory() as session:
        test = await session.get(RegressionTest, test_id)
        if test is None:
            raise HTTPException(status_code=404, detail="Test not found")

        if body.name is not None:
            test.name = body.name
        if body.description is not None:
            test.description = body.description
        if body.tags is not None:
            test.tags = json.dumps(body.tags)
        if body.agent_types is not None:
            test.agent_types = json.dumps(body.agent_types)
        if body.context_mode is not None:
            test.context_mode = body.context_mode
        if body.context_args is not None:
            test.context_args = json.dumps(body.context_args)
        if body.turns is not None:
            test.turns = json.dumps([t.model_dump() for t in body.turns])
        if body.on_unexpected_interrupt is not None:
            test.on_unexpected_interrupt = body.on_unexpected_interrupt
        if body.ignore_paths is not None:
            test.ignore_paths = json.dumps(body.ignore_paths)

        # Re-validate the merged definition and recompute the hash.
        merged = RegressionTestCreate(
            name=test.name,
            description=test.description,
            tags=json.loads(test.tags) if test.tags else [],
            agent_types=_row_agents(test),
            context_mode=cast(Any, test.context_mode),
            context_args=json.loads(test.context_args) if test.context_args else {},
            turns=json.loads(test.turns),
            on_unexpected_interrupt=cast(Any, test.on_unexpected_interrupt),
            ignore_paths=json.loads(test.ignore_paths) if test.ignore_paths else [],
        )
        _validate_definition(merged, agent_registry)
        test.definition_hash = _row_hash(test)

        await session.commit()
        await session.refresh(test)
        baselines = await _active_baselines(session, [test_id])
        last = await _last_results(session, [test_id])
    return _test_to_response(test, baselines.get(test_id), last.get(test_id))


@router.post("/tests/{test_id}/clone", response_model=RegressionTestResponse, status_code=201)
async def clone_test(
    test_id: str,
    request: Request,
    session_factory: async_sessionmaker[AsyncSession] = Depends(get_session_factory),
) -> RegressionTestResponse:
    """Duplicate a test's definition. Baselines/results stay with the original;
    the clone records its own baseline on its first run."""
    auth_user, _ = _get_user_and_token(request)
    async with session_factory() as session:
        src = await session.get(RegressionTest, test_id)
        if src is None:
            raise HTTPException(status_code=404, detail="Test not found")
        clone = RegressionTest(
            id=str(uuid.uuid4()),
            name=f"{src.name} (copy)",
            description=src.description,
            tags=src.tags,
            agent_types=src.agent_types,
            context_mode=src.context_mode,
            context_args=src.context_args,
            turns=src.turns,
            on_unexpected_interrupt=src.on_unexpected_interrupt,
            ignore_paths=src.ignore_paths,
            definition_hash=src.definition_hash,
            created_by=auth_user,
        )
        session.add(clone)
        await session.commit()
        await session.refresh(clone)
    return _test_to_response(clone)


@router.delete("/tests/{test_id}", status_code=204)
async def delete_test(
    test_id: str,
    session_factory: async_sessionmaker[AsyncSession] = Depends(get_session_factory),
) -> None:
    async with session_factory() as session:
        test = await session.get(RegressionTest, test_id)
        if test is None:
            raise HTTPException(status_code=404, detail="Test not found")
        await session.execute(delete(RegressionResult).where(RegressionResult.test_id == test_id))
        await session.execute(delete(RegressionBaseline).where(RegressionBaseline.test_id == test_id))
        await session.execute(delete(RegressionTest).where(RegressionTest.id == test_id))
        await session.commit()


# ---------------------------------------------------------------------------
# Baselines
# ---------------------------------------------------------------------------


@router.get("/tests/{test_id}/baseline", response_model=BaselineResponse)
async def get_baseline(
    test_id: str,
    session_factory: async_sessionmaker[AsyncSession] = Depends(get_session_factory),
) -> BaselineResponse:
    async with session_factory() as session:
        rows = (
            await session.execute(
                select(RegressionBaseline)
                .where(RegressionBaseline.test_id == test_id)
                .order_by(RegressionBaseline.version.desc())
            )
        ).scalars().all()
    versions = [
        BaselineInfo(
            id=b.id, version=b.version, definition_hash=b.definition_hash,
            source_result_id=b.source_result_id, is_active=b.is_active,
            promoted_by=b.promoted_by, promoted_at=b.promoted_at,
        )
        for b in rows
    ]
    active = next((b for b in rows if b.is_active), None)
    active_payload = None
    if active is not None:
        active_payload = {
            "id": active.id,
            "version": active.version,
            "definition_hash": active.definition_hash,
            "promoted_by": active.promoted_by,
            "promoted_at": active.promoted_at.isoformat(),
            "snapshot": json.loads(active.snapshot),
        }
    return BaselineResponse(baseline=active_payload, versions=versions)


@router.get("/baselines/{baseline_id}")
async def get_baseline_by_id(
    baseline_id: str,
    session_factory: async_sessionmaker[AsyncSession] = Depends(get_session_factory),
) -> dict[str, Any]:
    """Fetch one baseline version with its snapshot — lets the UI show the
    exact conversation a result was diffed against (not just the active one)."""
    async with session_factory() as session:
        b = await session.get(RegressionBaseline, baseline_id)
    if b is None:
        raise HTTPException(status_code=404, detail="Baseline not found")
    return {
        "id": b.id,
        "test_id": b.test_id,
        "version": b.version,
        "definition_hash": b.definition_hash,
        "is_active": b.is_active,
        "promoted_by": b.promoted_by,
        "promoted_at": b.promoted_at.isoformat(),
        "snapshot": json.loads(b.snapshot),
    }


@router.delete("/tests/{test_id}/baseline", status_code=204)
async def deactivate_baselines(
    test_id: str,
    session_factory: async_sessionmaker[AsyncSession] = Depends(get_session_factory),
) -> None:
    """Deactivate all baselines — the next run records a fresh one."""
    async with session_factory() as session:
        await session.execute(
            sa_update(RegressionBaseline)
            .where(RegressionBaseline.test_id == test_id)
            .values(is_active=False)
        )
        await session.commit()


@router.post("/tests/{test_id}/promote", response_model=PromoteResponse)
async def promote_result(
    test_id: str,
    body: PromoteRequest,
    request: Request,
    session_factory: async_sessionmaker[AsyncSession] = Depends(get_session_factory),
) -> PromoteResponse:
    """Copy a result's snapshot into a new active baseline version."""
    auth_user, _ = _get_user_and_token(request)
    async with session_factory() as session:
        test = await session.get(RegressionTest, test_id)
        if test is None:
            raise HTTPException(status_code=404, detail="Test not found")
        result = await session.get(RegressionResult, body.result_id)
        if result is None or result.test_id != test_id:
            raise HTTPException(status_code=404, detail="Result not found for this test")
        if not result.snapshot or result.status == "error":
            raise HTTPException(status_code=409, detail="Result has no usable snapshot to promote")

        max_version = await session.scalar(
            select(func.max(RegressionBaseline.version)).where(
                RegressionBaseline.test_id == test_id
            )
        )
        await session.execute(
            sa_update(RegressionBaseline)
            .where(RegressionBaseline.test_id == test_id)
            .values(is_active=False)
        )
        baseline = RegressionBaseline(
            id=str(uuid.uuid4()),
            test_id=test_id,
            version=(max_version or 0) + 1,
            snapshot=result.snapshot,
            definition_hash=test.definition_hash,
            source_result_id=result.id,
            is_active=True,
            promoted_by=auth_user,
        )
        session.add(baseline)
        await session.commit()
    return PromoteResponse(baseline_id=baseline.id, version=baseline.version)


# ---------------------------------------------------------------------------
# Runs
# ---------------------------------------------------------------------------


@router.post("/runs", response_model=RegressionRunSummary, status_code=201)
async def start_run(
    body: RegressionRunRequest,
    request: Request,
    graph: Graph = Depends(get_graph),
    session_factory: async_sessionmaker[AsyncSession] = Depends(get_session_factory),
    checkpointer: Any = Depends(get_checkpointer_dep),
) -> RegressionRunSummary:
    """Start a regression run in the background.

    auth_mode='user': real-context tests hit saas-api as the triggering
    user (session token — can expire mid-run). auth_mode='service': they run
    as the platform service account (application_token + service_account_user, a
    permanent machine credential — right choice for huge suites).
    """
    auth_user: str | None
    auth_token: str | None
    if body.auth_mode == "service":
        settings = get_settings()
        if not (settings.application_token and settings.service_account_user):
            raise HTTPException(
                status_code=400,
                detail=(
                    "service auth_mode needs APPLICATION_TOKEN and SERVICE_ACCOUNT_USER "
                    "configured in the environment"
                ),
            )
        auth_user, auth_token = settings.service_account_user, settings.application_token
    else:
        auth_user, auth_token = _get_user_and_token(request)
    # Attribution always names the human who clicked, even on service-auth runs.
    requester, _ = _get_user_and_token(request)

    scope = (body.agent_type or "").strip() or None
    if scope and scope.lower() == ROUTER_AGENT:
        scope = ROUTER_AGENT

    async with session_factory() as session:
        stmt = select(RegressionTest.id, RegressionTest.agent_types)
        if body.test_ids:
            stmt = stmt.where(RegressionTest.id.in_(body.test_ids))
        else:
            stmt = stmt.order_by(RegressionTest.created_at.asc())
        rows = (await session.execute(stmt)).all()
    if body.test_ids:
        missing = set(body.test_ids) - {r[0] for r in rows}
        if missing:
            raise HTTPException(status_code=404, detail=f"Tests not found: {', '.join(missing)}")
        order = {tid: i for i, tid in enumerate(body.test_ids)}
        rows = sorted(rows, key=lambda r: order[r[0]])
    if not rows:
        raise HTTPException(status_code=400, detail="No tests to run")

    # One execution unit per (test, agent); a scope runs only that agent and
    # drops tests that don't target it.
    units: list[tuple[str, str]] = []
    for test_id, agents_json in rows:
        agents = json.loads(agents_json) if agents_json else [ROUTER_AGENT]
        if scope is not None:
            if scope in agents:
                units.append((test_id, scope))
        else:
            units.extend((test_id, agent) for agent in agents)
    if not units:
        raise HTTPException(status_code=400, detail=f"No selected test targets agent '{scope}'")

    run_id = str(uuid.uuid4())
    run = RegressionRun(
        id=run_id, status="pending", mode=body.mode, agent_type=scope,
        total_tests=len(units), triggered_by=requester or auth_user,
    )
    async with session_factory() as session:
        session.add(run)
        await session.commit()
        await session.refresh(run)

    cancel_event = asyncio.Event()
    _cancel_signals[run_id] = cancel_event
    task = asyncio.create_task(
        execute_regression_run(
            run_id, units, graph, session_factory, checkpointer,
            auth_user, auth_token, body.mode, cancel_event,
        )
    )
    _running_tasks[run_id] = task
    task.add_done_callback(_log_task_exception)
    task.add_done_callback(lambda _: _running_tasks.pop(run_id, None))
    task.add_done_callback(lambda _: _cancel_signals.pop(run_id, None))

    return _run_to_summary(run)


@router.get("/runs", response_model=RegressionRunListResponse)
async def list_runs(
    limit: int = Query(default=50, le=200),
    offset: int = Query(default=0, ge=0),
    session_factory: async_sessionmaker[AsyncSession] = Depends(get_session_factory),
) -> RegressionRunListResponse:
    stmt = select(RegressionRun).order_by(RegressionRun.started_at.desc())
    count_stmt = select(func.count()).select_from(stmt.subquery())
    async with session_factory() as session:
        total = (await session.execute(count_stmt)).scalar() or 0
        rows = (await session.execute(stmt.offset(offset).limit(limit))).scalars().all()
    return RegressionRunListResponse(runs=[_run_to_summary(r) for r in rows], total=total)


@router.get("/runs/{run_id}", response_model=RegressionRunDetail)
async def get_run(
    run_id: str,
    session_factory: async_sessionmaker[AsyncSession] = Depends(get_session_factory),
) -> RegressionRunDetail:
    async with session_factory() as session:
        run = await session.get(RegressionRun, run_id)
        if run is None:
            raise HTTPException(status_code=404, detail="Run not found")
        results = (
            await session.execute(
                select(RegressionResult)
                .where(RegressionResult.run_id == run_id)
                .order_by(RegressionResult.created_at.asc())
            )
        ).scalars().all()
        test_ids = [r.test_id for r in results]
        tests = {}
        if test_ids:
            rows = (
                await session.execute(
                    select(RegressionTest.id, RegressionTest.name, RegressionTest.tags).where(
                        RegressionTest.id.in_(test_ids)
                    )
                )
            ).all()
            tests = {t[0]: (t[1], json.loads(t[2]) if t[2] else []) for t in rows}

    summary = _run_to_summary(run)
    return RegressionRunDetail(
        **summary.model_dump(),
        results=[
            _result_to_response(r, *tests.get(r.test_id, ("Unknown", [])))
            for r in results
        ],
    )


@router.post("/runs/{run_id}/cancel")
async def cancel_run(
    run_id: str,
    session_factory: async_sessionmaker[AsyncSession] = Depends(get_session_factory),
) -> dict[str, str]:
    async with session_factory() as session:
        run = await session.get(RegressionRun, run_id)
        if run is None:
            raise HTTPException(status_code=404, detail="Run not found")
        if run.status in ("completed", "cancelled", "error"):
            return {"status": run.status, "message": "Run already finished"}
        run.cancel_requested = True
        await session.commit()

    cancel_event = _cancel_signals.get(run_id)
    if cancel_event is not None:
        cancel_event.set()
        return {"status": "cancelling", "message": "Run will stop after in-flight tests finish"}
    return {"status": "cancelling", "message": "Cancel flag set; the running worker will pick it up"}
