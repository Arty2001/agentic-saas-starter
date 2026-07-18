import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiDelete, apiGet } from "../api/client";
import type { RunSummary, RunsListResponse } from "../api/types";
import FeedbackThumb from "../components/common/FeedbackThumb";
import StatusBadge from "../components/common/StatusBadge";
import RunFilterBar, {
  emptyFilters,
  hasActiveFilters,
  type RunFilters,
} from "../components/runs/RunFilterBar";
import { formatEastern, parseUtcDate } from "../utils";

/** Runs fetched per request; "Load more" pulls the next page from the server. */
const PAGE_SIZE = 50;
/** Debounce filter edits so typing doesn't fire a request per keystroke. */
const FILTER_DEBOUNCE_MS = 250;

function buildRunsQuery(filters: RunFilters): string {
  const params = new URLSearchParams();
  const search = filters.search.trim();
  if (search) params.set("search", search);
  if (filters.status) params.set("status", filters.status);
  if (filters.feedback) params.set("feedback", filters.feedback);
  if (filters.startDate) params.set("start_date", `${filters.startDate}T00:00:00`);
  if (filters.endDate) params.set("end_date", `${filters.endDate}T23:59:59`);
  for (const [key, value] of Object.entries(filters.facets)) {
    const v = (value ?? "").trim();
    if (v) params.append("facet", `${key}:${v}`);
  }
  return params.toString();
}

function formatTime(dateStr: string): string {
  return formatEastern(dateStr);
}

