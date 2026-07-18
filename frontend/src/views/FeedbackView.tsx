import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { apiGet } from "../api/client";
import type { FeedbackItem, FeedbackListResponse } from "../api/types";
import Dropdown, { type DropdownOption } from "../components/common/Dropdown";
import FeedbackThumb from "../components/common/FeedbackThumb";
import { useAuth } from "../context/AuthContext";
import { getFeedbackLastSeen, setFeedbackLastSeen } from "../hooks/feedbackSeen";
import { parseUtcDate, timeAgo } from "../utils";

/* ════════════════════════════════════════════════════════════════════════
   FEEDBACK — "Signal on Limestone" dashboard, wired to /api/feedback.
   Light/dark follows the app's .dark theme. Signature element: the diverging
   daily "sentiment pulse" (praise above the baseline, complaints below).
   ════════════════════════════════════════════════════════════════════════ */

const CSS = `
.fb-root {
  --bg: var(--c-bg);
  --card: var(--c-bg-elevated);
  --card-2: var(--c-bg-secondary);
  --ink: var(--c-text-1);
  --muted: var(--c-text-2);
  --faint: var(--c-text-3);
  --line: var(--c-border);
  --line-2: var(--c-border-subtle);
  --accent: var(--color-brand);
  --accent-ink: var(--color-brand-dark);
  --accent-soft: color-mix(in srgb, var(--color-brand) 12%, transparent);
  --up: var(--color-success);
  --up-soft: color-mix(in srgb, var(--color-success) 12%, transparent);
  --down: var(--color-error);
  --down-soft: color-mix(in srgb, var(--color-error) 12%, transparent);
  --amber: var(--color-warning);
  --shadow-md: 0 1px 2px var(--c-shadow);
  --shadow-lg: 0 8px 28px var(--c-shadow), 0 2px 6px var(--c-shadow);

  font-family: var(--font-sans);
  background: var(--bg);
  color: var(--ink);
  min-height: 100%;
  -webkit-font-smoothing: antialiased;
  font-size: 14px;
  line-height: 1.5;
}

.fb-display { font-variant-numeric: tabular-nums; letter-spacing: -0.01em; }
.fb-mono { font-family: var(--font-mono); }

.fb-card { background: var(--card); border: 1px solid var(--line); border-radius: 12px; }

.fb-eyebrow { font-size: 11px; font-weight: 600; letter-spacing: .08em; text-transform: uppercase; color: var(--faint); }

@keyframes fb-rise { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
.fb-rise { animation: fb-rise .45s cubic-bezier(.22,1,.36,1) both; }

@keyframes fb-shimmer { from { background-position: -400px 0; } to { background-position: 400px 0; } }
.fb-skeleton { border-radius: 8px; background: linear-gradient(90deg, var(--line-2) 25%, var(--line) 40%, var(--line-2) 55%); background-size: 800px 100%; animation: fb-shimmer 1.3s linear infinite; }

@keyframes fb-pip { 0%,100% { transform: scale(1); opacity: 1; } 50% { transform: scale(1.7); opacity: .45; } }
.fb-pip { animation: fb-pip 1.8s ease-in-out infinite; }

.fb-btn { display: inline-flex; align-items: center; gap: 7px; border-radius: 8px; border: 1px solid var(--line); background: var(--card); color: var(--ink); font-weight: 600; font-size: 13px; padding: 8px 12px; cursor: pointer; transition: background .18s ease, border-color .18s ease; }
.fb-btn:hover { background: var(--c-overlay); border-color: var(--faint); }
.fb-btn:disabled { opacity: .5; cursor: default; background: var(--card); border-color: var(--line); }
.fb-btn-primary { background: var(--ink); color: var(--bg); border-color: var(--ink); }
.fb-btn-primary:hover { background: var(--ink); border-color: var(--ink); opacity: .9; }

.fb-input, .fb-select { border-radius: 8px; border: 1px solid var(--line); background: var(--card); color: var(--ink); font: inherit; font-size: 13px; font-weight: 500; padding: 8px 11px; outline: none; transition: border-color .18s ease, box-shadow .18s ease; }
.fb-input::placeholder { color: var(--faint); }
.fb-input:focus, .fb-select:focus { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); }
.fb-select { appearance: none; -webkit-appearance: none; padding-right: 30px; cursor: pointer; }

.fb-seg { display: inline-flex; padding: 3px; gap: 2px; background: var(--card-2); border: 1px solid var(--line); border-radius: 9px; }
.fb-seg button { border: 1px solid transparent; background: transparent; color: var(--muted); font: inherit; font-size: 12.5px; font-weight: 600; padding: 5px 11px; border-radius: 7px; cursor: pointer; transition: background .18s ease, color .18s ease; display: inline-flex; align-items: center; gap: 6px; }
.fb-seg button[data-on="true"] { background: var(--card); color: var(--ink); border-color: var(--line); box-shadow: var(--shadow-md); }

.fb-row { transition: background .18s ease; cursor: pointer; }
.fb-row:hover { background: var(--c-overlay); }
.fb-expand { display: grid; grid-template-rows: 0fr; transition: grid-template-rows .32s cubic-bezier(.22,1,.36,1); }
.fb-expand[data-open="true"] { grid-template-rows: 1fr; }
.fb-expand > div { overflow: hidden; }

.fb-chip { display: inline-flex; align-items: center; gap: 5px; font-family: var(--font-mono); font-size: 11px; font-weight: 500; color: var(--muted); background: var(--card-2); border: 1px solid var(--line); border-radius: 6px; padding: 3px 8px; }
.fb-runlink { color: var(--accent-ink); font-weight: 600; font-size: 12.5px; text-decoration: none; display: inline-flex; align-items: center; gap: 4px; }
.fb-runlink:hover { text-decoration: underline; }
.fb-runlink svg { transition: transform .18s ease; }
.fb-runlink:hover svg { transform: translate(2px,-2px); }

.fb-gaugeArc { transition: stroke-dashoffset 1.1s cubic-bezier(.22,1,.36,1); }
.fb-bar { transition: width .9s cubic-bezier(.22,1,.36,1); }

.fb-root ::selection { background: var(--accent-soft); }
.fb-root :focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; border-radius: 6px; }

@media (prefers-reduced-motion: reduce) {
  .fb-root *, .fb-root *::before, .fb-root *::after { animation: none !important; transition: none !important; }
}
`;

