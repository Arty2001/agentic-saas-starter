import type { GraphEdgeDef } from "../../data/graphDefinition";

interface Props {
  edge: GraphEdgeDef;
}

export default function GraphEdge({ edge }: Props) {
  return (
    <g>
      <path
        d={edge.path}
        fill="none"
        stroke="var(--c-text-3)"
        strokeWidth={1.2}
        markerEnd="url(#arrowhead)"
        opacity={0.4}
      />
      {edge.label && (
        <EdgeLabel
          path={edge.path}
          label={edge.label}
          explicitX={edge.labelX}
          explicitY={edge.labelY}
        />
      )}
    </g>
  );
}

function EdgeLabel({
  path,
  label,
  explicitX,
  explicitY,
}: {
  path: string;
  label: string;
  explicitX?: number;
  explicitY?: number;
}) {
  let lx: number;
  let ly: number;

  if (explicitX !== undefined && explicitY !== undefined) {
    lx = explicitX;
    ly = explicitY;
  } else {
    // Fallback: extract midpoint from SVG path coordinates
    const nums = path.match(/-?\d+(\.\d+)?/g)?.map(Number) ?? [];
    if (nums.length < 4) return null;
    const x1 = nums[0], y1 = nums[1];
    const x2 = nums[nums.length - 2], y2 = nums[nums.length - 1];
    lx = (x1 + x2) / 2;
    ly = (y1 + y2) / 2 - 4;
  }

  return (
    <text
      x={lx}
      y={ly}
      textAnchor="middle"
      fontSize={7.5}
      fill="var(--c-text-3)"
      opacity={0.6}
      style={{ fontFamily: "var(--font-mono)", pointerEvents: "none" }}
    >
      {label}
    </text>
  );
}
