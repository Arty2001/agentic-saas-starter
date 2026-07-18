import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  regressionApi,
  type BaselineDetail,
  type JudgeTurnVerdict,
  type RegressionResult,
  type TurnSnapshot,
} from "../../api/regression";

interface Props {
  result: RegressionResult;
  onPromoted: () => void;
}

function fmtValue(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "string") return v;
  return JSON.stringify(v);
}

// ---------------------------------------------------------------------------
// Plain-language outcome banner
// ---------------------------------------------------------------------------

const OUTCOMES: Record<string, { color: string; title: string; detail: string }> = {
  passed: {
    color: "var(--color-success)",
    title: "Matched the baseline",
    detail: "Same routing, tool calls, and plan as the recorded baseline. The response text was identical or judged equivalent.",
  },
  baseline_created: {
    color: "#3b82f6",
    title: "Baseline recorded",
    detail: "First run of this test (or its definition changed) — this output was saved as the reference. Future runs are compared against it. Nothing was diffed.",
  },
  structural_diff: {
    color: "var(--color-error)",
    title: "Behavior changed vs the baseline",
    detail: "The agent's structured behavior (tool calls, plan items, routing, or termination) no longer matches the baseline. Each difference is listed below. If the new behavior is correct, promote this run to be the new baseline.",
  },
  text_diff: {
    color: "var(--color-warning)",
    title: "Same behavior, different response text",
    detail: "Tools, plan, and routing all matched the baseline, but the agent's reply text changed and the LLM judge ruled the meaning is different. Compare the two texts below — if the new wording is fine, promote this run.",
  },
  needs_review: {
    color: "#8b5cf6",
    title: "Text changed — judge unavailable",
    detail: "The reply text differs from the baseline but the LLM judge could not produce a verdict. Compare the texts below yourself.",
  },
  error: {
    color: "var(--color-error)",
    title: "Test could not complete",
    detail: "The run hit an error before it could be compared — no verdict about regressions. Details below.",
  },
  skipped: {
    color: "var(--c-text-3)",
    title: "Skipped",
    detail: "The run was cancelled before this test started.",
  },
};

