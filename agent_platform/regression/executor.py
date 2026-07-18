"""Regression run executor — drives scripted multi-turn tests through the graph.

A run executes (test, agent) units: every agent a test targets replays the
same scripted turns in its own fresh conversation (thread_id "regr-<uuid>"),
driven through the exact chat protocol (shared build_graph_input) and captured
from the exact event stream the browser sees (stream_graph_events).

Each test has ONE baseline shared by all its agents. Agents of the same test
run sequentially (in agent_types order) so that when no baseline exists the
first agent records it deterministically and the rest diff against it — that
head-to-head diff is what makes agent-vs-agent comparison possible. Later
runs diff structurally and judge text semantically against the same baseline.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import time
import uuid
from datetime import UTC, datetime
from typing import Any

from langchain_core.callbacks import AsyncCallbackHandler
from langchain_core.runnables import RunnableConfig
from pydantic import TypeAdapter
from sqlalchemy import func, select
from sqlalchemy import update as sa_update
from sqlalchemy.exc import IntegrityError, OperationalError
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from agent_platform.api.streaming import KEEPALIVE, build_graph_input, stream_graph_events
from agent_platform.config import get_settings
from agent_platform.db.models import RegressionBaseline, RegressionResult, RegressionRun, RegressionTest, Run
from agent_platform.observability.callback import ObservabilityCallbackHandler
from agent_platform.regression.contexts import ContextBuildError, build_context
from agent_platform.regression.differ import diff_snapshots, normalize_snapshot, text_pairs
from agent_platform.regression.judge import judge_turns
from agent_platform.regression.schemas import (
    ROUTER_AGENT,
    TestSnapshot,
    TurnSnapshot,
    TurnSpec,
    definition_hash,
)

logger = logging.getLogger(__name__)

# Checkpointer pool is maxsize=5 (db/checkpointer.py) — keep headroom.
_MAX_CONCURRENCY = 4
_TURN_TIMEOUT_S = 180
_MAX_AUTO_APPROVALS = 5

_TURNS_ADAPTER = TypeAdapter(list[TurnSpec])


class TurnScriptError(Exception):
    """The scripted turns don't match what the agent actually did.

    Carries the turns captured before the mismatch so the result can still
    persist a partial snapshot (the UI needs it to show what the agent did).
    """

    def __init__(self, message: str, snaps: list[TurnSnapshot] | None = None) -> None:
        super().__init__(message)
        self.snaps = snaps or []


class TestCancelled(Exception):
    """The run was cancelled while this test was in flight — result is 'skipped'."""


# Token-rejection signatures from saas-api / meta (auth.py + _unwrap messages).
_AUTH_FAIL_MARKERS = ("invalid token", "not authenticated", "token validation failed")


def _is_auth_failure(text: Any) -> bool:
    if not text:
        return False
    lowered = str(text).lower()
    return any(marker in lowered for marker in _AUTH_FAIL_MARKERS)


def _snapshot_auth_failure(turns: list[TurnSnapshot]) -> str | None:
    """Scan a real-mode snapshot for token-rejection signals; returns the offending text."""
    for turn in turns:
        if turn.error and _is_auth_failure(turn.error.get("message")):
            return str(turn.error.get("message"))
        for item in turn.items_completed or []:
            msg = item.get("message") if isinstance(item, dict) else None
            if _is_auth_failure(msg):
                return str(msg)
        for tr in turn.tool_results:
            if _is_auth_failure(tr.get("result")):
                return str(tr.get("result"))[:200]
    return None


class _ToolCallRecorder(AsyncCallbackHandler):
    """Records every executed tool call.

    Tools in this repo run imperatively (no model-emitted tool calls), so the
    SSE stream doesn't carry them — the callback layer is the ground truth,
    same approach as the legacy testing executor.
    """

    def __init__(self) -> None:
        self.calls: list[dict[str, Any]] = []

    async def on_tool_start(
        self,
        serialized: dict[str, Any],
        input_str: str,
        *,
        inputs: dict[str, Any] | None = None,
        **kwargs: Any,
    ) -> None:
        name = (serialized or {}).get("name") or ""
        args = inputs if isinstance(inputs, dict) else {"input": input_str}
        self.calls.append({"tool_name": name, "arguments": args})


_TOOL_RESULT_TRUNCATE = 2000


def _truncate_result(value: Any) -> str:
    s = value if isinstance(value, str) else str(value)
    if len(s) <= _TOOL_RESULT_TRUNCATE:
        return s
    return s[:_TOOL_RESULT_TRUNCATE] + f"... [truncated {len(s) - _TOOL_RESULT_TRUNCATE} chars]"


async def capture_turn(events: Any, *, turn_index: int, turn_input: dict[str, Any]) -> TurnSnapshot:
    """Fold one turn's SSEEvent stream (stream_graph_events) into a TurnSnapshot.

    This is the same event stream the browser sees, so capture is
    agent-agnostic by construction — whatever an agent emits lands in the
    snapshot verbatim. step/progress events are intentionally not snapshotted.
    """
    snap = TurnSnapshot(turn_index=turn_index, input=turn_input)
    text_parts: list[str] = []

    async for ev in events:
        if ev is KEEPALIVE:
            continue
        if snap.run_id is None and getattr(ev, "run_id", None):
            snap.run_id = ev.run_id
        data = ev.data if isinstance(ev.data, dict) else {}

        if ev.type == "router_decision":
            snap.router_decision = data.get("selected_agent")
        elif ev.type == "tool_call":
            snap.tool_calls.append(
                {"tool_name": data.get("tool_name"), "arguments": data.get("arguments")}
            )
        elif ev.type == "tool_result":
            snap.tool_results.append(
                {"tool_name": data.get("tool_name"), "result": _truncate_result(data.get("result"))}
            )
        elif ev.type == "plan":
            snap.plan = ev.data if isinstance(ev.data, dict) else {"value": ev.data}
        elif ev.type == "tool_clarification":
            snap.tool_clarification = data
        elif ev.type == "items_completed":
            snap.items_completed = data.get("items")
        elif ev.type == "text_delta":
            text_parts.append(str(data.get("content", "")))
        elif ev.type == "error":
            snap.error = data
        elif ev.type == "done":
            snap.awaiting_approval = bool(data.get("awaiting_approval"))

    snap.final_text = "".join(text_parts)
    return snap


def _now() -> datetime:
    return datetime.now(UTC)


def _context_hash(context: dict[str, Any] | None) -> str | None:
    if context is None:
        return None
    blob = json.dumps(context, sort_keys=True, default=str)
    return hashlib.sha256(blob.encode("utf-8")).hexdigest()


def _turn_to_chat_fields(turn: Any) -> tuple[str, str | None, list[dict] | None]:
    """Map a TurnSpec to (message, approval_action, modifications)."""
    if turn.type == "message":
        return turn.text, None, None
    if turn.type == "approve":
        return "", "approve", None
    if turn.type == "reject":
        return "", "reject", None
    if turn.type == "edit":
        return turn.text, "edit", None
    if turn.type == "clarification":
        response = turn.response
        mods = response if isinstance(response, list) else [response]
        return "", "clarification_response", mods
    raise TurnScriptError(f"unknown turn type: {turn.type!r}")


# ---------------------------------------------------------------------------
# Run orchestration
# ---------------------------------------------------------------------------


async def execute_regression_run(
    run_id: str,
    units: list[tuple[str, str]],
    graph: Any,
    session_factory: async_sessionmaker[AsyncSession],
    checkpointer: Any,
    auth_user: str | None,
    auth_token: str | None,
    mode: str,
    cancel_event: asyncio.Event | None = None,
) -> None:
    """Execute (test_id, agent_type) units; same-test agents run sequentially."""
    run_start = time.monotonic()
    cancelled = False

    try:
        async with session_factory() as session:
            run_row = await session.get(RegressionRun, run_id)
            if run_row:
                run_row.status = "running"
                await session.commit()

        sem = asyncio.Semaphore(_MAX_CONCURRENCY)
        # Auth circuit breaker: once one real-mode test hits a token rejection,
        # remaining real-mode tests are skipped instead of burning LLM cost on
        # runs that will fail (and would masquerade as regressions).
        auth_failed = asyncio.Event()

        # Group agents under their test, preserving order: tests run
        # concurrently, but a test's agents run one after another so the first
        # agent can record a missing baseline and the rest diff against it.
        agents_by_test: dict[str, list[str]] = {}
        for test_id, agent_type in units:
            agents_by_test.setdefault(test_id, []).append(agent_type)

        async def guarded(test_id: str, agent_types: list[str]) -> None:
            async with sem:
                for i, agent_type in enumerate(agent_types):
                    if (cancel_event and cancel_event.is_set()) or await _db_cancel_requested(
                        session_factory, run_id
                    ):
                        await _persist_result(
                            session_factory, run_id, test_id, agent_type,
                            status="skipped", error="run cancelled before this execution started",
                        )
                        continue
                    # Rebaseline re-records once per test (first agent only);
                    # the rest diff against the fresh baseline.
                    await _execute_single_test(
                        run_id, test_id, agent_type, graph, session_factory, checkpointer,
                        auth_user, auth_token, mode if i == 0 else "regression",
                        cancel_event, auth_failed,
                    )

        # create_task per test: each task copies the current context, so
        # per-test contextvars never leak into another test.
        tasks = [
            asyncio.create_task(guarded(tid, agents)) for tid, agents in agents_by_test.items()
        ]
        results = await asyncio.gather(*tasks, return_exceptions=True)
        for tid, res in zip(agents_by_test, results):
            if isinstance(res, Exception):
                logger.exception("regression_test_task_crashed: test_id=%s", tid, exc_info=res)

        cancelled = bool(cancel_event and cancel_event.is_set()) or await _db_cancel_requested(
            session_factory, run_id
        )

    except Exception:
        logger.exception("regression_run_crashed: run_id=%s", run_id)
    finally:
        total_duration = int((time.monotonic() - run_start) * 1000)
        try:
            async with session_factory() as session:
                run_row = await session.get(RegressionRun, run_id)
                if run_row:
                    run_row.status = "cancelled" if cancelled else "completed"
                    run_row.ended_at = _now()
                    run_row.duration_ms = total_duration
                    await session.commit()
        except Exception:
            logger.exception("regression_run_finalize_failed: run_id=%s", run_id)


async def _db_cancel_requested(
    session_factory: async_sessionmaker[AsyncSession], run_id: str
) -> bool:
    try:
        async with session_factory() as session:
            flag = await session.scalar(
                select(RegressionRun.cancel_requested).where(RegressionRun.id == run_id)
            )
        return bool(flag)
    except Exception:
        logger.exception("regression_cancel_check_failed: run_id=%s", run_id)
        return False


_STATUS_COUNTER = {
    "passed": RegressionRun.passed,
    "structural_diff": RegressionRun.failed,
    "text_diff": RegressionRun.failed,
    "error": RegressionRun.failed,
    "needs_review": RegressionRun.needs_review,
    "baseline_created": RegressionRun.baselines_created,
}


_DB_RETRIES = 3
# Postgres SQLSTATEs worth retrying: 40001 serialization_failure, 40P01 deadlock_detected.
_RETRYABLE_SQLSTATES = {"40001", "40P01"}


def _is_deadlock(exc: OperationalError) -> bool:
    orig = getattr(exc, "orig", None)
    return bool(orig and getattr(orig, "sqlstate", None) in _RETRYABLE_SQLSTATES)


async def _commit_with_retry(session_factory: async_sessionmaker[AsyncSession], work) -> None:
    """Run `work(session)` + commit, retrying on Postgres deadlock/serialization failures.

    Concurrent tests finishing at the same moment contend on the run-counter
    row; Postgres resolves that by aborting one transaction — retrying is the
    documented remedy.
    """
    for attempt in range(_DB_RETRIES):
        try:
            async with session_factory() as session:
                await work(session)
                await session.commit()
            return
        except OperationalError as e:
            if not _is_deadlock(e) or attempt == _DB_RETRIES - 1:
                raise
            await asyncio.sleep(0.1 * (attempt + 1))


async def _persist_result(
    session_factory: async_sessionmaker[AsyncSession],
    run_id: str,
    test_id: str,
    agent_type: str,
    *,
    status: str,
    baseline_id: str | None = None,
    snapshot: TestSnapshot | None = None,
    diff: list[dict[str, Any]] | None = None,
    judge: dict[str, Any] | None = None,
    error: str | None = None,
    mock_mode: bool = True,
    duration_ms: int | None = None,
) -> str:
    """Insert the result row, then bump the run counters.

    Two separate short transactions (insert, then counter update) so
    concurrent completions can't interleave their locks into a deadlock;
    each is retried on 1213 regardless.
    """
    result_id = str(uuid.uuid4())

    async def _insert(session: AsyncSession) -> None:
        session.add(
            RegressionResult(
                id=result_id,
                run_id=run_id,
                test_id=test_id,
                agent_type=agent_type,
                baseline_id=baseline_id,
                status=status,
                snapshot=snapshot.model_dump_json() if snapshot else None,
                diff=json.dumps(diff) if diff is not None else None,
                judge=json.dumps(judge) if judge is not None else None,
                error=error,
                mock_mode=mock_mode,
                duration_ms=duration_ms,
            )
        )

    values: dict[str, Any] = {"completed_tests": RegressionRun.completed_tests + 1}
    counter = _STATUS_COUNTER.get(status)
    if counter is not None:
        values[counter.key] = counter + 1

    async def _bump(session: AsyncSession) -> None:
        await session.execute(
            sa_update(RegressionRun).where(RegressionRun.id == run_id).values(**values)
        )

    await _commit_with_retry(session_factory, _insert)
    await _commit_with_retry(session_factory, _bump)
    return result_id


# ---------------------------------------------------------------------------
# Single test
# ---------------------------------------------------------------------------


async def _execute_single_test(
    run_id: str,
    test_id: str,
    agent_type: str,
    graph: Any,
    session_factory: async_sessionmaker[AsyncSession],
    checkpointer: Any,
    auth_user: str | None,
    auth_token: str | None,
    mode: str,
    cancel_event: asyncio.Event | None,
    auth_failed: asyncio.Event | None = None,
) -> None:
    test_start = time.monotonic()
    # The graph/context layers take None for "let the router LLM pick".
    graph_agent = None if agent_type == ROUTER_AGENT else agent_type

    async with session_factory() as session:
        test = await session.get(RegressionTest, test_id)
    if test is None:
        await _persist_result(
            session_factory, run_id, test_id, agent_type, status="error", error="test not found"
        )
        return

    if auth_failed and auth_failed.is_set() and test.context_mode == "real":
        await _persist_result(
            session_factory, run_id, test_id, agent_type, status="skipped",
            error="auth token was rejected earlier in this run — skipped to avoid more false failures",
        )
        return

    context_args = json.loads(test.context_args) if test.context_args else {}
    ignore_paths = json.loads(test.ignore_paths) if test.ignore_paths else []
    turns_raw = json.loads(test.turns)
    test_hash = definition_hash(
        test.context_mode, context_args, turns_raw, test.on_unexpected_interrupt
    )

    def _duration() -> int:
        return int((time.monotonic() - test_start) * 1000)

    # 1. Build the session context via the agent's test_context.py
    try:
        turns = _TURNS_ADAPTER.validate_python(turns_raw)
        session_context = await build_context(
            graph_agent, test.context_mode, context_args, auth_user, auth_token
        )
    except (ContextBuildError, Exception) as e:  # noqa: B014 — pydantic errors included
        logger.exception("regression_context_failed: test_id=%s agent=%s", test_id, agent_type)
        is_auth = test.context_mode == "real" and _is_auth_failure(str(e))
        if is_auth and auth_failed:
            auth_failed.set()
        await _persist_result(
            session_factory, run_id, test_id, agent_type,
            status="error",
            error=(
                f"auth: saas-api rejected the run's token (expired?) — {e}"
                if is_auth
                else f"context build failed: {e}"
            ),
            duration_ms=_duration(),
        )
        return

    # 2. Graph config — mirrors chat.py. auth_context only in real mode so
    #    mock tests deterministically hit every tool's mock branch.
    # thread_id columns are VARCHAR(36): "regr-" + 31 hex chars fits exactly.
    thread_id = f"regr-{uuid.uuid4().hex[:31]}"
    configurable: dict[str, Any] = {"thread_id": thread_id}
    if session_context:
        configurable["session_context"] = session_context
    is_real = test.context_mode == "real"
    if is_real:
        configurable["auth_context"] = {"user": auth_user, "token": auth_token}
    mock_mode = not (is_real and auth_token and auth_user and get_settings().saas_api_url)

    # 4. Drive the scripted turns
    def _make_snapshot(turn_snaps: list[TurnSnapshot]) -> TestSnapshot:
        return TestSnapshot(
            meta={
                "captured_at": _now().isoformat(),
                "agent_type": agent_type,
                "mock_mode": mock_mode,
                "context_mode": test.context_mode,
                "context_hash": _context_hash(session_context),
                "thread_id": thread_id,
            },
            turns=turn_snaps,
        )

    try:
        turn_snaps = await _run_turns(
            run_id=run_id,
            test=test,
            agent_type=agent_type,
            turns=turns,
            graph=graph,
            session_factory=session_factory,
            configurable=configurable,
            thread_id=thread_id,
            auth_user=auth_user,
            session_context=session_context,
            cancel_event=cancel_event,
        )
        snapshot = _make_snapshot(turn_snaps)
    except TestCancelled as e:
        await _persist_result(
            session_factory, run_id, test_id, agent_type,
            status="skipped", error=str(e), mock_mode=mock_mode, duration_ms=_duration(),
        )
        return
    except TurnScriptError as e:
        # Persist the turns that DID run so the UI can show the trace of what
        # the agent actually said (e.g. a clarifying question instead of a plan).
        await _persist_result(
            session_factory, run_id, test_id, agent_type,
            status="error", snapshot=_make_snapshot(e.snaps) if e.snaps else None,
            error=str(e), mock_mode=mock_mode, duration_ms=_duration(),
        )
        return
    except Exception as e:
        logger.exception("regression_test_failed: test_id=%s agent=%s", test_id, agent_type)
        await _persist_result(
            session_factory, run_id, test_id, agent_type,
            status="error", error=str(e), mock_mode=mock_mode, duration_ms=_duration(),
        )
        return
    finally:
        await _cleanup_thread(checkpointer, thread_id)

    # Real-mode token rejection mid-test must read as an auth error, not as a
    # behavioral regression (the failed items would otherwise diff red).
    if test.context_mode == "real":
        auth_msg = _snapshot_auth_failure(turn_snaps)
        if auth_msg is not None:
            if auth_failed:
                auth_failed.set()
            await _persist_result(
                session_factory, run_id, test_id, agent_type,
                status="error", snapshot=snapshot,
                error=f"auth: saas-api rejected the run's token mid-test (expired?) — {auth_msg}",
                mock_mode=mock_mode, duration_ms=_duration(),
            )
            return

    # A turn-level error event aborts the test as an error result.
    errored = next((t for t in turn_snaps if t.error), None)
    if errored is not None:
        await _persist_result(
            session_factory, run_id, test_id, agent_type,
            status="error", snapshot=snapshot,
            error=f"turn {errored.turn_index}: {(errored.error or {}).get('message', errored.error)}",
            mock_mode=mock_mode, duration_ms=_duration(),
        )
        return

    # 5. Baseline / diff / judge
    async with session_factory() as session:
        baseline = await session.scalar(
            select(RegressionBaseline).where(
                RegressionBaseline.test_id == test_id,
                RegressionBaseline.is_active.is_(True),
            )
        )

    needs_new_baseline = (
        mode == "rebaseline" or baseline is None or baseline.definition_hash != test_hash
    )
    if needs_new_baseline:
        new_baseline_id = await _create_baseline(
            session_factory, test_id, snapshot, test_hash, auth_user
        )
        if new_baseline_id is not None:
            await _persist_result(
                session_factory, run_id, test_id, agent_type,
                status="baseline_created", baseline_id=new_baseline_id,
                snapshot=snapshot, mock_mode=mock_mode, duration_ms=_duration(),
            )
            return
        # Lost the version race to a concurrent run — re-read and diff instead.
        async with session_factory() as session:
            baseline = await session.scalar(
                select(RegressionBaseline).where(
                    RegressionBaseline.test_id == test_id,
                    RegressionBaseline.is_active.is_(True),
                )
            )
        if baseline is None:
            await _persist_result(
                session_factory, run_id, test_id, agent_type,
                status="error", error="baseline creation raced and no active baseline exists",
                snapshot=snapshot, mock_mode=mock_mode, duration_ms=_duration(),
            )
            return

    assert baseline is not None  # guarded above: we return when no active baseline exists
    baseline_snapshot = TestSnapshot.model_validate_json(baseline.snapshot)
    diff = diff_snapshots(
        normalize_snapshot(baseline_snapshot.model_dump(), ignore_paths),
        normalize_snapshot(snapshot.model_dump(), ignore_paths),
    )
    if diff:
        await _persist_result(
            session_factory, run_id, test_id, agent_type,
            status="structural_diff", baseline_id=baseline.id,
            snapshot=snapshot, diff=diff, mock_mode=mock_mode, duration_ms=_duration(),
        )
        return

    pairs = text_pairs(baseline_snapshot.model_dump(), snapshot.model_dump())
    judge_report = None
    status = "passed"
    if pairs:
        report = await judge_turns(baseline_snapshot, snapshot, pairs)
        judge_report = report.model_dump()
        if any(v.equivalent is False for v in report.verdicts):
            status = "text_diff"
        elif any(v.equivalent is None for v in report.verdicts):
            status = "needs_review"

    await _persist_result(
        session_factory, run_id, test_id, agent_type,
        status=status, baseline_id=baseline.id,
        snapshot=snapshot, diff=[], judge=judge_report,
        mock_mode=mock_mode, duration_ms=_duration(),
    )


async def _create_baseline(
    session_factory: async_sessionmaker[AsyncSession],
    test_id: str,
    snapshot: TestSnapshot,
    test_hash: str,
    auth_user: str | None,
    source_result_id: str | None = None,
) -> str | None:
    """Insert a new active baseline version. Returns None if the version raced."""
    baseline_id = str(uuid.uuid4())
    try:
        async with session_factory() as session:
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
            session.add(
                RegressionBaseline(
                    id=baseline_id,
                    test_id=test_id,
                    version=(max_version or 0) + 1,
                    snapshot=snapshot.model_dump_json(),
                    definition_hash=test_hash,
                    source_result_id=source_result_id,
                    is_active=True,
                    promoted_by=auth_user,
                )
            )
            await session.commit()
        return baseline_id
    except IntegrityError:
        logger.warning("baseline_version_race: test_id=%s", test_id)
        return None


async def _cleanup_thread(checkpointer: Any, thread_id: str) -> None:
    """Best-effort removal of the test conversation's checkpoint rows."""
    try:
        if checkpointer is not None and hasattr(checkpointer, "adelete_thread"):
            await checkpointer.adelete_thread(thread_id)
    except Exception:
        logger.warning("regression_thread_cleanup_failed: thread_id=%s", thread_id, exc_info=True)


