import { useState } from "react";
import type {
  GraphNodeDef,
  GraphEdgeDef,
  SubgraphDef,
} from "../../data/graphDefinition";
import GraphNode from "./GraphNode";
import GraphEdge from "./GraphEdge";

interface Props {
  nodes: GraphNodeDef[];
  edges: GraphEdgeDef[];
  subgraphs: SubgraphDef[];
  viewBoxWidth: number;
  viewBoxHeight: number;
  selectedNodeId: string | null;
  activeNodeId: string | null;
  onNodeSelect: (id: string) => void;
  onSubgraphToggle: (id: string) => void;
}

export default function AgentGraph({
  nodes,
  edges,
  subgraphs,
  viewBoxWidth,
  viewBoxHeight,
  selectedNodeId,
  activeNodeId,
  onNodeSelect,
  onSubgraphToggle,
}: Props) {
  return (
    <svg
      viewBox={`0 0 ${viewBoxWidth} ${viewBoxHeight}`}
      className="w-full h-full"
      style={{ maxHeight: "100%" }}
    >
      <defs>
        <marker
          id="arrowhead"
          markerWidth="8"
          markerHeight="6"
          refX="7"
          refY="3"
          orient="auto"
        >
          <polygon
            points="0 0, 8 3, 0 6"
            fill="var(--c-text-3)"
            opacity={0.5}
          />
        </marker>
      </defs>

      {/* Subgraph containers */}
      {subgraphs.map((sg) => (
        <SubgraphContainer
          key={sg.id}
          sg={sg}
          onToggle={onSubgraphToggle}
        />
      ))}

      {/* Edges */}
      {edges.map((e, i) => (
        <GraphEdge key={i} edge={e} />
      ))}

      {/* Nodes */}
      {nodes.map((n) => (
        <GraphNode
          key={n.id}
          node={n}
          isSelected={selectedNodeId === n.id}
          isActive={activeNodeId === n.id}
          onClick={onNodeSelect}
        />
      ))}
    </svg>
  );
}

// ── Subgraph container with hover + collapse ─────────────────────────────

function SubgraphContainer({
  sg,
  onToggle,
}: {
  sg: SubgraphDef;
  onToggle: (id: string) => void;
}) {
  const [hovered, setHovered] = useState(false);

  return (
    <g
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <rect
        x={sg.x}
        y={sg.y}
        width={sg.w}
        height={sg.h}
        rx={8}
        fill={hovered ? "var(--c-bg-secondary)" : "var(--c-overlay)"}
        stroke={hovered ? "var(--c-text-3)" : "var(--c-border)"}
        strokeWidth={hovered ? 1.2 : 1}
        strokeDasharray="6 3"
        style={{ transition: "fill 0.15s, stroke 0.15s" }}
      />

      {/* Clickable header */}
      <g
        onClick={() => onToggle(sg.id)}
        style={{ cursor: "pointer" }}
      >
        <rect
          x={sg.x}
          y={sg.y}
          width={sg.w}
          height={sg.collapsed ? sg.h : 20}
          rx={8}
          fill="transparent"
        />
        <text
          x={sg.x + 10}
          y={sg.y + 14}
          fontSize={9}
          fill={hovered ? "var(--c-text-1)" : "var(--c-text-3)"}
          opacity={hovered ? 0.9 : 0.65}
          style={{
            fontFamily: "var(--font-mono)",
            pointerEvents: "none",
            transition: "fill 0.15s, opacity 0.15s",
          }}
        >
          {sg.collapsed ? "▸" : "▾"} {sg.label}
          {sg.collapsed ? ` (${sg.nodeCount})` : ""}
        </text>
      </g>
    </g>
  );
}
