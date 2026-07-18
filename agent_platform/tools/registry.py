"""Tool registry with autodiscovery from agent_platform/tools/ subdirectories."""

from __future__ import annotations

import importlib.util
import logging
from pathlib import Path
from typing import Any

import yaml
from langchain_core.tools import StructuredTool
from pydantic import BaseModel

logger = logging.getLogger(__name__)


class ToolRegistry:
    """Registry of LangGraph-compatible tools.

    Scans agent_platform/tools/ subdirectories at startup. Each tool subdirectory
    must contain: __init__.py (with async run()), schemas.py (with InputSchema),
    and prompt.yaml (with metadata).
    """

    def __init__(self) -> None:
        self._tools: dict[str, StructuredTool] = {}
        self._metadata: dict[str, dict[str, Any]] = {}

    @property
    def tools(self) -> dict[str, StructuredTool]:
        """All registered tools."""
        return dict(self._tools)

    def get_tool(self, name: str) -> StructuredTool | None:
        """Get a single tool by name."""
        return self._tools.get(name)

    def get_tools_by_category(self, category: str) -> list[StructuredTool]:
        return [
            self._tools[name]
            for name, meta in self._metadata.items()
            if meta.get("category") == category
        ]

    def get_tools_by_tag(self, tag: str) -> list[StructuredTool]:
        return [
            self._tools[name]
            for name, meta in self._metadata.items()
            if tag in meta.get("tags", [])
        ]

    def get_tool_list(self) -> list[StructuredTool]:
        return list(self._tools.values())

    def get_schemas_summary(self) -> list[dict[str, Any]]:
        """Return tool name + description + args schema for router prompt generation."""
        summaries = []
        for name, tool in self._tools.items():
            summaries.append({
                "name": name,
                "description": tool.description,
                "parameters": (
                    tool.args_schema.model_json_schema()
                    if isinstance(tool.args_schema, type) and issubclass(tool.args_schema, BaseModel)
                    else {}
                ),
            })
        return summaries

    def discover(self, tools_dir: Path) -> None:
        if not tools_dir.exists():
            logger.warning("Tools directory not found: %s", tools_dir)
            return

        for tool_path in sorted(tools_dir.iterdir()):
            if not tool_path.is_dir() or tool_path.name.startswith(("_", ".")):
                continue

            prompt_yaml = tool_path / "prompt.yaml"
            init_py = tool_path / "__init__.py"
            schemas_py = tool_path / "schemas.py"

            if not all(p.exists() for p in [prompt_yaml, init_py, schemas_py]):
                logger.warning(f"Skipping incomplete tool: {tool_path.name} found files {[p.name for p in [prompt_yaml, init_py, schemas_py] if p.exists()]} for tool path: {tool_path.absolute()}")
                continue

            try:
                self._register_tool(tool_path, prompt_yaml, init_py, schemas_py)
            except Exception:
                logger.exception("Failed to register tool: %s", tool_path.name)

    def _register_tool(
        self,
        tool_path: Path,
        prompt_yaml: Path,
        init_py: Path,
        schemas_py: Path,
    ) -> None:
        """Register a single tool from its directory."""
        with open(prompt_yaml) as f:
            metadata = yaml.safe_load(f)

        tool_spec = importlib.util.spec_from_file_location(
            f"tool_{tool_path.name}", init_py
        )
        assert tool_spec is not None and tool_spec.loader is not None
        tool_module = importlib.util.module_from_spec(tool_spec)
        tool_spec.loader.exec_module(tool_module)

        schemas_spec = importlib.util.spec_from_file_location(
            f"tool_{tool_path.name}_schemas", schemas_py
        )
        assert schemas_spec is not None and schemas_spec.loader is not None
        schemas_module = importlib.util.module_from_spec(schemas_spec)
        schemas_spec.loader.exec_module(schemas_module)

        # Rebuild Pydantic model to resolve deferred annotations (from __future__ import annotations).
        # Pass the schemas module's namespace so Literal and other types resolve correctly.
        input_schema: type[BaseModel] = schemas_module.InputSchema
        try:
            input_schema.model_rebuild(_types_namespace=vars(schemas_module))
        except Exception:
            pass  # Already built or no deferred annotations

        tool_name = metadata["name"]
        tool = StructuredTool.from_function(
            coroutine=tool_module.run,
            name=tool_name,
            description=metadata["description"],
            args_schema=input_schema,
        )
        tool.metadata = metadata  # type: ignore[assignment]

        self._tools[tool_name] = tool
        self._metadata[tool_name] = metadata
        logger.info("Registered tool: %s (category=%s)", tool_name, metadata.get("category"))


def discover_tools(tools_dir: Path | None = None) -> ToolRegistry:
    """Convenience function to create and populate a tool registry.

    Args:
        tools_dir: Path to tools directory. Defaults to agent_platform/tools/
    """
    if tools_dir is None:
        tools_dir = Path(__file__).resolve().parent

    registry = ToolRegistry()
    registry.discover(tools_dir)
    return registry
