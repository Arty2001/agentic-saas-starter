import type { ExecutionStep } from "../../api/types";
import CollapsibleBlock from "../common/CollapsibleBlock";
import { ToolCallBlock } from "./ToolCallBlock";

interface ExecutionProgressProps {
  steps: ExecutionStep[];
}

function statusIcon(status: ExecutionStep["status"]): string {
  switch (status) {
    case "pending": return "\u25CB";
    case "running": return "\u25CF";
    case "done": return "\u2714";
    case "failed": return "\u2718";
  }
}

function statusColor(status: ExecutionStep["status"]): string {
  switch (status) {
    case "pending": return "var(--c-text-3)";
    case "running": return "var(--color-running)";
    case "done": return "var(--color-success)";
    case "failed": return "var(--color-error)";
  }
}

function formatDuration(startedAt?: string, completedAt?: string): string | null {
  if (!startedAt || !completedAt) return null;
  const ms = new Date(completedAt).getTime() - new Date(startedAt).getTime();
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export function ExecutionProgress({ steps }: ExecutionProgressProps) {
  return (
    <div className="space-y-2 pl-4 border-l-2" style={{ borderColor: "var(--c-border)" }}>
      {steps.map((execStep) => {
        const duration = formatDuration(execStep.startedAt, execStep.completedAt);
        const resultPreview =
          execStep.result && execStep.result.length > 100
            ? execStep.result.slice(0, 100) + "..."
            : execStep.result;

        return (
          <div key={execStep.stepIndex} className="relative">
            <div
              className="absolute -left-[calc(0.5rem+1px)] top-1 w-3 h-3 rounded-full border-2"
              style={{ borderColor: "var(--c-bg)", backgroundColor: statusColor(execStep.status) }}
            />

            <div className="ml-2 space-y-1">
              <div className="flex items-center gap-2 text-[13px]">
                <span className="font-medium" style={{ color: statusColor(execStep.status) }}>
                  {statusIcon(execStep.status)}
                </span>
                <span className="font-medium" style={{ color: "var(--c-text-1)" }}>
                  Step {execStep.stepIndex + 1}: {execStep.step.tool_name}
                </span>
                {duration && (
                  <span className="text-[11px]" style={{ color: "var(--c-text-3)" }}>({duration})</span>
                )}
              </div>

              {execStep.toolCalls.length > 0 && (
                <div className="space-y-1 ml-4">
                  {execStep.toolCalls.map((tc, idx) => (
                    <ToolCallBlock
                      key={`${execStep.stepIndex}-${idx}`}
                      toolName={tc.toolName}
                      arguments={tc.arguments}
                      result={tc.result}
                      defaultOpen={execStep.status === "running"}
                    />
                  ))}
                </div>
              )}

              {execStep.result && execStep.status === "done" && (
                <div className="ml-4">
                  {execStep.result.length > 100 ? (
                    <CollapsibleBlock title="Result" defaultOpen={false}>
                      <pre
                        className="text-[11px] font-mono rounded p-2 overflow-x-auto"
                        style={{ background: "var(--c-bg-tertiary)", color: "var(--c-text-2)" }}
                      >
                        {execStep.result}
                      </pre>
                    </CollapsibleBlock>
                  ) : (
                    <p
                      className="text-[12px] rounded p-2"
                      style={{ background: "var(--c-bg-tertiary)", color: "var(--c-text-2)" }}
                    >
                      {resultPreview}
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
