/** Generate a unique ID. */
export function generateId(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

/**
 * Parse an API timestamp, forcing UTC interpretation.
 */
export function parseUtcDate(dateStr: string): Date {
  const hasZone = /([zZ]|[+-]\d{2}:?\d{2})$/.test(dateStr);
  return new Date(hasZone ? dateStr : `${dateStr}Z`);
}

/**
 * Format an API timestamp in US Eastern time. `America/New_York` automatically
 * applies EST or EDT (daylight saving) depending on the date.
 */
export function formatEastern(dateStr: string): string {
  return parseUtcDate(dateStr).toLocaleString("en-US", { timeZone: "America/New_York" }) + " ET";
}

/** Compact relative time, e.g. "just now", "5m ago", "3h ago", "2d ago". */
export function timeAgo(dateStr: string): string {
  const s = Math.max(0, Math.round((Date.now() - parseUtcDate(dateStr).getTime()) / 1000));
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d}d ago`;
  const mo = Math.round(d / 30);
  return mo < 12 ? `${mo}mo ago` : `${Math.round(mo / 12)}y ago`;
}
