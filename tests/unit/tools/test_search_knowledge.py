"""Unit tests for the knowledge-base search tool."""

from agent_platform.tools.search_knowledge import run as search_knowledge


class TestSearchKnowledge:
    async def test_finds_relevant_section_with_source(self) -> None:
        result = await search_knowledge(query="clarification envelope suggestedOptions answerKey")
        assert result["results"], "expected at least one hit"
        top = result["results"][0]
        assert top["source"] == "tools.md"
        assert "suggestedOptions" in top["content"]
        assert top["score"] > 0

    async def test_respects_top_k(self) -> None:
        result = await search_knowledge(query="agents tools registry discovery", top_k=2)
        assert len(result["results"]) <= 2

    async def test_unknown_topic_returns_empty_not_hallucination(self) -> None:
        result = await search_knowledge(query="kubernetes ingress annotations")
        assert result["results"] == []
        assert "message" in result

    async def test_empty_query_is_an_error(self) -> None:
        result = await search_knowledge(query="the and of")
        assert result.get("error")
