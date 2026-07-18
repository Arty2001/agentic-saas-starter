"""Playground API routes for prompt/tool editing and sandbox chat.

Provides endpoints to:
- GET /api/playground/prompts: Fetch all production prompts and tool definitions.
- GET /api/playground/graph: Auto-introspected graph topology for dynamic rendering.
- POST /api/playground/chat: Run agent with prompt/tool overrides (SSE).

Overrides are per-session in the frontend — nothing writes to production files.
"""

from __future__ import annotations

import importlib
import logging
import re
from datetime import UTC, datetime
from typing import Any

from fastapi import APIRouter, Depends
from langchain_core.runnables import RunnableConfig
from pydantic import BaseModel, Field
from sqlalchemy import update as sa_update
from starlette.responses import StreamingResponse

from agent_platform.agents.registry import AgentRegistry
from agent_platform.api.dependencies import (
    Graph,
    get_agent_registry,
    get_graph,
    get_session_factory,
    get_tool_registry,
)
from agent_platform.api.streaming import build_graph_input, sse_response, stream_graph
from agent_platform.db.models import Run
from agent_platform.observability.callback import ObservabilityCallbackHandler
from agent_platform.tools.registry import ToolRegistry

logger = logging.getLogger(__name__)

router = APIRouter(tags=["playground"])

# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------

class PromptEntry(BaseModel):
    """A single editable prompt."""

    key: str = Field(description="Unique key for this prompt")
    label: str = Field(description="Human-readable label")
    node: str = Field(description="Graph node this prompt belongs to")
    content: str = Field(description="The prompt text")
    template_vars: list[str] = Field(
        default_factory=list,
        description="List of {variable} names injected at runtime (read-only context)",
    )

class ToolDefEntry(BaseModel):
    """A single editable tool definition."""

    name: str
    description: str
    category: str | None = None
    tags: list[str] = []
    args_schema: dict | None = None

class PlaygroundPromptsResponse(BaseModel):
    """Response for GET /api/playground/prompts."""

    prompts: list[PromptEntry]
    tools: list[ToolDefEntry]

class PlaygroundChatRequest(BaseModel):
    """Request body for POST /api/playground/chat."""

    message: str
    session_id: str
    agent_type: str | None = Field(default=None, description="Which agent to invoke. None or 'router' = auto-route.")
    prompt_overrides: dict[str, str] = Field(
        default_factory=dict,
        description="Map of prompt key -> overridden prompt text",
    )
    tool_overrides: dict[str, dict[str, str]] = Field(
        default_factory=dict,
        description="Map of tool name -> {description: ...}",
    )
    approval_action: str | None = None
    modifications: list[dict] | None = None

# -- Graph topology schemas ------------------------------------------------

class GraphNodeInfo(BaseModel):
    """A node in the graph topology."""

    id: str
    label: str
    type: str  # "start" | "end" | "main" | "subgraph"
    prompt_keys: list[str] = []

class GraphEdgeInfo(BaseModel):
    """An edge in the graph topology."""

    source: str
    target: str
    label: str | None = None
    conditional: bool = False

class SubgraphInfo(BaseModel):
    """An agent subgraph with its internal topology."""

    id: str
    label: str
    entry_node: str | None = None
    exit_nodes: list[str] = []
    nodes: list[GraphNodeInfo]
    edges: list[GraphEdgeInfo]

class GraphTopologyResponse(BaseModel):
    """Response for GET /api/playground/graph."""

    nodes: list[GraphNodeInfo]
    edges: list[GraphEdgeInfo]
    subgraphs: list[SubgraphInfo]

# ---------------------------------------------------------------------------
# Hardcoded default prompts (so we always serve the correct originals
# even if prompts.py were to be modified)
# ---------------------------------------------------------------------------

# ---------------------------------------------------------------------------
# Auto-discover agent prompts
# ---------------------------------------------------------------------------

_TEMPLATE_VAR_RE = re.compile(r"\{(\w+)\}")

