import type { RegressionTurn, TurnType } from "../../api/regression";

interface Props {
  turns: RegressionTurn[];
  onChange: (turns: RegressionTurn[]) => void;
}

const TURN_TYPES: { value: TurnType; label: string; hint: string }[] = [
  { value: "message", label: "Message", hint: "Send a user prompt" },
  { value: "approve", label: "Approve", hint: "Approve the pending plan" },
  { value: "reject", label: "Reject", hint: "Reject the pending plan" },
  { value: "edit", label: "Edit plan", hint: "Natural-language feedback that re-runs the planner" },
  { value: "clarification", label: "Answer clarification", hint: 'JSON like {"categoryNames": ["Engineering"]} or plain text' },
];

function defaultTurn(type: TurnType): RegressionTurn {
  switch (type) {
    case "message":
      return { type: "message", text: "" };
    case "approve":
      return { type: "approve" };
    case "reject":
      return { type: "reject" };
    case "edit":
      return { type: "edit", text: "" };
    case "clarification":
      return { type: "clarification", response: "" };
  }
}

function clarificationText(response: unknown): string {
  if (typeof response === "string") return response;
  try {
    return JSON.stringify(response);
  } catch {
    return String(response);
  }
}

export default function TurnBuilder({ turns, onChange }: Props) {
  const update = (i: number, turn: RegressionTurn) => {
    const next = [...turns];
    next[i] = turn;
    onChange(next);
  };

  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= turns.length) return;
    const next = [...turns];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };

  return (
    <div className="space-y-2">
      {turns.map((turn, i) => {
        const meta = TURN_TYPES.find((t) => t.value === turn.type);
        return (
          <div
            key={i}
            className="flex items-start gap-2 p-2 rounded"
            style={{ background: "var(--c-bg-secondary)", border: "1px solid var(--c-border-subtle)" }}
          >
            <span className="text-[11px] font-mono pt-1.5 w-6 text-right" style={{ color: "var(--c-text-3)" }}>
              {i + 1}.
            </span>
            <select
              value={turn.type}
              onChange={(e) => update(i, defaultTurn(e.target.value as TurnType))}
              className="text-[12px] px-1.5 py-1 rounded"
              style={{ background: "var(--c-bg)", color: "var(--c-text-1)", border: "1px solid var(--c-border)" }}
            >
              {TURN_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>

            <div className="flex-1 min-w-0">
              {(turn.type === "message" || turn.type === "edit") && (
                <textarea
                  value={turn.text}
                  onChange={(e) => update(i, { ...turn, text: e.target.value })}
                  placeholder={turn.type === "message" ? "User prompt…" : "Plan feedback, e.g. “make it 3 tasks”…"}
                  rows={2}
                  className="w-full text-[12px] px-2 py-1.5 rounded resize-y"
                  style={{ background: "var(--c-bg)", color: "var(--c-text-1)", border: "1px solid var(--c-border)" }}
                />
              )}
              {turn.type === "clarification" && (
                <input
                  value={clarificationText(turn.response)}
                  onChange={(e) => {
                    const raw = e.target.value;
                    let parsed: unknown = raw;
                    try {
                      parsed = JSON.parse(raw);
                    } catch {
                      /* keep as string */
                    }
                    update(i, { type: "clarification", response: parsed });
                  }}
                  placeholder='{"categoryNames": ["Engineering"]}'
                  className="w-full text-[12px] font-mono px-2 py-1.5 rounded"
                  style={{ background: "var(--c-bg)", color: "var(--c-text-1)", border: "1px solid var(--c-border)" }}
                />
              )}
              {(turn.type === "approve" || turn.type === "reject") && (
                <div className="text-[11px] pt-1.5" style={{ color: "var(--c-text-3)" }}>
                  {meta?.hint}
                </div>
              )}
            </div>

            <div className="flex items-center gap-1 pt-1">
              <button onClick={() => move(i, -1)} disabled={i === 0} className="text-[11px] px-1 disabled:opacity-30" style={{ color: "var(--c-text-3)" }} title="Move up">▲</button>
              <button onClick={() => move(i, 1)} disabled={i === turns.length - 1} className="text-[11px] px-1 disabled:opacity-30" style={{ color: "var(--c-text-3)" }} title="Move down">▼</button>
              <button
                onClick={() => onChange(turns.filter((_, j) => j !== i))}
                disabled={turns.length === 1}
                className="text-[11px] px-1 disabled:opacity-30"
                style={{ color: "var(--color-error)" }}
                title="Remove turn"
              >
                ✕
              </button>
            </div>
          </div>
        );
      })}

      <button
        onClick={() => onChange([...turns, defaultTurn(turns.length === 0 ? "message" : "approve")])}
        className="text-[12px] px-2 py-1 rounded font-medium"
        style={{ color: "var(--color-brand)", border: "1px dashed var(--c-border)" }}
      >
        + Add turn
      </button>
    </div>
  );
}
