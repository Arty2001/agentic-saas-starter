"""Unit tests for the new-agent / new-tool generators."""

import pytest

from agent_platform.agents.registry import discover_agents
from agent_platform.scaffold import create_agent, create_tool
from agent_platform.tools.registry import discover_tools


class TestCreateAgent:
    def test_generates_discoverable_skeleton(self, tmp_path) -> None:
        created = create_agent("billing_agent", base_dir=tmp_path)
        names = {p.name for p in created}
        assert names == {"description.yaml", "graph.py", "nodes.py", "__init__.py"}

        graph_src = (tmp_path / "billing_agent" / "graph.py").read_text(encoding="utf-8")
        assert "def build_billing_agent_graph" in graph_src

        # The metadata registry picks it up as-is.
        registry = discover_agents(agents_dir=tmp_path)
        assert "billing_agent" in registry.agent_names

    def test_rejects_bad_names_and_duplicates(self, tmp_path) -> None:
        with pytest.raises(ValueError):
            create_agent("Billing-Agent", base_dir=tmp_path)
        create_agent("billing_agent", base_dir=tmp_path)
        with pytest.raises(FileExistsError):
            create_agent("billing_agent", base_dir=tmp_path)


class TestCreateTool:
    def test_generates_registrable_tool(self, tmp_path) -> None:
        create_tool("create_invoice", category="billing", base_dir=tmp_path)

        # The tool registry loads it end to end (module import + schema + yaml).
        registry = discover_tools(tools_dir=tmp_path)
        assert "create_invoice" in registry.tools
        tool = registry.get_tool("create_invoice")
        assert tool is not None
        assert registry.get_tools_by_category("billing") == [tool]

    async def test_generated_tool_mock_runs(self, tmp_path) -> None:
        create_tool("create_invoice", base_dir=tmp_path)
        registry = discover_tools(tools_dir=tmp_path)
        tool = registry.get_tool("create_invoice")
        result = await tool.ainvoke({"example_param": "hello"})
        assert result["status"] == "ok"
        assert result["mock"] is True

    def test_rejects_bad_category(self, tmp_path) -> None:
        with pytest.raises(ValueError):
            create_tool("ok_name", category="Not Valid", base_dir=tmp_path)
