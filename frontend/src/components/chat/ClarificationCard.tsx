import { useState } from "react";
import type { ToolClarificationData } from "../../api/types";

interface ClarificationCardProps {
  data: ToolClarificationData;
  response: Record<string, unknown> | null;
  status: "pending" | "resolved";
  onRespond: (response: Record<string, unknown>) => void;
  onSubmit: () => void;
}

/**
 * Renders a single mid-execution tool clarification request.
 * Shows what went wrong, lists available options as clickable chips,
 * and lets the user pick a correction. One card at a time (queue style).
 */
export function ClarificationCard({
  data,
  response,
  status,
  onRespond,
  onSubmit,
}: ClarificationCardProps) {
  const [selectedValue, setSelectedValue] = useState<string>(() => {
    if (!response) return "";
    const vals = Object.values(response);
    if (vals.length && Array.isArray(vals[0]) && vals[0].length) return vals[0][0] as string;
    if (vals.length && typeof vals[0] === "string") return vals[0] as string;
    return "";
  });

  const isResolved = status === "resolved";
  const toolResponse = data.tool_response ?? {};
  const baseMessage = (toolResponse.error ?? toolResponse.message ?? data.message) as string;
  // clarification_round > 1 means the previous answer didn't match either.
  const errorMessage =
    (data.clarification_round ?? 1) > 1
      ? `That answer still didn't match any of the available options. ${baseMessage}`
      : baseMessage;
  // Tools describe their own options and which param the answer corrects
  // (answer_key), so this card needs zero domain knowledge.
  const rawOptions = (toolResponse.suggestedOptions ?? toolResponse.availableOptions ?? []) as Array<
    string | { name?: string }
  >;
  const options = rawOptions
    .map((o) => (typeof o === "string" ? o : o?.name ?? ""))
    .filter(Boolean);
  const remaining = data.remaining ?? 1;

  const handleSelect = (name: string) => {
    if (isResolved) return;
    setSelectedValue(name);
    onRespond({ [data.answer_key ?? "value"]: name });
  };

  return (
    <div
      className="rounded-lg overflow-hidden max-w-[85%]"
      style={{
        border: "1px solid var(--c-warning, #f59e0b)",
        background: "var(--c-bg-secondary)",
      }}
    >
      {/* Header */}
      <div
        className="px-4 py-2 flex items-center gap-2 text-[13px] font-semibold"
        style={{
          background: "color-mix(in srgb, var(--c-warning, #f59e0b) 12%, transparent)",
          color: "var(--c-warning, #f59e0b)",
        }}
      >
        <span>Clarification needed</span>
        <span className="font-normal" style={{ color: "var(--c-text-3)" }}>
          — {data.item_name}
        </span>
        {remaining > 1 && !isResolved && (
          <span
            className="text-[11px] px-2 py-0.5 rounded font-medium"
            style={{ background: "var(--c-bg-tertiary)", color: "var(--c-text-2)" }}
          >
            +{remaining - 1} more
          </span>
        )}
        {isResolved && (
          <span
            className="ml-auto text-[11px] px-2 py-0.5 rounded font-medium"
            style={{ background: "var(--c-bg-tertiary)", color: "var(--c-text-2)" }}
          >
            Resolved
          </span>
        )}
      </div>

      {/* Body */}
      <div className="px-4 py-3 space-y-2">
        <p className="text-[13px]" style={{ color: "var(--c-text-1)" }}>
          {errorMessage}
        </p>

        {/* Available options as clickable chips */}
        {!isResolved && options.length > 0 && (
          <OptionChips
            label="Options"
            options={options}
            selected={selectedValue}
            onSelect={handleSelect}
          />
        )}

        {/* Show selection in resolved state */}
        {isResolved && selectedValue && (
          <p className="text-[12px]" style={{ color: "var(--c-text-3)" }}>
            Selected: <span className="font-medium" style={{ color: "var(--c-text-1)" }}>{selectedValue}</span>
          </p>
        )}

        {/* Submit button */}
        {!isResolved && (
          <div className="flex justify-end pt-1">
            <button
              type="button"
              onClick={onSubmit}
              disabled={!selectedValue}
              className="text-[13px] font-medium px-4 py-1.5 rounded cursor-pointer transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              style={{
                background: "var(--c-accent, #3b82f6)",
                color: "#fff",
              }}
            >
              Submit
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function OptionChips({
  label,
  options,
  selected,
  onSelect,
}: {
  label: string;
  options: string[];
  selected: string;
  onSelect: (value: string) => void;
}) {
  return (
    <div>
      <p className="text-[12px] font-medium mb-1.5" style={{ color: "var(--c-text-2)" }}>
        {label}:
      </p>
      <div className="flex flex-wrap gap-1.5">
        {options.map((name) => (
          <button
            key={name}
            type="button"
            onClick={() => onSelect(name)}
            className="text-[12px] px-2.5 py-1 rounded cursor-pointer transition-colors"
            style={{
              background: selected === name
                ? "var(--c-accent, #3b82f6)"
                : "var(--c-bg-tertiary)",
              color: selected === name ? "#fff" : "var(--c-text-1)",
              border: `1px solid ${
                selected === name
                  ? "var(--c-accent, #3b82f6)"
                  : "var(--c-border)"
              }`,
            }}
          >
            {name}
          </button>
        ))}
      </div>
    </div>
  );
}