function formatDuration(startedAt: string, endedAt: string | null): string {
  if (!endedAt) return "...";
  const ms = parseUtcDate(endedAt).getTime() - parseUtcDate(startedAt).getTime();
  if (ms < 1000) return `${ms}ms`;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

type GroupedSessions = { threadId: string; runs: RunSummary[]; latestAt: string }[];

function groupBySession(runs: RunSummary[]): GroupedSessions {
  const map = new Map<string, RunSummary[]>();
  for (const run of runs) {
    const list = map.get(run.thread_id) ?? [];
    list.push(run);
    map.set(run.thread_id, list);
  }
  const groups: GroupedSessions = [];
  for (const [threadId, sessionRuns] of map) {
    groups.push({
      threadId,
      runs: sessionRuns.sort(
        (a, b) => parseUtcDate(a.started_at).getTime() - parseUtcDate(b.started_at).getTime()
      ),
      latestAt: sessionRuns[sessionRuns.length - 1].started_at,
    });
  }
  return groups.sort(
    (a, b) => parseUtcDate(b.latestAt).getTime() - parseUtcDate(a.latestAt).getTime()
  );
}

export default function RunsView() {
  const navigate = useNavigate();
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  const [filters, setFilters] = useState<RunFilters>(emptyFilters);
  const [metadataKeys, setMetadataKeys] = useState<string[]>([]);
  const [statuses, setStatuses] = useState<string[]>([]);
  const [initialized, setInitialized] = useState(false);
  const [showTestRuns, setShowTestRuns] = useState(false);

  // Facet keys and status options for the filter dropdowns, from their catalogs.
  useEffect(() => {
    let cancelled = false;
    apiGet<string[]>("/metadata-keys")
      .then((keys) => { if (!cancelled) setMetadataKeys(keys); })
      .catch(() => { /* non-fatal: the facet dropdown just stays empty */ });
    apiGet<string[]>("/run-statuses")
      .then((s) => { if (!cancelled) setStatuses(s); })
      .catch(() => { /* non-fatal: the status dropdown just shows "Any status" */ });
    return () => { cancelled = true; };
  }, []);

  const query = useMemo(() => {
    const q = buildRunsQuery(filters);
    return showTestRuns ? `${q}&include_tests=true` : q;
  }, [filters, showTestRuns]);

  // Track the active query so an in-flight "Load more" from a stale query can be discarded
  const queryRef = useRef(query);
  queryRef.current = query;

  // First page: (re)load whenever the filters change or a refresh is requested.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const handle = setTimeout(() => {
      setLoading(true);
      apiGet<RunsListResponse>(`/runs?${query}&offset=0&limit=${PAGE_SIZE}`)
        .then((result) => {
          if (cancelled) return;
          setRuns(result.runs);
          setTotal(result.total);
          setError(null);
          setInitialized(true);
          setLoading(false);
        })
        .catch((err: unknown) => { if (!cancelled) { setError(err instanceof Error ? err.message : String(err)); setLoading(false); } });
    }, FILTER_DEBOUNCE_MS);
    return () => { cancelled = true; clearTimeout(handle); };
  }, [query, retryCount]);

  // Next page: fetch from the current offset and append to what's loaded.
  const loadMore = useCallback(() => {
    const q = query;
    setLoadingMore(true);
    apiGet<RunsListResponse>(`/runs?${q}&offset=${runs.length}&limit=${PAGE_SIZE}`)
      .then((result) => {
        if (queryRef.current !== q) return; // filters changed mid-flight
        setRuns((prev) => [...prev, ...result.runs]);
        setTotal(result.total);
        setLoadingMore(false);
      })
      .catch((err: unknown) => { setError(err instanceof Error ? err.message : String(err)); setLoadingMore(false); });
  }, [query, runs.length]);

  const handleDelete = async (runId: string) => {
    if (!confirm("Delete this run?")) return;
    try { await apiDelete(`/runs/${runId}`); setRetryCount((c) => c + 1); }
    catch (err) { alert(err instanceof Error ? err.message : "Failed to delete"); }
  };

  const sessions = useMemo(() => groupBySession(runs), [runs]);

  const facetValues = useMemo(() => {
    const sets: Record<string, Set<string>> = {};
    for (const run of runs) {
      const m = run.run_metadata;
      if (!m) continue;
      for (const [key, raw] of Object.entries(m)) {
        if (raw == null || raw === "") continue;
        (sets[key] ??= new Set<string>()).add(String(raw));
      }
    }
    const out: Record<string, string[]> = {};
    for (const [key, set] of Object.entries(sets)) {
      out[key] = Array.from(set).sort((a, b) => a.localeCompare(b));
    }
    return out;
  }, [runs]);

  if (loading && !initialized) {
    return (
      <div className="px-6 py-8 max-w-4xl mx-auto overflow-y-auto h-full no-scrollbar">
        <h1 className="text-[13px] font-semibold uppercase tracking-wider mb-6" style={{ color: "var(--c-text-3)" }}>Runs</h1>
        <p style={{ color: "var(--c-text-3)" }}>Loading...</p>
      </div>
    );
  }

  if (error && !initialized) {
    return (
      <div className="px-6 py-8 max-w-4xl mx-auto overflow-y-auto h-full no-scrollbar">
        <h1 className="text-[13px] font-semibold uppercase tracking-wider mb-4" style={{ color: "var(--c-text-3)" }}>Runs</h1>
        <p className="mb-3" style={{ color: "var(--color-error)" }}>{error}</p>
        <button onClick={() => setRetryCount((c) => c + 1)} className="px-3 py-1.5 rounded text-[13px] font-medium text-white" style={{ background: "var(--c-text-1)" }}>
          Retry
        </button>
      </div>
    );
  }

  const filtering = hasActiveFilters(filters);
  const hasMore = runs.length < total;

  return (
    <div className="px-6 py-8 max-w-4xl mx-auto overflow-y-auto h-full no-scrollbar">
      <div
        className="sticky -top-8 z-20 -mx-6 px-6 pt-1 pb-3"
        style={{ background: "var(--c-bg)", borderBottom: "1px solid var(--c-border-subtle)" }}
      >
        <RunFilterBar
          filters={filters}
          onChange={setFilters}
          metadataKeys={metadataKeys}
          statuses={statuses}
          facetValues={facetValues}
          loadedCount={runs.length}
          totalCount={total}
        />
        <label
          className="flex items-center gap-1.5 mt-2 text-[11px] cursor-pointer select-none"
          style={{ color: "var(--c-text-3)" }}
          title="Runs produced by the Tests eval framework are hidden by default"
        >
          <input
            type="checkbox"
            checked={showTestRuns}
            onChange={(e) => setShowTestRuns(e.target.checked)}
          />
          Show test runs
        </label>
        {error && (
          <p className="text-[12px] mt-1" style={{ color: "var(--color-error)" }}>
            Couldn’t refresh: {error}
          </p>
        )}
      </div>

      {sessions.length === 0 && (
        <p className="text-[13px] mt-6" style={{ color: "var(--c-text-3)" }}>
          {filtering ? "No runs match the active filters." : "No runs found."}
          {filtering && (
            <>
              {" "}
              <button
                onClick={() => setFilters(emptyFilters())}
                className="font-medium hover:underline"
                style={{ color: "var(--color-brand)" }}
              >
                Clear filters
              </button>
            </>
          )}
        </p>
      )}

      <div className="space-y-4 mt-4">
        {sessions.map((session) => (
          <div
            key={session.threadId}
            className="rounded-lg overflow-hidden"
            style={{ border: "1px solid var(--c-border)", background: "var(--c-bg-elevated)" }}
          >
            <div className="px-4 py-2 flex items-center justify-between" style={{ background: "var(--c-bg-secondary)", borderBottom: "1px solid var(--c-border)" }}>
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-medium uppercase tracking-wider" style={{ color: "var(--c-text-3)" }}>Session</span>
                <span
                  className="text-[12px] font-mono font-semibold px-1.5 py-0.5 rounded"
                  style={{ color: "var(--c-text-1)", background: "var(--c-bg-tertiary)" }}
                >
                  {session.threadId.slice(0, 8)}
                </span>
                <span className="text-[11px]" style={{ color: "var(--c-text-3)" }}>
                  {session.runs.length} run{session.runs.length !== 1 ? "s" : ""}
                </span>
              </div>
            </div>

            <div>
              {session.runs.map((run, idx) => (
                <div
                  key={run.id}
                  className="group flex items-center gap-3 px-4 py-2 cursor-pointer transition-colors hover:bg-[var(--c-overlay)]"
                  style={{ borderTop: idx > 0 ? "1px solid var(--c-border-subtle)" : undefined }}
                  onClick={() => navigate(`/runs/${run.id}`)}
                >
                  <span className="text-[11px] w-5 text-right shrink-0 font-mono" style={{ color: "var(--c-text-3)" }}>#{idx + 1}</span>
                  <StatusBadge status={run.status} />
                  <span className="text-[12px] font-medium min-w-[90px]" style={{ color: "var(--c-text-2)" }}>
                    {run.agent_type ?? "N/A"}
                  </span>
                  <span className="text-[11px]" style={{ color: "var(--c-text-3)" }}>{formatTime(run.started_at)}</span>
                  <span className="text-[11px]" style={{ color: "var(--c-text-3)" }}>{formatDuration(run.started_at, run.ended_at)}</span>
                  {run.user_id && (
                    <span className="text-[11px] font-mono" style={{ color: "var(--c-text-3)" }} title="User">
                      {run.user_id}
                    </span>
                  )}
                  {run.total_tokens != null && (
                    <span className="text-[11px] font-mono" style={{ color: "var(--c-text-3)" }}>{run.total_tokens.toLocaleString()} tok</span>
                  )}
                  <div className="ml-auto flex items-center gap-2.5">
                    {run.feedback && <FeedbackThumb type={run.feedback.feedback_type} />}
                    <button
                      onClick={(e) => { e.stopPropagation(); handleDelete(run.id); }}
                      className="text-[14px] transition-opacity opacity-0 group-hover:opacity-100"
                      style={{ color: "var(--c-text-3)" }}
                      title="Delete"
                    >
                      &times;
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {hasMore && (
        <div className="flex justify-center mt-4">
          <button
            onClick={loadMore}
            disabled={loadingMore}
            className="h-8 px-4 rounded-md text-[12px] font-medium transition-colors"
            style={{ border: "1px solid var(--c-border)", background: "var(--c-bg-elevated)", color: "var(--c-text-2)", opacity: loadingMore ? 0.6 : 1 }}
            onMouseEnter={(e) => (e.currentTarget.style.background = "var(--c-overlay)")}
            onMouseLeave={(e) => (e.currentTarget.style.background = "var(--c-bg-elevated)")}
          >
            {loadingMore ? "Loading…" : `Show more (${total - runs.length} more run${total - runs.length !== 1 ? "s" : ""})`}
          </button>
        </div>
      )}
    </div>
  );
}
