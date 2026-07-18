"""Unit tests for task_agent orchestration helpers (no LLM, no DB)."""

from langgraph.types import Send

from agent_platform.agents.task_agent.branch import (
    _needs_clarification,
    _normalize_answer,
)
from agent_platform.agents.task_agent.nodes import (
    _options_section_from_config,
    _summarize_item,
    dispatch_items,
    planner_route,
    triage_route,
)
from agent_platform.tools.executor import is_tool_error


class TestTriageRoute:
    def test_plan_goes_to_planner(self) -> None:
        assert triage_route({"triage_result": "plan"}) == "planner"

    def test_greeting_and_question_go_to_guide(self) -> None:
        assert triage_route({"triage_result": "greeting"}) == "guide_respond"
        assert triage_route({"triage_result": "question"}) == "guide_respond"

    def test_everything_else_is_safety(self) -> None:
        assert triage_route({"triage_result": "off_topic"}) == "safety_respond"
        assert triage_route({}) == "safety_respond"


class TestPlannerRoute:
    def test_items_present(self) -> None:
        assert planner_route({"plan_items": [{"title": "t"}]}) == "present_plan"

    def test_clarification_asked(self) -> None:
        assert planner_route({"plan_items": None}) == "__end__"


class TestDispatchItems:
    def test_fans_out_one_send_per_item(self) -> None:
        items = [{"title": "a"}, {"title": "b"}, {"title": "c"}]
        sends = dispatch_items({"plan_items": items, "should_cancel": False})
        assert isinstance(sends, list)
        assert all(isinstance(s, Send) and s.node == "execute_item" for s in sends)
        assert [s.arg["item_index"] for s in sends] == [0, 1, 2]

    def test_cancel_short_circuits(self) -> None:
        assert dispatch_items({"should_cancel": True, "plan_items": [{}]}) == "format_results"

    def test_no_items_short_circuits(self) -> None:
        assert dispatch_items({"plan_items": None}) == "format_results"


class TestResultClassification:
    def test_clarification_is_not_hard_error(self) -> None:
        result = {"status": "clarification_needed", "suggestedOptions": ["x"]}
        assert _needs_clarification(result)
        assert not is_tool_error(result)

    def test_plain_error_is_hard_error(self) -> None:
        assert is_tool_error({"error": True, "message": "boom"})
        assert is_tool_error({"status": "error", "message": "boom"})

    def test_success_is_neither(self) -> None:
        ok = {"status": "created", "taskId": 1}
        assert not _needs_clarification(ok)
        assert not is_tool_error(ok)


class TestClarificationAnswerNormalization:
    def test_single_item_list_unwrapped(self) -> None:
        assert _normalize_answer([{"assigneeName": "Sam Torres"}]) == {"assigneeName": "Sam Torres"}

    def test_empty_and_bad_shapes(self) -> None:
        assert _normalize_answer([]) == {}
        assert _normalize_answer("nope") == {}


class TestPromptGrounding:
    def test_no_payload_keeps_prompt_unchanged(self) -> None:
        assert _options_section_from_config({"configurable": {}}) == ""
        assert _options_section_from_config(None) == ""

    def test_team_and_projects_grounded_and_deduped(self) -> None:
        config = {"configurable": {"session_context": {"payload": {
            "team": [{"name": "Sam Torres"}, {"name": "Sam Torres"}, "Priya Patel"],
            "projects": [{"name": "Mobile App"}],
        }}}}
        section = _options_section_from_config(config)
        assert section.count("Sam Torres") == 1
        assert "Priya Patel" in section
        assert "Mobile App" in section

    def test_item_summary_reads_naturally(self) -> None:
        line = _summarize_item({
            "title": "Draft announcement", "assigneeName": "Sam",
            "dueDate": "Friday", "priority": "high",
        })
        assert line == '"Draft announcement" → Sam due Friday [high]'
