/**
 * Chat state reducer and action types.
 *
 * Manages the complete chat state including messages, streaming status,
 * plan approval flow, and execution progress. All SSE event types from
 * the backend are mapped to reducer actions.
 */

import { generateId } from "../utils";
import type {
  ChatMessage,
  ExecutionStep,
  PlanStatus,
  PlanStep,
} from "../api/types";

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

export interface ChatState {
  messages: ChatMessage[];
  currentSessionId: string;
  isStreaming: boolean;
  awaitingApproval: boolean;
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

export type ChatAction =
  | { type: "ADD_USER_MESSAGE"; payload: { content: string } }
  | { type: "APPEND_TEXT_DELTA"; payload: { content: string } }
  | { type: "SET_PLAN"; payload: { payload: unknown } }
  | { type: "UPDATE_PLAN_STATUS"; payload: { status: PlanStatus } }
  | { type: "STEP_START"; payload: { stepIndex: number; step: PlanStep } }
  | { type: "STEP_COMPLETE"; payload: { stepIndex: number; result: string } }
  | { type: "TOOL_CALL"; payload: { toolName: string; arguments: unknown } }
  | { type: "TOOL_RESULT"; payload: { toolName: string; result: string } }
  | { type: "SET_TOOL_CLARIFICATION"; payload: { data: import("../api/types").ToolClarificationData } }
  | { type: "SET_CLARIFICATION_RESPONSE"; payload: { response: Record<string, unknown> } }
  | { type: "RESOLVE_TOOL_CLARIFICATION" }
  | { type: "SET_DONE"; payload: { awaitingApproval: boolean } }
  | { type: "SET_ERROR"; payload: { errorType: string; message: string } }
  | {
      type: "ADD_ITEM_ERRORS";
      payload: {
        failures: Array<{
          name?: string;
          failed_step?: string;
          error?: string;
          id?: number | null;
        }>;
      };
    }
  | {
      type: "ROUTER_DECISION";
      payload: { decision: string; selectedAgent: string };
    }
  | { type: "DEBUG_EVENT"; payload: { eventType: string; data: unknown } }
  | { type: "SET_STREAMING"; payload: boolean }
  | { type: "CLEAR_MESSAGES" };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function findLastIndex<T>(arr: T[], pred: (item: T) => boolean): number {
  for (let i = arr.length - 1; i >= 0; i--) {
    if (pred(arr[i])) return i;
  }
  return -1;
}

function updateMessageAt(
  messages: ChatMessage[],
  index: number,
  updater: (msg: ChatMessage) => ChatMessage,
): ChatMessage[] {
  const copy = [...messages];
  copy[index] = updater(copy[index]);
  return copy;
}

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------

export function chatReducer(state: ChatState, action: ChatAction): ChatState {
  switch (action.type) {
    case "ADD_USER_MESSAGE":
      return {
        ...state,
        messages: [
          ...state.messages,
          { kind: "user", content: action.payload.content },
        ],
      };

    case "APPEND_TEXT_DELTA": {
      const lastIdx = state.messages.length - 1;
      const last = state.messages[lastIdx];
      if (last && last.kind === "assistant") {
        return {
          ...state,
          messages: updateMessageAt(state.messages, lastIdx, (msg) => ({
            ...msg,
            content: (msg as { content: string }).content + action.payload.content,
          })),
        };
      }
      return {
        ...state,
        messages: [
          ...state.messages,
          { kind: "assistant", content: action.payload.content },
        ],
      };
    }

    case "SET_PLAN":
      return {
        ...state,
        messages: [
          ...state.messages,
          {
            kind: "plan",
            payload: action.payload.payload,
            status: "pending_approval",
          },
        ],
      };

    case "UPDATE_PLAN_STATUS": {
      const idx = findLastIndex(
        state.messages,
        (m) => m.kind === "plan",
      );
      if (idx === -1) return state;
      return {
        ...state,
        messages: updateMessageAt(state.messages, idx, (msg) => {
          if (msg.kind !== "plan") return msg;
          return { ...msg, status: action.payload.status };
        }),
      };
    }

    case "STEP_START": {
      const progressIdx = findLastIndex(
        state.messages,
        (m) => m.kind === "execution_progress",
      );
      const newStep: ExecutionStep = {
        stepIndex: action.payload.stepIndex,
        step: action.payload.step,
        status: "running",
        toolCalls: [],
      };
      if (progressIdx === -1) {
        return {
          ...state,
          messages: [
            ...state.messages,
            { kind: "execution_progress", steps: [newStep] },
          ],
        };
      }
      return {
        ...state,
        messages: updateMessageAt(state.messages, progressIdx, (msg) => {
          const progress = msg as { kind: "execution_progress"; steps: ExecutionStep[] };
          const steps = [...progress.steps];
          const existing = steps.findIndex(
            (s) => s.stepIndex === action.payload.stepIndex,
          );
          if (existing >= 0) {
            steps[existing] = { ...steps[existing], status: "running" };
          } else {
            steps.push(newStep);
          }
          return { ...progress, steps };
        }),
      };
    }

    case "STEP_COMPLETE": {
      const progressIdx = findLastIndex(
        state.messages,
        (m) => m.kind === "execution_progress",
      );
      if (progressIdx === -1) return state;
      return {
        ...state,
        messages: updateMessageAt(state.messages, progressIdx, (msg) => {
          const progress = msg as { kind: "execution_progress"; steps: ExecutionStep[] };
          const steps = progress.steps.map((s) =>
            s.stepIndex === action.payload.stepIndex
              ? {
                  ...s,
                  status: "done" as const,
                  result: action.payload.result,
                  completedAt: new Date().toISOString(),
                }
              : s,
          );
          return { ...progress, steps };
        }),
      };
    }

    case "TOOL_CALL": {
      const progressIdx = findLastIndex(
        state.messages,
        (m) => m.kind === "execution_progress",
      );
      if (progressIdx === -1) return state;
      return {
        ...state,
        messages: updateMessageAt(state.messages, progressIdx, (msg) => {
          const progress = msg as { kind: "execution_progress"; steps: ExecutionStep[] };
          const steps = [...progress.steps];
          const runningIdx = findLastIndex(steps, (s) => s.status === "running");
          if (runningIdx >= 0) {
            steps[runningIdx] = {
              ...steps[runningIdx],
              toolCalls: [
                ...steps[runningIdx].toolCalls,
                {
                  toolName: action.payload.toolName,
                  arguments: action.payload.arguments,
                },
              ],
            };
          }
          return { ...progress, steps };
        }),
      };
    }

    case "TOOL_RESULT": {
      const progressIdx = findLastIndex(
        state.messages,
        (m) => m.kind === "execution_progress",
      );
      if (progressIdx === -1) return state;
      return {
        ...state,
        messages: updateMessageAt(state.messages, progressIdx, (msg) => {
          const progress = msg as { kind: "execution_progress"; steps: ExecutionStep[] };
          const steps = [...progress.steps];
          const runningIdx = findLastIndex(steps, (s) => s.status === "running");
          if (runningIdx >= 0) {
            const toolCalls = [...steps[runningIdx].toolCalls];
            // Find the last tool call matching this tool name without a result
            const tcIdx = findLastIndex(
              toolCalls,
              (tc) =>
                tc.toolName === action.payload.toolName && tc.result === undefined,
            );
            if (tcIdx >= 0) {
              toolCalls[tcIdx] = {
                ...toolCalls[tcIdx],
                result: action.payload.result,
              };
            }
            steps[runningIdx] = { ...steps[runningIdx], toolCalls };
          }
          return { ...progress, steps };
        }),
      };
    }

    case "SET_TOOL_CLARIFICATION":
      return {
        ...state,
        messages: [
          ...state.messages,
          {
            kind: "tool_clarification" as const,
            data: action.payload.data,
            response: null,
            status: "pending" as const,
          },
        ],
      };

    case "SET_CLARIFICATION_RESPONSE": {
      const clrIdx = findLastIndex(
        state.messages,
        (m) => m.kind === "tool_clarification",
      );
      if (clrIdx === -1) return state;
      return {
        ...state,
        messages: updateMessageAt(state.messages, clrIdx, (msg) => {
          if (msg.kind !== "tool_clarification") return msg;
          return { ...msg, response: action.payload.response };
        }),
      };
    }

    case "RESOLVE_TOOL_CLARIFICATION": {
      const clIdx = findLastIndex(
        state.messages,
        (m) => m.kind === "tool_clarification",
      );
      if (clIdx === -1) return state;
      return {
        ...state,
        messages: updateMessageAt(state.messages, clIdx, (msg) => {
          if (msg.kind !== "tool_clarification") return msg;
          return { ...msg, status: "resolved" as const };
        }),
      };
    }

    case "SET_DONE":
      return {
        ...state,
        isStreaming: false,
        awaitingApproval: action.payload.awaitingApproval,
      };

    case "SET_ERROR":
      return {
        ...state,
        isStreaming: false,
        messages: [
          ...state.messages,
          {
            kind: "error",
            errorType: action.payload.errorType,
            message: action.payload.message,
          },
        ],
      };

    case "ADD_ITEM_ERRORS": {
      const items = action.payload.failures.map((f) => {
        const stepLabel = f.failed_step ? ` at ${f.failed_step}` : "";
        const itemName = f.name || "Item";
        return {
          kind: "error" as const,
          errorType: `${itemName} halted${stepLabel}`,
          message: f.error || "The item stopped before completion.",
        };
      });
      return { ...state, messages: [...state.messages, ...items] };
    }

    case "ROUTER_DECISION":
      return {
        ...state,
        messages: [
          ...state.messages,
          {
            kind: "system_event",
            eventType: "router_decision",
            data: {
              decision: action.payload.decision,
              selectedAgent: action.payload.selectedAgent,
            },
          },
        ],
      };

    case "DEBUG_EVENT":
      return {
        ...state,
        messages: [
          ...state.messages,
          {
            kind: "system_event",
            eventType: action.payload.eventType,
            data: action.payload.data,
          },
        ],
      };

    case "SET_STREAMING":
      return { ...state, isStreaming: action.payload };

    case "CLEAR_MESSAGES":
      return {
        ...state,
        messages: [],
        isStreaming: false,
        awaitingApproval: false,
        currentSessionId: generateId(),
      };

    default:
      return state;
  }
}
