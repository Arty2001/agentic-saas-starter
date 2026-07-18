interface PromptEntry {
  key: string;
  label: string;
  node: string;
  content: string;
  template_vars: string[];
}

interface Props {
  prompt: PromptEntry;
  value: string;
  isDirty: boolean;
  onChange: (key: string, value: string, originalContent: string) => void;
  onRevert: (key: string) => void;
}

export default function PromptEditor({ prompt, value, isDirty, onChange, onRevert }: Props) {
  return (
    <div className="border-b px-4 py-3" style={{ borderColor: "var(--c-border-subtle)" }}>
      <div className="flex items-center gap-2 mb-2">
        <span className="text-[13px] font-semibold" style={{ color: "var(--c-text-1)" }}>
          {prompt.label}
        </span>
        {isDirty && (
          <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: "var(--color-brand)" }} />
        )}
        <span className="text-[11px] px-1.5 py-0.5 rounded font-mono" style={{ background: "var(--c-bg-tertiary)", color: "var(--c-text-3)" }}>
          {prompt.node}
        </span>
        {isDirty && (
          <button
            onClick={() => onRevert(prompt.key)}
            className="ml-auto text-[11px] px-2 py-0.5 rounded hover:bg-[var(--c-bg-tertiary)]"
            style={{ color: "var(--c-text-3)" }}
          >
            revert
          </button>
        )}
      </div>
      {prompt.template_vars.length > 0 && (
        <div className="mb-2 text-[11px] px-2 py-1 rounded" style={{ background: "var(--c-bg-tertiary)", color: "var(--c-text-3)" }}>
          Runtime variables: {prompt.template_vars.map((v) => (
            <code key={v} className="mx-0.5 px-1 rounded" style={{ background: "var(--c-code-bg)", color: "var(--c-text-2)", fontFamily: "var(--font-mono)", fontSize: "10px" }}>
              {`{${v}}`}
            </code>
          ))}
        </div>
      )}
      <textarea
        value={value}
        onChange={(e) => onChange(prompt.key, e.target.value, prompt.content)}
        rows={Math.min(12, Math.max(3, value.split("\n").length + 1))}
        className="w-full px-3 py-2 rounded text-[13px] leading-relaxed resize-y outline-none"
        spellCheck={false}
        style={{
          fontFamily: "var(--font-mono)",
          background: "var(--c-code-bg)",
          color: "var(--c-text-1)",
          border: `1px solid ${isDirty ? "var(--color-brand)" : "var(--c-border)"}`,
        }}
      />
    </div>
  );
}
