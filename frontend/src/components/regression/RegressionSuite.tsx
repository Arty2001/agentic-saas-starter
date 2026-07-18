import { useEffect, useMemo, useState } from "react";
import { regressionApi, type RegressionTest } from "../../api/regression";
import { useAgentContext } from "../../context/AgentContext";
import StatusChip from "./StatusChip";

interface Props {
  onEdit: (id: string) => void;
  onNew: () => void;
  onRunStarted: (runId: string) => void;
}

/** Per-agent latest results; collapses to a single chip for single-agent tests. */
function LastResults({ test, scopedAgent }: { test: RegressionTest; scopedAgent?: string }) {
  const states = scopedAgent ? test.agents.filter((a) => a.agent_type === scopedAgent) : test.agents;
  if (states.length === 0 || states.every((s) => !s.last_result)) {
    return <span style={{ color: "var(--c-text-3)" }}>—</span>;
  }
  return (
    <div className="flex flex-col gap-0.5">
      {states.map((s) => (
        <div key={s.agent_type} className="flex items-center gap-1.5">
          {states.length > 1 && (
            <span className="text-[10px]" style={{ color: "var(--c-text-3)" }}>{s.agent_type}</span>
          )}
          {s.last_result ? (
            <StatusChip status={s.last_result.status} />
          ) : (
            <span className="text-[10px]" style={{ color: "var(--c-text-3)" }}>not run</span>
          )}
        </div>
      ))}
    </div>
  );
}

