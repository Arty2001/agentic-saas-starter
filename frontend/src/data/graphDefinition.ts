/**
 * Dynamic graph layout engine for the agent orchestration pipeline.
 *
 * Fetches topology from GET /api/playground/graph, computes positions,
 * edge SVG paths, and subgraph containers. Supports collapse/expand
 * and branching within subgraphs.
 */

// ── Display types ────────────────────────────────────────────────────────

export interface GraphNodeDef {
  id: string;
  label: string;
  type: "start" | "end" | "main" | "subgraph";
  promptKeys: string[];
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface GraphEdgeDef {
  from: string;
  to: string;
  label?: string;
  path: string;
  labelX?: number;
  labelY?: number;
}

export interface SubgraphDef {
  id: string;
  label: string;
  nodeIds: string[];
  nodeCount: number;
  x: number;
  y: number;
  w: number;
  h: number;
  collapsed: boolean;
}

// ── API topology types ──────────────────────────────────────────────────

export interface TopologyNode {
  id: string;
  label: string;
  type: string;
  prompt_keys: string[];
}

export interface TopologyEdge {
  source: string;
  target: string;
  label: string | null;
  conditional: boolean;
}

export interface TopologySubgraph {
  id: string;
  label: string;
  entry_node: string | null;
  exit_nodes: string[];
  nodes: TopologyNode[];
  edges: TopologyEdge[];
}

export interface GraphTopology {
  nodes: TopologyNode[];
  edges: TopologyEdge[];
  subgraphs: TopologySubgraph[];
}

// ── Layout result ────────────────────────────────────────────────────────

export interface GraphLayout {
  nodes: GraphNodeDef[];
  edges: GraphEdgeDef[];
  subgraphs: SubgraphDef[];
  viewBoxWidth: number;
  viewBoxHeight: number;
}

// ── Layout constants ─────────────────────────────────────────────────────

const CANVAS_W = 620;
const MARGIN_TOP = 20;
const LAYER_GAP = 90;
const NODE_GAP_X = 50;

const MAIN_W = 120;
const MAIN_H = 36;
const CAP_W = 60;
const CAP_H = 28;
const SUB_W = 110;
const SUB_H = 32;

const SG_PAD_X = 20;
const SG_PAD_TOP = 26;
const SG_PAD_BOT = 16;
const SG_NODE_GAP = 18;
const SG_OFFSET_Y = 36;
const SG_GAP_BETWEEN = 36;
const SG_COLLAPSED_H = 36;
const SG_BRANCH_GAP = 16;

// ── Layout engine ────────────────────────────────────────────────────────

export function computeLayout(
  topology: GraphTopology,
  collapsedSet: Set<string> = new Set(),
): GraphLayout {
  console.warn("[pg] computeLayout start", { nodes: topology.nodes.length, edges: topology.edges.length, subgraphs: topology.subgraphs.map(s => ({ id: s.id, nodes: s.nodes.length, edges: s.edges.length })) });
  const pos = new Map<string, Rect>();
  const allNodes: GraphNodeDef[] = [];
  const allEdges: GraphEdgeDef[] = [];
  const allSG: SubgraphDef[] = [];

  const sgContainerBaseW = SUB_W + SG_PAD_X * 2;
  const activeSGs = topology.subgraphs.filter((s) => s.nodes.length > 0);

  // Estimate container widths based on branching
  const sgWidths = activeSGs.map((sg) => {
    const maxBranch = computeMaxBranching(sg);
    return Math.max(sgContainerBaseW, maxBranch * (SUB_W + SG_BRANCH_GAP) - SG_BRANCH_GAP + SG_PAD_X * 2);
  });
  const sgTotalW =
    sgWidths.reduce((s, w) => s + w, 0) +
    Math.max(0, activeSGs.length - 1) * SG_GAP_BETWEEN;
  const canvasW = Math.max(CANVAS_W, sgTotalW + 100);

  // ── 1. BFS layers ──────────────────────────────────────────────────────
  const adj = new Map<string, string[]>();
  for (const n of topology.nodes) adj.set(n.id, []);
  for (const e of topology.edges) adj.get(e.source)?.push(e.target);

  const layers = new Map<string, number>();
  const q: string[] = [];
  const startId = topology.nodes.find((n) => n.type === "start")?.id;
  const endId = topology.nodes.find((n) => n.type === "end")?.id;
  if (startId) {
    layers.set(startId, 0);
    q.push(startId);
  }
  while (q.length) {
    const c = q.shift()!;
    for (const nb of adj.get(c) ?? [])
      if (!layers.has(nb)) {
        layers.set(nb, layers.get(c)! + 1);
        q.push(nb);
      }
  }

  const layerGroups = new Map<number, TopologyNode[]>();
  for (const n of topology.nodes) {
    if (n.id === endId) continue;
    const l = layers.get(n.id) ?? 0;
    (layerGroups.get(l) ?? (layerGroups.set(l, []), layerGroups.get(l)!)).push(
      n,
    );
  }

  // ── 2. Position main graph nodes ───────────────────────────────────────
  for (const [layer, group] of [...layerGroups.entries()].sort(
    (a, b) => a[0] - b[0],
  )) {
    const y = MARGIN_TOP + layer * LAYER_GAP;
    const dims = group.map((n) => ({
      w: n.type === "start" || n.type === "end" ? CAP_W : MAIN_W,
      h: n.type === "start" || n.type === "end" ? CAP_H : MAIN_H,
    }));
    const totalW =
      dims.reduce((s, d) => s + d.w, 0) + (group.length - 1) * NODE_GAP_X;
    let accX = (canvasW - totalW) / 2;

    for (let i = 0; i < group.length; i++) {
      const tn = group[i];
      const { w, h } = dims[i];
      allNodes.push({
        id: tn.id,
        label: tn.label,
        type: (tn.type === "start" || tn.type === "end"
          ? tn.type
          : "main") as "start" | "end" | "main",
        promptKeys: tn.prompt_keys,
        x: accX,
        y,
        w,
        h,
      });
      pos.set(tn.id, { x: accX, y, w, h });
      accX += w + NODE_GAP_X;
    }
  }

  // ── 3. Subgraphs with BFS layer layout ─────────────────────────────────
  const dispPos = pos.get("dispatcher");
  const sgTopY = dispPos
    ? dispPos.y + dispPos.h + SG_OFFSET_Y
    : MARGIN_TOP + 3 * LAYER_GAP;

  const dispTarget = topology.edges.find(
    (e) => e.source === "dispatcher",
  )?.target;

  interface SGPlan {
    sg: TopologySubgraph;
    containerW: number;
    h: number;
    collapsed: boolean;
  }
  const plans: SGPlan[] = activeSGs.map((sg, i) => {
    const collapsed = collapsedSet.has(sg.id);
    const layerCount = computeLayerCount(sg);
    const h = collapsed
      ? SG_COLLAPSED_H
      : SG_PAD_TOP +
        layerCount * SUB_H +
        (layerCount - 1) * SG_NODE_GAP +
        SG_PAD_BOT;
    return { sg, containerW: sgWidths[i], h, collapsed };
  });

  let sgX = (canvasW - sgTotalW) / 2;
  let sgBottom = sgTopY;

  for (const { sg, containerW, h, collapsed } of plans) {
    const cx = sgX;
    const cy = sgTopY;
    const nodeIds: string[] = [];

    if (!collapsed) {
      // BFS layer assignment within subgraph — start ONLY from entry_node
      const sgLayers = bfsLayers(sg);

      // Group by layer
      const sgLayerGroups = new Map<number, TopologyNode[]>();
      for (const n of sg.nodes) {
        const l = sgLayers.get(n.id) ?? 0;
        if (!sgLayerGroups.has(l)) sgLayerGroups.set(l, []);
        sgLayerGroups.get(l)!.push(n);
      }

      // Position each layer
      let iy = cy + SG_PAD_TOP;
      for (const [, group] of [...sgLayerGroups.entries()].sort(
        (a, b) => a[0] - b[0],
      )) {
        const rowW =
          group.length * SUB_W + (group.length - 1) * SG_BRANCH_GAP;
        let ix = cx + (containerW - rowW) / 2;
        for (const tn of group) {
          allNodes.push({
            id: tn.id,
            label: tn.label,
            type: "subgraph",
            promptKeys: tn.prompt_keys,
            x: ix,
            y: iy,
            w: SUB_W,
            h: SUB_H,
          });
          pos.set(tn.id, { x: ix, y: iy, w: SUB_W, h: SUB_H });
          nodeIds.push(tn.id);
          ix += SUB_W + SG_BRANCH_GAP;
        }
        iy += SUB_H + SG_NODE_GAP;
      }
    }

    allSG.push({
      id: sg.id,
      label: sg.label,
      nodeIds,
      nodeCount: sg.nodes.length,
      x: cx,
      y: cy,
      w: containerW,
      h,
      collapsed,
    });

    const boxCx = cx + containerW / 2;

    // --- dispatcher → subgraph ---
    if (dispPos) {
      const dx = dispPos.x + dispPos.w / 2;
      const dy = dispPos.y + dispPos.h;
      if (!collapsed && sg.entry_node && pos.has(sg.entry_node)) {
        allEdges.push(buildEdge("dispatcher", sg.entry_node, undefined, pos));
      } else if (collapsed) {
        const midY = (dy + cy) / 2;
        allEdges.push({
          from: "dispatcher",
          to: sg.id,
          path: `M${dx},${dy} C${dx},${midY} ${boxCx},${midY} ${boxCx},${cy}`,
        });
      }
    }

    // --- subgraph exit → next main node ---
    if (dispTarget && pos.has(dispTarget)) {
      const tgt = pos.get(dispTarget)!;
      if (!collapsed) {
        for (const eid of sg.exit_nodes) {
          if (!pos.has(eid)) continue;
          allEdges.push(buildEdge(eid, dispTarget, undefined, pos));
        }
      } else {
        const tx = tgt.x + tgt.w / 2;
        const ty = tgt.y + tgt.h;
        const midY = (cy + h + ty) / 2;
        allEdges.push({
          from: sg.id,
          to: dispTarget,
          path: `M${boxCx},${cy + h} C${boxCx},${midY} ${tx},${midY} ${tx},${ty}`,
        });
      }
    }

    // --- internal edges ---
    if (!collapsed) {
      for (const e of sg.edges) {
        if (pos.has(e.source) && pos.has(e.target))
          allEdges.push(
            buildEdge(e.source, e.target, e.label ?? undefined, pos),
          );
      }
    }

    sgX += containerW + SG_GAP_BETWEEN;
    sgBottom = Math.max(sgBottom, cy + h);
  }

  // ── 4. END node ────────────────────────────────────────────────────────
  if (endId) {
    const en = topology.nodes.find((n) => n.id === endId)!;
    const ex = (canvasW - CAP_W) / 2;
    const ey = sgBottom + SG_GAP_BETWEEN + 10;
    allNodes.push({
      id: endId,
      label: en.label,
      type: "end",
      promptKeys: en.prompt_keys,
      x: ex,
      y: ey,
      w: CAP_W,
      h: CAP_H,
    });
    pos.set(endId, { x: ex, y: ey, w: CAP_W, h: CAP_H });
  }

  // ── 5. Main graph edges ────────────────────────────────────────────────
  const routerEdges: TopologyEdge[] = [];
  const otherEdges: TopologyEdge[] = [];
  for (const e of topology.edges) {
    if (e.source === "dispatcher" && activeSGs.length > 0) continue;
    if (!pos.has(e.source) || !pos.has(e.target)) continue;
    if (e.source === "router" && e.label) routerEdges.push(e);
    else otherEdges.push(e);
  }

  routerEdges.sort((a, b) => {
    const ax = pos.get(a.target)!.x;
    const bx = pos.get(b.target)!.x;
    return ax - bx;
  });
  for (const e of routerEdges) {
    const to = pos.get(e.target)!;
    const edge = buildEdge(e.source, e.target, e.label ?? undefined, pos);
    edge.labelX = to.x + to.w / 2;
    edge.labelY = to.y - 8;
    allEdges.push(edge);
  }

  for (const e of otherEdges) {
    allEdges.push(
      buildEdge(e.source, e.target, e.label ?? undefined, pos),
    );
  }

  const maxY = allNodes.reduce((m, n) => Math.max(m, n.y + n.h), 0);
  console.warn("[pg] computeLayout done", { canvasW, height: maxY + 30, totalNodes: allNodes.length, totalEdges: allEdges.length });
  return {
    nodes: allNodes,
    edges: allEdges,
    subgraphs: allSG,
    viewBoxWidth: canvasW,
    viewBoxHeight: maxY + 30,
  };
}

// ── Helpers ──────────────────────────────────────────────────────────────

/**
 * BFS layer assignment for a subgraph. Starts ONLY from entry_node
 * so dynamically-wired nodes (Send()) are placed after their logical parent.
 * Unreachable nodes are appended at max_layer + 1.
 */
function bfsLayers(sg: TopologySubgraph): Map<string, number> {
  console.warn("[pg] bfsLayers start", sg.id, "nodes:", sg.nodes.length, "edges:", sg.edges.length, "entry:", sg.entry_node);
  const adj = new Map<string, string[]>();
  for (const n of sg.nodes) adj.set(n.id, []);
  for (const e of sg.edges) {
    if (e.label === "loop") continue;
    // Drop edges pointing back at the entry node (e.g. a re-plan path
    // present_plan → triage). The backend only tags 2-node back-pairs as
    // "loop"; longer cycles slip through and would re-queue forever in the
    // longest-path BFS below.
    if (e.target === sg.entry_node) continue;
    adj.get(e.source)?.push(e.target);
  }

  const layers = new Map<string, number>();
  const q: string[] = [];

  // Start only from the declared entry node
  if (sg.entry_node) {
    layers.set(sg.entry_node, 0);
    q.push(sg.entry_node);
  }

  // BFS — use max distance so nodes converging from multiple parents
  // land at the deepest possible layer
  while (q.length) {
    const c = q.shift()!;
    for (const nb of adj.get(c) ?? []) {
      const newL = (layers.get(c) ?? 0) + 1;
      if (!layers.has(nb) || layers.get(nb)! < newL) {
        layers.set(nb, newL);
        q.push(nb);
      }
    }
  }

  // Place unreachable nodes (e.g. execute_item via Send()) after the last reachable layer
  const maxLayer = Math.max(0, ...layers.values());
  let extraLayer = maxLayer + 1;
  for (const n of sg.nodes) {
    if (!layers.has(n.id)) {
      layers.set(n.id, extraLayer);
      extraLayer++;
    }
  }

  console.warn("[pg] bfsLayers done", sg.id, "maxLayer:", maxLayer, "totalLayers:", new Set(layers.values()).size);
  return layers;
}

/** Compute the max branching factor (widest layer) in a subgraph. */
function computeMaxBranching(sg: TopologySubgraph): number {
  const layers = bfsLayers(sg);
  const layerCounts = new Map<number, number>();
  for (const l of layers.values()) {
    layerCounts.set(l, (layerCounts.get(l) ?? 0) + 1);
  }
  return Math.max(1, ...layerCounts.values());
}

/** Count unique layers in a subgraph for height calculation. */
function computeLayerCount(sg: TopologySubgraph): number {
  const layers = bfsLayers(sg);
  const uniqueLayers = new Set(layers.values());
  return Math.max(1, uniqueLayers.size);
}

type Rect = { x: number; y: number; w: number; h: number };

function buildEdge(
  fromId: string,
  toId: string,
  label: string | undefined,
  pos: Map<string, Rect>,
): GraphEdgeDef {
  const from = pos.get(fromId)!;
  const to = pos.get(toId)!;
  const back = from.y + from.h > to.y + to.h;
  return { from: fromId, to: toId, label, path: back ? loopPath(from, to) : fwdPath(from, to) };
}

function fwdPath(a: Rect, b: Rect): string {
  const x1 = a.x + a.w / 2;
  const y1 = a.y + a.h;
  const x2 = b.x + b.w / 2;
  const y2 = b.y;
  if (Math.abs(x2 - x1) < 5) return `M${x1},${y1} L${x2},${y2}`;
  const my = (y1 + y2) / 2;
  return `M${x1},${y1} C${x1},${my} ${x2},${my} ${x2},${y2}`;
}

function loopPath(a: Rect, b: Rect): string {
  const x1 = a.x + a.w;
  const y1 = a.y + a.h / 2;
  const x2 = b.x + b.w;
  const y2 = b.y + b.h / 2;
  return `M${x1},${y1} C${x1 + 35},${y1} ${x2 + 35},${y2} ${x2},${y2}`;
}

export function findNodeById(
  nodes: GraphNodeDef[],
  id: string,
): GraphNodeDef | undefined {
  return nodes.find((n) => n.id === id);
}