# ---------------------------------------------------------------------------
# Turn loop
# ---------------------------------------------------------------------------


async def _run_turns(
    *,
    run_id: str,
    test: RegressionTest,
    agent_type: str,
    turns: list[Any],
    graph: Any,
    session_factory: async_sessionmaker[AsyncSession],
    configurable: dict[str, Any],
    thread_id: str,
    auth_user: str | None,
    session_context: dict[str, Any] | None,
    cancel_event: asyncio.Event | None,
) -> list[TurnSnapshot]:
    snaps: list[TurnSnapshot] = []
    awaiting = False  # is the thread interrupted right now?
    pending_is_clarification = False

    async def _invoke(turn_index: int, turn_input: dict[str, Any],
                      message: str, action: str | None, mods: list[dict] | None) -> TurnSnapshot:
        input_val, is_resume = build_graph_input(
            message=message,
            agent_type=None if agent_type == ROUTER_AGENT else agent_type,
            approval_action=action,
            modifications=mods,
        )
        run_metadata = {
            "source": "regression",
            "regression_run_id": run_id,
            "regression_test_id": test.id,
            "regression_agent_type": agent_type,
        }
        if session_context:
            run_metadata.update({
                "tenant_id": session_context.get("tenant_id") or "",
                "workspace_id": session_context.get("workspace_id") or "",
            })
        obs = ObservabilityCallbackHandler(
            session_factory, thread_id, user_id=auth_user, run_metadata=run_metadata
        )
        recorder = _ToolCallRecorder()
        config: RunnableConfig = {"configurable": configurable, "callbacks": [obs, recorder]}

        if is_resume:
            # Mirror chat.py: resolve this thread's pending_approval runs.
            status_map = {"approve": "approved", "reject": "rejected", "edit": "edited"}
            resolved = status_map.get(action or "", "approved")
            async with session_factory() as session:
                await session.execute(
                    sa_update(Run)
                    .where(Run.thread_id == thread_id)
                    .where(Run.status == "pending_approval")
                    .values(status=resolved, ended_at=_now())
                )
                await session.commit()
        else:
            await obs.write_conversation_message("user", message)

        turn_start = time.monotonic()
        try:
            snap = await asyncio.wait_for(
                capture_turn(
                    stream_graph_events(
                        graph=graph,
                        input_val=input_val,
                        config=config,
                        callback_handler=obs,
                        is_approval_resume=is_resume,
                        session_id=thread_id,
                    ),
                    turn_index=turn_index,
                    turn_input=turn_input,
                ),
                timeout=_TURN_TIMEOUT_S,
            )
        except TimeoutError:
            snap = TurnSnapshot(
                turn_index=turn_index,
                input=turn_input,
                error={"error_type": "Timeout", "message": f"turn timed out after {_TURN_TIMEOUT_S}s"},
            )
        # Imperative tool executions only surface via callbacks; prefer that
        # ground truth over message-derived calls when present.
        if recorder.calls:
            snap.tool_calls = recorder.calls
        snap.duration_ms = int((time.monotonic() - turn_start) * 1000)
        return snap

    try:
        for i, turn in enumerate(turns):
            if (cancel_event and cancel_event.is_set()) or await _db_cancel_requested(session_factory, run_id):
                raise TestCancelled(f"run cancelled before turn {i + 1}")

            is_resume_turn = turn.type in ("approve", "reject", "edit", "clarification")
            if is_resume_turn and not awaiting:
                raise TurnScriptError(
                    f"turn {i} ({turn.type}): expected a pending interrupt but the agent had completed"
                )
            if turn.type == "message" and awaiting:
                # Unexpected interrupt sits between the previous turn and this message.
                if test.on_unexpected_interrupt != "auto_approve" or pending_is_clarification:
                    kind = "clarification" if pending_is_clarification else "plan approval"
                    raise TurnScriptError(
                        f"turn {i}: unexpected {kind} interrupt before this message "
                        f"(policy: {test.on_unexpected_interrupt})"
                    )
                approvals = 0
                while awaiting and approvals < _MAX_AUTO_APPROVALS:
                    approvals += 1
                    auto_snap = await _invoke(
                        len(snaps), {"type": "auto_approve"}, "", "approve", None
                    )
                    snaps.append(auto_snap)
                    awaiting = auto_snap.awaiting_approval
                    pending_is_clarification = auto_snap.tool_clarification is not None
                    if auto_snap.error:
                        return snaps
                    if awaiting and pending_is_clarification:
                        raise TurnScriptError(
                            f"auto-approve hit a clarification interrupt before turn {i} — cannot auto-answer"
                        )
                if awaiting:
                    raise TurnScriptError(
                        f"still awaiting approval after {_MAX_AUTO_APPROVALS} auto-approvals before turn {i}"
                    )

            message, action, mods = _turn_to_chat_fields(turn)
            snap = await _invoke(len(snaps), turn.model_dump(), message, action, mods)
            snaps.append(snap)
            awaiting = snap.awaiting_approval
            pending_is_clarification = snap.tool_clarification is not None
            if snap.error:
                break
    except TurnScriptError as e:
        # Keep what the agent actually did so the result can show a trace.
        e.snaps = snaps
        raise

    # Ending on awaiting_approval=True is valid (plan-only tests).
    return snaps
