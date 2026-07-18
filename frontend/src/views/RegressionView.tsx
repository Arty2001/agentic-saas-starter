import { useState } from "react";
import RegressionSuite from "../components/regression/RegressionSuite";
import RegressionEditor from "../components/regression/RegressionEditor";
import RegressionRunReport from "../components/regression/RegressionRunReport";
import RegressionRunHistory from "../components/regression/RegressionRunHistory";

type Tab = "suite" | "editor" | "report" | "history";

export default function RegressionView() {
  const [tab, setTab] = useState<Tab>("suite");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [viewingRunId, setViewingRunId] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const handleEdit = (id: string) => {
    setEditingId(id);
    setTab("editor");
  };

  const handleNew = () => {
    setEditingId(null);
    setTab("editor");
  };

  const handleSaved = () => {
    setRefreshKey((k) => k + 1);
    setTab("suite");
  };

  const handleViewRun = (runId: string) => {
    setViewingRunId(runId);
    setTab("report");
  };

  const tabs: { key: Tab; label: string }[] = [
    { key: "suite", label: "Tests" },
    { key: "editor", label: editingId ? "Edit Test" : "New Test" },
    { key: "report", label: "Report" },
    { key: "history", label: "Run History" },
  ];

  const tabClass = (key: Tab) =>
    `px-2 py-1 text-[13px] font-medium transition-colors cursor-pointer ${
      tab === key
        ? "text-[var(--c-text-1)] border-b-2 border-[var(--color-brand)]"
        : "text-[var(--c-text-3)] hover:text-[var(--c-text-1)]"
    }`;

  return (
    <div className="px-6 py-8 max-w-5xl mx-auto overflow-y-auto h-full no-scrollbar">
      <div className="flex items-center gap-6 mb-2">
        <h1 className="text-[13px] font-semibold uppercase tracking-wider" style={{ color: "var(--c-text-3)" }}>
          Tests
        </h1>
        <div className="flex items-center gap-4">
          {tabs.map((t) => (
            <button key={t.key} className={tabClass(t.key)} onClick={() => setTab(t.key)}>
              {t.label}
            </button>
          ))}
        </div>
      </div>
      <p className="text-[12px] mb-6" style={{ color: "var(--c-text-3)" }}>
        Snapshot regression: author prompts + agent, the first run records the baseline, later runs flag tool-plan and
        response changes.
      </p>

      {tab === "suite" && (
        <RegressionSuite key={refreshKey} onEdit={handleEdit} onNew={handleNew} onRunStarted={handleViewRun} />
      )}
      {tab === "editor" && (
        <RegressionEditor editingId={editingId} onSaved={handleSaved} onCancel={() => setTab("suite")} />
      )}
      {tab === "report" && <RegressionRunReport runId={viewingRunId} />}
      {tab === "history" && <RegressionRunHistory onViewRun={handleViewRun} />}
    </div>
  );
}
