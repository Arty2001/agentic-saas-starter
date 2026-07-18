import { useState, type ReactNode } from "react";

interface CollapsibleBlockProps {
  title: string;
  count?: number;
  defaultOpen?: boolean;
  children: ReactNode;
}

export default function CollapsibleBlock({ title, count, defaultOpen = false, children }: CollapsibleBlockProps) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="rounded-lg overflow-hidden" style={{ border: "1px solid var(--c-border)" }}>
      <button
        type="button"
        className="flex w-full items-center justify-between px-3 py-2 text-[12px] font-medium transition-colors hover:bg-[var(--c-overlay)]"
        style={{ color: "var(--c-text-2)" }}
        onClick={() => setOpen((prev) => !prev)}
      >
        <span>
          {title}
          {count != null && <span className="ml-1" style={{ color: "var(--c-text-3)" }}>({count})</span>}
        </span>
        <svg
          className={`h-3 w-3 transition-transform duration-150 ${open ? "rotate-90" : ""}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
        </svg>
      </button>
      {open && <div className="px-3 pb-3">{children}</div>}
    </div>
  );
}

export { CollapsibleBlock };
