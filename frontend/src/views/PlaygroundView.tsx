/**
 * Prompt Playground — interactive graph visualization + sandbox chat.
 *
 * Split layout:
 *   Left panel: interactive agent graph (click nodes to edit prompts)
 *   Right panel: sandbox chat with full agent trajectory
 *
 * Nothing writes to production. Export/import overrides as local JSON.
 */

import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { streamSSE } from "../api/sse";
import type { SSEEvent } from "../api/types";
import { apiGet, getApiBase } from "../api/client";
import { useAgentContext } from "../context/AgentContext";
import { generateId } from "../utils";
import AgentGraph from "../components/playground/AgentGraph";
import NodeDrawer from "../components/playground/NodeDrawer";
import type { GraphTopology, GraphLayout } from "../data/graphDefinition";
import { computeLayout } from "../data/graphDefinition";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PromptEntry {
  key: string;
  label: string;
  node: string;
  content: string;
  template_vars: string[];
}

interface ToolDefEntry {
  name: string;
  description: string;
  category: string | null;
  tags: string[];
  args_schema: Record<string, unknown> | null;
}

interface PromptsResponse {
  prompts: PromptEntry[];
  tools: ToolDefEntry[];
}

type TraceEvent =
  | { kind: "user"; content: string }
  | { kind: "assistant"; content: string }
  | { kind: "router"; decision: string; agent: string | null }
  | { kind: "plan"; payload: unknown }
  | { kind: "step_start"; index: number; step: unknown }
  | { kind: "step_complete"; index: number; result: string }
  | { kind: "tool_call"; name: string; args: unknown }
  | { kind: "tool_result"; name: string; result: string }
  | { kind: "error"; message: string };

interface PlaygroundState {
  trace: TraceEvent[];
  isStreaming: boolean;
  awaitingApproval: boolean;
  sessionId: string;
}

type PAction =
  | { type: "ADD_USER"; content: string }
  | { type: "APPEND_DELTA"; content: string }
  | { type: "ADD_TRACE"; event: TraceEvent }
  | { type: "DONE"; awaiting: boolean }
  | { type: "STREAMING"; v: boolean }
  | { type: "RESET" };

function reducer(s: PlaygroundState, a: PAction): PlaygroundState {
  switch (a.type) {
    case "ADD_USER":
      return { ...s, trace: [...s.trace, { kind: "user", content: a.content }] };
    case "APPEND_DELTA": {
      const last = s.trace[s.trace.length - 1];
      if (last?.kind === "assistant") {
        const updated = [...s.trace];
        updated[updated.length - 1] = { kind: "assistant", content: last.content + a.content };
        return { ...s, trace: updated };
      }
      return { ...s, trace: [...s.trace, { kind: "assistant", content: a.content }] };
    }
    case "ADD_TRACE":
      return { ...s, trace: [...s.trace, a.event] };
    case "DONE":
      return { ...s, isStreaming: false, awaitingApproval: a.awaiting };
    case "STREAMING":
      return { ...s, isStreaming: a.v };
    case "RESET":
      return { trace: [], isStreaming: false, awaitingApproval: false, sessionId: generateId() };
    default:
      return s;
  }
}

const STORAGE_KEY = "playground-overrides";

