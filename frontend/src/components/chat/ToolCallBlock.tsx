import CollapsibleBlock from "../common/CollapsibleBlock";

interface ToolCallBlockProps {
  toolName: string;
  arguments: unknown;
  result?: string;
  error?: string;
  defaultOpen?: boolean;
}

export function ToolCallBlock({
  toolName,
  arguments: args,
  result,
  error,
  defaultOpen,
}: ToolCallBlockProps) {
  const isActive = !result && !error;
  const open = defaultOpen ?? isActive;

  const statusIcon = error ? "\u2718" : result ? "\u2714" : "\u25CB";
  const statusColor = error
    ? "var(--color-error)"
    : result
      ? "var(--color-success)"
      : "var(--color-running)";

  return (
    <CollapsibleBlock
      title={`${statusIcon} ${toolName}`}
      defaultOpen={open}
    >
      <div className="space-y-2">
        <div>
          <p className="text-[12px] font-medium mb-1" style={{ color: statusColor }}>
            {error ? "Failed" : result ? "Completed" : "Running..."}
          </p>
          <p className="text-[11px] mb-1" style={{ color: "var(--c-text-3)" }}>Arguments:</p>
          <pre
            className="text-[11px] font-mono rounded p-2 overflow-x-auto"
            style={{ background: "var(--c-bg-tertiary)", color: "var(--c-text-2)" }}
          >
            {JSON.stringify(args, null, 2)}
          </pre>
        </div>
        {result && (
          <div>
            <p className="text-[11px] mb-1" style={{ color: "var(--c-text-3)" }}>Result:</p>
            <pre
              className="text-[11px] font-mono rounded p-2 overflow-x-auto"
              style={{ background: "var(--c-bg-tertiary)", color: "var(--c-text-2)" }}
            >
              {result}
            </pre>
          </div>
        )}
        {error && (
          <div>
            <p className="text-[11px] mb-1" style={{ color: "var(--color-error)" }}>Error:</p>
            <pre
              className="text-[11px] font-mono rounded p-2 overflow-x-auto"
              style={{ background: "var(--color-error-subtle)", color: "var(--color-error)" }}
            >
              {error}
            </pre>
          </div>
        )}
      </div>
    </CollapsibleBlock>
  );
}
