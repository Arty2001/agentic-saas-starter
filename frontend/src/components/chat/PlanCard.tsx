import type { PlanStatus } from "../../api/types";

interface PlanCardProps {
  payload: unknown;
  status: PlanStatus;
  onApprove: () => void;
  onReject: () => void;
}

const STATUS_STYLES: Record<string, { label: string; dot: string; text: string; bg: string } | null> = {
  pending_approval: null,
  editing: null,
  approved: { label: "Approved", dot: "#16a34a", text: "#15803d", bg: "rgba(22,163,74,0.08)" },
  rejected: { label: "Rejected", dot: "#dc2626", text: "#dc2626", bg: "rgba(220,38,38,0.08)" },
  executing: { label: "Executing", dot: "#2563eb", text: "#2563eb", bg: "rgba(37,99,235,0.08)" },
  completed: { label: "Completed", dot: "#16a34a", text: "#15803d", bg: "rgba(22,163,74,0.08)" },
  failed: { label: "Failed", dot: "#dc2626", text: "#dc2626", bg: "rgba(220,38,38,0.08)" },
};

export function PlanCard({ payload, status, onApprove, onReject }: PlanCardProps) {
  const isReadOnly = ["approved", "rejected", "executing", "completed", "failed"].includes(status);
  const badge = STATUS_STYLES[status];
  const json = JSON.stringify(payload, null, 2);

  return (
    <div
      className="rounded-lg p-4 my-1 max-w-full"
      style={{ background: "var(--c-bg-elevated)", border: "1px solid var(--c-border)" }}
    >
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-[13px] font-semibold" style={{ color: "var(--c-text-1)" }}>
          Plan
        </h3>
        {badge && (
          <span
            className="inline-flex items-center gap-1.5 text-[11px] font-medium px-2 py-0.5 rounded"
            style={{ background: badge.bg, color: badge.text }}
          >
            <span className="w-1.5 h-1.5 rounded-full" style={{ background: badge.dot }} />
            {badge.label}
          </span>
        )}
      </div>

      <pre
        className={`text-[11px] font-mono whitespace-pre-wrap break-words rounded px-3 py-2 overflow-x-auto ${isReadOnly ? "opacity-50" : ""}`}
        style={{ background: "var(--c-bg-tertiary)", color: "var(--c-text-2)" }}
      >
        {json}
      </pre>

      {status === "pending_approval" && (
        <div className="flex gap-2 mt-3 pt-3" style={{ borderTop: "1px solid var(--c-border)" }}>
          <button
            type="button"
            onClick={onApprove}
            className="px-4 py-1.5 rounded text-[13px] font-medium text-white transition-colors hover:opacity-90"
            style={{ background: "#16a34a" }}
          >
            Approve
          </button>
          <button
            type="button"
            onClick={onReject}
            className="px-4 py-1.5 rounded text-[13px] font-medium text-white transition-colors hover:opacity-90"
            style={{ background: "#dc2626" }}
          >
            Reject
          </button>
        </div>
      )}
    </div>
  );
}