def _discover_agent_prompts(agent_registry: AgentRegistry) -> list[PromptEntry]:
    """Scan every registered agent's ``prompts`` module for ``*_SYSTEM``
    constants and turn them into editable :class:`PromptEntry` objects.

    Convention
    ----------
    * File:  ``agent_platform/agents/<agent_name>/prompts.py``
    * Constants ending in ``_SYSTEM`` are treated as node prompts.
    * ``PLANNER_SYSTEM`` → node ``planner``, key ``planner``
    * Template variables are ``{placeholder}`` patterns in the string.
    """
    entries: list[PromptEntry] = []
    for agent_name in agent_registry.agent_names:
        module_path = f"agent_platform.agents.{agent_name}.prompts"
        try:
            mod = importlib.import_module(module_path)
        except (ImportError, ModuleNotFoundError):
            continue  # agent has no prompts.py — skip

        for attr_name in sorted(dir(mod)):
            if not attr_name.endswith("_SYSTEM"):
                continue
            content = getattr(mod, attr_name)
            if not isinstance(content, str):
                continue

            # PLANNER_SYSTEM → "planner"
            node_id = attr_name.removesuffix("_SYSTEM").lower()
            label = node_id.replace("_", " ").title()
            template_vars = _TEMPLATE_VAR_RE.findall(content)

            entries.append(
                PromptEntry(
                    key=node_id,
                    label=label,
                    node=f"{node_id} ({agent_name})",
                    content=content,
                    template_vars=template_vars,
                )
            )
    return entries

# ---------------------------------------------------------------------------
# GET /api/playground/prompts
# ---------------------------------------------------------------------------

@router.get("/playground/prompts", response_model=PlaygroundPromptsResponse)
async def get_prompts(
    tool_registry: ToolRegistry = Depends(get_tool_registry),
    agent_registry: AgentRegistry = Depends(get_agent_registry),
) -> PlaygroundPromptsResponse:
    """Return all production prompts and tool definitions for editing.

    Template prompts are served with their {placeholder} variables intact.
    The frontend shows which variables get injected at runtime.
    """
    tools_summary = tool_registry.get_schemas_summary()

    # -- Agent prompts (auto-discovered from each agent's prompts.py) ---------
    prompts: list[PromptEntry] = []

    # -- Auto-discover agent prompts from each agent's prompts.py -----------
    # Convention: any constant ending in _SYSTEM maps to a node.
    #   PLANNER_SYSTEM  →  node "planner",  key "planner"
    #   FETCHER_SYSTEM  →  node "fetcher",  key "fetcher"
    # Template vars are extracted from {placeholder} patterns in the string.
    prompts.extend(_discover_agent_prompts(agent_registry))

    tool_defs = []
    for s in tools_summary:
        meta = tool_registry._metadata.get(s["name"], {})
        tool_defs.append(
            ToolDefEntry(
                name=s["name"],
                description=s.get("description", ""),
                category=meta.get("category"),
                tags=meta.get("tags", []),
                args_schema=s.get("parameters"),
            )
        )

    return PlaygroundPromptsResponse(prompts=prompts, tools=tool_defs)

# ---------------------------------------------------------------------------
# GET /api/playground/graph  —  auto-introspected topology
# ---------------------------------------------------------------------------

# Friendly labels for conditional edges (grouped by target)
_ROUTER_EDGE_LABELS: dict[str, str] = {}

def _normalize_node_id(raw: str) -> str:
    """Map LangGraph internal IDs to our display IDs."""
    if raw == "__start__":
        return "start"
    if raw == "__end__":
        return "end"
    return raw

def _default_node_label(node_id: str) -> str:
    if node_id == "start":
        return "START"
    if node_id == "end":
        return "END"
    return node_id.replace("_", " ").title()

def _detect_back_edges(
    adj: dict[str, list[str]], roots: list[str], all_ids: list[str]
) -> set[tuple[str, str]]:
    """Classify cycle-closing back-edges via iterative DFS.

    An edge u->v is a back-edge when v is still on the current DFS stack (an
    ancestor of u) — i.e. the edge closes a cycle. This generalizes loop
    detection beyond direct 2-node mutual pairs (A<->B), so multi-hop cycles
    like build_plans -> ... -> correction_gate -> build_plans are tagged too.
    Without this the frontend's layered BFS re-queues forever on the cycle.
    """
    WHITE, GRAY, BLACK = 0, 1, 2
    color: dict[str, int] = {nid: WHITE for nid in all_ids}
    back: set[tuple[str, str]] = set()
    # Visit entry/start roots first so the DFS tree follows real flow direction.
    order = [r for r in roots if r in color]
    order += [nid for nid in all_ids if nid not in roots]
    for root in order:
        if color.get(root, BLACK) != WHITE:
            continue
        color[root] = GRAY
        stack = [(root, iter(adj.get(root, [])))]
        while stack:
            node, it = stack[-1]
            pushed = False
            for nb in it:
                c = color.get(nb, BLACK)
                if c == GRAY:
                    back.add((node, nb))
                elif c == WHITE:
                    color[nb] = GRAY
                    stack.append((nb, iter(adj.get(nb, []))))
                    pushed = True
                    break
                # BLACK: forward/cross edge — not a back-edge
            if not pushed:
                color[node] = BLACK
                stack.pop()
    return back

