import type { ChatMessage } from "../../api/types";
import { ClarificationCard } from "./ClarificationCard";
import { ExecutionProgress } from "./ExecutionProgress";
import { PlanCard } from "./PlanCard";
import { SystemEvent } from "./SystemEvent";

interface MessageBubbleProps {
  message: ChatMessage;
  onPlanApprove?: () => void;
  onPlanReject?: () => void;
  onClarificationRespond?: (response: Record<string, unknown>) => void;
  onClarificationSubmit?: () => void;
}

export function MessageBubble({
  message,
  onPlanApprove,
  onPlanReject,
  onClarificationRespond,
  onClarificationSubmit,
}: MessageBubbleProps) {
  switch (message.kind) {
    case "user":
      return (
        <div className="flex justify-end">
          <div
            className="rounded-lg rounded-br-sm px-4 py-2 max-w-[75%] text-[14px] leading-relaxed whitespace-pre-wrap"
            style={{ background: "var(--c-user-bubble)", color: "var(--c-user-bubble-text)" }}
          >
            {message.content}
          </div>
        </div>
      );

    case "assistant":
      return (
        <div className="flex justify-start">
          <div className="flex gap-3 max-w-[80%]">
            <div
              className="w-6 h-6 rounded flex items-center justify-center shrink-0 mt-0.5 text-[11px] font-bold"
              style={{ background: "var(--c-bg-tertiary)", color: "var(--c-text-2)" }}
            >
              G
            </div>
            <div
              className="rounded-lg rounded-bl-sm px-4 py-2 text-[14px] leading-relaxed whitespace-pre-wrap"
              style={{ background: "var(--c-assistant-bubble)", color: "var(--c-assistant-bubble-text)" }}
            >
              {message.content}
            </div>
          </div>
        </div>
      );

    case "system_event":
      return <SystemEvent eventType={message.eventType} data={message.data} />;

    case "plan":
      return (
        <div className="flex justify-start pl-9">
          <PlanCard
            payload={message.payload}
            status={message.status}
            onApprove={onPlanApprove ?? (() => {})}
            onReject={onPlanReject ?? (() => {})}
          />
        </div>
      );

    case "execution_progress":
      return (
        <div className="flex justify-start pl-9 w-full">
          <div className="max-w-[85%]">
            <ExecutionProgress steps={message.steps} />
          </div>
        </div>
      );

    case "tool_clarification":
      return (
        <div className="flex justify-start pl-9">
          <ClarificationCard
            data={message.data}
            response={message.response}
            status={message.status}
            onRespond={onClarificationRespond ?? (() => {})}
            onSubmit={onClarificationSubmit ?? (() => {})}
          />
        </div>
      );

    case "error":
      return (
        <div className="flex justify-start pl-9">
          <div
            className="rounded-lg px-4 py-3 max-w-[75%] text-[13px]"
            style={{ background: "var(--color-error-subtle)", color: "var(--color-error)", border: "1px solid var(--color-error)" }}
          >
            <span className="font-semibold">{message.errorType}:</span> {message.message}
          </div>
        </div>
      );

    default:
      return null;
  }
}