// Map SSE events to graph node IDs for active highlighting
function deriveActiveNode(eventType: string, data: unknown): string | null {
  switch (eventType) {
    case "router_decision": {
      const d = data as { decision: string };
      if (d.decision === "needs_info") return "clarifier";
      if (d.decision === "just_chatting" || d.decision === "reject" || d.decision === "question_about_plan") return "responder";
      return "dispatcher";
    }
    case "clarification": return "clarifier";
    case "plan": return "present_plan";
    case "step_start": return "execute_item";
    case "step_complete": return "format_results";
    case "text_delta": return "responder";
    case "tool_call": return "executor";
    case "done": return null;
    default: return null;
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function PlaygroundView() {
  const { agentTypeForRequest } = useAgentContext();
  const [production, setProduction] = useState<PromptsResponse | null>(null);
  const [graphTopology, setGraphTopology] = useState<GraphTopology | null>(null);
  const [graphLayout, setGraphLayout] = useState<GraphLayout | null>(null);
  const collapsedRef = useRef<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);

  const [editedPrompts, setEditedPrompts] = useState<Record<string, string>>({});
  const [editedTools, setEditedTools] = useState<Record<string, string>>({});

  // Graph interaction
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [activeNodeId, setActiveNodeId] = useState<string | null>(null);
  const [showTools, setShowTools] = useState(false);

  const [state, dispatch] = useReducer(reducer, {
    trace: [],
    isStreaming: false,
    awaitingApproval: false,
    sessionId: generateId(),
  });
  const [chatInput, setChatInput] = useState("");
  const traceEndRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      apiGet<PromptsResponse>("/playground/prompts"),
      apiGet<GraphTopology>("/playground/graph"),
    ])
      .then(([promptsData, topoData]) => {
        setProduction(promptsData);
        setGraphTopology(topoData);
        setGraphLayout(computeLayout(topoData));
        try {
          const saved = localStorage.getItem(STORAGE_KEY);
          if (saved) {
            const parsed = JSON.parse(saved);
            if (parsed.prompt_overrides) setEditedPrompts(parsed.prompt_overrides);
            if (parsed.tool_overrides) {
              const tools: Record<string, string> = {};
              for (const [name, val] of Object.entries(parsed.tool_overrides)) {
                const v = val as { description?: string };
                if (v.description) tools[name] = v.description;
              }
              setEditedTools(tools);
            }
          }
        } catch { /* ignore corrupt storage */ }
        setLoading(false);
      })
      .catch((err) => {
        console.error("Failed to fetch prompts/graph:", err);
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    if (!production) return;
    const hasEdits = Object.keys(editedPrompts).length > 0 || Object.keys(editedTools).length > 0;
    if (hasEdits) {
      const payload = {
        prompt_overrides: editedPrompts,
        tool_overrides: Object.fromEntries(
          Object.entries(editedTools).map(([name, desc]) => [name, { description: desc }]),
        ),
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
  }, [editedPrompts, editedTools, production]);

  useEffect(() => {
    traceEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [state.trace]);

  const getPromptValue = useCallback(
    (key: string) => editedPrompts[key] ?? production?.prompts.find((p) => p.key === key)?.content ?? "",
    [editedPrompts, production],
  );

  const getToolDesc = useCallback(
    (name: string) => editedTools[name] ?? production?.tools.find((t) => t.name === name)?.description ?? "",
    [editedTools, production],
  );

  const hasDirtyState = Object.keys(editedPrompts).length > 0 || Object.keys(editedTools).length > 0;
  const dirtyCount = Object.keys(editedPrompts).length + Object.keys(editedTools).length;

  const resetAll = useCallback(() => {
    setEditedPrompts({});
    setEditedTools({});
    setStatusMsg("Reset to production defaults");
  }, []);

  const handleExport = useCallback(() => {
    const payload = {
      exported_at: new Date().toISOString(),
      prompt_overrides: editedPrompts,
      tool_overrides: Object.fromEntries(
        Object.entries(editedTools).map(([name, desc]) => [name, { description: desc }]),
      ),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `playground-overrides-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setStatusMsg("Exported to file");
  }, [editedPrompts, editedTools]);

  const handleImport = useCallback(() => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json";
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const data = JSON.parse(reader.result as string);
          if (data.prompt_overrides) setEditedPrompts(data.prompt_overrides);
          if (data.tool_overrides) {
            const tools: Record<string, string> = {};
            for (const [name, val] of Object.entries(data.tool_overrides)) {
              const v = val as { description?: string };
              if (v.description) tools[name] = v.description;
            }
            setEditedTools(tools);
          }
          setStatusMsg(`Imported from ${file.name}`);
        } catch {
          setStatusMsg("Error: Invalid JSON file");
        }
      };
      reader.readAsText(file);
    };
    input.click();
  }, []);

  const buildOverrides = useCallback(() => {
    const prompt_overrides: Record<string, string> = { ...editedPrompts };
    const tool_overrides: Record<string, { description: string }> = {};
    for (const [name, desc] of Object.entries(editedTools)) {
      tool_overrides[name] = { description: desc };
    }
    return { prompt_overrides, tool_overrides };
  }, [editedPrompts, editedTools]);

  const handleEvent = useCallback((event: SSEEvent) => {
    const { type, data } = event;

    // Update active node highlight
    const nextActive = deriveActiveNode(type, data);
    if (type === "done") {
      setActiveNodeId(null);
    } else if (nextActive !== null) {
      setActiveNodeId(nextActive);
    }

    switch (type) {
      case "text_delta":
        dispatch({ type: "APPEND_DELTA", content: (data as { content: string }).content });
        break;
      case "router_decision": {
        const d = data as { decision: string; selected_agent: string | null };
        dispatch({ type: "ADD_TRACE", event: { kind: "router", decision: d.decision, agent: d.selected_agent } });
        break;
      }
      case "clarification":
        dispatch({ type: "APPEND_DELTA", content: (data as { content: string }).content });
        break;
      case "plan": {
        // Agent-agnostic: forward the raw interrupt payload as-is.
        dispatch({ type: "ADD_TRACE", event: { kind: "plan", payload: data } });
        break;
      }
      case "step_start": {
        const d = data as { step_index: number; step: unknown };
        dispatch({ type: "ADD_TRACE", event: { kind: "step_start", index: d.step_index, step: d.step } });
        break;
      }
      case "step_complete": {
        const d = data as { step_index: number; result: string };
        dispatch({ type: "ADD_TRACE", event: { kind: "step_complete", index: d.step_index, result: d.result } });
        break;
      }
      case "tool_call": {
        const d = data as { tool_name: string; arguments: unknown };
        dispatch({ type: "ADD_TRACE", event: { kind: "tool_call", name: d.tool_name, args: d.arguments } });
        break;
      }
      case "tool_result": {
        const d = data as { tool_name: string; result: string };
        dispatch({ type: "ADD_TRACE", event: { kind: "tool_result", name: d.tool_name, result: d.result } });
        break;
      }
      case "done":
        dispatch({ type: "DONE", awaiting: (data as { awaiting_approval: boolean }).awaiting_approval });
        break;
      case "error":
        dispatch({ type: "ADD_TRACE", event: { kind: "error", message: (data as { message: string }).message } });
        dispatch({ type: "DONE", awaiting: false });
        break;
      default:
        break;
    }
  }, []);

  const sendMessage = useCallback(
    async (msg: string, approvalAction?: string, modifications?: unknown[]) => {
      if (!msg.trim() && !approvalAction) return;
      if (!approvalAction) dispatch({ type: "ADD_USER", content: msg });
      dispatch({ type: "STREAMING", v: true });
      setChatInput("");
      setActiveNodeId("router");

      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      const { prompt_overrides, tool_overrides } = buildOverrides();
      const body: Record<string, unknown> = {
        message: msg,
        session_id: state.sessionId,
        prompt_overrides,
        tool_overrides,
        ...(agentTypeForRequest && { agent_type: agentTypeForRequest }),
      };
      if (approvalAction) {
        body.approval_action = approvalAction;
        if (modifications) body.modifications = modifications;
      }

      await streamSSE(
        `${getApiBase()}/playground/chat`,
        body,
        handleEvent,
        (err) => {
          dispatch({ type: "ADD_TRACE", event: { kind: "error", message: err.message } });
          dispatch({ type: "DONE", awaiting: false });
          setActiveNodeId(null);
        },
        controller.signal,
      );
    },
    [buildOverrides, handleEvent, state.sessionId, agentTypeForRequest],
  );

  // Subgraph collapse/expand
  const handleSubgraphToggle = useCallback(
    (sgId: string) => {
      if (!graphTopology) return;
      const set = collapsedRef.current;
      if (set.has(sgId)) set.delete(sgId);
      else set.add(sgId);
      setGraphLayout(computeLayout(graphTopology, set));
    },
    [graphTopology],
  );

  // Node click handler
  const handleNodeSelect = useCallback((id: string) => {
    setShowTools(false);
    setSelectedNodeId((prev) => (prev === id ? null : id));
  }, []);

  const handleDrawerClose = useCallback(() => {
    setSelectedNodeId(null);
    setShowTools(false);
  }, []);

  const handlePromptChange = useCallback((key: string, value: string, original: string) => {
    setEditedPrompts((prev) => {
      if (value === original) { const n = { ...prev }; delete n[key]; return n; }
      return { ...prev, [key]: value };
    });
  }, []);

  const handlePromptRevert = useCallback((key: string) => {
    setEditedPrompts((prev) => { const n = { ...prev }; delete n[key]; return n; });
  }, []);

  const handleToolChange = useCallback((name: string, value: string, original: string) => {
    setEditedTools((prev) => {
      if (value === original) { const n = { ...prev }; delete n[name]; return n; }
      return { ...prev, [name]: value };
    });
  }, []);

  const handleToolRevert = useCallback((name: string) => {
    setEditedTools((prev) => { const n = { ...prev }; delete n[name]; return n; });
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full" style={{ color: "var(--c-text-3)" }}>
        Loading prompts...
      </div>
    );
  }

  if (!production || !graphLayout) {
    return (
      <div className="flex items-center justify-center h-full" style={{ color: "var(--color-error)" }}>
        Failed to load prompts. Is the backend running?
      </div>
    );
  }

  return (
    <div className="flex h-full" style={{ background: "var(--c-bg)" }}>
      {/* ====== LEFT PANEL: Graph + Drawer ====== */}
      <div
        className="flex flex-col border-r"
        style={{ width: "50%", minWidth: 380, borderColor: "var(--c-border)" }}
      >
        {/* Toolbar */}
        <div
          className="flex items-center gap-2 px-4 py-2 border-b shrink-0"
          style={{ borderColor: "var(--c-border)", background: "var(--c-bg-secondary)" }}
        >
          <span className="text-[13px] font-medium" style={{ color: "var(--c-text-1)" }}>
            Agent Graph
          </span>
          <button
            onClick={() => { setSelectedNodeId(null); setShowTools((v) => !v); }}
            className="px-2 py-1 text-[12px] font-medium rounded transition-colors"
            style={{
              color: showTools ? "var(--c-text-1)" : "var(--c-text-3)",
              background: showTools ? "var(--c-bg-tertiary)" : "transparent",
            }}
          >
            Tools ({production.tools.length})
          </button>
          <div className="ml-auto flex items-center gap-1.5">
            {hasDirtyState && (
              <span className="text-[11px] px-2 py-0.5 rounded font-mono" style={{ background: "var(--color-warning-subtle)", color: "var(--color-warning)" }}>
                {dirtyCount} modified
              </span>
            )}
            <button onClick={handleImport} className="px-2 py-1 text-[12px] rounded hover:bg-[var(--c-bg-tertiary)]" style={{ color: "var(--c-text-2)" }}>
              Import
            </button>
            <button
              onClick={handleExport}
              disabled={!hasDirtyState}
              className="px-2 py-1 text-[12px] rounded"
              style={{ color: hasDirtyState ? "var(--c-text-2)" : "var(--c-text-3)", cursor: hasDirtyState ? "pointer" : "default" }}
            >
              Export
            </button>
            <button
              onClick={resetAll}
              disabled={!hasDirtyState}
              className="px-2 py-1 text-[12px] rounded"
              style={{ color: hasDirtyState ? "var(--color-error)" : "var(--c-text-3)", cursor: hasDirtyState ? "pointer" : "default" }}
            >
              Reset
            </button>
          </div>
        </div>

        {statusMsg && (
          <div
            className="flex items-center justify-between px-4 py-1.5 text-[12px] shrink-0"
            style={{
              background: statusMsg.startsWith("Error") ? "var(--color-error-subtle)" : "var(--color-info-subtle)",
              color: statusMsg.startsWith("Error") ? "var(--color-error)" : "var(--color-info)",
            }}
          >
            <span>{statusMsg}</span>
            <button onClick={() => setStatusMsg(null)} className="ml-2 opacity-60 hover:opacity-100">&times;</button>
          </div>
        )}

        {/* Graph + Drawer container */}
        <div className="flex-1 relative overflow-hidden">
          {/* Graph */}
          <div className="w-full h-full p-4">
            <AgentGraph
              nodes={graphLayout.nodes}
              edges={graphLayout.edges}
              subgraphs={graphLayout.subgraphs}
              viewBoxWidth={graphLayout.viewBoxWidth}
              viewBoxHeight={graphLayout.viewBoxHeight}
              selectedNodeId={selectedNodeId}
              activeNodeId={activeNodeId}
              onNodeSelect={handleNodeSelect}
              onSubgraphToggle={handleSubgraphToggle}
            />
          </div>

          {/* Slide-up drawer */}
          <NodeDrawer
            selectedNodeId={selectedNodeId}
            graphNodes={graphLayout.nodes}
            showTools={showTools}
            prompts={production.prompts}
            tools={production.tools}
            editedPrompts={editedPrompts}
            editedTools={editedTools}
            getPromptValue={getPromptValue}
            getToolDesc={getToolDesc}
            onPromptChange={handlePromptChange}
            onPromptRevert={handlePromptRevert}
            onToolChange={handleToolChange}
            onToolRevert={handleToolRevert}
            onClose={handleDrawerClose}
          />
        </div>
      </div>

      {/* ====== RIGHT PANEL: Chat (unchanged) ====== */}
      <div className="flex-1 flex flex-col min-w-0" style={{ background: "var(--c-bg)" }}>
        <div
          className="flex items-center gap-2 px-4 py-2 border-b shrink-0"
          style={{ borderColor: "var(--c-border)", background: "var(--c-bg-secondary)" }}
        >
          <span className="text-[13px] font-medium" style={{ color: "var(--c-text-1)" }}>
            Sandbox Chat
          </span>
          {hasDirtyState && (
            <span className="text-[11px] px-2 py-0.5 rounded font-mono" style={{ background: "var(--color-brand-subtle)", color: "var(--color-brand)" }}>
              overrides active
            </span>
          )}
          <div className="ml-auto">
            <button
              onClick={() => dispatch({ type: "RESET" })}
              className="px-3 py-1 text-[12px] rounded transition-colors hover:bg-[var(--c-bg-tertiary)]"
              style={{ color: "var(--c-text-3)" }}
            >
              New session
            </button>
          </div>
        </div>

        {/* Trace */}
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
          {state.trace.length === 0 && (
            <div className="py-16" style={{ color: "var(--c-text-3)" }}>
              <p className="text-[14px]">Send a message to test your prompt changes.</p>
              <p className="text-[12px] mt-2">
                Click a node in the graph to edit its prompts.
                Overrides are applied per-request. Production is never affected.
              </p>
            </div>
          )}
          {state.trace.map((ev, i) => (
            <TraceBlock key={i} event={ev} />
          ))}
          {state.isStreaming && !state.awaitingApproval && (() => {
            const last = state.trace[state.trace.length - 1];
            const showDots = !last || last.kind !== "assistant";
            return showDots ? (
              <div className="flex items-center gap-1.5 px-3 py-2">
                <span className="pg-loading-dot" style={{ animationDelay: "0ms" }} />
                <span className="pg-loading-dot" style={{ animationDelay: "200ms" }} />
                <span className="pg-loading-dot" style={{ animationDelay: "400ms" }} />
                <style>{`
                  .pg-loading-dot {
                    display: inline-block;
                    width: 5px;
                    height: 5px;
                    border-radius: 50%;
                    background: var(--c-text-3);
                    animation: pg-dot-pulse 1.4s ease-in-out infinite;
                  }
                  @keyframes pg-dot-pulse {
                    0%, 80%, 100% { opacity: 0.25; transform: scale(0.75); }
                    40% { opacity: 1; transform: scale(1); }
                  }
                `}</style>
              </div>
            ) : null;
          })()}
          {state.awaitingApproval && (
            <div className="flex gap-2 mt-2">
              <button
                onClick={() => sendMessage("", "approve")}
                className="px-4 py-1.5 text-[13px] font-medium rounded"
                style={{ background: "var(--c-text-1)", color: "var(--c-bg)" }}
              >
                Approve Plan
              </button>
              <button
                onClick={() => sendMessage("", "reject")}
                className="px-4 py-1.5 text-[13px] font-medium rounded"
                style={{ background: "var(--c-bg-tertiary)", color: "var(--c-text-1)" }}
              >
                Reject
              </button>
            </div>
          )}
          <div ref={traceEndRef} />
        </div>

        {/* Input */}
        <div className="px-4 py-3 border-t shrink-0" style={{ borderColor: "var(--c-border)" }}>
          <form
            onSubmit={(e) => { e.preventDefault(); sendMessage(chatInput); }}
            className="flex gap-2"
          >
            <input
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              disabled={state.isStreaming || state.awaitingApproval}
              placeholder="Type a message to test..."
              className="flex-1 px-3 py-2 rounded text-[14px] outline-none"
              style={{ background: "var(--c-bg-tertiary)", color: "var(--c-text-1)", border: "1px solid var(--c-border)" }}
            />
            <button
              type="submit"
              disabled={state.isStreaming || state.awaitingApproval || !chatInput.trim()}
              className="px-4 py-2 rounded text-[13px] font-medium transition-colors"
              style={{
                background: chatInput.trim() ? "var(--c-text-1)" : "var(--c-bg-tertiary)",
                color: chatInput.trim() ? "var(--c-bg)" : "var(--c-text-3)",
              }}
            >
              Send
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Trace event renderer (unchanged)
// ---------------------------------------------------------------------------

function TraceBlock({ event }: { event: TraceEvent }) {
  switch (event.kind) {
    case "user":
      return (
        <div className="flex justify-end">
          <div className="max-w-[80%] px-3 py-2 rounded-lg rounded-br-sm text-[14px]" style={{ background: "var(--c-user-bubble)", color: "var(--c-user-bubble-text)" }}>
            {event.content}
          </div>
        </div>
      );
    case "assistant":
      return (
        <div className="flex justify-start">
          <div className="max-w-[80%] px-3 py-2 rounded-lg rounded-bl-sm text-[14px] whitespace-pre-wrap" style={{ background: "var(--c-assistant-bubble)", color: "var(--c-assistant-bubble-text)" }}>
            {event.content}
          </div>
        </div>
      );
    case "router":
      return (
        <div className="flex items-center gap-2 px-2 py-1">
          <div className="w-1.5 h-1.5 rounded-full" style={{ background: "var(--color-info)" }} />
          <span className="text-[11px] font-mono" style={{ color: "var(--c-text-3)" }}>
            Router: <strong style={{ color: "var(--c-text-2)" }}>{event.decision}</strong>
            {event.agent && <> &rarr; {event.agent}</>}
          </span>
        </div>
      );
    case "plan": {
      return (
        <div className="rounded-lg px-3 py-2 text-[12px]" style={{ background: "var(--c-bg-tertiary)", border: "1px solid var(--c-border)" }}>
          <div className="font-medium mb-1" style={{ color: "var(--c-text-2)" }}>
            Plan
          </div>
          <pre className="font-mono text-[11px] whitespace-pre-wrap break-words" style={{ color: "var(--c-text-3)" }}>
            {JSON.stringify(event.payload, null, 2)}
          </pre>
        </div>
      );
    }
    case "step_start":
      return (
        <div className="flex items-center gap-2 px-2 py-1">
          <div className="w-1.5 h-1.5 rounded-full" style={{ background: "var(--color-running)" }} />
          <span className="text-[11px] font-mono" style={{ color: "var(--c-text-3)" }}>Step {event.index + 1} running...</span>
        </div>
      );
    case "step_complete":
      return (
        <div className="flex items-center gap-2 px-2 py-1">
          <div className="w-1.5 h-1.5 rounded-full" style={{ background: "var(--color-success)" }} />
          <span className="text-[11px] font-mono" style={{ color: "var(--c-text-3)" }}>Step {event.index + 1} done</span>
        </div>
      );
    case "tool_call":
      return (
        <div className="rounded-lg px-3 py-2 text-[12px]" style={{ fontFamily: "var(--font-mono)", background: "var(--c-code-bg)", border: "1px solid var(--c-border-subtle)" }}>
          <div style={{ color: "var(--color-info)" }}>{event.name}()</div>
          <pre className="mt-1 whitespace-pre-wrap" style={{ color: "var(--c-text-2)" }}>
            {typeof event.args === "string" ? event.args : JSON.stringify(event.args, null, 2)}
          </pre>
        </div>
      );
    case "tool_result": {
      let display: string;
      try { display = JSON.stringify(JSON.parse(event.result), null, 2); } catch { display = event.result; }
      return (
        <div className="rounded-lg px-3 py-2 text-[12px]" style={{ fontFamily: "var(--font-mono)", background: "var(--c-code-bg)", border: "1px solid var(--c-border-subtle)" }}>
          <div style={{ color: "var(--color-success)" }}>{event.name} result</div>
          <pre className="mt-1 whitespace-pre-wrap max-h-48 overflow-y-auto" style={{ color: "var(--c-text-2)" }}>{display}</pre>
        </div>
      );
    }
    case "error":
      return (
        <div className="rounded-lg px-3 py-2 text-[12px]" style={{ background: "var(--color-error-subtle)", color: "var(--color-error)" }}>
          Error: {event.message}
        </div>
      );
    default:
      return null;
  }
}
