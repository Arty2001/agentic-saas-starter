interface SystemEventProps {
  eventType: string;
  data: unknown;
}

const EVENT_CONFIG: Record<string, { label: string }> = {
  router_decision: { label: "Router" },
  clarification: { label: "Clarification" },
  tool_call: { label: "Tool Call" },
  tool_result: { label: "Tool Result" },
  step_start: { label: "Step Start" },
  step_complete: { label: "Step Done" },
  done: { label: "Done" },
};

function formatData(eventType: string, data: unknown): string {
  if (!data || typeof data !== "object") return String(data);
  const d = data as Record<string, unknown>;
  switch (eventType) {
    case "router_decision": {
      const agent = d.selectedAgent ?? d.selected_agent ?? "unknown";
      return `${d.decision} \u2192 ${agent}`;
    }
    case "tool_call":
      return `${d.tool_name ?? d.toolName}(${JSON.stringify(d.arguments ?? {})})`;
    case "tool_result": {
      const result = String(d.result ?? "");
      return `${d.tool_name ?? d.toolName} \u2192 ${result.length > 100 ? result.slice(0, 100) + "..." : result}`;
    }
    case "step_start":
      return `#${d.step_index} ${(d.step as Record<string, unknown>)?.tool_name ?? ""}`;
    case "step_complete": {
      const res = String(d.result ?? "");
      return `#${d.step_index ?? 0} \u2192 ${res.length > 100 ? res.slice(0, 100) + "..." : res}`;
    }
    case "clarification":
      return (d.content as string) ?? "";
    case "done":
      return d.awaiting_approval ? "awaiting approval" : "complete";
    default:
      return JSON.stringify(data);
  }
}

export function SystemEvent({ eventType, data }: SystemEventProps) {
  const config = EVENT_CONFIG[eventType] ?? { label: eventType };
  const content = formatData(eventType, data);

  return (
    <div className="flex justify-center my-1">
      <div
        className="inline-flex items-center gap-1.5 text-[11px] font-mono px-3 py-1 rounded max-w-[90%] truncate"
        style={{ background: "var(--c-bg-tertiary)", color: "var(--c-text-3)" }}
      >
        <span className="font-semibold" style={{ color: "var(--c-text-2)" }}>{config.label}</span>
        <span className="opacity-70 truncate">{content}</span>
      </div>
    </div>
  );
}
