interface ToolDefEntry {
  name: string;
  description: string;
  category: string | null;
  tags: string[];
  args_schema: Record<string, unknown> | null;
}

interface Props {
  tools: ToolDefEntry[];
  editedTools: Record<string, string>;
  getToolDesc: (name: string) => string;
  onToolChange: (name: string, value: string, originalDesc: string) => void;
  onToolRevert: (name: string) => void;
}

export default function ToolsPanel({ tools, editedTools, getToolDesc, onToolChange, onToolRevert }: Props) {
  return (
    <div>
      {tools.map((t) => {
        const desc = getToolDesc(t.name);
        const isDirty = t.name in editedTools;
        return (
          <div key={t.name} className="border-b px-4 py-3" style={{ borderColor: "var(--c-border-subtle)" }}>
            <div className="flex items-center gap-2 mb-2">
              <span className="text-[13px] font-semibold" style={{ color: "var(--c-text-1)" }}>
                {t.name}
              </span>
              {isDirty && (
                <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: "var(--color-brand)" }} />
              )}
              {t.category && (
                <span className="text-[10px] px-1.5 py-0.5 rounded font-mono" style={{ background: "var(--c-bg-tertiary)", color: "var(--c-text-3)" }}>
                  {t.category}
                </span>
              )}
              {isDirty && (
                <button
                  onClick={() => onToolRevert(t.name)}
                  className="ml-auto text-[11px] px-2 py-0.5 rounded hover:bg-[var(--c-bg-tertiary)]"
                  style={{ color: "var(--c-text-3)" }}
                >
                  revert
                </button>
              )}
            </div>
            <label className="block text-[11px] font-medium mb-1" style={{ color: "var(--c-text-3)" }}>Description</label>
            <textarea
              value={desc}
              onChange={(e) => onToolChange(t.name, e.target.value, t.description)}
              rows={Math.min(8, Math.max(2, desc.split("\n").length + 1))}
              className="w-full px-3 py-2 rounded text-[13px] leading-relaxed resize-y outline-none"
              spellCheck={false}
              style={{
                fontFamily: "var(--font-mono)",
                background: "var(--c-code-bg)",
                color: "var(--c-text-1)",
                border: `1px solid ${isDirty ? "var(--color-brand)" : "var(--c-border)"}`,
              }}
            />
            {t.args_schema && (
              <>
                <label className="block text-[11px] font-medium mt-2 mb-1" style={{ color: "var(--c-text-3)" }}>Args Schema (read-only)</label>
                <pre
                  className="px-3 py-2 rounded text-[11px] overflow-x-auto max-h-40"
                  style={{ fontFamily: "var(--font-mono)", background: "var(--c-code-bg)", color: "var(--c-text-3)", border: "1px solid var(--c-border-subtle)" }}
                >
                  {JSON.stringify(t.args_schema, null, 2)}
                </pre>
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}
