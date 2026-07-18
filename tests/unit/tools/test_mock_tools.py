"""Unit tests for the demo tools' mock branches.

The mock branch is the contract the whole demo (and every eval in mock
mode) runs against, so its clarification/error envelopes must match what
the branch sub-graph and the UI expect.
"""

from agent_platform.tools.create_task import run as create_task
from agent_platform.tools.get_project_summary import run as get_project_summary
from agent_platform.tools.matching import candidates, resolve


class TestMatching:
    def test_exact_and_case_insensitive(self) -> None:
        team = ["Sam Torres", "Samir Khan"]
        assert resolve("Sam Torres", team) == ("Sam Torres", [])
        assert resolve("sam torres", team) == ("Sam Torres", [])

    def test_ambiguous_returns_candidates(self) -> None:
        match, suggestions = resolve("sam", ["Sam Torres", "Samir Khan", "Jordan Lee"])
        assert match is None
        assert suggestions == ["Sam Torres", "Samir Khan"]

    def test_unknown_returns_all_options(self) -> None:
        match, suggestions = resolve("zorp", ["Sam Torres", "Jordan Lee"])
        assert match is None
        assert suggestions == ["Sam Torres", "Jordan Lee"]

    def test_normalized_matching(self) -> None:
        assert candidates("jordan-lee", ["Jordan Lee"]) == ["Jordan Lee"]


class TestCreateTask:
    async def test_creates_with_resolved_names(self) -> None:
        result = await create_task(
            title="Review pricing page", projectName="website", assigneeName="priya"
        )
        assert result["status"] == "created"
        assert result["project"] == "Website Redesign"
        assert result["assignee"] == "Priya Patel"
        assert result["taskId"]

    async def test_ids_increment(self) -> None:
        first = await create_task(title="A")
        second = await create_task(title="B")
        assert second["taskId"] == first["taskId"] + 1

    async def test_ambiguous_assignee_asks_for_clarification(self) -> None:
        result = await create_task(title="Ship it", assigneeName="sam")
        assert result["status"] == "clarification_needed"
        assert result["answerKey"] == "assigneeName"
        assert result["suggestedOptions"] == ["Sam Torres", "Samir Khan"]

    async def test_unknown_project_asks_with_all_projects(self) -> None:
        result = await create_task(title="Ship it", projectName="quantum")
        assert result["status"] == "clarification_needed"
        assert result["answerKey"] == "projectName"
        assert "Website Redesign" in result["suggestedOptions"]

    async def test_defaults_applied(self) -> None:
        result = await create_task(title="Solo task")
        assert result["project"] == "General"
        assert result["assignee"] is None
        assert result["priority"] == "medium"


class TestGetProjectSummary:
    async def test_fuzzy_match_returns_stats(self) -> None:
        result = await get_project_summary(projectName="mobile")
        assert result["status"] == "ok"
        assert result["project"] == "Mobile App"
        assert result["openTasks"] > 0

    async def test_unknown_project_clarifies(self) -> None:
        result = await get_project_summary(projectName="atlantis")
        assert result["status"] == "clarification_needed"
        assert result["answerKey"] == "projectName"
        assert len(result["suggestedOptions"]) >= 4
