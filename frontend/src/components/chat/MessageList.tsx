import { useEffect, useRef } from "react";
import type { ChatMessage } from "../../api/types";
import { MessageBubble } from "./MessageBubble";

const EXAMPLE_PROMPTS = [
  { label: "Plan a batch of tasks", prompt: "Create tasks for the product launch: draft the announcement (assign to Sam), update the pricing page (Priya, website project), and a QA pass (Jordan) — all due Friday, announcement is high priority" },
  { label: "Trigger a clarification", prompt: "Create a task to review the beta feedback and assign it to sam" },
  { label: "Project status", prompt: "How's the Mobile App project looking?" },
  { label: "Ask about the platform", prompt: "How does plan approval work, and what happens if a name can't be matched?" },
];

interface MessageListProps {
  messages: ChatMessage[];
  isStreaming?: boolean;
  onSend: (message: string) => void;
  onPlanApprove?: () => void;
  onPlanReject?: () => void;
  onClarificationRespond?: (response: Record<string, unknown>) => void;
  onClarificationSubmit?: () => void;
}

export function MessageList({
  messages,
  isStreaming,
  onSend,
  onPlanApprove,
  onPlanReject,
  onClarificationRespond,
  onClarificationSubmit,
}: MessageListProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  if (messages.length === 0) {
    return (
      <div className="flex-1 overflow-y-auto flex items-center justify-center px-6 pb-8">
        <div className="max-w-lg w-full">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {EXAMPLE_PROMPTS.map((ex) => (
              <button
                key={ex.label}
                type="button"
                onClick={() => onSend(ex.prompt)}
                className="text-left rounded-lg px-3 py-3 cursor-pointer transition-colors hover:bg-[var(--c-bg-tertiary)]"
                style={{
                  background: "var(--c-bg-secondary)",
                  border: "1px solid var(--c-border)",
                  color: "var(--c-text-1)",
                }}
              >
                <span className="text-[12px] font-semibold block mb-0.5" style={{ color: "var(--c-text-2)" }}>
                  {ex.label}
                </span>
                <span className="text-[13px] line-clamp-2" style={{ color: "var(--c-text-3)" }}>
                  {ex.prompt}
                </span>
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  const lastMsg = messages[messages.length - 1];
  const showLoading = isStreaming && (!lastMsg || lastMsg.kind !== "assistant");

  return (
    <div ref={containerRef} className="flex-1 overflow-y-auto">
      <div className="max-w-3xl mx-auto px-6 py-6 space-y-4">
        {messages.map((msg, i) => (
          <MessageBubble
            key={i}
            message={msg}
            onPlanApprove={onPlanApprove}
            onPlanReject={onPlanReject}
            onClarificationRespond={onClarificationRespond}
            onClarificationSubmit={onClarificationSubmit}
          />
        ))}
        {showLoading && (
          <div className="flex justify-start">
            <div className="flex gap-3 max-w-[80%]">
              <div
                className="w-6 h-6 rounded flex items-center justify-center shrink-0 mt-0.5 text-[11px] font-bold"
                style={{ background: "var(--c-bg-tertiary)", color: "var(--c-text-2)" }}
              >
                G
              </div>
              <div
                className="rounded-lg rounded-bl-sm px-4 py-3 flex items-center gap-1.5"
                style={{ background: "var(--c-assistant-bubble)" }}
              >
                <span className="loading-dot" style={{ animationDelay: "0ms" }} />
                <span className="loading-dot" style={{ animationDelay: "200ms" }} />
                <span className="loading-dot" style={{ animationDelay: "400ms" }} />
                <style>{`
                  .loading-dot {
                    display: inline-block;
                    width: 6px;
                    height: 6px;
                    border-radius: 50%;
                    background: var(--c-text-3);
                    animation: dot-pulse 1.4s ease-in-out infinite;
                  }
                  @keyframes dot-pulse {
                    0%, 80%, 100% { opacity: 0.25; transform: scale(0.75); }
                    40% { opacity: 1; transform: scale(1); }
                  }
                `}</style>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
