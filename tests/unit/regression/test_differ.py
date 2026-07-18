"""Unit tests for the eval engine's structural differ.

The differ decides whether an agent's behavior regressed, so its
normalization rules (what counts as signal vs noise) are the highest-value
thing in the eval engine to pin down.
"""

from agent_platform.regression.differ import (
    diff_snapshots,
    normalize_snapshot,
    text_pairs,
)


def _snapshot(**turn_overrides) -> dict:
    turn = {
        "turn_index": 0,
        "input": {"message": "create a task"},
        "router_decision": "task_agent",
        "tool_calls": [{"tool_name": "create_task", "arguments": {"title": "T"}}],
        "tool_results": [{"tool_name": "create_task", "result": "..."}],
        "plan": None,
        "final_text": "Done.",
        "run_id": "abc",
        "duration_ms": 1200,
        **turn_overrides,
    }
    return {"meta": {"mock_mode": True, "captured_at": "2026-01-01"}, "turns": [turn]}


class TestNormalization:
    def test_volatile_and_display_fields_are_stripped(self) -> None:
        normalized = normalize_snapshot(_snapshot())
        turn = normalized["turns"][0]
        assert "final_text" not in turn  # judge territory, not structure
        assert "tool_results" not in turn
        assert "run_id" not in turn
        assert "duration_ms" not in turn

    def test_identical_behavior_with_different_ids_diffs_clean(self) -> None:
        base = _snapshot()
        act = _snapshot(run_id="different", duration_ms=999)
        act["turns"][0]["tool_calls"][0]["arguments"]["taskId"] = 42  # volatile key
        assert diff_snapshots(normalize_snapshot(base), normalize_snapshot(act)) == []

    def test_parallel_tool_call_order_is_not_signal(self) -> None:
        call_a = {"tool_name": "create_task", "arguments": {"title": "A"}}
        call_b = {"tool_name": "create_task", "arguments": {"title": "B"}}
        base = _snapshot(tool_calls=[call_a, call_b])
        act = _snapshot(tool_calls=[call_b, call_a])
        assert diff_snapshots(normalize_snapshot(base), normalize_snapshot(act)) == []

    def test_extra_ignore_paths(self) -> None:
        base = _snapshot()
        act = _snapshot()
        act["turns"][0]["tool_calls"][0]["arguments"]["dueDate"] = "Friday"
        ignoring = normalize_snapshot(act, ["**.dueDate"])
        assert diff_snapshots(normalize_snapshot(base), ignoring) == []


class TestDiffSignal:
    def test_changed_tool_argument_is_flagged(self) -> None:
        base = _snapshot()
        act = _snapshot(tool_calls=[{"tool_name": "create_task", "arguments": {"title": "DIFFERENT"}}])
        diff = diff_snapshots(normalize_snapshot(base), normalize_snapshot(act))
        assert len(diff) == 1
        assert diff[0]["kind"] == "changed"
        assert "arguments.title" in diff[0]["path"]

    def test_routing_change_is_flagged(self) -> None:
        diff = diff_snapshots(
            normalize_snapshot(_snapshot()),
            normalize_snapshot(_snapshot(router_decision="echo_agent")),
        )
        assert any("router_decision" in d["path"] for d in diff)

    def test_missing_tool_call_is_flagged(self) -> None:
        diff = diff_snapshots(
            normalize_snapshot(_snapshot()),
            normalize_snapshot(_snapshot(tool_calls=[])),
        )
        assert any(d["path"].endswith(".length") for d in diff)

    def test_mock_vs_real_environment_is_a_hard_fail(self) -> None:
        base = _snapshot()
        act = _snapshot()
        act["meta"]["mock_mode"] = False
        diff = diff_snapshots(normalize_snapshot(base), normalize_snapshot(act))
        assert any("mock_mode" in d["path"] for d in diff)


class TestTextPairs:
    def test_whitespace_churn_is_not_a_pair(self) -> None:
        base = _snapshot(final_text="All done.")
        act = _snapshot(final_text="All   done.\n")
        assert text_pairs(base, act) == []

    def test_meaningful_text_change_is_a_pair(self) -> None:
        base = _snapshot(final_text="Created 3 tasks.")
        act = _snapshot(final_text="Created 2 tasks.")
        pairs = text_pairs(base, act)
        assert pairs == [(0, "Created 3 tasks.", "Created 2 tasks.")]
