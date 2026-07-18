import { useCallback, useRef, useState, type KeyboardEvent } from "react";

const COMMANDS: Record<string, { description: string }> = {
  "/clear": { description: "Clear conversation and start fresh" },
};

interface ChatInputProps {
  onSend: (message: string) => void;
  onCommand: (command: string) => void;
  disabled: boolean;
}

export function ChatInput({ onSend, onCommand, disabled }: ChatInputProps) {
  const [value, setValue] = useState("");
  const [showHints, setShowHints] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleSend = useCallback(() => {
    const trimmed = value.trim();
    if (!trimmed || disabled) return;

    if (trimmed.startsWith("/")) {
      const cmd = trimmed.split(" ")[0].toLowerCase();
      if (cmd in COMMANDS) {
        onCommand(cmd);
        setValue("");
        setShowHints(false);
        if (textareaRef.current) textareaRef.current.style.height = "auto";
        return;
      }
    }

    onSend(trimmed);
    setValue("");
    setShowHints(false);
    if (textareaRef.current) textareaRef.current.style.height = "auto";
  }, [value, disabled, onSend, onCommand]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend],
  );

  const handleChange = useCallback((val: string) => {
    setValue(val);
    setShowHints(val.startsWith("/") && val.length < 20);
  }, []);

  const handleInput = useCallback(() => {
    const el = textareaRef.current;
    if (el) {
      el.style.height = "auto";
      el.style.height = `${el.scrollHeight}px`;
    }
  }, []);

  const matchingCommands = showHints
    ? Object.entries(COMMANDS).filter(([cmd]) => cmd.startsWith(value.trim().toLowerCase()))
    : [];

  return (
    <div className="sticky bottom-0 px-6 py-4" style={{ background: "var(--c-bg)", borderTop: "1px solid var(--c-border)" }}>
      <div className="relative max-w-3xl mx-auto">
        {matchingCommands.length > 0 && (
          <div
            className="absolute bottom-full mb-2 left-0 rounded-lg overflow-hidden w-64"
            style={{ background: "var(--c-bg-elevated)", border: "1px solid var(--c-border)" }}
          >
            {matchingCommands.map(([cmd, { description }]) => (
              <button
                key={cmd}
                type="button"
                onClick={() => { onCommand(cmd); setValue(""); setShowHints(false); }}
                className="flex items-center gap-3 w-full px-3 py-2 text-left transition-colors hover:bg-[var(--c-overlay)]"
              >
                <span className="text-[13px] font-mono font-semibold" style={{ color: "var(--c-text-1)" }}>{cmd}</span>
                <span className="text-[12px]" style={{ color: "var(--c-text-3)" }}>{description}</span>
              </button>
            ))}
          </div>
        )}

        <div
          className="flex items-end gap-2 rounded-lg px-4 py-2"
          style={{ background: "var(--c-bg-secondary)", border: "1px solid var(--c-border)" }}
        >
          <textarea
            ref={textareaRef}
            value={value}
            onChange={(e) => handleChange(e.target.value)}
            onInput={handleInput}
            onKeyDown={handleKeyDown}
            disabled={disabled}
            placeholder={disabled ? "Waiting for response..." : "Ask the agents anything..."}
            className="flex-1 resize-none bg-transparent text-[14px] placeholder:text-[var(--c-text-3)] focus:outline-none min-h-[24px] max-h-[160px] py-1 disabled:opacity-50"
            style={{ color: "var(--c-text-1)" }}
            rows={1}
          />
          <button
            type="button"
            onClick={handleSend}
            disabled={disabled || !value.trim()}
            className="flex h-8 w-8 items-center justify-center rounded transition-colors disabled:opacity-30 disabled:cursor-not-allowed hover:opacity-80 shrink-0"
            style={{ background: "var(--c-text-1)", color: "var(--c-bg)" }}
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 10.5L12 3m0 0l7.5 7.5M12 3v18" />
            </svg>
          </button>
        </div>

        <p className="mt-2 text-[11px]" style={{ color: "var(--c-text-3)" }}>
          / for commands
        </p>
      </div>
    </div>
  );
}
