/**
 * Main chat interface wiring SSE streaming, state, and all chat components.
 *
 * Connects ChatContext (state + dispatch) and useSSE (streaming) into a
 * chat experience. Plan approval handlers send approval_action requests
 * to the backend via SSE.
 */

import { useCallback } from "react";
import type { SSEEvent, ToolClarificationData } from "../api/types";
import { ChatInput } from "../components/chat/ChatInput";
import { MessageList } from "../components/chat/MessageList";
import { useAgentContext } from "../context/AgentContext";
import { useChatContext } from "../context/ChatContext";
import { useSSE } from "../hooks/useSSE";

/** The primary chat view with message list and input. */
export default function ChatView() {
  const { state, dispatch } = useChatContext();
  const { send } = useSSE();
  const { agentTypeForRequest } = useAgentContext();

  // -------------------------------------------------------------------------
  // SSE event handler
  // -------------------------------------------------------------------------

  const handleSSEEvent = useCallback(
    (event: SSEEvent) => {
      const { type, data } = event;

      switch (type) {
        case "text_delta": {
          const d = data as { content: string };
          dispatch({ type: "APPEND_TEXT_DELTA", payload: { content: d.content } });
          break;
        }
        case "router_decision": {
          const d = data as { decision: string; selected_agent: string };
          dispatch({
            type: "ROUTER_DECISION",
            payload: { decision: d.decision, selectedAgent: d.selected_agent },
          });
          break;
        }
        case "clarification": {
          const d = data as { content: string };
          dispatch({ type: "DEBUG_EVENT", payload: { eventType: "clarification", data: d } });
          dispatch({ type: "APPEND_TEXT_DELTA", payload: { content: d.content } });
          break;
        }
        case "plan": {
          // Agent-agnostic: the backend forwards the raw interrupt payload
          // (whatever the agent emitted) under the `plan` event. Render it as-is.
          dispatch({ type: "SET_PLAN", payload: { payload: data } });
          break;
        }
        case "tool_clarification": {
          const d = data as ToolClarificationData;
          dispatch({ type: "SET_TOOL_CLARIFICATION", payload: { data: d } });
          break;
        }
        case "step_start": {
          const d = data as { step_index: number; step: Record<string, unknown> };
          dispatch({ type: "DEBUG_EVENT", payload: { eventType: "step_start", data: d } });
          dispatch({
            type: "STEP_START",
            payload: {
              stepIndex: d.step_index,
              step: {
                tool_name: (d.step.tool_name as string) ?? "",
                arguments: (d.step.arguments as Record<string, unknown>) ?? {},
              },
            },
          });
          break;
        }
        case "step_complete": {
          const d = data as { step_index?: number; step: Record<string, unknown>; result: string };
          dispatch({ type: "DEBUG_EVENT", payload: { eventType: "step_complete", data: d } });
          dispatch({
            type: "STEP_COMPLETE",
            payload: {
              stepIndex: d.step_index ?? 0,
              result: d.result,
            },
          });
          break;
        }
        case "tool_call": {
          const d = data as { tool_name: string; arguments: Record<string, unknown> };
          dispatch({ type: "DEBUG_EVENT", payload: { eventType: "tool_call", data: d } });
          dispatch({
            type: "TOOL_CALL",
            payload: { toolName: d.tool_name, arguments: d.arguments },
          });
          break;
        }
        case "tool_result": {
          const d = data as { tool_name: string; result: string };
          dispatch({ type: "DEBUG_EVENT", payload: { eventType: "tool_result", data: d } });
          dispatch({
            type: "TOOL_RESULT",
            payload: { toolName: d.tool_name, result: d.result },
          });
          break;
        }
        case "items_completed": {
          dispatch({ type: "DEBUG_EVENT", payload: { eventType: "items_completed", data } });
          break;
        }
        case "done": {
          const d = data as { awaiting_approval: boolean };
          dispatch({ type: "DEBUG_EVENT", payload: { eventType: "done", data: d } });
          dispatch({ type: "SET_DONE", payload: { awaitingApproval: d.awaiting_approval } });
          break;
        }
        case "error": {
          const d = data as { error_type: string; message: string };
          dispatch({
            type: "SET_ERROR",
            payload: { errorType: d.error_type, message: d.message },
          });
          break;
        }
        default:
          // Unknown event types logged but not dispatched
          console.warn("Unknown SSE event type:", type, data);
      }
    },
    [dispatch],
  );

  const handleSSEError = useCallback(
    (error: Error) => {
      dispatch({
        type: "SET_ERROR",
        payload: { errorType: "connection_error", message: error.message },
      });
    },
    [dispatch],
  );

  // -------------------------------------------------------------------------
  // Chat send handler
  // -------------------------------------------------------------------------

  const handleSend = useCallback(
    (message: string) => {
      dispatch({ type: "ADD_USER_MESSAGE", payload: { content: message } });
      dispatch({ type: "SET_STREAMING", payload: true });

      send(
        {
          message,
          session_id: state.currentSessionId,
          ...(agentTypeForRequest && { agent_type: agentTypeForRequest }),
        },
        handleSSEEvent,
        handleSSEError,
      );
    },
    [dispatch, send, state.currentSessionId, agentTypeForRequest, handleSSEEvent, handleSSEError],
  );

  // -------------------------------------------------------------------------
  // Plan approval handlers
  // -------------------------------------------------------------------------

  const handlePlanApprove = useCallback(() => {
    dispatch({ type: "UPDATE_PLAN_STATUS", payload: { status: "approved" } });
    dispatch({ type: "SET_STREAMING", payload: true });
    send(
      { message: "", session_id: state.currentSessionId, approval_action: "approve" },
      handleSSEEvent,
      handleSSEError,
    );
  }, [state.currentSessionId, send, dispatch, handleSSEEvent, handleSSEError]);

  const handlePlanReject = useCallback(() => {
    dispatch({ type: "UPDATE_PLAN_STATUS", payload: { status: "rejected" } });
    dispatch({ type: "SET_STREAMING", payload: true });
    send(
      { message: "", session_id: state.currentSessionId, approval_action: "reject" },
      handleSSEEvent,
      handleSSEError,
    );
  }, [state.currentSessionId, send, dispatch, handleSSEEvent, handleSSEError]);

  // -------------------------------------------------------------------------
  // Tool clarification handler
  // -------------------------------------------------------------------------

  const handleClarificationRespond = useCallback(
    (response: Record<string, unknown>) => {
      dispatch({ type: "SET_CLARIFICATION_RESPONSE", payload: { response } });
    },
    [dispatch],
  );

  const handleClarificationSubmit = useCallback(() => {
    const clMsg = [...state.messages].reverse().find((m) => m.kind === "tool_clarification");
    if (!clMsg || clMsg.kind !== "tool_clarification" || !clMsg.response) return;

    dispatch({ type: "RESOLVE_TOOL_CLARIFICATION" });
    dispatch({ type: "SET_STREAMING", payload: true });

    send(
      {
        message: "",
        session_id: state.currentSessionId,
        approval_action: "clarification_response",
        modifications: [clMsg.response],
      },
      handleSSEEvent,
      handleSSEError,
    );
  }, [state.messages, state.currentSessionId, send, dispatch, handleSSEEvent, handleSSEError]);

  // -------------------------------------------------------------------------
  // Slash commands
  // -------------------------------------------------------------------------

  const handleCommand = useCallback(
    (command: string) => {
      switch (command) {
        case "/clear":
          dispatch({ type: "CLEAR_MESSAGES" });
          break;
        default:
          break;
      }
    },
    [dispatch],
  );

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  return (
    <div className="flex h-full" style={{ background: "var(--c-bg)" }}>
      <main className="flex-1 flex flex-col min-w-0">
        <MessageList
          messages={state.messages}
          isStreaming={state.isStreaming}
          onSend={handleSend}
          onPlanApprove={handlePlanApprove}
          onPlanReject={handlePlanReject}
          onClarificationRespond={handleClarificationRespond}
          onClarificationSubmit={handleClarificationSubmit}
        />
        <ChatInput
          onSend={handleSend}
          onCommand={handleCommand}
          disabled={state.isStreaming || state.awaitingApproval}
        />
      </main>
    </div>
  );
}
