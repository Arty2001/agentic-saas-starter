import { useState } from "react";
import type { GraphNodeDef } from "../../data/graphDefinition";

interface Props {
  node: GraphNodeDef;
  isSelected: boolean;
  isActive: boolean;
  onClick: (id: string) => void;
}

const TYPE_STYLES: Record<string, { fill: string; stroke: string; rx: number }> = {
  start:    { fill: "var(--c-bg-tertiary)",  stroke: "var(--c-border)",        rx: 14 },
  end:      { fill: "var(--c-bg-tertiary)",  stroke: "var(--c-border)",        rx: 14 },
  main:     { fill: "var(--c-bg-elevated)",  stroke: "var(--c-border)",        rx: 6  },
  subgraph: { fill: "var(--c-bg-secondary)", stroke: "var(--c-border-subtle)", rx: 4  },
};

export default function GraphNode({ node, isSelected, isActive, onClick }: Props) {
  const [hovered, setHovered] = useState(false);
  const style = TYPE_STYLES[node.type] ?? TYPE_STYLES.main;
  const hasPrompts = node.promptKeys.length > 0;
  const interactive = hasPrompts;

  let stroke = style.stroke;
  let strokeWidth = 1.5;
  if (isActive) { stroke = "var(--color-running)"; strokeWidth = 2.5; }
  else if (isSelected) { stroke = "var(--color-brand)"; strokeWidth = 2.5; }
  else if (hovered && interactive) { stroke = "var(--color-brand)"; strokeWidth = 2; }

  const scale = hovered && interactive ? 1.02 : 1;
  const tx = node.x + node.w / 2;
  const ty = node.y + node.h / 2;

  return (
    <g
      onClick={() => interactive && onClick(node.id)}
      onMouseEnter={() => interactive && setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{ cursor: interactive ? "pointer" : "default" }}
      transform={`translate(${tx},${ty}) scale(${scale}) translate(${-tx},${-ty})`}
    >
      <rect
        x={node.x}
        y={node.y}
        width={node.w}
        height={node.h}
        rx={style.rx}
        fill={style.fill}
        stroke={stroke}
        strokeWidth={strokeWidth}
        className={isActive ? "graph-node-active" : ""}
        style={{ transition: "stroke 0.15s, stroke-width 0.15s" }}
      />
      <text
        x={node.x + node.w / 2}
        y={node.y + node.h / 2}
        textAnchor="middle"
        dominantBaseline="central"
        fontSize={node.type === "start" || node.type === "end" ? 10 : 12}
        fontWeight={node.type === "start" || node.type === "end" ? 500 : 600}
        fill={hasPrompts ? "var(--c-text-1)" : "var(--c-text-3)"}
        style={{ pointerEvents: "none", fontFamily: "var(--font-sans)" }}
      >
        {node.label}
      </text>
      {hasPrompts && (
        <circle
          cx={node.x + node.w - 6}
          cy={node.y + 6}
          r={3}
          fill={isSelected ? "var(--color-brand)" : hovered ? "var(--color-brand)" : "var(--c-text-3)"}
          opacity={0.6}
          style={{ transition: "fill 0.15s" }}
        />
      )}
    </g>
  );
}
