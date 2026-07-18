/** Shared run-status styling, used by both StatusBadge and the run timeline so
 * their colors stay identical. */
export interface StatusStyle {
  label: string;
  dot: string;
  text: string;
  bg: string;
}

export const STATUS_MAP: Record<string, StatusStyle> = {
  completed: { label: "Completed", dot: "#16a34a", text: "#15803d", bg: "rgba(22,163,74,0.08)" },
  running: { label: "Running", dot: "#2563eb", text: "#2563eb", bg: "rgba(37,99,235,0.08)" },
  failed: { label: "Failed", dot: "#dc2626", text: "#dc2626", bg: "rgba(220,38,38,0.08)" },
  error: { label: "Error", dot: "#dc2626", text: "#dc2626", bg: "rgba(220,38,38,0.08)" },
  pending_approval: { label: "Pending Approval", dot: "#d97706", text: "#d97706", bg: "rgba(217,119,6,0.08)" },
  approved: { label: "Approved", dot: "#16a34a", text: "#15803d", bg: "rgba(22,163,74,0.08)" },
  modified: { label: "Modified", dot: "#7c3aed", text: "#6d28d9", bg: "rgba(124,58,237,0.08)" },
  rejected: { label: "Rejected", dot: "#dc2626", text: "#dc2626", bg: "rgba(220,38,38,0.08)" },
  cancelled: { label: "Cancelled", dot: "#a8a29e", text: "#78716c", bg: "rgba(168,162,158,0.08)" },
};

export const STATUS_DEFAULT: StatusStyle = {
  label: "Unknown",
  dot: "#a8a29e",
  text: "#78716c",
  bg: "rgba(168,162,158,0.08)",
};

export function statusStyle(status: string): StatusStyle {
  return STATUS_MAP[status] ?? STATUS_DEFAULT;
}
