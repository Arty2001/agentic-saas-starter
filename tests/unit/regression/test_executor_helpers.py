"""Unit tests for the eval executor's pure plumbing (no DB, no LLM)."""

from agent_platform.api.schemas import SSEEvent
from agent_platform.regression.executor import (
    _context_hash,
    _is_auth_failure,
    _truncate_result,
    _turn_to_chat_fields,
    capture_turn,
)
from agent_platform.regression.schemas import (
    ApproveTurn,
    ClarificationTurn,
    MessageTurn,
    RejectTurn,
)


class TestTurnToChatFields:
    def test_message_turn(self) -> None:
        turn = MessageTurn(type="message", text="hello")
        assert _turn_to_chat_fields(turn) == ("hello", None, None)

    def test_approve_and_reject_turns(self) -> None:
        assert _turn_to_chat_fields(ApproveTurn(type="approve")) == ("", "approve", None)
        assert _turn_to_chat_fields(RejectTurn(type="reject")) == ("", "reject", None)

    def test_clarification_turn_wraps_single_answer(self) -> None:
        turn = ClarificationTurn(type="clarification", response={"assigneeName": "Sam Torres"})
        message, action, mods = _turn_to_chat_fields(turn)
        assert action == "clarification_response"
        assert mods == [{"assigneeName": "Sam Torres"}]


class TestAuthFailureDetection:
    def test_detects_token_rejection_signatures(self) -> None:
        assert _is_auth_failure("Invalid token.")
        assert _is_auth_failure("401: Token validation failed")

    def test_ignores_ordinary_errors(self) -> None:
        assert not _is_auth_failure("No matching project found")
        assert not _is_auth_failure(None)


class TestSmallHelpers:
    def test_context_hash_is_stable_and_order_insensitive(self) -> None:
        a = _context_hash({"tenant_id": "t", "workspace_id": "w"})
        b = _context_hash({"workspace_id": "w", "tenant_id": "t"})
        assert a == b
        assert _context_hash(None) is None

    def test_truncate_result_caps_long_payloads(self) -> None:
        long = "x" * 5000
        out = _truncate_result(long)
        assert len(out) < 5000
        assert "truncated" in out


async def _events(*events: SSEEvent):
    for ev in events:
        yield ev


class TestCaptureTurn:
    async def test_folds_event_stream_into_snapshot(self) -> None:
        snap = await capture_turn(
            _events(
                SSEEvent.create("router_decision", {"selected_agent": "task_agent"}),
                SSEEvent.create("tool_call", {"tool_name": "create_task", "arguments": {"title": "T"}}),
                SSEEvent.create("tool_result", {"tool_name": "create_task", "result": "ok"}),
                SSEEvent.create("text_delta", {"content": "Created "}),
                SSEEvent.create("text_delta", {"content": "1 task."}),
                SSEEvent.create("done", {"awaiting_approval": False}),
            ),
            turn_index=0,
            turn_input={"message": "create a task"},
        )
        assert snap.router_decision == "task_agent"
        assert snap.tool_calls == [{"tool_name": "create_task", "arguments": {"title": "T"}}]
        assert snap.final_text == "Created 1 task."
        assert snap.awaiting_approval is False

    async def test_captures_plan_interrupt_and_awaiting_approval(self) -> None:
        snap = await capture_turn(
            _events(
                SSEEvent.create("plan", {"type": "plan_approval", "items": [{"title": "T"}]}),
                SSEEvent.create("done", {"awaiting_approval": True}),
            ),
            turn_index=1,
            turn_input={"message": "plan things"},
        )
        assert snap.plan == {"type": "plan_approval", "items": [{"title": "T"}]}
        assert snap.awaiting_approval is True

    async def test_captures_items_completed(self) -> None:
        snap = await capture_turn(
            _events(
                SSEEvent.create("items_completed", {"items": [{"name": "T", "severity": "ok"}]}),
                SSEEvent.create("done", {"awaiting_approval": False}),
            ),
            turn_index=2,
            turn_input={"approval_action": "approve"},
        )
        assert snap.items_completed == [{"name": "T", "severity": "ok"}]
