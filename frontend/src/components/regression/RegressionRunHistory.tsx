import { useEffect, useState } from "react";
import { regressionApi, type RegressionRunSummary } from "../../api/regression";
import StatusChip from "./StatusChip";

interface Props {
  onViewRun: (runId: string) => void;
}

export default function RegressionRunHistory({ onViewRun }: Props) {
  const [runs, setRuns] = useState<RegressionRunSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    regressionApi
      .listRuns(100)
      .then((r) => {
        setRuns(r.runs);
        setLoading(false);
      })
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : String(e));
        setLoading(false);
      });
  }, []);

  if (loading) return <p className="text-[13px]" style={{ color: "var(--c-text-3)" }}>Loading…</p>;
  if (error) return <p className="text-[13px]" style={{ color: "var(--color-error)" }}>{error}</p>;
  if (runs.length === 0) return <p className="text-[13px]" style={{ color: "var(--c-text-3)" }}>No runs yet.</p>;

  return (
    <div className="rounded-lg overflow-hidden" style={{ border: "1px solid var(--c-border)" }}>
      <table className="w-full text-[12px]">
        <thead>
          <tr style={{ background: "var(--c-bg-elevated)", color: "var(--c-text-3)" }}>
            <th className="text-left px-3 py-2 font-semibold">Run</th>
            <th className="text-left px-3 py-2 font-semibold">Status</th>
            <th className="text-left px-3 py-2 font-semibold">Mode</th>
            <th className="text-left px-3 py-2 font-semibold">Results</th>
            <th className="text-left px-3 py-2 font-semibold">By</th>
            <th className="text-left px-3 py-2 font-semibold">Started</th>
            <th className="text-left px-3 py-2 font-semibold">Duration</th>
          </tr>
        </thead>
        <tbody>
          {runs.map((r) => (
            <tr
              key={r.id}
              className="cursor-pointer hover:bg-[var(--c-overlay)]"
              style={{ borderTop: "1px solid var(--c-border-subtle)" }}
              onClick={() => onViewRun(r.id)}
            >
              <td className="px-3 py-2 font-mono" style={{ color: "var(--c-text-1)" }}>{r.id.slice(0, 8)}</td>
              <td className="px-3 py-2"><StatusChip status={r.status} /></td>
              <td className="px-3 py-2" style={{ color: "var(--c-text-3)" }}>
                {r.mode}
                {r.agent_type ? ` · ${r.agent_type} only` : ""}
              </td>
              <td className="px-3 py-2" style={{ color: "var(--c-text-2)" }}>
                <span style={{ color: "var(--color-success)" }}>{r.passed}✓</span>{" "}
                <span style={{ color: "var(--color-error)" }}>{r.failed}✗</span>{" "}
                {r.needs_review > 0 && <span style={{ color: "#8b5cf6" }}>{r.needs_review}?</span>}{" "}
                {r.baselines_created > 0 && <span style={{ color: "#3b82f6" }}>{r.baselines_created}◎</span>}{" "}
                <span style={{ color: "var(--c-text-3)" }}>/ {r.total_tests}</span>
              </td>
              <td className="px-3 py-2" style={{ color: "var(--c-text-3)" }}>{r.triggered_by ?? "—"}</td>
              <td className="px-3 py-2" style={{ color: "var(--c-text-3)" }}>{new Date(r.started_at).toLocaleString()}</td>
              <td className="px-3 py-2 font-mono" style={{ color: "var(--c-text-3)" }}>
                {r.duration_ms == null ? "—" : r.duration_ms < 1000 ? `${r.duration_ms}ms` : `${(r.duration_ms / 1000).toFixed(1)}s`}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
