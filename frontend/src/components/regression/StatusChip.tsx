const STATUS_STYLES: Record<string, { bg: string; label: string }> = {
  passed: { bg: "var(--color-success)", label: "passed" },
  structural_diff: { bg: "var(--color-error)", label: "plan changed" },
  text_diff: { bg: "var(--color-warning)", label: "text changed" },
  needs_review: { bg: "#8b5cf6", label: "needs review" },
  baseline_created: { bg: "#3b82f6", label: "baseline recorded" },
  error: { bg: "var(--color-error)", label: "error" },
  skipped: { bg: "var(--c-text-3)", label: "skipped" },
  pending: { bg: "var(--c-text-3)", label: "pending" },
  running: { bg: "var(--color-warning)", label: "running" },
  completed: { bg: "var(--color-success)", label: "completed" },
  cancelled: { bg: "var(--c-text-3)", label: "cancelled" },
};

export default function StatusChip({ status }: { status: string }) {
  const style = STATUS_STYLES[status] ?? { bg: "var(--c-text-3)", label: status };
  return (
    <span
      className="text-[11px] font-medium px-2 py-0.5 rounded whitespace-nowrap"
      style={{ background: style.bg, color: "white" }}
    >
      {style.label}
    </span>
  );
}