function OutcomeBanner({ status }: { status: string }) {
  const o = OUTCOMES[status];
  if (!o) return null;
  return (
    <div className="p-3 rounded-lg" style={{ background: "var(--c-bg-secondary)", borderLeft: `3px solid ${o.color}` }}>
      <div className="text-[12px] font-semibold" style={{ color: o.color }}>{o.title}</div>
      <div className="text-[12px] mt-0.5" style={{ color: "var(--c-text-2)" }}>{o.detail}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Plan summary — human-readable instead of raw JSON
// ---------------------------------------------------------------------------

interface PlanItem {
  title?: string;
  name?: string;
  [key: string]: unknown;
}

function PlanSummary({ plan }: { plan: Record<string, unknown> }) {
  const items = (plan.items ?? plan.tasks ?? []) as PlanItem[];
  return (
    <div className="space-y-1.5">
      <div className="text-[11px] font-semibold" style={{ color: "var(--c-text-3)" }}>
        Proposed plan — {items.length} item{items.length === 1 ? "" : "s"}
      </div>
      {items.map((s, i) => (
        <div key={i} className="p-2 rounded" style={{ background: "var(--c-bg)", border: "1px solid var(--c-border-subtle)" }}>
          <div className="text-[12px] font-medium" style={{ color: "var(--c-text-1)" }}>
            {i + 1}. {s.title ?? s.name ?? `Item ${i + 1}`}
          </div>
          <div className="text-[11px] font-mono mt-0.5" style={{ color: "var(--c-text-3)" }}>
            {Object.entries(s)
              .filter(([k]) => k !== "title" && k !== "name")
              .map(([k, v]) => `${k}=${fmtValue(v)}`)
              .join("  ") || "no attributes"}
          </div>
        </div>
      ))}
      <details>
        <summary className="text-[10px] cursor-pointer" style={{ color: "var(--c-text-3)" }}>raw JSON</summary>
        <pre className="text-[10px] p-1.5 rounded overflow-x-auto" style={{ background: "var(--c-bg)", color: "var(--c-text-2)" }}>
          {JSON.stringify(plan, null, 2)}
        </pre>
      </details>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Judge comparison — baseline vs this run, side by side
// ---------------------------------------------------------------------------

function JudgeComparison({ verdict, currentText }: { verdict: JudgeTurnVerdict; currentText: string }) {
  const color =
    verdict.equivalent === true ? "var(--color-success)" : verdict.equivalent === false ? "var(--color-warning)" : "#8b5cf6";
  const baseline = verdict.baseline_text;
  const actual = verdict.actual_text ?? currentText;
  return (
    <div className="rounded" style={{ border: `1px solid ${color}` }}>
      <div className="px-2 py-1.5 text-[11px]" style={{ color: "var(--c-text-2)" }}>
        <span className="font-semibold" style={{ color }}>
          {verdict.equivalent === true
            ? "✓ Response text changed, but the judge ruled it means the same thing"
            : verdict.equivalent === false
              ? "✗ Response text changed AND means something different"
              : "? Response text changed — judge could not rule"}
        </span>
        {verdict.differences && <span> — {verdict.differences}</span>}
        {verdict.error && <span> — judge error: {verdict.error}</span>}
      </div>
      <div className="grid grid-cols-2 gap-0" style={{ borderTop: `1px solid var(--c-border-subtle)` }}>
        <div className="p-2">
          <div className="text-[10px] font-semibold uppercase tracking-wider mb-1" style={{ color: "var(--c-text-3)" }}>
            Baseline said
          </div>
          <div className="text-[11px] whitespace-pre-wrap" style={{ color: "var(--c-text-2)" }}>
            {baseline ?? "(not stored for this run — re-run to capture)"}
          </div>
        </div>
        <div className="p-2" style={{ borderLeft: "1px solid var(--c-border-subtle)" }}>
          <div className="text-[10px] font-semibold uppercase tracking-wider mb-1" style={{ color: "var(--c-text-3)" }}>
            This run said
          </div>
          <div className="text-[11px] whitespace-pre-wrap" style={{ color: "var(--c-text-2)" }}>{actual}</div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// One turn of the captured conversation
// ---------------------------------------------------------------------------

const TURN_LABELS: Record<string, string> = {
  message: "user message",
  approve: "user approved the plan",
  reject: "user rejected the plan",
  edit: "user asked to change the plan",
  clarification: "user answered a clarification",
  auto_approve: "auto-approved (policy)",
};

function VerdictStrip({ verdict }: { verdict: JudgeTurnVerdict }) {
  const color =
    verdict.equivalent === true ? "var(--color-success)" : verdict.equivalent === false ? "var(--color-warning)" : "#8b5cf6";
  return (
    <div className="px-2 py-1.5 rounded text-[11px]" style={{ border: `1px solid ${color}`, color: "var(--c-text-2)" }}>
      <span className="font-semibold" style={{ color }}>
        {verdict.equivalent === true
          ? "✓ Texts differ but the judge ruled they mean the same thing"
          : verdict.equivalent === false
            ? "✗ Judge: the responses mean different things"
            : "? Judge could not rule"}
      </span>
      {verdict.differences && <span> — {verdict.differences}</span>}
      {verdict.error && <span> — judge error: {verdict.error}</span>}
    </div>
  );
}

function TurnCard({
  turn,
  verdict,
  compact = false,
  highlight = false,
}: {
  turn: TurnSnapshot;
  verdict: JudgeTurnVerdict | undefined;
  compact?: boolean;
  highlight?: boolean;
}) {
  const input = turn.input as { type?: string; text?: string };
  return (
    <div
      className="p-2.5 rounded space-y-2 h-full"
      style={{
        background: "var(--c-bg-secondary)",
        border: highlight ? "1px solid var(--color-error)" : "1px solid transparent",
      }}
    >
      <div className="flex items-center gap-2 text-[11px]" style={{ color: "var(--c-text-3)" }}>
        <span className="font-semibold" style={{ color: "var(--c-text-2)" }}>Turn {turn.turn_index + 1}</span>
        <span className="px-1.5 py-0.5 rounded" style={{ background: "var(--c-bg-tertiary)" }}>
          {TURN_LABELS[input.type ?? ""] ?? input.type}
        </span>
        {turn.router_decision && <span>routed to {turn.router_decision}</span>}
        <span className="flex-1" />
        {turn.run_id && (
          <Link to={`/runs/${turn.run_id}`} className="hover:underline" style={{ color: "var(--color-brand)" }}>
            full trace ↗
          </Link>
        )}
      </div>

      {input.text && (
        <div className="text-[12px]" style={{ color: "var(--c-text-1)" }}>“{input.text}”</div>
      )}

      {turn.tool_calls.length > 0 && (
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-wider mb-0.5" style={{ color: "var(--c-text-3)" }}>
            Tools executed
          </div>
          {turn.tool_calls.map((tc, i) => (
            <div key={i} className="text-[11px] font-mono" style={{ color: "var(--c-text-2)" }}>
              <code>{tc.tool_name}</code> <span style={{ color: "var(--c-text-3)" }}>{JSON.stringify(tc.arguments)}</span>
            </div>
          ))}
        </div>
      )}

      {turn.plan != null && <PlanSummary plan={turn.plan} />}

      {turn.tool_clarification != null && (
        <div className="text-[11px]" style={{ color: "var(--c-text-2)" }}>
          <span className="font-semibold" style={{ color: "var(--c-text-3)" }}>Agent asked a clarification: </span>
          {String((turn.tool_clarification as { message?: string }).message ?? JSON.stringify(turn.tool_clarification))}
        </div>
      )}

      {turn.items_completed != null && (
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-wider mb-0.5" style={{ color: "var(--c-text-3)" }}>
            Item results
          </div>
          {(turn.items_completed as { name?: string; severity?: string; message?: string }[]).map((s, i) => (
            <div key={i} className="text-[11px]" style={{ color: "var(--c-text-2)" }}>
              <span style={{ color: s.severity === "error" ? "var(--color-error)" : "var(--color-success)" }}>
                {s.severity === "error" ? "✗" : "✓"}
              </span>{" "}
              {s.name} {s.message && <span style={{ color: "var(--c-text-3)" }}>— {s.message}</span>}
            </div>
          ))}
        </div>
      )}

      {verdict && !compact ? (
        <JudgeComparison verdict={verdict} currentText={turn.final_text} />
      ) : (
        turn.final_text && (
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-wider mb-0.5" style={{ color: "var(--c-text-3)" }}>
              Agent response
            </div>
            <div className="text-[11px] whitespace-pre-wrap" style={{ color: "var(--c-text-2)" }}>{turn.final_text}</div>
          </div>
        )
      )}

      {turn.awaiting_approval && (
        <div className="text-[11px]" style={{ color: "var(--c-text-3)" }}>
          ⏸ Turn ended with the agent waiting for plan approval (the next turn answers it).
        </div>
      )}

      {turn.error && (
        <div className="text-[11px]" style={{ color: "var(--color-error)" }}>
          {turn.error.message ?? JSON.stringify(turn.error)}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

export default function RegressionDiffView({ result, onPromoted }: Props) {
  const snapshot = result.snapshot;
  const judgeByTurn = new Map((result.judge?.verdicts ?? []).map((v) => [v.turn_index, v]));

  // The exact baseline this result was compared against (lazy: only when expanded).
  const [baseline, setBaseline] = useState<BaselineDetail | null>(null);
  useEffect(() => {
    if (!result.baseline_id || result.status === "baseline_created") return;
    let cancelled = false;
    regressionApi
      .getBaselineById(result.baseline_id)
      .then((b) => { if (!cancelled) setBaseline(b); })
      .catch(() => { /* comparison pane just stays hidden */ });
    return () => { cancelled = true; };
  }, [result.baseline_id, result.status]);

  // Turn indices touched by the structural diff (for highlighting).
  const changedTurns = new Set<number>();
  for (const d of result.diff) {
    const m = /^turns\[(\d+)\]/.exec(d.path);
    if (m) changedTurns.add(Number(m[1]));
  }

  const promote = async () => {
    if (!confirm("Accept this run's output as the new baseline? Future runs will be compared against it.")) return;
    try {
      await regressionApi.promote(result.test_id, result.id);
      onPromoted();
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : "Failed to promote");
    }
  };

  return (
    <div className="px-6 pb-4 space-y-3">
      <OutcomeBanner status={result.status} />

      {result.error && (
        <div className="p-2 rounded text-[12px]" style={{ background: "var(--c-bg-secondary)", color: "var(--color-error)" }}>
          {result.error}
        </div>
      )}

      {/* Structural diff table */}
      {result.diff.length > 0 && (
        <div>
          <h4 className="text-[11px] font-semibold uppercase tracking-wider mb-1" style={{ color: "var(--color-error)" }}>
            What changed ({result.diff.length})
          </h4>
          <div className="rounded overflow-hidden" style={{ border: "1px solid var(--c-border)" }}>
            <table className="w-full text-[11px] font-mono">
              <thead>
                <tr style={{ background: "var(--c-bg-elevated)", color: "var(--c-text-3)" }}>
                  <th className="text-left px-2 py-1.5">field</th>
                  <th className="text-left px-2 py-1.5">baseline had</th>
                  <th className="text-left px-2 py-1.5">this run has</th>
                </tr>
              </thead>
              <tbody>
                {result.diff.map((d, i) => (
                  <tr key={i} style={{ borderTop: "1px solid var(--c-border-subtle)" }}>
                    <td className="px-2 py-1.5 align-top" style={{ color: "var(--c-text-1)" }}>
                      {d.path} <span style={{ color: "var(--c-text-3)" }}>({d.kind})</span>
                    </td>
                    <td className="px-2 py-1.5 align-top break-all" style={{ color: "var(--color-error)" }}>{fmtValue(d.baseline)}</td>
                    <td className="px-2 py-1.5 align-top break-all" style={{ color: "var(--color-success)" }}>{fmtValue(d.actual)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Conversation: baseline vs this run side by side when a baseline exists */}
      {snapshot && baseline ? (
        <div>
          <div className="grid grid-cols-2 gap-2 mb-1">
            <h4 className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--c-text-3)" }}>
              Baseline (v{baseline.version}) — what it should do
              {typeof baseline.snapshot.meta.agent_type === "string" && (
                <span className="normal-case font-normal"> (recorded from {baseline.snapshot.meta.agent_type})</span>
              )}
            </h4>
            <h4 className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--c-text-3)" }}>
              This run — {result.agent_type}{" "}
              <span className="normal-case font-normal">
                ({result.mock_mode ? "mock tools" : "real saas-api"})
              </span>
            </h4>
          </div>
          <div className="space-y-2">
            {Array.from(
              { length: Math.max(baseline.snapshot.turns.length, snapshot.turns.length) },
              (_, i) => {
                const baseTurn = baseline.snapshot.turns[i];
                const runTurn = snapshot.turns[i];
                const verdict = judgeByTurn.get(i);
                return (
                  <div key={i}>
                    <div className="grid grid-cols-2 gap-2 items-stretch">
                      {baseTurn ? (
                        <TurnCard turn={baseTurn} verdict={undefined} compact highlight={changedTurns.has(i)} />
                      ) : (
                        <div className="p-2.5 rounded text-[11px] flex items-center" style={{ background: "var(--c-bg-secondary)", color: "var(--c-text-3)" }}>
                          (baseline has no turn {i + 1})
                        </div>
                      )}
                      {runTurn ? (
                        <TurnCard turn={runTurn} verdict={verdict} compact highlight={changedTurns.has(i)} />
                      ) : (
                        <div className="p-2.5 rounded text-[11px] flex items-center" style={{ background: "var(--c-bg-secondary)", color: "var(--c-text-3)" }}>
                          (this run has no turn {i + 1})
                        </div>
                      )}
                    </div>
                    {verdict && <div className="mt-1"><VerdictStrip verdict={verdict} /></div>}
                  </div>
                );
              },
            )}
          </div>
        </div>
      ) : (
        snapshot && (
          <div>
            <h4 className="text-[11px] font-semibold uppercase tracking-wider mb-1" style={{ color: "var(--c-text-3)" }}>
              {result.status === "baseline_created" ? "Recorded conversation (now the baseline)" : "This run's conversation"}{" "}
              <span className="normal-case font-normal">
                ({result.mock_mode ? "mock tools — no real API calls" : "real saas-api"})
              </span>
            </h4>
            <div className="space-y-1.5">
              {snapshot.turns.map((turn) => (
                <TurnCard key={turn.turn_index} turn={turn} verdict={judgeByTurn.get(turn.turn_index)} />
              ))}
            </div>
          </div>
        )
      )}

      {result.status !== "baseline_created" && result.snapshot && result.status !== "error" && (
        <button
          onClick={promote}
          className="px-3 py-1 rounded text-[12px] font-medium"
          style={{ border: "1px solid var(--color-brand)", color: "var(--color-brand)" }}
          title="Accept this run's output as the new baseline"
        >
          Promote to baseline
        </button>
      )}
    </div>
  );
}