const DAY = 86_400_000;

/* ─── utilities ───────────────────────────────────────────────────────── */

function shortDate(t: number): string {
  return new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function labelize(cat: string): string {
  if (cat === "incorrect_or_incomplete") return "Incorrect or incomplete";
  return cat.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
}

function csvEscape(v: string | null): string {
  if (v == null) return "";
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Stringify any metadata value for display/search/export (objects -> JSON). */
function metaText(v: unknown): string {
  if (v == null) return "";
  return typeof v === "object" ? JSON.stringify(v) : String(v);
}

/* ─── icons ───────────────────────────────────────────────────────────── */

const I = ({ d, size = 16, sw = 1.8 }: { d: ReactNode; size?: number; sw?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {d}
  </svg>
);

const Icon = {
  thumbUp: (s = 16) => <I size={s} d={<path d="M7 11v9m0-9 3.4-6.8A2 2 0 0 1 14 5v4h4.6a2 2 0 0 1 2 2.4l-1.2 6A2 2 0 0 1 17.4 19H7m0-8H4a1 1 0 0 0-1 1v7a1 1 0 0 0 1 1h3" />} />,
  thumbDown: (s = 16) => <I size={s} d={<path d="M17 13V4m0 9-3.4 6.8A2 2 0 0 1 10 19v-4H5.4a2 2 0 0 1-2-2.4l1.2-6A2 2 0 0 1 6.6 5H17m0 8h3a1 1 0 0 0 1-1V5a1 1 0 0 0-1-1h-3" />} />,
  search: (s = 16) => <I size={s} d={<><circle cx="11" cy="11" r="7" /><path d="m20 20-3.2-3.2" /></>} />,
  download: (s = 16) => <I size={s} d={<><path d="M12 4v11m0 0 4.5-4.5M12 15l-4.5-4.5" /><path d="M4 19h16" /></>} />,
  chevron: (s = 16) => <I size={s} d={<path d="m6 9 6 6 6-6" />} />,
  arrow: (s = 14) => <I size={s} d={<path d="M6 18 18 6m0 0H8m10 0v10" />} />,
  inbox: (s = 22) => <I size={s} d={<><path d="M3 13h4.2l1.6 2.6h6.4L16.8 13H21" /><path d="M5.4 5.6h13.2L21 13v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-5l2.4-7.4Z" /></>} />,
  x: (s = 14) => <I size={s} d={<path d="M6 6l12 12M18 6 6 18" />} />,
};

/* ─── sentiment gauge ─────────────────────────────────────────────────── */

function Gauge({ rate, size = 224 }: { rate: number; size?: number }) {
  const [drawn, setDrawn] = useState(0);
  useEffect(() => {
    const t = requestAnimationFrame(() => setDrawn(rate));
    return () => cancelAnimationFrame(t);
  }, [rate]);

  const R = 78;
  const C = Math.PI * R;
  const offset = C * (1 - drawn);
  const pct = Math.round(rate * 100);
  const height = (size * 116) / 200;

  return (
    <div style={{ position: "relative", width: size, height, flexShrink: 0 }}>
      <svg viewBox="0 0 200 116" width={size} height={height} role="img" aria-label={`Positive rate ${pct} percent`}>
        <path d={`M 22 106 A ${R} ${R} 0 0 1 178 106`} fill="none" stroke="var(--line)" strokeWidth="13" strokeLinecap="round" />
        <path d={`M 22 106 A ${R} ${R} 0 0 1 178 106`} fill="none" className="fb-gaugeArc" stroke={rate >= 0.5 ? "var(--up)" : "var(--down)"} strokeWidth="13" strokeLinecap="round" strokeDasharray={C} strokeDashoffset={offset} />
      </svg>
      <div style={{ position: "absolute", inset: 0, top: height * 0.5, textAlign: "center" }}>
        <div className="fb-display" style={{ fontSize: size * 0.2, fontWeight: 700, lineHeight: 1 }}>
          {pct}<span style={{ fontSize: size * 0.1, fontWeight: 500, color: "var(--muted)" }}>%</span>
        </div>
      </div>
    </div>
  );
}

/* ─── sentiment pulse (signature) ─────────────────────────────────────── */

interface DayBucket { t: number; up: number; down: number; }

function PulseChart({ days, height = 100 }: { days: DayBucket[]; height?: number }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = days.length * 12;
  const H = 130;
  const BASE = 74;
  const maxUp = Math.max(1, ...days.map((d) => d.up));
  const maxDown = Math.max(1, ...days.map((d) => d.down));
  const upH = (v: number) => (v / maxUp) * 52;
  const downH = (v: number) => (v / maxDown) * 40;
  const h = hover != null ? days[hover] : null;

  return (
    <div style={{ position: "relative" }} onMouseLeave={() => setHover(null)}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={height} preserveAspectRatio="none" style={{ display: "block" }} role="img" aria-label="Daily feedback, positive above the line, negative below">
        <line x1="0" y1={BASE} x2={W} y2={BASE} stroke="var(--line)" strokeWidth="1" />
        {days.map((d, i) => {
          const x = i * 12 + 2.5;
          const dim = hover != null && hover !== i;
          return (
            <g key={d.t} style={{ opacity: dim ? 0.35 : 1, transition: "opacity .15s ease" }}>
              {d.up > 0 && <rect x={x} y={BASE - 2 - upH(d.up)} width="7" height={upH(d.up)} fill="var(--up)" />}
              {d.down > 0 && <rect x={x} y={BASE + 2} width="7" height={downH(d.down)} fill="var(--down)" />}
              {d.up === 0 && d.down === 0 && <rect x={x + 2} y={BASE - 1} width="3" height="2" fill="var(--line)" />}
              <rect x={i * 12} y="0" width="12" height={H} fill="transparent" onMouseEnter={() => setHover(i)} />
            </g>
          );
        })}
      </svg>
      {h && hover != null && (
        <div style={{ position: "absolute", left: `${((hover + 0.5) / days.length) * 100}%`, top: -6, transform: `translateX(${hover > days.length * 0.7 ? "-100%" : hover < days.length * 0.3 ? "0" : "-50%"})`, background: "var(--ink)", color: "var(--card)", borderRadius: 9, padding: "6px 10px", pointerEvents: "none", boxShadow: "var(--shadow-lg)", whiteSpace: "nowrap", zIndex: 5 }}>
          <div className="fb-mono" style={{ fontSize: 10, opacity: 0.7, letterSpacing: ".08em" }}>{shortDate(h.t).toUpperCase()}</div>
          <div style={{ fontSize: 12, fontWeight: 700, display: "flex", gap: 10, marginTop: 2 }}>
            <span>▲ {h.up} up</span>
            <span style={{ opacity: 0.85 }}>▼ {h.down} down</span>
          </div>
        </div>
      )}
    </div>
  );
}

/* ─── top thumbs-down reasons ─────────────────────────────────────────── */

function Reasons({ rows, onPick, active }: { rows: Array<{ cat: string; count: number; share: number }>; onPick: (cat: string) => void; active: string }) {
  const max = Math.max(1, ...rows.map((r) => r.count));
  if (rows.length === 0) {
    return <div style={{ fontSize: 13, color: "var(--muted)", paddingTop: 8 }}>No thumbs-down in this range. Enjoy it while it lasts.</div>;
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
      {rows.map((r) => {
        const on = active === r.cat;
        return (
          <button key={r.cat} onClick={() => onPick(on ? "all" : r.cat)} title={on ? "Clear reason filter" : `Filter list to "${labelize(r.cat)}"`}
            style={{ all: "unset", cursor: "pointer", display: "block", borderRadius: 8, padding: "2px 4px", background: on ? "var(--down-soft)" : "transparent", transition: "background .18s ease" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 4 }}>
              <span style={{ fontSize: 12.5, fontWeight: 700 }}>{labelize(r.cat)}</span>
              <span className="fb-mono" style={{ fontSize: 11, color: "var(--muted)" }}>{r.count} · {Math.round(r.share * 100)}%</span>
            </div>
            <div style={{ height: 6, borderRadius: 99, background: "var(--line-2)", overflow: "hidden" }}>
              <div className="fb-bar" style={{ height: "100%", borderRadius: 99, background: "var(--down)", width: `${(r.count / max) * 100}%`, opacity: on ? 1 : 0.85 }} />
            </div>
          </button>
        );
      })}
    </div>
  );
}

/* ─── feedback list row ───────────────────────────────────────────────── */

function MetaChip({ text }: { text: string }) {
  return (
    <span className="text-[10px] font-mono px-1.5 py-0.5 rounded max-w-[240px] truncate" title={text} style={{ background: "var(--c-bg-tertiary)", color: "var(--c-text-3)" }}>
      {text}
    </span>
  );
}

function FeedbackRow({ fb, isNew, open, onToggle, index }: { fb: FeedbackItem; isNew: boolean; open: boolean; onToggle: () => void; index: number }) {
  const excerpt = fb.comment ?? fb.prompt_text ?? "—";
  const meta = fb.metadata;
  return (
    <li style={{ borderTop: index > 0 ? "1px solid var(--c-border-subtle)" : undefined }}>
      <div
        className="flex items-center gap-3 px-4 py-2 cursor-pointer transition-colors hover:bg-[var(--c-overlay)]"
        onClick={onToggle} role="button" tabIndex={0} aria-expanded={open}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onToggle(); } }}
      >
        <FeedbackThumb type={fb.feedback_type} size={13} />
        <span className="text-[12px] font-medium max-w-[150px] truncate shrink-0" style={{ color: "var(--c-text-2)" }} title={fb.username ?? ""}>
          {fb.username ?? "anonymous"}
        </span>
        {fb.category && (
          <span className="text-[10px] px-1.5 py-0.5 rounded font-mono shrink-0" style={{ background: "var(--c-bg-tertiary)", color: "var(--c-text-3)" }}>
            {labelize(fb.category)}
          </span>
        )}
        <span className="text-[11px] flex-1 min-w-0 truncate" style={{ color: "var(--c-text-3)" }}>
          {!fb.comment && <span style={{ opacity: 0.7 }}>Prompt · </span>}{excerpt}
        </span>
        {isNew && (
          <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full shrink-0" style={{ background: "var(--color-warning)", color: "#fff" }}>New</span>
        )}
        <span className="text-[11px] font-mono tabular-nums shrink-0" style={{ color: "var(--c-text-3)" }} title={fb.created_at}>{timeAgo(fb.created_at)}</span>
        <svg className={`h-3 w-3 shrink-0 transition-transform duration-150 ${open ? "rotate-90" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} style={{ color: "var(--c-text-3)" }}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
        </svg>
      </div>

      <div className="fb-expand" data-open={open}>
        <div>
          <div className="pr-4 pb-3 pl-[44px] space-y-2.5">
            {([["Prompt", fb.prompt_text], ["AI Reply", fb.ai_reply_text], ["Comment", fb.comment]] as const).map(([label, text]) =>
              text ? (
                <div key={label}>
                  <div className="text-[10px] font-semibold uppercase tracking-wider mb-1" style={{ color: "var(--c-text-3)" }}>{label}</div>
                  <div className="rounded-md px-2.5 py-1.5 text-[12px] leading-snug whitespace-pre-wrap" style={{ background: "var(--c-overlay)", border: "1px solid var(--c-border-subtle)", color: "var(--c-text-2)" }}>{text}</div>
                </div>
              ) : null
            )}
            <div className="flex items-center gap-1.5 flex-wrap pt-0.5">
              {meta && Object.entries(meta)
                .filter(([, v]) => v != null && v !== "")
                .map(([k, v]) => <MetaChip key={k} text={`${k}: ${metaText(v)}`} />)}
              {fb.run_id && (
                <Link to={`/runs/${fb.run_id}`} onClick={(e) => e.stopPropagation()} className="text-[12px] font-medium hover:underline shrink-0 ml-auto" style={{ color: "var(--color-brand)" }}>
                  View run →
                </Link>
              )}
            </div>
          </div>
        </div>
      </div>
    </li>
  );
}

/* ─── skeleton + empty ────────────────────────────────────────────────── */

function Skeleton() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div className="fb-card" style={{ padding: 26, display: "grid", gap: 24, gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
        {[0, 1, 2].map((i) => (
          <div key={i} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div className="fb-skeleton" style={{ height: 12, width: "40%" }} />
            <div className="fb-skeleton" style={{ height: 96 }} />
          </div>
        ))}
      </div>
      <div className="fb-card" style={{ padding: 20, display: "flex", flexDirection: "column", gap: 14 }}>
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} style={{ display: "flex", gap: 14, alignItems: "center" }}>
            <div className="fb-skeleton" style={{ width: 32, height: 32, borderRadius: 10 }} />
            <div className="fb-skeleton" style={{ height: 13, flex: 1 }} />
            <div className="fb-skeleton" style={{ height: 11, width: 54 }} />
          </div>
        ))}
      </div>
    </div>
  );
}

function EmptyState({ onClear }: { onClear: () => void }) {
  return (
    <div style={{ textAlign: "center", padding: "56px 24px", color: "var(--muted)" }}>
      <div style={{ width: 52, height: 52, borderRadius: 16, margin: "0 auto 14px", display: "grid", placeItems: "center", background: "var(--card-2)", border: "1px solid var(--line)", color: "var(--faint)" }}>{Icon.inbox(24)}</div>
      <div style={{ fontSize: 14.5, fontWeight: 800, color: "var(--ink)" }}>No feedback matches these filters</div>
      <div style={{ fontSize: 13, marginTop: 4 }}>Widen the date range or clear a filter to see more.</div>
      <button className="fb-btn" style={{ marginTop: 16 }} onClick={onClear}>{Icon.x(13)} Clear all filters</button>
    </div>
  );
}

/* ─── main ────────────────────────────────────────────────────────────── */

type RangeKey = "7" | "30" | "90" | "all";
type FeedbackType = "up" | "down";

interface Filters {
  type: "all" | FeedbackType;
  category: string;
  user: string;
  query: string;
  range: RangeKey;
}

const DEFAULT_FILTERS: Filters = { type: "all", category: "all", user: "all", query: "", range: "30" };

const RANGE_OPTIONS: DropdownOption[] = [
  { value: "7", label: "Last 7 days" },
  { value: "30", label: "Last 30 days" },
  { value: "90", label: "Last 90 days" },
  { value: "all", label: "All time" },
];

export default function FeedbackView() {
  const { user } = useAuth();
  const [all, setAll] = useState<FeedbackItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [openId, setOpenId] = useState<string | null>(null);
  const [visible, setVisible] = useState(20);
  const set = (patch: Partial<Filters>) => { setFilters((f) => ({ ...f, ...patch })); setVisible(20); };

  const [nowMs] = useState(() => Date.now());
  const [prevSeen] = useState<number | null>(() => {
    const s = getFeedbackLastSeen(user);
    return s ? parseUtcDate(s).getTime() : null;
  });
  useEffect(() => { setFeedbackLastSeen(user, new Date().toISOString()); }, [user]);

  // One fetch of all feedback; every view/aggregate is derived client-side.
  useEffect(() => {
    let cancelled = false;
    apiGet<FeedbackListResponse>("/feedback?limit=5000")
      .then((r) => { if (!cancelled) setAll(r.items); })
      .catch((e: unknown) => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)); });
    return () => { cancelled = true; };
  }, [retryCount]);

  const data = useMemo(() => all ?? [], [all]);
  const loading = all === null;

  const earliest = useMemo(
    () => (data.length ? Math.min(...data.map((f) => +parseUtcDate(f.created_at))) : nowMs),
    [data, nowMs]
  );
  const spanDays = Math.min(90, Math.max(7, Math.ceil((nowMs - earliest) / DAY)));
  const rangeDays = filters.range === "all" ? spanDays : parseInt(filters.range, 10);
  const windowStart = nowMs - rangeDays * DAY;

  const matchesStatic = useCallback((fb: FeedbackItem) => {
    if (filters.type !== "all" && fb.feedback_type !== filters.type) return false;
    if (filters.category !== "all" && fb.category !== filters.category) return false;
    if (filters.user !== "all" && fb.username !== filters.user) return false;
    if (filters.query) {
      const q = filters.query.toLowerCase();
      const metaValues = fb.metadata ? Object.values(fb.metadata).map(metaText) : [];
      const hay = [fb.comment, fb.prompt_text, fb.ai_reply_text, fb.username, ...metaValues]
        .filter(Boolean).join(" ").toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  }, [filters]);

  const filtered = useMemo(
    () => data.filter((fb) => matchesStatic(fb) && (filters.range === "all" || +parseUtcDate(fb.created_at) >= windowStart)),
    [data, matchesStatic, filters.range, windowStart]
  );

  const stats = useMemo(() => {
    const total = filtered.length;
    const up = filtered.filter((f) => f.feedback_type === "up").length;
    const down = total - up;
    const rate = total ? up / total : 0;

    let deltaPts: number | null = null;
    if (filters.range !== "all") {
      const prev = data.filter((fb) => {
        const t = +parseUtcDate(fb.created_at);
        return matchesStatic(fb) && t < windowStart && t >= windowStart - rangeDays * DAY;
      });
      const pUp = prev.filter((f) => f.feedback_type === "up").length;
      if (prev.length >= 4) deltaPts = (rate - pUp / prev.length) * 100;
    }

    const catCounts = new Map<string, number>();
    for (const f of filtered) if (f.category) catCounts.set(f.category, (catCounts.get(f.category) ?? 0) + 1);
    const reasons = [...catCounts.entries()]
      .map(([cat, count]) => ({ cat, count, share: down ? count / down : 0 }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    return { total, up, down, rate, deltaPts, reasons };
  }, [filtered, data, matchesStatic, filters.range, windowStart, rangeDays]);

  const days: DayBucket[] = useMemo(() => {
    const n = Math.min(rangeDays, 90);
    const buckets: DayBucket[] = [];
    const startOfToday = new Date(nowMs); startOfToday.setHours(0, 0, 0, 0);
    for (let i = n - 1; i >= 0; i--) buckets.push({ t: +startOfToday - i * DAY, up: 0, down: 0 });
    const first = buckets[0].t;
    for (const f of filtered) {
      const t = +parseUtcDate(f.created_at);
      if (t < first) continue;
      const idx = Math.min(buckets.length - 1, Math.floor((t - first) / DAY));
      if (f.feedback_type === "up") buckets[idx].up++; else buckets[idx].down++;
    }
    return buckets;
  }, [filtered, rangeDays, nowMs]);

  const allUsers = useMemo(() => [...new Set(data.map((f) => f.username).filter(Boolean) as string[])].sort(), [data]);
  const allCategories = useMemo(() => [...new Set(data.map((f) => f.category).filter(Boolean) as string[])].sort(), [data]);

  const exportCsv = () => {
    // Metadata columns are whatever keys the backend actually sent, unioned across rows.
    const metaKeys = [...new Set(filtered.flatMap((f) => Object.keys(f.metadata ?? {})))].sort();
    const cols = ["feedback_type", "category", "comment", "prompt_text", "ai_reply_text", "username", "run_id", ...metaKeys, "created_at"];
    const lines = [cols.map(csvEscape).join(",")];
    for (const f of filtered) {
      const meta = f.metadata ?? {};
      lines.push([
        f.feedback_type, f.category, f.comment, f.prompt_text, f.ai_reply_text, f.username, f.run_id,
        ...metaKeys.map((k) => metaText(meta[k])), f.created_at,
      ].map((v) => csvEscape(v as string | null)).join(","));
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `feedback_${new Date(nowMs).toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportDisabled = loading || filtered.length === 0;

  return (
    <div className="fb-root no-scrollbar" style={{ height: "100%", overflowY: "auto" }}>
      <style>{CSS}</style>
      <div style={{ maxWidth: 1060, margin: "0 auto", padding: "36px 24px 80px" }}>

        <header className="fb-rise flex items-center justify-between gap-4" style={{ marginBottom: 22 }}>
          <h1 className="text-[13px] font-semibold uppercase tracking-wider" style={{ color: "var(--c-text-3)" }}>Feedback</h1>
          <button
            onClick={exportCsv}
            disabled={exportDisabled}
            className="flex items-center gap-1.5 h-8 px-3 rounded-md text-[12px] font-medium transition-colors"
            style={{ border: "1px solid var(--c-border)", background: "var(--c-bg-elevated)", color: "var(--c-text-2)", opacity: exportDisabled ? 0.5 : 1 }}
            onMouseEnter={(e) => { if (!exportDisabled) e.currentTarget.style.background = "var(--c-overlay)"; }}
            onMouseLeave={(e) => (e.currentTarget.style.background = "var(--c-bg-elevated)")}
            title="Download the current view as CSV"
          >
            {Icon.download(14)} Export CSV
          </button>
        </header>

        {error ? (
          <div className="fb-card" style={{ padding: 24 }}>
            <div style={{ color: "var(--down)", fontWeight: 700, marginBottom: 10 }}>{error}</div>
            <button className="fb-btn" onClick={() => { setError(null); setRetryCount((c) => c + 1); }}>Retry</button>
          </div>
        ) : loading ? <Skeleton /> : (
          <>
            <section className="fb-card fb-rise" aria-label="Feedback analytics" style={{ padding: "14px 20px", height: 130, overflow: "hidden", marginBottom: 18, animationDelay: "100ms" }}>
              <div style={{ display: "grid", gap: 28, gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", alignItems: "start" }}>
                <div style={{display:'flex', height: '100%', flexDirection: 'column' }}>
                  <div className="fb-eyebrow" style={{ marginBottom: 8 }}>Sentiment</div>
                  <div style={{ display: "flex", alignItems: "center", gap: 18 , height: '100%'}}>
                    <Gauge rate={stats.rate} size={92} />
                    <div style={{ display: "flex", gap: 16 }}>
                      {[{ label: "total", value: stats.total, color: "var(--ink)" }, { label: "up", value: stats.up, color: "var(--up)" }, { label: "down", value: stats.down, color: "var(--down)" }].map((s) => (
                        <div key={s.label} style={{ textAlign: "center" }}>
                          <div className="fb-display" style={{ fontSize: 18, fontWeight: 700, color: s.color }}>{s.value}</div>
                          <div className="fb-eyebrow">{s.label}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                <div style={{ minWidth: 0 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8 }}>
                    <div className="fb-eyebrow">Sentiment pulse</div>
                    <div style={{ display: "flex", gap: 12 }}>
                      <span style={{ fontSize: 11, fontWeight: 700, color: "var(--up)" }}>▲ positive</span>
                      <span style={{ fontSize: 11, fontWeight: 700, color: "var(--down)" }}>▼ negative</span>
                    </div>
                  </div>
                  <PulseChart days={days} height={72} />
                </div>

                <div>
                  <div className="fb-eyebrow" style={{ marginBottom: 8 }}>Top thumbs-down reasons</div>
                  <Reasons rows={stats.reasons.slice(0, 3)} active={filters.category} onPick={(cat) => set({ category: cat, type: cat === "all" ? filters.type : "down" })} />
                </div>
              </div>
            </section>

            <div className="fb-rise" style={{ animationDelay: "180ms" }}>
              <div className="flex items-center gap-2 mb-3 flex-wrap">
                <div className="search-field flex items-center gap-2 flex-1 min-w-[200px] h-8 px-2.5 rounded-md" style={{ border: "1px solid var(--c-border)", background: "var(--c-bg-elevated)" }}>
                  <span className="shrink-0" style={{ color: "var(--c-text-3)" }}>{Icon.search(14)}</span>
                  <input value={filters.query} onChange={(e) => set({ query: e.target.value })} placeholder="Search comments, prompts, replies…" className="flex-1 h-full bg-transparent outline-none text-[12px]" style={{ color: "var(--c-text-1)" }} />
                  {filters.query && (
                    <button onClick={() => set({ query: "" })} className="shrink-0 flex items-center justify-center w-4 h-4 rounded text-[13px] transition-colors hover:bg-[var(--c-overlay)]" style={{ color: "var(--c-text-3)" }} title="Clear search">&times;</button>
                  )}
                </div>

                <Dropdown
                  value={filters.type}
                  active={filters.type !== "all"}
                  width={160}
                  onChange={(v) => set({ type: v as Filters["type"], category: v === "up" ? "all" : filters.category })}
                  options={[
                    { value: "all", label: "All feedback" },
                    { value: "up", label: "Positive", icon: <FeedbackThumb type="up" size={11} /> },
                    { value: "down", label: "Negative", icon: <FeedbackThumb type="down" size={11} /> },
                  ]}
                />
                <Dropdown
                  value={filters.category}
                  active={filters.category !== "all"}
                  width={200}
                  onChange={(v) => set({ category: v, type: v === "all" ? filters.type : "down" })}
                  options={[{ value: "all", label: "All reasons" }, ...allCategories.map((c) => ({ value: c, label: labelize(c) }))]}
                />
                <Dropdown
                  value={filters.user}
                  active={filters.user !== "all"}
                  width={200}
                  onChange={(v) => set({ user: v })}
                  options={[{ value: "all", label: "All users" }, ...allUsers.map((u) => ({ value: u, label: u }))]}
                />
                <Dropdown
                  value={filters.range}
                  active={filters.range !== "30"}
                  width={160}
                  align="right"
                  onChange={(v) => set({ range: v as RangeKey })}
                  options={RANGE_OPTIONS}
                />
              </div>

              {filtered.length === 0 ? (
                <EmptyState onClear={() => set(DEFAULT_FILTERS)} />
              ) : (
                <>
                  <ul className="rounded-lg overflow-hidden" style={{ listStyle: "none", margin: 0, padding: 0, border: "1px solid var(--c-border)", background: "var(--c-bg-elevated)" }}>
                    {filtered.slice(0, visible).map((fb, i) => (
                      <FeedbackRow key={fb.id} fb={fb} index={i}
                        isNew={prevSeen != null && +parseUtcDate(fb.created_at) > prevSeen}
                        open={openId === fb.id}
                        onToggle={() => setOpenId((id) => (id === fb.id ? null : fb.id))} />
                    ))}
                  </ul>
                  <div className="flex items-center justify-between gap-3 mt-3">
                    <span className="text-[11px] font-mono" style={{ color: "var(--c-text-3)" }}>Showing {Math.min(visible, filtered.length)} of {filtered.length}</span>
                    {visible < filtered.length && (
                      <button
                        onClick={() => setVisible((v) => v + 20)}
                        className="h-8 px-4 rounded-md text-[12px] font-medium transition-colors"
                        style={{ border: "1px solid var(--c-border)", background: "var(--c-bg-elevated)", color: "var(--c-text-2)" }}
                        onMouseEnter={(e) => (e.currentTarget.style.background = "var(--c-overlay)")}
                        onMouseLeave={(e) => (e.currentTarget.style.background = "var(--c-bg-elevated)")}
                      >
                        Show more
                      </button>
                    )}
                  </div>
                </>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
