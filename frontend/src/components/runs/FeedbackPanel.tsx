import type { RunFeedback } from "../../api/types";
import FeedbackThumb from "../common/FeedbackThumb";

/** Title-case a raw feedback category, e.g. "incorrect_data" -> "Incorrect Data". */
function categoryLabel(raw: string): string {
  return raw.replace(/[_-]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * The user's rating on a run. Styled to match the execution-trace node boxes
 * (1px border + 3px sentiment rail, bg-elevated, max-w-3xl). Only shows
 * feedback_type / category / comment.
 */
export default function FeedbackPanel({ feedback }: { feedback: RunFeedback }) {
  const up = feedback.feedback_type === "up";
  const accent = up ? "#16a34a" : "#dc2626";

  return (
    <section className="mb-6">
      <h2
        className="text-[13px] font-semibold uppercase tracking-wider mb-3"
        style={{ color: "var(--c-text-3)" }}
      >
        Feedback
      </h2>

      <div
        className="rounded-lg overflow-hidden max-w-3xl"
        style={{
          border: "1px solid var(--c-border)",
          borderLeftWidth: "3px",
          borderLeftColor: accent,
          background: "var(--c-bg-elevated)",
        }}
      >
        <div className="flex items-center justify-between px-4 py-2">
          <div className="flex items-center gap-2">
            <FeedbackThumb type={feedback.feedback_type} size={13} bare />
            <h4 className="text-[13px] font-bold" style={{ color: accent }}>
              {up ? "Positive" : "Negative"}
            </h4>
          </div>
          {feedback.category && (
            <span
              className="text-[10px] px-1.5 py-0.5 rounded font-mono"
              style={{ background: "var(--c-bg-tertiary)", color: "var(--c-text-3)" }}
            >
              {categoryLabel(feedback.category)}
            </span>
          )}
        </div>

        {feedback.comment && (
          <div className="px-4 pb-3">
            <div
              className="rounded-md px-2.5 py-1.5 text-[12px] leading-snug whitespace-pre-wrap"
              style={{
                background: "var(--c-overlay)",
                border: "1px solid var(--c-border-subtle)",
                color: "var(--c-text-2)",
              }}
            >
              {feedback.comment}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
