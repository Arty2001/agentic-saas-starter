import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { apiGet } from "../api/client";
import type { RunDetail, RunSummary, RunsListResponse } from "../api/types";
import StatusBadge from "../components/common/StatusBadge";
import ExecutionTrace from "../components/runs/ExecutionTrace";
import FeedbackPanel from "../components/runs/FeedbackPanel";
import SessionTimeline from "../components/runs/SessionTimeline";
import { formatEastern, parseUtcDate } from "../utils";

function formatDuration(startedAt: string, endedAt: string | null): string {
  if (!endedAt) return "In progress...";
  const ms = new Date(endedAt).getTime() - new Date(startedAt).getTime();
  if (ms < 1000) return `${ms}ms`;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

export default function RunDetailView() {
  const { runId } = useParams<{ runId: string }>();
  const [run, setRun] = useState<RunDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  const [sessionRuns, setSessionRuns] = useState<RunSummary[]>([]);
  // Which thread the loaded sessionRuns belong to — so clicking between runs of
  // the same session swaps only the detail pane and leaves the timeline steady.
  const fetchedThreadRef = useRef<string | null>(null);

  useEffect(() => {
    if (!runId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    apiGet<RunDetail>(`/runs/${runId}`)
      .then((result) => { if (!cancelled) { setRun(result); setLoading(false); } })
      .catch((err: unknown) => { if (!cancelled) { setError(err instanceof Error ? err.message : String(err)); setLoading(false); } });
    return () => { cancelled = true; };
  }, [runId, retryCount]);

  // Sibling runs for the timeline. Keyed on thread_id and guarded so it only
  // refetches when the session actually changes. Non-fatal: on failure the
  // timeline just doesn't render.
  const threadId = run?.thread_id;
  useEffect(() => {
    if (!threadId || fetchedThreadRef.current === threadId) return;
    fetchedThreadRef.current = threadId;
    let cancelled = false;
    apiGet<RunsListResponse>(`/runs?session_id=${encodeURIComponent(threadId)}&limit=200`)
      .then((result) => {
        if (cancelled) return;
        setSessionRuns(
          [...result.runs].sort(
            (a, b) => parseUtcDate(a.started_at).getTime() - parseUtcDate(b.started_at).getTime()
          )
        );
      })
      .catch(() => { if (!cancelled) fetchedThreadRef.current = null; });
    return () => { cancelled = true; };
  }, [threadId]);

  // Only take over the whole page on the first load. When navigating between
  // runs of a session the previous run stays visible so the timeline doesn't flash.
  if (loading && !run) {
    return (
      <div className="px-6 py-8 max-w-5xl mx-auto overflow-y-auto h-full no-scrollbar">
        <Link to="/runs" className="text-[13px] font-medium hover:underline" style={{ color: "var(--c-text-2)" }}>&larr; Runs</Link>
        <p className="mt-4" style={{ color: "var(--c-text-3)" }}>Loading...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="px-6 py-8 max-w-5xl mx-auto overflow-y-auto h-full no-scrollbar">
        <Link to="/runs" className="text-[13px] font-medium hover:underline" style={{ color: "var(--c-text-2)" }}>&larr; Runs</Link>
        <p className="mt-4 mb-3" style={{ color: "var(--color-error)" }}>{error}</p>
        <button onClick={() => setRetryCount((c) => c + 1)} className="px-3 py-1.5 rounded text-[13px] font-medium text-white" style={{ background: "var(--c-text-1)" }}>Retry</button>
      </div>
    );
  }

  if (!run) return null;

  return (
    <div className="h-full overflow-y-auto no-scrollbar">
      <div className="max-w-6xl mx-auto flex gap-6 px-6">
        {sessionRuns.length > 1 && (
          <aside className="sticky top-0 self-start shrink-0">
            <SessionTimeline runs={sessionRuns} activeId={runId} />
          </aside>
        )}

        <div className="flex-1 min-w-0 py-8">
      <Link to="/runs" className="text-[13px] font-medium hover:underline" style={{ color: "var(--c-text-2)" }}>&larr; Runs</Link>

      <h1 className="text-[18px] font-bold mt-3 mb-4" style={{ color: "var(--c-text-1)" }}>
        Run <span className="font-mono px-1.5 py-0.5 rounded text-[16px]" style={{ background: "var(--c-bg-tertiary)" }}>{runId!.slice(0, 8)}</span>
      </h1>

      <div className="flex flex-wrap items-center gap-3 mb-6">
        <StatusBadge status={run.status} />
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px]" style={{ color: "var(--c-text-2)" }}>
          <span>Agent: <strong>{run.agent_type ?? "N/A"}</strong></span>
          <span>Started: <strong>{formatEastern(run.started_at)}</strong></span>
          <span>Duration: <strong>{formatDuration(run.started_at, run.ended_at)}</strong></span>
          {run.total_tokens != null && (
            <span>Tokens: <strong className="font-mono">{run.total_tokens.toLocaleString()}</strong></span>
          )}
          {run.run_metadata?.tenant_id && (
            <span>Client: <strong>{String(run.run_metadata.tenant_id)}</strong></span>
          )}

          {run.run_metadata?.workspace_id && (
            <span>Dataset: <strong className="font-mono">{String(run.run_metadata.workspace_id)}</strong></span>
          )}
          {run.run_metadata?.user_role && (
            <span>User role: <strong>{String(run.run_metadata.user_role)}</strong></span>
          )}
        </div>
      </div>

      {run.feedback && <FeedbackPanel feedback={run.feedback} />}

      {run.error && (
        <div className="mb-6 p-3 rounded-lg text-[13px]" style={{ background: "var(--color-error-subtle)", color: "var(--color-error)", border: "1px solid var(--color-error)" }}>
          <span className="font-semibold">Tool Call Errors:</span>
          <div className="mt-1 whitespace-pre-wrap">{run.error}</div>
        </div>
      )}

      <h2 className="text-[13px] font-semibold uppercase tracking-wider mb-3" style={{ color: "var(--c-text-3)" }}>Execution Trace</h2>
      <ExecutionTrace steps={run.steps} edges={run.edges} />
        </div>
      </div>
    </div>
  );
}
