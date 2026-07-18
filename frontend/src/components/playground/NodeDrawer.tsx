import { useEffect } from "react";
import type { GraphNodeDef } from "../../data/graphDefinition";
import { findNodeById } from "../../data/graphDefinition";
import PromptEditor from "./PromptEditor";
import ToolsPanel from "./ToolsPanel";

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

interface Props {
  selectedNodeId: string | null;
  graphNodes: GraphNodeDef[];
  showTools: boolean;
  prompts: PromptEntry[];
  tools: ToolDefEntry[];
  editedPrompts: Record<string, string>;
  editedTools: Record<string, string>;
  getPromptValue: (key: string) => string;
  getToolDesc: (name: string) => string;
  onPromptChange: (key: string, value: string, original: string) => void;
  onPromptRevert: (key: string) => void;
  onToolChange: (name: string, value: string, original: string) => void;
  onToolRevert: (name: string) => void;
  onClose: () => void;
}

export default function NodeDrawer({
  selectedNodeId,
  graphNodes,
  showTools,
  prompts,
  tools,
  editedPrompts,
  editedTools,
  getPromptValue,
  getToolDesc,
  onPromptChange,
  onPromptRevert,
  onToolChange,
  onToolRevert,
  onClose,
}: Props) {
  const isOpen = selectedNodeId !== null || showTools;
  const node = selectedNodeId ? findNodeById(graphNodes, selectedNodeId) : null;
  const nodePrompts = node
    ? prompts.filter((p) => node.promptKeys.includes(p.key))
    : [];

  // Escape to close
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [isOpen, onClose]);

  return (
    <div
      className="absolute bottom-0 left-0 right-0 flex flex-col border-t"
      style={{
        height: "60%",
        borderColor: "var(--c-border)",
        background: "var(--c-bg)",
        transform: isOpen ? "translateY(0)" : "translateY(100%)",
        transition: "transform 0.25s ease",
        zIndex: 10,
      }}
    >
      {/* Header */}
      <div
        className="flex items-center gap-2 px-4 py-2 shrink-0 border-b"
        style={{ borderColor: "var(--c-border)", background: "var(--c-bg-secondary)" }}
      >
        {showTools && !selectedNodeId ? (
          <span className="text-[13px] font-semibold" style={{ color: "var(--c-text-1)" }}>
            Tools ({tools.length})
          </span>
        ) : node ? (
          <>
            <span className="text-[13px] font-semibold" style={{ color: "var(--c-text-1)" }}>
              {node.label}
            </span>
            <span className="text-[11px] font-mono px-1.5 py-0.5 rounded" style={{ background: "var(--c-bg-tertiary)", color: "var(--c-text-3)" }}>
              {nodePrompts.length} prompt{nodePrompts.length !== 1 ? "s" : ""}
            </span>
          </>
        ) : null}
        <button
          onClick={onClose}
          className="ml-auto text-[16px] px-1 hover:opacity-80"
          style={{ color: "var(--c-text-3)" }}
        >
          &times;
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {showTools && !selectedNodeId ? (
          <ToolsPanel
            tools={tools}
            editedTools={editedTools}
            getToolDesc={getToolDesc}
            onToolChange={onToolChange}
            onToolRevert={onToolRevert}
          />
        ) : (
          nodePrompts.map((p) => (
            <PromptEditor
              key={p.key}
              prompt={p}
              value={getPromptValue(p.key)}
              isDirty={p.key in editedPrompts}
              onChange={onPromptChange}
              onRevert={onPromptRevert}
            />
          ))
        )}
        {selectedNodeId && nodePrompts.length === 0 && (
          <div className="px-4 py-8 text-[13px]" style={{ color: "var(--c-text-3)" }}>
            This node has no editable prompts.
          </div>
        )}
      </div>
    </div>
  );
}