export default function RegressionSuite({ onEdit, onNew, onRunStarted }: Props) {
  const { selectedAgent } = useAgentContext();
  const [tests, setTests] = useState<RegressionTest[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [rebaseline, setRebaseline] = useState(false);
  const [serviceAuth, setServiceAuth] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // The global top-left agent selector scopes the suite: a specific agent
  // shows only tests targeting it AND runs execute only for that agent;
  // "Router (Auto)" shows everything and runs every agent of every test.
  const scopedAgent = selectedAgent === "router" ? undefined : selectedAgent;
  const visibleTests = useMemo(
    () =>
      scopedAgent === undefined
        ? tests
        : tests.filter((t) => t.agent_types.includes(scopedAgent)),
    [tests, scopedAgent],
  );
  const hiddenCount = tests.length - visibleTests.length;
  const visibleSelected = useMemo(
    () => [...selected].filter((id) => visibleTests.some((t) => t.id === id)),
    [selected, visibleTests],
  );

  const load = () => {
    setLoading(true);
    regressionApi
      .listTests(search)
      .then((r) => {
        setTests(r.tests);
        setLoading(false);
      })
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : String(e));
        setLoading(false);
      });
  };

  useEffect(load, [search]);

  const toggle = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  };

  const run = async (ids: string[]) => {
    try {
      const summary = await regressionApi.startRun(
        ids,
        rebaseline ? "rebaseline" : "regression",
        serviceAuth ? "service" : "user",
        scopedAgent,
      );
      onRunStarted(summary.id);
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : "Failed to start run");
    }
  };

  const remove = async (id: string) => {
    if (!confirm("Delete this test (and its baselines/results)?")) return;
    try {
      await regressionApi.deleteTest(id);
      load();
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : "Failed to delete");
    }
  };

  // Clone then jump straight into the editor to rename/tweak the copy.
  const clone = async (id: string) => {
    try {
      const copy = await regressionApi.cloneTest(id);
      onEdit(copy.id);
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : "Failed to clone");
    }
  };

  if (error) {
    return (
      <div className="text-[13px]" style={{ color: "var(--color-error)" }}>
        {error} — have the regression tables been created? (MIGRATIONS.md §5)
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center gap-3 mb-4">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search tests…"
          className="text-[13px] px-2 py-1.5 rounded w-56"
          style={{ background: "var(--c-bg)", color: "var(--c-text-1)", border: "1px solid var(--c-border)" }}
        />
        <label className="flex items-center gap-1.5 text-[12px]" style={{ color: "var(--c-text-2)" }} title="Re-record baselines instead of diffing">
          <input type="checkbox" checked={rebaseline} onChange={(e) => setRebaseline(e.target.checked)} />
          re-record baselines
        </label>
        <label
          className="flex items-center gap-1.5 text-[12px]"
          style={{ color: "var(--c-text-2)" }}
          title="Real-mode tests call saas-api as the platform service account (permanent token) instead of your session — use for big suites so an expiring login can't fail tests mid-run"
        >
          <input type="checkbox" checked={serviceAuth} onChange={(e) => setServiceAuth(e.target.checked)} />
          service account
        </label>
        {scopedAgent && (
          <span
            className="text-[11px] px-2 py-0.5 rounded"
            style={{ background: "var(--c-bg-tertiary)", color: "var(--c-text-3)" }}
            title="Scoped by the agent selector in the top-left: only tests targeting this agent are listed, and runs execute only this agent. Switch to Router (Auto) to see every test and run every agent."
          >
            {scopedAgent} only{hiddenCount > 0 ? ` · ${hiddenCount} hidden` : ""}
          </span>
        )}
        <div className="flex-1" />
        {visibleSelected.length > 0 && (
          <button
            onClick={() => run(visibleSelected)}
            className="px-3 py-1.5 rounded text-[12px] font-medium"
            style={{ background: "var(--color-brand)", color: "white" }}
          >
            ▶ Run {visibleSelected.length} selected
          </button>
        )}
        <button
          onClick={() => run(scopedAgent ? visibleTests.map((t) => t.id) : [])}
          disabled={visibleTests.length === 0}
          className="px-3 py-1.5 rounded text-[12px] font-medium disabled:opacity-40"
          style={{ background: "var(--c-bg-elevated)", color: "var(--c-text-1)", border: "1px solid var(--c-border)" }}
        >
          ▶ Run all{scopedAgent ? ` (${visibleTests.length})` : ""}
        </button>
        <button onClick={onNew} className="px-3 py-1.5 rounded text-[12px] font-medium" style={{ background: "var(--color-brand)", color: "white" }}>
          + New test
        </button>
      </div>

      {loading ? (
        <p className="text-[13px]" style={{ color: "var(--c-text-3)" }}>Loading…</p>
      ) : visibleTests.length === 0 ? (
        <div className="text-[13px] p-6 rounded-lg text-center" style={{ color: "var(--c-text-3)", border: "1px dashed var(--c-border)" }}>
          {tests.length > 0
            ? `No tests for '${selectedAgent}'. Switch the top-left selector to Router (Auto) to see all ${tests.length} tests, or create one.`
            : "No tests yet. A test is just prompts + agents — the first run records the baseline, later runs diff against it."}
        </div>
      ) : (
        <div className="rounded-lg overflow-hidden" style={{ border: "1px solid var(--c-border)" }}>
          <table className="w-full text-[12px]">
            <thead>
              <tr style={{ background: "var(--c-bg-elevated)", color: "var(--c-text-3)" }}>
                <th className="w-8 px-2 py-2" />
                <th className="text-left px-2 py-2 font-semibold">Name</th>
                <th className="text-left px-2 py-2 font-semibold">Agents</th>
                <th className="text-left px-2 py-2 font-semibold">Context</th>
                <th className="text-left px-2 py-2 font-semibold">Turns</th>
                <th className="text-left px-2 py-2 font-semibold">Baseline</th>
                <th className="text-left px-2 py-2 font-semibold">Last result</th>
                <th className="w-44 px-2 py-2" />
              </tr>
            </thead>
            <tbody>
              {visibleTests.map((t) => (
                <tr key={t.id} className="hover:bg-[var(--c-overlay)]" style={{ borderTop: "1px solid var(--c-border-subtle)" }}>
                  <td className="px-2 py-2 text-center">
                    <input type="checkbox" checked={selected.has(t.id)} onChange={() => toggle(t.id)} />
                  </td>
                  <td className="px-2 py-2">
                    <button className="font-medium text-left hover:underline" style={{ color: "var(--c-text-1)" }} onClick={() => onEdit(t.id)}>
                      {t.name}
                    </button>
                    {t.tags.length > 0 && (
                      <span className="ml-2">
                        {t.tags.map((tag) => (
                          <span key={tag} className="text-[10px] px-1.5 py-0.5 rounded mr-1" style={{ background: "var(--c-bg-tertiary)", color: "var(--c-text-3)" }}>
                            {tag}
                          </span>
                        ))}
                      </span>
                    )}
                  </td>
                  <td className="px-2 py-2">
                    {t.agent_types.map((a) => (
                      <span
                        key={a}
                        className="text-[10px] px-1.5 py-0.5 rounded mr-1 font-medium"
                        style={{
                          background: a === scopedAgent ? "var(--color-brand)" : "var(--c-bg-tertiary)",
                          color: a === scopedAgent ? "white" : "var(--c-text-2)",
                        }}
                      >
                        {a}
                      </span>
                    ))}
                  </td>
                  <td className="px-2 py-2">
                    <span
                      className="text-[10px] px-1.5 py-0.5 rounded font-medium"
                      style={{
                        background: t.context_mode === "real" ? "var(--color-warning)" : "var(--c-bg-tertiary)",
                        color: t.context_mode === "real" ? "white" : "var(--c-text-3)",
                      }}
                    >
                      {t.context_mode}
                    </span>
                  </td>
                  <td className="px-2 py-2 font-mono" style={{ color: "var(--c-text-3)" }}>{t.turns.length}</td>
                  <td className="px-2 py-2">
                    {t.baseline_version == null ? (
                      <span style={{ color: "var(--c-text-3)" }}>none</span>
                    ) : t.baseline_stale ? (
                      <span style={{ color: "var(--color-warning)" }}>v{t.baseline_version} (stale)</span>
                    ) : (
                      <span style={{ color: "var(--c-text-2)" }}>v{t.baseline_version}</span>
                    )}
                  </td>
                  <td className="px-2 py-2"><LastResults test={t} scopedAgent={scopedAgent} /></td>
                  <td className="px-2 py-2 text-right whitespace-nowrap">
                    <button onClick={() => run([t.id])} className="px-2 py-0.5 text-[11px] font-medium" style={{ color: "var(--color-brand)" }}>▶ Run</button>
                    <button onClick={() => onEdit(t.id)} className="px-2 py-0.5 text-[11px]" style={{ color: "var(--c-text-3)" }}>Edit</button>
                    <button onClick={() => clone(t.id)} className="px-2 py-0.5 text-[11px]" style={{ color: "var(--c-text-3)" }} title="Duplicate this test's definition — the copy starts with no baseline">Clone</button>
                    <button onClick={() => remove(t.id)} className="px-2 py-0.5 text-[11px]" style={{ color: "var(--color-error)" }}>Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