def _extract_graph_topology(
    compiled_graph: Any,
    prompt_key_map: dict[str, list[str]],
    *,
    node_type: str = "main",
    skip_start_end: bool = False,
    label_overrides: dict[str, str] | None = None,
) -> tuple[list[GraphNodeInfo], list[GraphEdgeInfo], str | None, list[str]]:
    """Extract topology from a compiled LangGraph graph.

    Returns ``(nodes, edges, entry_node_id, exit_node_ids)``.
    """
    drawable = compiled_graph.get_graph()

    # -- nodes -----------------------------------------------------------------
    nodes: list[GraphNodeInfo] = []
    entry_node: str | None = None
    exit_nodes: list[str] = []
    seen: set[str] = set()

    for raw_id in drawable.nodes:
        nid = _normalize_node_id(raw_id)
        if nid in seen:
            continue
        seen.add(nid)

        ntype = node_type
        if raw_id == "__start__":
            ntype = "start"
        elif raw_id == "__end__":
            ntype = "end"

        if skip_start_end and ntype in ("start", "end"):
            continue

        label = (label_overrides or {}).get(nid) or _default_node_label(nid)
        nodes.append(
            GraphNodeInfo(
                id=nid,
                label=label,
                type=ntype,
                prompt_keys=prompt_key_map.get(nid, []),
            )
        )

    # Phantom-edge filter: get_graph() injects extra incoming edges to
    # defer=True (barrier) nodes that don't match the declared routing
    # (e.g. triage -> assemble_plans, parse_* -> assemble_plans). Reconstruct
    # each source's real conditional targets from the builder's branch `ends`
    # maps and drop conditional edges whose target isn't among them. Sources
    # with a dynamic branch (no path_map) or no builder are left untouched —
    # there we can't distinguish phantom from real.
    builder = getattr(compiled_graph, "builder", None)
    static_targets: dict[str, set[str] | None] = {}
    if builder is not None:
        for branch_src, branch_map in getattr(builder, "branches", {}).items():
            allowed: set[str] = set()
            dynamic = False
            for branch in branch_map.values():
                ends = getattr(branch, "ends", None)
                if not ends:
                    dynamic = True
                    break
                allowed.update(ends.values())
            static_targets[branch_src] = None if dynamic else allowed

    def _is_phantom_edge(raw_src: str, raw_tgt: str, cond: bool) -> bool:
        if not cond or builder is None:
            return False
        if raw_src not in static_targets:
            # Source declares no conditional branch (add_conditional_edges),
            # so any conditional edge from it is a get_graph() artifact —
            # e.g. the phantom edges injected toward defer=True barrier nodes.
            return True
        allowed = static_targets[raw_src]
        if allowed is None:
            return False  # dynamic routing (no path_map) — cannot classify
        return raw_tgt not in allowed

    # -- edges (grouped by source→target) -------------------------------------
    raw_edges: dict[tuple[str, str], list[str]] = {}
    raw_cond: dict[tuple[str, str], bool] = {}

    for edge in drawable.edges:
        src = _normalize_node_id(edge.source)
        tgt = _normalize_node_id(edge.target)

        if skip_start_end:
            if edge.source == "__start__":
                entry_node = tgt
                continue
            if edge.target == "__end__":
                if src not in exit_nodes:
                    exit_nodes.append(src)
                continue

        cond = getattr(edge, "conditional", False)
        if _is_phantom_edge(edge.source, edge.target, cond):
            continue

        key = (src, tgt)
        raw_cond[key] = raw_cond.get(key, False) or cond
        if key not in raw_edges:
            raw_edges[key] = []
        data = getattr(edge, "data", None)
        if data and cond:
            raw_edges[key].append(str(data))

    pair_set = set(raw_edges.keys())

    # Detect cycle-closing back-edges (any length) so the frontend layout can
    # drop them instead of looping forever. Start the DFS from the entry/start
    # node so the tree follows flow direction.
    adj: dict[str, list[str]] = {}
    for (s, t) in raw_edges:
        adj.setdefault(s, []).append(t)
    node_ids = [n.id for n in nodes]
    start_id = entry_node or next((n.id for n in nodes if n.type == "start"), None)
    roots = ([start_id] if start_id else []) + [nid for nid in node_ids if nid != start_id]
    back_edges = _detect_back_edges(adj, roots, node_ids)

    edges: list[GraphEdgeInfo] = []

    for (src, tgt), labels in raw_edges.items():
        is_cond = raw_cond.get((src, tgt), False)
        # DFS-detected back-edge, or a direct 2-node conditional pair (legacy).
        is_back_edge = (src, tgt) in back_edges or ((tgt, src) in pair_set and is_cond)

        edge_label: str | None
        if is_back_edge:
            edge_label = "loop"
        elif labels:
            # Use the conditional edge data as the label (e.g. "planner", "safety_respond")
            edge_label = " / ".join(labels)
        elif src == "router" and tgt in _ROUTER_EDGE_LABELS:
            edge_label = _ROUTER_EDGE_LABELS[tgt]
        else:
            edge_label = None

        edges.append(
            GraphEdgeInfo(source=src, target=tgt, label=edge_label, conditional=is_cond)
        )

    return nodes, edges, entry_node, exit_nodes

