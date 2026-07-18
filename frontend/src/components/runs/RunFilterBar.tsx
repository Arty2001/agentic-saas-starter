import { type KeyboardEvent as ReactKeyBoardEvent, type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import FeedbackThumb from "../common/FeedbackThumb";

/** The runs list defaults to the trailing 30-day window. */
export const DEFAULT_RANGE_DAYS = 30;

function toYMD(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function todayYMD(): string {
  return toYMD(new Date());
}

function daysAgoYMD(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return toYMD(d);
}

/** Title-case a raw status value, e.g. "pending_approval" -> "Pending Approval". */
function statusLabel(status: string): string {
  return status.replace(/[_-]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

const ACTIVE_BORDER = "color-mix(in srgb, var(--color-brand) 35%, transparent)";

const KNOWN_LABELS: Record<string, string> = {
  tenant_id: "Client",
  workspace_id: "Dataset",
  user_role: "User role",
};

function facetLabel(key: string): string {
  return KNOWN_LABELS[key] ?? key.replace(/[_.]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export interface RunFilters {
  search: string;
  facets: Record<string, string>;
  status: string;
  /** "" any · "any" has-feedback · "up" · "down" */
  feedback: string;
  startDate: string;
  endDate: string;
}

export function emptyFilters(): RunFilters {
  return {
    search: "",
    facets: {},
    status: "",
    feedback: "",
    startDate: daysAgoYMD(DEFAULT_RANGE_DAYS),
    endDate: todayYMD(),
  };
}

/** True when the date window is exactly the default trailing 30 days. */
function isDefaultRange(f: RunFilters): boolean {
  return f.startDate === daysAgoYMD(DEFAULT_RANGE_DAYS) && f.endDate === todayYMD();
}

export function hasActiveFilters(f: RunFilters): boolean {
  return (
    f.search.trim() !== "" ||
    f.status !== "" ||
    f.feedback !== "" ||
    !isDefaultRange(f) ||
    Object.values(f.facets).some((v) => (v ?? "").trim() !== "")
  );
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      width="10" height="10" viewBox="0 0 12 12" fill="none"
      style={{ transition: "transform 0.15s ease", transform: open ? "rotate(180deg)" : "none", opacity: 0.6 }}
    >
      <path d="M3 4.5L6 7.5L9 4.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function MagnifierIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
      <circle cx="7" cy="7" r="4.5" stroke="currentColor" strokeWidth="1.4" />
      <path d="M10.5 10.5L14 14" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

function CalendarIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
      <rect x="2" y="3" width="12" height="11" rx="1.5" stroke="currentColor" strokeWidth="1.3" />
      <path d="M2 6.5h12M5 1.5v3M11 1.5v3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}

function StatusDropdown({
  value,
  statuses,
  onChange,
}: {
  value: string;
  /** Distinct status values to offer (from GET /run-statuses). */
  statuses: string[];
  onChange: (next: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const active = value !== "";
  // "" (Any status) plus one option per distinct status.
  const options = useMemo(
    () => [{ value: "", label: "Any status" }, ...statuses.map((s) => ({ value: s, label: statusLabel(s) }))],
    [statuses],
  );
  const current = options.find((s) => s.value === value) ?? options[0];

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 h-8 pl-2.5 pr-2 rounded-md text-[12px] transition-all"
        style={{
          border: `1px solid ${active ? ACTIVE_BORDER : "var(--c-border)"}`,
          background: active ? "var(--color-brand-subtle)" : "var(--c-bg-elevated)",
          color: active ? "var(--color-brand-dark)" : "var(--c-text-2)",
        }}
      >
        <span className="font-medium whitespace-nowrap">{current.label}</span>
        <span style={{ color: active ? "var(--color-brand)" : "var(--c-text-3)" }}>
          <ChevronIcon open={open} />
        </span>
      </button>

      {open && (
        <div
          className="absolute right-0 top-[calc(100%+5px)] z-30 w-[170px] rounded-lg overflow-hidden py-1"
          style={{
            background: "var(--c-bg-elevated)",
            border: "1px solid var(--c-border)",
            boxShadow: "0 8px 28px var(--c-shadow), 0 2px 6px var(--c-shadow)",
          }}
        >
          {options.map((s) => {
            const selected = s.value === value;
            return (
              <button
                key={s.value || "any"}
                onClick={() => { onChange(s.value); setOpen(false); }}
                className="flex items-center justify-between w-full px-3 py-1.5 text-left text-[12px] transition-colors hover:bg-[var(--c-overlay)]"
                style={{ color: selected ? "var(--color-brand)" : "var(--c-text-1)" }}
              >
                {s.label}
                {selected && (
                  <svg width="11" height="11" viewBox="0 0 10 10" fill="none">
                    <path d="M1.5 5L4 7.5L8.5 2.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function FeedbackDropdown({
  value,
  onChange,
}: {
  value: string;
  onChange: (next: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const active = value !== "";
  const options: { value: string; label: string; icon?: ReactNode }[] = [
    { value: "", label: "Any feedback" },
    { value: "any", label: "Has feedback" },
    { value: "up", label: "Thumbs up", icon: <FeedbackThumb type="up" size={11} /> },
    { value: "down", label: "Thumbs down", icon: <FeedbackThumb type="down" size={11} /> },
  ];
  const current = options.find((o) => o.value === value) ?? options[0];

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 h-8 pl-2.5 pr-2 rounded-md text-[12px] transition-all"
        style={{
          border: `1px solid ${active ? ACTIVE_BORDER : "var(--c-border)"}`,
          background: active ? "var(--color-brand-subtle)" : "var(--c-bg-elevated)",
          color: active ? "var(--color-brand-dark)" : "var(--c-text-2)",
        }}
      >
        {current.icon}
        <span className="font-medium whitespace-nowrap">{current.label}</span>
        <span style={{ color: active ? "var(--color-brand)" : "var(--c-text-3)" }}>
          <ChevronIcon open={open} />
        </span>
      </button>

      {open && (
        <div
          className="absolute right-0 top-[calc(100%+5px)] z-30 w-[170px] rounded-lg overflow-hidden py-1"
          style={{
            background: "var(--c-bg-elevated)",
            border: "1px solid var(--c-border)",
            boxShadow: "0 8px 28px var(--c-shadow), 0 2px 6px var(--c-shadow)",
          }}
        >
          {options.map((o) => {
            const selected = o.value === value;
            return (
              <button
                key={o.value || "any-fb"}
                onClick={() => { onChange(o.value); setOpen(false); }}
                className="flex items-center justify-between w-full px-3 py-1.5 text-left text-[12px] transition-colors hover:bg-[var(--c-overlay)]"
                style={{ color: selected ? "var(--color-brand)" : "var(--c-text-1)" }}
              >
                <span className="flex items-center gap-1.5">
                  {o.icon}
                  {o.label}
                </span>
                {selected && (
                  <svg width="11" height="11" viewBox="0 0 10 10" fill="none">
                    <path d="M1.5 5L4 7.5L8.5 2.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function DateRangePicker({
  startDate,
  endDate,
  active,
  onChange,
}: {
  startDate: string;
  endDate: string;
  /** Whether the current window differs from the default 30 days. */
  active: boolean;
  onChange: (next: { startDate: string; endDate: string }) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const fieldStyle = {
    background: "var(--c-bg-elevated)",
    color: "var(--c-text-1)",
    border: "1px solid var(--c-border)",
  };

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        onClick={() => setOpen((o) => !o)}
        title={`${startDate || "…"} → ${endDate || "…"}`}
        className="flex items-center justify-center h-8 w-8 rounded-md transition-all"
        style={{
          border: `1px solid ${active ? ACTIVE_BORDER : "var(--c-border)"}`,
          background: active ? "var(--color-brand-subtle)" : "var(--c-bg-elevated)",
          color: active ? "var(--color-brand)" : "var(--c-text-3)",
        }}
      >
        <CalendarIcon />
      </button>

      {open && (
        <div
          className="absolute right-0 top-[calc(100%+5px)] z-30 w-[200px] rounded-lg p-3"
          style={{
            background: "var(--c-bg-elevated)",
            border: "1px solid var(--c-border)",
            boxShadow: "0 8px 28px var(--c-shadow), 0 2px 6px var(--c-shadow)",
          }}
        >
          <label className="block text-[11px] font-medium mb-1" style={{ color: "var(--c-text-3)" }}>
            From
          </label>
          <input
            type="date"
            value={startDate}
            max={endDate || undefined}
            onChange={(e) => onChange({ startDate: e.target.value, endDate })}
            className="w-full h-8 px-2 rounded text-[12px] outline-none mb-3"
            style={fieldStyle}
          />
          <label className="block text-[11px] font-medium mb-1" style={{ color: "var(--c-text-3)" }}>
            To
          </label>
          <input
            type="date"
            value={endDate}
            min={startDate || undefined}
            onChange={(e) => onChange({ startDate, endDate: e.target.value })}
            className="w-full h-8 px-2 rounded text-[12px] outline-none"
            style={fieldStyle}
          />
          <button
            onClick={() => {
              onChange({ startDate: daysAgoYMD(DEFAULT_RANGE_DAYS), endDate: todayYMD() });
              setOpen(false);
            }}
            className="mt-3 w-full h-7 rounded text-[12px] font-medium transition-colors"
            style={{ border: "1px solid var(--c-border)", color: "var(--c-text-2)" }}
            onMouseEnter={(e) => (e.currentTarget.style.background = "var(--c-overlay)")}
            onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
          >
            Reset to last {DEFAULT_RANGE_DAYS} days
          </button>
        </div>
      )}
    </div>
  );
}

function AddFilterDropdown({
  availableKeys,
  onAdd,
}: {
  availableKeys: string[];
  onAdd: (key: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const disabled = availableKeys.length === 0;

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        onClick={() => !disabled && setOpen((o) => !o)}
        disabled={disabled}
        className="flex items-center gap-1.5 h-7 pl-2 pr-2.5 rounded-md text-[12px] font-medium transition-all"
        style={{
          border: "1px dashed var(--c-border)",
          background: "var(--c-bg-elevated)",
          color: disabled ? "var(--c-text-3)" : "var(--c-text-2)",
          opacity: disabled ? 0.5 : 1,
          cursor: disabled ? "default" : "pointer",
        }}
      >
        <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
          <path d="M6 2v8M2 6h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
        Filter
        <ChevronIcon open={open} />
      </button>

      {open && (
        <div
          className="absolute left-0 top-[calc(100%+5px)] z-30 w-[180px] rounded-lg overflow-hidden py-1 max-h-[280px] overflow-y-auto"
          style={{
            background: "var(--c-bg-elevated)",
            border: "1px solid var(--c-border)",
            boxShadow: "0 8px 28px var(--c-shadow), 0 2px 6px var(--c-shadow)",
          }}
        >
          {availableKeys.map((key) => (
            <button
              key={key}
              onClick={() => { onAdd(key); setOpen(false); }}
              className="block w-full px-3 py-1.5 text-left text-[12px] transition-colors hover:bg-[var(--c-overlay)]"
              style={{ color: "var(--c-text-1)" }}
            >
              {facetLabel(key)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

const MAX_SUGGESTIONS = 5;

function FacetChip({
  keyName,
  value,
  autoFocus,
  suggestions,
  onChange,
  onRemove,
}: {
  keyName: string;
  value: string;
  autoFocus: boolean;
  suggestions: string[];
  onChange: (next: string) => void;
  onRemove: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);

  useEffect(() => {
    if (autoFocus) inputRef.current?.focus();
  }, [autoFocus]);

  const matches = useMemo(() => {
    const q = value.trim().toLowerCase();
    return suggestions
      .filter((s) => s.toLowerCase().startsWith(q) && s.toLowerCase() !== q)
      .slice(0, MAX_SUGGESTIONS);
  }, [suggestions, value]);

  useEffect(() => { setHighlight(0); }, [value]);

  // Close the dropdown on an outside click.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  // Only suggest once the user has typed at least one character.
  const showDropdown = open && value.trim().length > 0 && matches.length > 0;

  const choose = (v: string) => {
    onChange(v);
    setOpen(false);
    inputRef.current?.focus();
  };

  const handleKeyDown = (e: ReactKeyBoardEvent<HTMLInputElement>) => {
    if (showDropdown && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
      e.preventDefault();
      const n = matches.length;
      setHighlight((h) => (e.key === "ArrowDown" ? (h + 1) % n : (h - 1 + n) % n));
      return;
    }
    if (e.key === "Enter" && showDropdown) {
      e.preventDefault();
      choose(matches[highlight] ?? matches[0]);
      return;
    }
    if (e.key === "Escape") {
      if (open) setOpen(false);
      else onRemove();
    }
  };

  return (
    <div ref={containerRef} className="relative">
      <div
        className="flex items-center gap-1.5 h-7 pl-2.5 pr-1.5 rounded-md text-[12px]"
        style={{ border: "1px solid var(--c-border)", background: "var(--c-bg-elevated)" }}
      >
        <span className="font-medium" style={{ color: "var(--c-text-2)" }}>{facetLabel(keyName)}</span>
        <span style={{ color: "var(--c-text-3)" }}>contains</span>
        <div className="relative">
          <input
            ref={inputRef}
            value={value}
            onChange={(e) => { onChange(e.target.value); setOpen(true); }}
            onFocus={() => setOpen(true)}
            onKeyDown={handleKeyDown}
            placeholder="type to filter…"
            className="h-5 w-[110px] px-1 rounded outline-none text-[12px]"
            style={{ background: "var(--c-bg-elevated)", color: "var(--c-text-1)", border: "1px solid var(--c-border-subtle)" }}
          />

          {showDropdown && (
            <div
              className="absolute left-0 -right-7 top-[calc(100%+6px)] z-30 rounded-lg overflow-hidden py-1"
              style={{
                background: "var(--c-bg-elevated)",
                border: "1px solid var(--c-border)",
                boxShadow: "0 8px 28px var(--c-shadow), 0 2px 6px var(--c-shadow)",
              }}
            >
              {matches.map((s, i) => (
                <button
                  key={s}
                  // mousedown (not click) so selection lands before the input blurs.
                  onMouseDown={(e) => { e.preventDefault(); choose(s); }}
                  onMouseEnter={() => setHighlight(i)}
                  className="block w-full px-2 py-1.5 text-left text-[12px] truncate transition-colors"
                  style={{ color: "var(--c-text-1)", background: i === highlight ? "var(--c-overlay)" : "transparent" }}
                  title={s}
                >
                  {s}
                </button>
              ))}
            </div>
          )}
        </div>
        <button
          onClick={onRemove}
          className="flex items-center justify-center w-4 h-4 rounded text-[13px] transition-colors hover:bg-[var(--c-overlay)]"
          style={{ color: "var(--c-text-3)" }}
          title="Remove filter"
        >
          &times;
        </button>
      </div>
    </div>
  );
}

interface RunFilterBarProps {
  filters: RunFilters;
  onChange: (next: RunFilters) => void;
  metadataKeys: string[];
  /** Distinct run statuses for the status filter, from GET /run-statuses. */
  statuses: string[];
  facetValues: Record<string, string[]>;
  loadedCount: number;
  totalCount: number;
}

export default function RunFilterBar({ filters, onChange, metadataKeys, statuses, facetValues, loadedCount, totalCount }: RunFilterBarProps) {
  // Facet whose input should grab focus right after being added.
  const [focusKey, setFocusKey] = useState<string | null>(null);

  const activeFacetKeys = Object.keys(filters.facets);
  const availableKeys = metadataKeys.filter((k) => !(k in filters.facets));
  const anyActive = hasActiveFilters(filters);
  const capped = loadedCount < totalCount;

  const setSearch = (search: string) => onChange({ ...filters, search });
  const setStatus = (status: string) => onChange({ ...filters, status });
  const setFeedback = (feedback: string) => onChange({ ...filters, feedback });
  const setRange = (range: { startDate: string; endDate: string }) => onChange({ ...filters, ...range });
  const rangeActive = !isDefaultRange(filters);

  const addFacet = (key: string) => {
    onChange({ ...filters, facets: { ...filters.facets, [key]: "" } });
    setFocusKey(key);
  };
  const setFacet = (key: string, value: string) =>
    onChange({ ...filters, facets: { ...filters.facets, [key]: value } });
  const removeFacet = (key: string) => {
    const next = { ...filters.facets };
    delete next[key];
    onChange({ ...filters, facets: next });
  };

  return (
    <div className="mb-4">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-3">
          <div
            className="search-field flex items-center gap-2 flex-1 h-8 px-2.5 rounded-md"
            style={{ border: "1px solid var(--c-border)", background: "var(--c-bg-elevated)" }}
          >
            <span className="shrink-0" style={{ color: "var(--c-text-3)" }}>
              <MagnifierIcon />
            </span>
            <input
              value={filters.search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search"
              className="flex-1 h-full bg-transparent outline-none text-[12px]"
              style={{ color: "var(--c-text-1)" }}
            />
            {filters.search && (
              <button
                onClick={() => setSearch("")}
                className="shrink-0 flex items-center justify-center w-4 h-4 rounded text-[13px] transition-colors hover:bg-[var(--c-overlay)]"
                style={{ color: "var(--c-text-3)" }}
                title="Clear search"
              >
                &times;
              </button>
            )}
          </div>

          <StatusDropdown value={filters.status} statuses={statuses} onChange={setStatus} />
          <FeedbackDropdown value={filters.feedback} onChange={setFeedback} />
          <DateRangePicker
            startDate={filters.startDate}
            endDate={filters.endDate}
            active={rangeActive}
            onChange={setRange}
          />
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <AddFilterDropdown availableKeys={availableKeys} onAdd={addFacet} />

          {activeFacetKeys.map((key) => (
            <FacetChip
              key={key}
              keyName={key}
              value={filters.facets[key] ?? ""}
              autoFocus={focusKey === key}
              suggestions={facetValues[key] ?? []}
              onChange={(v) => setFacet(key, v)}
              onRemove={() => removeFacet(key)}
            />
          ))}

          {anyActive && (
            <button
              onClick={() => onChange(emptyFilters())}
              className="h-7 px-2.5 rounded-md text-[12px] font-medium transition-colors"
              style={{ color: "var(--c-text-2)" }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "var(--c-overlay)")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
            >
              Clear all
            </button>
          )}

          <span className="ml-auto text-[12px] font-mono tabular-nums" style={{ color: "var(--c-text-3)" }}>
            {capped ? (
              <>
                <span style={{ color: "var(--c-text-1)" }}>{loadedCount}</span>
                <span> / {totalCount}</span>
              </>
            ) : (
              <span>
                {totalCount} {anyActive ? (totalCount === 1 ? "match" : "matches") : "total"}
              </span>
            )}
          </span>
        </div>
      </div>
    </div>
  );
}
