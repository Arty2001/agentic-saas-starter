import { Link } from "react-router-dom";
import type { RunSummary } from "../../api/types";
import FeedbackThumb from "../common/FeedbackThumb";
import { statusStyle } from "../common/statusStyles";
import { formatEastern } from "../../utils";

interface SessionTimelineProps {
  /** All runs in the session, ordered #1..#N (chronological). */
  runs: RunSummary[];
  /** The run currently open — its dot is emphasized. */
  activeId: string | undefined;
}

/**
 * A slim vertical timeline of every run in the session. One dot per run, colored
 * by status, current run emphasized; click a dot to jump to that run.
 */
export default function SessionTimeline({ runs, activeId }: SessionTimelineProps) {
  const last = runs.length - 1;

  return (
    <nav
      className="flex flex-col py-8 pl-1 pr-2"
      aria-label={`Session runs (${runs.length})`}
    >
      {runs.map((run, i) => {
        const { dot: color, label } = statusStyle(run.status);
        const isActive = run.id === activeId;
        const title = `Run #${i + 1} · ${label} · ${formatEastern(run.started_at)}`;

        return (
          <Link
            key={run.id}
            to={`/runs/${run.id}`}
            title={title}
            aria-current={isActive ? "true" : undefined}
            className="group relative flex items-center gap-2.5 h-9 no-underline"
          >
            <span className="relative w-3 shrink-0 flex justify-center">
              {/* connector down to the next dot */}
              {i < last && (
                <span
                  className="absolute top-1/2 left-1/2 -translate-x-1/2 w-px h-9"
                  style={{ background: "var(--c-border)" }}
                />
              )}
              <span
                className="relative z-10 rounded-full transition-all"
                style={
                  isActive
                    ? {
                        width: 11,
                        height: 11,
                        background: color,
                        boxShadow: `0 0 0 3px ${color}33`,
                      }
                    : {
                        width: 8,
                        height: 8,
                        background: color,
                        opacity: 0.55,
                      }
                }
              />
            </span>

            <span
              className="text-[10px] font-mono tabular-nums transition-colors"
              style={{
                color: isActive ? "var(--c-text-1)" : "var(--c-text-3)",
                fontWeight: isActive ? 600 : 400,
              }}
            >
              #{i + 1}
            </span>

            {run.feedback && (
              <FeedbackThumb bare size={10} type={run.feedback.feedback_type} />
            )}
          </Link>
        );
      })}
    </nav>
  );
}