@router.get("/playground/graph", response_model=GraphTopologyResponse)
async def get_graph_topology(
    graph: Any = Depends(get_graph),
    tool_registry: ToolRegistry = Depends(get_tool_registry),
    agent_registry: AgentRegistry = Depends(get_agent_registry),
) -> GraphTopologyResponse:
    """Return the full graph topology for dynamic frontend rendering.

    Auto-introspects the compiled main graph **and** every registered
    agent subgraph so the frontend never needs static graph definitions.
    """
    # Build prompt-key map by reusing the prompts endpoint
    prompts_resp = await get_prompts(tool_registry, agent_registry)
    pk_map: dict[str, list[str]] = {}
    for p in prompts_resp.prompts:
        node_id = p.node.split(" (")[0].strip()
        pk_map.setdefault(node_id, []).append(p.key)

    # Main graph topology
    main_nodes, main_edges, _, _ = _extract_graph_topology(
        graph, pk_map, node_type="main"
    )

    # Agent subgraph topologies
    subgraphs: list[SubgraphInfo] = []
    for agent_name in agent_registry.agent_names:
        builder = agent_registry.get_graph_builder(agent_name)
        if builder is None:
            continue
        try:
            state_graph = builder()
            compiled_sub = state_graph.compile()

            desc = agent_registry.get_description(agent_name)
            label_overrides = desc.get("node_labels") if desc else None

            sub_nodes, sub_edges, entry, exits = _extract_graph_topology(
                compiled_sub,
                pk_map,
                node_type="subgraph",
                skip_start_end=True,
                label_overrides=label_overrides,
            )
            subgraphs.append(
                SubgraphInfo(
                    id=agent_name,
                    label=agent_name,
                    entry_node=entry,
                    exit_nodes=exits,
                    nodes=sub_nodes,
                    edges=sub_edges,
                )
            )
        except Exception:
            logger.exception("Failed to extract topology for agent: %s", agent_name)

    return GraphTopologyResponse(
        nodes=main_nodes, edges=main_edges, subgraphs=subgraphs
    )

# ---------------------------------------------------------------------------
# POST /api/playground/chat
# ---------------------------------------------------------------------------

@router.post("/playground/chat")
async def playground_chat(
    request_body: PlaygroundChatRequest,
    graph: Graph = Depends(get_graph),
    session_factory: Any = Depends(get_session_factory),
) -> StreamingResponse:
    """Stream chat responses with prompt/tool overrides applied.

    Uses the same streaming pipeline as POST /api/chat but injects
    prompt_overrides and tool_overrides via config['configurable'].
    """
    logger.info(
        "playground_chat_request: session_id=%s message_len=%d approval_action=%s",
        request_body.session_id,
        len(request_body.message or ""),
        request_body.approval_action,
    )

    callback_handler = ObservabilityCallbackHandler(session_factory, request_body.session_id)

    # Build config with playground overrides
    configurable: dict[str, Any] = {"thread_id": request_body.session_id}
    if request_body.prompt_overrides:
        configurable["prompt_overrides"] = request_body.prompt_overrides
    if request_body.tool_overrides:
        configurable["tool_overrides"] = request_body.tool_overrides
    config: RunnableConfig = {
        "configurable": configurable,
        "callbacks": [callback_handler],
    }

    # Build input
    input_val, is_approval = build_graph_input(
        message=request_body.message,
        agent_type=request_body.agent_type,
        approval_action=request_body.approval_action,
        modifications=request_body.modifications,
    )

    # Resolve pending_approval runs
    if is_approval:
        status_map = {"approve": "approved", "modify": "modified", "reject": "rejected"}
        resolved_status = status_map.get(request_body.approval_action or "", "approved")
        async with session_factory() as session:
            await session.execute(
                sa_update(Run)
                .where(Run.thread_id == request_body.session_id)
                .where(Run.status == "pending_approval")
                .values(status=resolved_status, ended_at=datetime.now(UTC))
            )
            await session.commit()

    if not is_approval:
        await callback_handler.write_conversation_message("user", request_body.message)

    return sse_response(
        stream_graph(
            graph=graph,
            input_val=input_val,
            config=config,
            callback_handler=callback_handler,
            is_approval_resume=is_approval,
            session_id=request_body.session_id,
        )
    )
