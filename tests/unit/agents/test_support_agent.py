"""Unit tests for support_agent's loop guard (no LLM needed)."""

from langchain_core.messages import AIMessage, HumanMessage, ToolMessage

from agent_platform.agents.support_agent.nodes import _search_rounds_this_turn


class TestSearchRoundCounter:
    def test_counts_only_since_last_user_message(self) -> None:
        messages = [
            HumanMessage("earlier question"),
            ToolMessage(content="old", tool_call_id="a"),
            HumanMessage("new question"),
            AIMessage(""),
            ToolMessage(content="hit 1", tool_call_id="b"),
            ToolMessage(content="hit 2", tool_call_id="c"),
        ]
        assert _search_rounds_this_turn(messages) == 2

    def test_zero_before_any_search(self) -> None:
        assert _search_rounds_this_turn([HumanMessage("q")]) == 0
