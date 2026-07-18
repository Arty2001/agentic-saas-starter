"""Agent registry with autodiscovery from agent_platform/agents/*/description.yaml.

Also auto-discovers graph builders from each agent's ``graph.py`` module
by looking for a function named ``build_<agent_name>_graph``.
"""

from __future__ import annotations

import importlib
import inspect
import logging
from collections.abc import Callable
from pathlib import Path
from typing import Any

import yaml
from langgraph.graph import StateGraph

logger = logging.getLogger(__name__)


class AgentRegistry:
    """Registry of agent subgraphs.

    Scans agent_platform/agents/ subdirectories for description.yaml files
    and optionally auto-discovers graph builders from graph.py modules.
    """

    def __init__(self) -> None:
        self._descriptions: dict[str, dict[str, Any]] = {}
        self._graph_builders: dict[str, Callable[..., StateGraph]] = {}

    @property
    def agent_names(self) -> list[str]:
        """All registered agent names."""
        return list(self._descriptions.keys())

    def get_description(self, name: str) -> dict[str, Any] | None:
        """Get description.yaml contents for a specific agent."""
        return self._descriptions.get(name)

    def get_all_descriptions(self) -> list[dict[str, Any]]:
        return list(self._descriptions.values())

    def get_graph_builder(self, name: str) -> Callable[..., StateGraph] | None:
        return self._graph_builders.get(name)

    def register_graph_builder(self, name: str, builder: Callable[..., StateGraph]) -> None:
        """Manually register a graph builder (still supported but usually not needed)."""
        if name not in self._descriptions:
            logger.warning("Registering graph builder for unknown agent: %s", name)
        self._graph_builders[name] = builder
        logger.info("Registered graph builder: %s", name)

    def discover(self, agents_dir: Path) -> None:
        """Scan agents_dir for description.yaml files and load metadata."""
        if not agents_dir.exists():
            logger.warning("Agents directory not found: %s", agents_dir)
            return

        for agent_path in sorted(agents_dir.iterdir()):
            if not agent_path.is_dir() or agent_path.name.startswith(("_", ".")):
                continue

            desc_yaml = agent_path / "description.yaml"
            if not desc_yaml.exists():
                continue

            try:
                with open(desc_yaml) as f:
                    description = yaml.safe_load(f)
                agent_name = description["name"]
                self._descriptions[agent_name] = description
                logger.info("Discovered agent: %s", agent_name)
            except Exception:
                logger.exception("Failed to load agent description: %s", agent_path.name)

    def discover_graph_builders(self, tool_registry: Any = None) -> None:
        """Auto-discover graph builder functions from each agent's graph.py.

        Convention: the module ``agent_platform.agents.<name>.graph`` must contain
        a function named ``build_<name>_graph``.

        If the builder's signature accepts a parameter (e.g. ``tool_registry``),
        it is automatically curried with the provided *tool_registry*.
        """
        for agent_name in list(self._descriptions.keys()):
            if agent_name in self._graph_builders:
                continue  # already registered manually

            module_path = f"agent_platform.agents.{agent_name}.graph"
            fn_name = f"build_{agent_name}_graph"
            try:
                mod = importlib.import_module(module_path)
            except (ImportError, ModuleNotFoundError):
                logger.debug("No graph.py for agent %s — skipping builder discovery", agent_name)
                continue

            builder_fn = getattr(mod, fn_name, None)
            if builder_fn is None:
                logger.warning(
                    "Agent %s has graph.py but no function '%s'", agent_name, fn_name
                )
                continue

            # Check if the builder needs tool_registry
            sig = inspect.signature(builder_fn)
            needs_tools = any(
                p.name == "tool_registry" for p in sig.parameters.values()
            )

            if needs_tools and tool_registry is not None:
                # Curry tool_registry into the builder
                self._graph_builders[agent_name] = lambda tr=tool_registry, fn=builder_fn: fn(tr)
            else:
                self._graph_builders[agent_name] = builder_fn

            logger.info("Auto-discovered graph builder: %s (needs_tools=%s)", agent_name, needs_tools)


def discover_agents(agents_dir: Path | None = None) -> AgentRegistry:
    """Convenience function to create and populate an agent registry.

    Args:
        agents_dir: Path to agents directory. Defaults to agent_platform/agents/
    """
    if agents_dir is None:
        agents_dir = Path(__file__).resolve().parent

    registry = AgentRegistry()
    registry.discover(agents_dir)
    return registry
