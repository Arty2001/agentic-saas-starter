import { type ReactNode, useEffect, useRef, useState } from "react";

const ACTIVE_BORDER = "color-mix(in srgb, var(--color-brand) 35%, transparent)";

export interface DropdownOption {
  value: string;
  label: string;
  icon?: ReactNode;
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg width="10" height="10" viewBox="0 0 12 12" fill="none" style={{ transition: "transform 0.15s ease", transform: open ? "rotate(180deg)" : "none", opacity: 0.6 }}>
      <path d="M3 4.5L6 7.5L9 4.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

interface DropdownProps {
  value: string;
  options: DropdownOption[];
  onChange: (value: string) => void;
  /** Highlight as active; defaults to "any value other than '' or 'all'". */
  active?: boolean;
  width?: number;
  align?: "left" | "right";
}

/** The shared filter dropdown used across the Runs and Feedback tabs. */
export default function Dropdown({ value, options, onChange, active, width = 170, align = "left" }: DropdownProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const isActive = active ?? (value !== "" && value !== "all");
  const current = options.find((o) => o.value === value) ?? options[0];

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open]);

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 h-8 pl-2.5 pr-2 rounded-md text-[12px] transition-all"
        style={{
          border: `1px solid ${isActive ? ACTIVE_BORDER : "var(--c-border)"}`,
          background: isActive ? "var(--color-brand-subtle)" : "var(--c-bg-elevated)",
          color: isActive ? "var(--color-brand-dark)" : "var(--c-text-2)",
        }}
      >
        {current?.icon}
        <span className="font-medium whitespace-nowrap max-w-[160px] truncate">{current?.label}</span>
        <span style={{ color: isActive ? "var(--color-brand)" : "var(--c-text-3)" }}>
          <ChevronIcon open={open} />
        </span>
      </button>

      {open && (
        <div
          className={`absolute ${align === "right" ? "right-0" : "left-0"} top-[calc(100%+5px)] z-30 rounded-lg overflow-hidden py-1 max-h-[300px] overflow-y-auto no-scrollbar`}
          style={{ width, background: "var(--c-bg-elevated)", border: "1px solid var(--c-border)", boxShadow: "0 8px 28px var(--c-shadow), 0 2px 6px var(--c-shadow)" }}
        >
          {options.map((o) => {
            const selected = o.value === value;
            return (
              <button
                key={o.value || "any"}
                onClick={() => { onChange(o.value); setOpen(false); }}
                className="flex items-center justify-between w-full px-3 py-1.5 text-left text-[12px] transition-colors hover:bg-[var(--c-overlay)]"
                style={{ color: selected ? "var(--color-brand)" : "var(--c-text-1)" }}
              >
                <span className="flex items-center gap-1.5 truncate">{o.icon}{o.label}</span>
                {selected && (
                  <svg width="11" height="11" viewBox="0 0 10 10" fill="none" className="shrink-0 ml-2">
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
