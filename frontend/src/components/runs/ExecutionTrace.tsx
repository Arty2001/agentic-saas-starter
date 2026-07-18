import type { EdgeDetail, StepDetail } from "../../api/types";
import { useState } from "react";

interface ExecutionTraceProps {
  steps: StepDetail[];
  edges: EdgeDetail[];
}

function fmtMs(ms: number | null): string {
  if (ms == null) return "-";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function prettify(raw: string | null): string {
  if (!raw) return "";
  try { return JSON.stringify(JSON.parse(raw), null, 2); }
  catch { return raw; }
}

function Expandable({ label, badge, defaultOpen, children }: {
  label: string; badge?: string; defaultOpen?: boolean; children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen ?? false);
  return (
    <div className="rounded-lg overflow-hidden" style={{ border: "1px solid var(--c-border)" }}>
      <button
        type="button"
        onClick={() => setOpen((p) => !p)}
        className="flex w-full items-center gap-2 px-3 py-2 text-[11px] font-medium transition-colors hover:bg-[var(--c-overlay)]"
        style={{ color: "var(--c-text-2)" }}
      >
        <svg className={`h-3 w-3 shrink-0 transition-transform duration-150 ${open ? "rotate-90" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
        </svg>
        <span>{label}</span>
        {badge && <span className="ml-auto text-[10px] px-1.5 py-0.5 rounded font-mono" style={{ background: "var(--c-bg-tertiary)", color: "var(--c-text-3)" }}>{badge}</span>}
      </button>
      {open && <div style={{ borderTop: "1px solid var(--c-border)" }}>{children}</div>}
    </div>
  );
}

function CodeBlock({ content, maxHeight }: { content: string; maxHeight?: string }) {
  return (
    <pre
      className="text-[11px] font-mono whitespace-pre-wrap break-all p-3 overflow-auto"
      style={{ background: "var(--c-code-bg)", color: "var(--c-text-2)", maxHeight: maxHeight ?? "400px" }}
    >
      {content || <span style={{ color: "var(--c-text-3)", fontStyle: "italic" }}>empty</span>}
    </pre>
  );
}

const NODE_COLORS: Record<string, string> = {
  router: "#2563eb", clarifier: "#d97706", dispatcher: "#7c3aed",
  responder: "#16a34a", planner: "#4f46e5", present_plan: "#ea580c",
  executor: "#dc2626", replanner: "#db2777", chat: "#0d9488",
};

function NodeBox({ step, edges, prevStep }: { step: StepDetail; edges: EdgeDetail[]; prevStep: StepDetail | null }) {
  const connectingEdge = prevStep ? edges.find((e) => e.from_node === prevStep.node_name && e.to_node === step.node_name) : null;
  const borderColor = NODE_COLORS[step.node_name] ?? "#a8a29e";

  return (
    <div>
      {prevStep && (
        <div className="flex flex-col items-center py-1">
          <div className="w-px h-4" style={{ background: "var(--c-border)" }} />
          {connectingEdge?.condition && (
            <span className="text-[10px] px-2 py-0.5 rounded font-mono" style={{ background: "var(--c-bg-tertiary)", color: "var(--c-text-3)" }}>
              {connectingEdge.condition}
            </span>
          )}
          <svg className="h-2 w-3" viewBox="0 0 12 8" style={{ color: "var(--c-border)" }} fill="currentColor"><path d="M6 8L0 0h12z" /></svg>
        </div>
      )}

      <div className="rounded-lg overflow-hidden" style={{ border: "1px solid var(--c-border)", borderLeftWidth: "3px", borderLeftColor: borderColor, background: "var(--c-bg-elevated)" }}>
        <div className="flex items-center justify-between px-4 py-2">
          <div className="flex items-center gap-2">
            <h4 className="text-[13px] font-bold font-mono" style={{ color: "var(--c-text-1)" }}>{step.node_name}</h4>
            {step.duration_ms != null && (
              <span className="text-[10px] px-1.5 py-0.5 rounded font-mono" style={{ background: "var(--c-bg-tertiary)", color: "var(--c-text-3)" }}>{fmtMs(step.duration_ms)}</span>
            )}
          </div>
          <span className="text-[10px] font-mono" style={{ color: "var(--c-text-3)" }}>{new Date(step.started_at).toLocaleTimeString()}</span>
        </div>

        {(step.llm_calls.length > 0 || step.tool_calls.length > 0 || step.input_state || step.output_state) && (
          <div className="px-4 pb-3 space-y-2">
            {(step.input_state || step.output_state) && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {step.input_state && <Expandable label="Input State"><CodeBlock content={prettify(step.input_state)} /></Expandable>}
                {step.output_state && <Expandable label="Output State"><CodeBlock content={prettify(step.output_state)} /></Expandable>}
              </div>
            )}

            {step.llm_calls.map((lc) => (
              <Expandable
                key={lc.id}
                label={`LLM: ${lc.provider}/${lc.model.split("/").pop()}`}
                badge={`${lc.input_tokens ?? 0} in / ${lc.output_tokens ?? 0} out  \u00b7  ${fmtMs(lc.duration_ms)}`}
              >
                <div>
                  {lc.messages && (
                    <div>
                      <div className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wider" style={{ color: "var(--c-text-3)", background: "var(--c-bg-tertiary)" }}>Input Messages</div>
                      <CodeBlock content={prettify(lc.messages)} maxHeight="500px" />
                    </div>
                  )}
                  {lc.response && (
                    <div>
                      <div className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wider" style={{ color: "var(--c-text-3)", background: "var(--c-bg-tertiary)", borderTop: "1px solid var(--c-border)" }}>Response</div>
                      <CodeBlock content={prettify(lc.response)} maxHeight="500px" />
                    </div>
                  )}
                  {!lc.messages && !lc.response && (
                    <div className="px-3 py-2 text-[11px]" style={{ color: "var(--c-text-3)" }}>Tokens: {lc.input_tokens ?? 0} in / {lc.output_tokens ?? 0} out</div>
                  )}
                </div>
              </Expandable>
            ))}

            {step.tool_calls.map((tc) => (
              <Expandable key={tc.id} label={`Tool: ${tc.tool_name}`} badge={tc.error ? "error" : fmtMs(tc.duration_ms)} defaultOpen={!!tc.error}>
                <div>
                  {tc.arguments && (
                    <div>
                      <div className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wider" style={{ color: "var(--c-text-3)", background: "var(--c-bg-tertiary)" }}>Arguments</div>
                      <CodeBlock content={prettify(tc.arguments)} maxHeight="300px" />
                    </div>
                  )}
                  {tc.result && (
                    <div>
                      <div className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wider" style={{ color: "var(--c-text-3)", background: "var(--c-bg-tertiary)", borderTop: "1px solid var(--c-border)" }}>Result</div>
                      <CodeBlock content={prettify(tc.result)} maxHeight="300px" />
                    </div>
                  )}
                  {tc.error && (
                    <div>
                      <div className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wider" style={{ background: "var(--color-error-subtle)", color: "var(--color-error)", borderTop: "1px solid var(--c-border)" }}>Error</div>
                      <pre className="text-[11px] font-mono whitespace-pre-wrap break-all p-3" style={{ color: "var(--color-error)" }}>{tc.error}</pre>
                    </div>
                  )}
                </div>
              </Expandable>
            ))}
          </div>
        )}

        {step.llm_calls.length === 0 && step.tool_calls.length === 0 && !step.input_state && !step.output_state && (
          <div className="px-4 pb-3">
            <p className="text-[11px] italic" style={{ color: "var(--c-text-3)" }}>No calls recorded</p>
          </div>
        )}
      </div>
    </div>
  );
}

function mergeSteps(steps: StepDetail[]): StepDetail[] {
  const INTERNAL = new Set(["LangGraph", "RunnableSequence", "RunnableLambda", "route_decision"]);
  const merged: StepDetail[] = [];
  for (const step of steps) {
    if (INTERNAL.has(step.node_name) && step.llm_calls.length === 0 && step.tool_calls.length === 0) continue;
    const prev = merged[merged.length - 1];
    if (prev && prev.node_name === step.node_name) {
      prev.llm_calls = [...prev.llm_calls, ...step.llm_calls];
      prev.tool_calls = [...prev.tool_calls, ...step.tool_calls];
      prev.ended_at = step.ended_at ?? prev.ended_at;
      if (step.duration_ms != null) prev.duration_ms = (prev.duration_ms ?? 0) + step.duration_ms;
      continue;
    }
    merged.push({ ...step, llm_calls: [...step.llm_calls], tool_calls: [...step.tool_calls] });
  }
  return merged.filter((s) => s.llm_calls.length > 0 || s.tool_calls.length > 0 || !INTERNAL.has(s.node_name));
}

export default function ExecutionTrace({ steps, edges }: ExecutionTraceProps) {
  if (steps.length === 0) return <p className="text-[13px]" style={{ color: "var(--c-text-3)" }}>No execution steps recorded.</p>;

  const displaySteps = mergeSteps(steps);
  const totalLlm = displaySteps.reduce((n, s) => n + s.llm_calls.length, 0);
  const totalTools = displaySteps.reduce((n, s) => n + s.tool_calls.length, 0);
  const totalTokensIn = displaySteps.reduce((n, s) => n + s.llm_calls.reduce((t, lc) => t + (lc.input_tokens ?? 0), 0), 0);
  const totalTokensOut = displaySteps.reduce((n, s) => n + s.llm_calls.reduce((t, lc) => t + (lc.output_tokens ?? 0), 0), 0);

  return (
    <div>
      <div className="flex flex-wrap gap-4 mb-4 text-[11px] font-mono" style={{ color: "var(--c-text-3)" }}>
        <span>{displaySteps.length} nodes</span>
        <span>{totalLlm} LLM calls</span>
        <span>{totalTools} tool calls</span>
        <span>{totalTokensIn.toLocaleString()} tokens in</span>
        <span>{totalTokensOut.toLocaleString()} tokens out</span>
      </div>

      <div className="flex flex-col items-stretch max-w-3xl">
        <div className="flex justify-center">
          <span className="text-[10px] font-mono font-bold px-3 py-1 rounded" style={{ background: "var(--c-bg-tertiary)", color: "var(--c-text-3)" }}>START</span>
        </div>
        <div className="flex flex-col items-center py-1">
          <svg className="h-2 w-3" viewBox="0 0 12 8" style={{ color: "var(--c-border)" }} fill="currentColor"><path d="M6 8L0 0h12z" /></svg>
        </div>

        {displaySteps.map((step, idx) => (
          <NodeBox key={step.id} step={step} edges={edges} prevStep={idx > 0 ? displaySteps[idx - 1] : null} />
        ))}

        <div className="flex flex-col items-center py-1">
          <div className="w-px h-4" style={{ background: "var(--c-border)" }} />
          <svg className="h-2 w-3" viewBox="0 0 12 8" style={{ color: "var(--c-border)" }} fill="currentColor"><path d="M6 8L0 0h12z" /></svg>
        </div>
        <div className="flex justify-center">
          <span className="text-[10px] font-mono font-bold px-3 py-1 rounded" style={{ background: "var(--c-bg-tertiary)", color: "var(--c-text-3)" }}>END</span>
        </div>
      </div>
    </div>
  );
}
