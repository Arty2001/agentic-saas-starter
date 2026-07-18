import { useEffect, useState } from "react";
import { regressionApi, type RegressionResult, type RegressionRunDetail } from "../../api/regression";
import RegressionDiffView from "./RegressionDiffView";
import StatusChip from "./StatusChip";

interface Props {
  runId: string | null;
}

/** Keep a test's per-agent results adjacent (tests ordered by first appearance). */
function groupByTest(results: RegressionResult[]): RegressionResult[] {
  const groups = new Map<string, RegressionResult[]>();
  for (const r of results) {
    const group = groups.get(r.test_id);
    if (group) group.push(r);
    else groups.set(r.test_id, [r]);
  }
  return [...groups.values()].flat();
}

function ResultRow({ result, onPromoted }: { result: RegressionResult; onPromoted: () => void }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div style={{ borderBottom: "1px solid var(--c-border-subtle)" }}>
      <div
        className="flex items-center gap-3 px-4 py-3 cursor-pointer transition-colors hover:bg-[var(--c-overlay)]"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex-1 min-w-0">
          <div className="text-[13px] font-medium truncate" style={{ color: "var(--c-text-1)" }}>
            {result.test_name}
            <span
              className="ml-2 text-[10px] px-1.5 py-0.5 rounded font-medium align-middle"
              style={{ background: "var(--c-bg-tertiary)", color: "var(--c-text-2)" }}
              title="Agent this execution ran as — same-test rows share one baseline, so they compare agents head-to-head"
            >
              {result.agent_type}
            </span>
          </div>
          <div className="text-[11px] truncate" style={{ color: "var(--c-text-3)" }}>
            {result.mock_mode ? "mock" : "real"}
            {result.test_tags.length > 0 && ` · ${result.test_tags.join(", ")}`}
            {result.diff.length > 0 && ` · ${result.diff.length} structural change${result.diff.length === 1 ? "" : "s"}`}
          </div>
        </div>
        <StatusChip status={result.status} />
        {result.duration_ms != null && (
          <span className="text-[11px] font-mono" style={{ color: "var(--c-text-3)" }}>
            {result.duration_ms < 1000 ? `${result.duration_ms}ms` : `${(result.duration_ms / 1000).toFixed(1)}s`}
          </span>
        )}
        <span className="text-[11px]" style={{ color: "var(--c-text-3)" }}>{expanded ? "▲" : "▼"}</span>
      </div>
      {expanded && <RegressionDiffView result={result} onPromoted={onPromoted} />}
    </div>
  );
}

export default function RegressionRunReport({ runId }: Props) {
  const [data, setData] = useState<RegressionRunDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pollCount, setPollCount] = useState(0);

  useEffect(() => {
    if (!runId) return;
    regressionApi
      .getRun(runId)
      .then(setData)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, [runId, pollCount]);

  useEffect(() => {
    if (!data || (data.status !== "pending" && data.status !== "running")) return;
    const timer = setInterval(() => setPollCount((c) => c + 1), 3000);
    return () => clearInterval(timer);
  }, [data?.status]);

  if (!runId) {
    return <p className="text-[13px]" style={{ color: "var(--c-text-3)" }}>Run tests from the suite to see a report here.</p>;
  }
  if (error) {
    return <p className="text-[13px]" style={{ color: "var(--color-error)" }}>{error}</p>;
  }
  if (!data) {
    return <p className="text-[13px]" style={{ color: "var(--c-text-3)" }}>Loading…</p>;
  }

  const isRunning = data.status === "pending" || data.status === "running";

  return (
    <div>
      <div
        className="flex items-center gap-4 mb-4 px-4 py-3 rounded-lg flex-wrap"
        style={{ background: "var(--c-bg-elevated)", border: "1px solid var(--c-border)" }}
      >
        <span className="text-[13px] font-semibold font-mono" style={{ color: "var(--c-text-1)" }}>
          {data.id.slice(0, 8)}
        </span>
        <StatusChip status={data.status} />
        {data.mode === "rebaseline" && (
          <span className="text-[11px] px-1.5 py-0.5 rounded" style={{ background: "var(--c-bg-tertiary)", color: "var(--c-text-3)" }}>
            re-record mode
          </span>
        )}
        {data.agent_type && (
          <span
            className="text-[11px] px-1.5 py-0.5 rounded"
            style={{ background: "var(--c-bg-tertiary)", color: "var(--c-text-3)" }}
            title="This run was scoped to one agent by the top-left selector"
          >
            {data.agent_type} only
          </span>
        )}
        <span className="text-[12px] font-mono" style={{ color: "var(--c-text-3)" }}>
          {data.completed_tests}/{data.total_tests}
        </span>
        <span className="text-[12px]" style={{ color: "var(--color-success)" }}>{data.passed} passed</span>
        <span className="text-[12px]" style={{ color: "var(--color-error)" }}>{data.failed} failed</span>
        {data.needs_review > 0 && <span className="text-[12px]" style={{ color: "#8b5cf6" }}>{data.needs_review} needs review</span>}
        {data.baselines_created > 0 && <span className="text-[12px]" style={{ color: "#3b82f6" }}>{data.baselines_created} baselines recorded</span>}
        {data.duration_ms != null && (
          <span className="text-[11px] font-mono" style={{ color: "var(--c-text-3)" }}>
            {data.duration_ms < 1000 ? `${data.duration_ms}ms` : `${(data.duration_ms / 1000).toFixed(1)}s`}
          </span>
        )}
        {isRunning && (
          <button
            onClick={async () => {
              try {
                await regressionApi.cancelRun(data.id);
                setPollCount((c) => c + 1);
              } catch (e: unknown) {
                alert(e instanceof Error ? e.message : "Failed to cancel");
              }
            }}
            className="px-2 py-1 rounded text-[11px] font-medium"
            style={{ color: "var(--color-error)", border: "1px solid var(--color-error)" }}
          >
            Stop
          </button>
        )}
      </div>

      {data.total_tests > 0 && (
        <div className="flex mb-4 rounded overflow-hidden h-1.5" style={{ background: "var(--c-bg-tertiary)" }}>
          {data.passed > 0 && <div style={{ width: `${(data.passed / data.total_tests) * 100}%`, background: "var(--color-success)" }} />}
          {data.baselines_created > 0 && <div style={{ width: `${(data.baselines_created / data.total_tests) * 100}%`, background: "#3b82f6" }} />}
          {data.needs_review > 0 && <div style={{ width: `${(data.needs_review / data.total_tests) * 100}%`, background: "#8b5cf6" }} />}
          {data.failed > 0 && <div style={{ width: `${(data.failed / data.total_tests) * 100}%`, background: "var(--color-error)" }} />}
        </div>
      )}

      <div className="rounded-lg overflow-hidden" style={{ border: "1px solid var(--c-border)" }}>
        {data.results.length === 0 && isRunning && (
          <div className="px-4 py-6 text-[13px]" style={{ color: "var(--c-text-3)" }}>
            Running tests…
          </div>
        )}
        {groupByTest(data.results).map((r) => (
          <ResultRow key={r.id} result={r} onPromoted={() => setPollCount((c) => c + 1)} />
        ))}
      </div>
    </div>
  );
}
