const THUMB_UP =
  "M2 21h4V9H2v12zM23 10c0-1.1-.9-2-2-2h-6.31l.95-4.57.03-.32c0-.41-.17-.79-.44-1.06L14.17 1 7.59 7.59C7.22 7.95 7 8.45 7 9v10c0 1.1.9 2 2 2h9c.83 0 1.54-.5 1.84-1.22l3.02-7.05c.09-.23.14-.47.14-.73v-2z";
const THUMB_DOWN =
  "M15 3H6c-.83 0-1.54.5-1.84 1.22l-3.02 7.05c-.09.23-.14.47-.14.73v2c0 1.1.9 2 2 2h6.31l-.95 4.57-.03.32c0 .41.17.79.44 1.06L9.83 23l6.59-6.6c.36-.36.58-.86.58-1.41V5c0-1.1-.9-2-2-2zm4 0v12h4V3h-4z";

/** Sentiment colors: success green for up, brand/error red for down. */
const COLORS = {
  up: { fg: "#16a34a", bg: "rgba(22,163,74,0.10)" },
  down: { fg: "#dc2626", bg: "rgba(220,38,38,0.10)" },
} as const;

interface FeedbackThumbProps {
  type: "up" | "down";
  /** Icon size in px. */
  size?: number;
  /** Bare glyph (no chip) — used inline in the run detail header. */
  bare?: boolean;
  className?: string;
  title?: string;
}

/** A thumbs-up/down glyph: subtle chip in lists, bare glyph inline in detail. */
export default function FeedbackThumb({ type, size = 13, bare = false, className, title }: FeedbackThumbProps) {
  const c = COLORS[type];
  const label = title ?? (type === "up" ? "Thumbs up" : "Thumbs down");
  const glyph = (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
      <path d={type === "up" ? THUMB_UP : THUMB_DOWN} />
    </svg>
  );

  if (bare) {
    return (
      <span className={`inline-flex shrink-0 ${className ?? ""}`} style={{ color: c.fg }} title={label}>
        {glyph}
      </span>
    );
  }

  return (
    <span
      className={`inline-flex items-center justify-center rounded-md shrink-0 ${className ?? ""}`}
      style={{ width: size + 10, height: size + 10, background: c.bg, color: c.fg }}
      title={label}
    >
      {glyph}
    </span>
  );
}
