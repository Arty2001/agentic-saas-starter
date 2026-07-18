"""Discovery-convention tests: the filesystem IS the registry."""

from agent_platform.agents.registry import discover_agents
from agent_platform.tools.registry import discover_tools

EXPECTED_TOOLS = {
    "create_task",
    "get_project_summary",
    "search_knowledge",
}


def test_all_tools_discovered_with_schemas() -> None:
    registry = discover_tools()
    assert set(registry.tools) >= EXPECTED_TOOLS
    for summary in registry.get_schemas_summary():
        assert summary["description"], f"{summary['name']} has no description"


def test_agents_discovered_with_graph_builders() -> None:
    registry = discover_agents()
    assert {"task_agent", "support_agent", "echo_agent"} <= set(registry.agent_names)

    registry.discover_graph_builders(discover_tools())
    for name in ("task_agent", "support_agent", "echo_agent"):
        assert registry.get_graph_builder(name) is not None, f"{name} has no graph builder"
