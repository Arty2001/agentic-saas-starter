import { useEffect, useMemo, useState } from "react";
import {
  regressionApi,
  type ContextMode,
  type RegressionAgentInfo,
  type RegressionTestCreate,
  type RegressionTurn,
  type UnexpectedInterruptPolicy,
} from "../../api/regression";
import { useAgentContext } from "../../context/AgentContext";
import TurnBuilder from "./TurnBuilder";

interface Props {
  editingId: string | null;
  onSaved: () => void;
  onCancel: () => void;
}

const inputStyle = {
  background: "var(--c-bg)",
  color: "var(--c-text-1)",
  border: "1px solid var(--c-border)",
} as const;

function Label({ children }: { children: React.ReactNode }) {
  return (
    <label className="block text-[11px] font-semibold uppercase tracking-wider mb-1" style={{ color: "var(--c-text-3)" }}>
      {children}
    </label>
  );
}

export default function RegressionEditor({ editingId, onSaved, onCancel }: Props) {
  const { selectedAgent: globalAgent } = useAgentContext();
  const [agents, setAgents] = useState<RegressionAgentInfo[]>([]);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [tags, setTags] = useState("");
  const [agentTypes, setAgentTypes] = useState<string[]>([globalAgent]);
  const [contextMode, setContextMode] = useState<ContextMode>("mock");
  const [contextArgs, setContextArgs] = useState<Record<string, unknown>>({});
  const [turns, setTurns] = useState<RegressionTurn[]>([{ type: "message", text: "" }]);
  const [policy, setPolicy] = useState<UnexpectedInterruptPolicy>("fail");
  const [ignorePaths, setIgnorePaths] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    regressionApi.agents().then(setAgents).catch(() => setAgents([]));
  }, []);

  useEffect(() => {
    if (!editingId) return;
    regressionApi
      .getTest(editingId)
      .then((t) => {
        setName(t.name);
        setDescription(t.description ?? "");
        setTags(t.tags.join(", "));
        setAgentTypes(t.agent_types.length > 0 ? t.agent_types : ["router"]);
        setContextMode(t.context_mode);
        setContextArgs(t.context_args ?? {});
        setTurns(t.turns as RegressionTurn[]);
        setPolicy(t.on_unexpected_interrupt);
        setIgnorePaths(t.ignore_paths.join("\n"));
        if (t.ignore_paths.length > 0 || t.on_unexpected_interrupt !== "fail") setShowAdvanced(true);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, [editingId]);

  // Context form is rendered from the first selected agent that ships a
  // test_context.py; the same mode/args apply to every selected agent.
  const contextSpec = useMemo(() => {
    const withContext = agents.find((a) => agentTypes.includes(a.name) && a.context);
    return withContext?.context ?? null;
  }, [agents, agentTypes]);

  const toggleAgent = (value: string) => {
    setAgentTypes((prev) =>
      prev.includes(value) ? prev.filter((a) => a !== value) : [...prev, value],
    );
  };

  // Seed defaults when the agent (or its spec) changes on a new test.
  useEffect(() => {
    if (editingId) return;
    setContextArgs(contextSpec ? { ...contextSpec.defaults } : {});
  }, [contextSpec, editingId]);

  const argFields = useMemo(() => {
    const props = (contextSpec?.args_schema?.properties ?? {}) as Record<
      string,
      { title?: string; description?: string }
    >;
    return Object.entries(props);
  }, [contextSpec]);

  const handleSave = async () => {
    setError(null);
    if (!name.trim()) {
      setError("Name is required");
      return;
    }
    if (agentTypes.length === 0) {
      setError("Select at least one agent");
      return;
    }
    if (turns.length === 0 || turns[0].type !== "message" || !("text" in turns[0] && turns[0].text.trim())) {
      setError("The first turn must be a non-empty message");
      return;
    }
    const body: RegressionTestCreate = {
      name: name.trim(),
      description: description.trim() || null,
      tags: tags.split(",").map((t) => t.trim()).filter(Boolean),
      agent_types: agentTypes,
      context_mode: contextSpec ? contextMode : "mock",
      context_args: contextSpec ? contextArgs : {},
      turns,
      on_unexpected_interrupt: policy,
      ignore_paths: ignorePaths.split("\n").map((p) => p.trim()).filter(Boolean),
    };
    setSaving(true);
    try {
      if (editingId) {
        await regressionApi.updateTest(editingId, body);
      } else {
        await regressionApi.createTest(body);
      }
      onSaved();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-5 max-w-3xl">
      {error && (
        <div className="p-2 rounded text-[12px]" style={{ background: "var(--c-bg-secondary)", color: "var(--color-error)" }}>
          {error}
        </div>
      )}

      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label>Name</Label>
          <input value={name} onChange={(e) => setName(e.target.value)} className="w-full text-[13px] px-2 py-1.5 rounded" style={inputStyle} placeholder="e.g. Three-task launch plan, approve" />
        </div>
        <div>
          <Label>Tags (comma-separated)</Label>
          <input value={tags} onChange={(e) => setTags(e.target.value)} className="w-full text-[13px] px-2 py-1.5 rounded" style={inputStyle} placeholder="smoke, planner" />
        </div>
      </div>

      <div>
        <Label>Description</Label>
        <input value={description} onChange={(e) => setDescription(e.target.value)} className="w-full text-[13px] px-2 py-1.5 rounded" style={inputStyle} placeholder="What this test protects" />
      </div>

      <div>
        <Label>Agents</Label>
        <div className="flex flex-wrap gap-2">
          {["router", ...agents.map((a) => a.name)].map((value) => {
            const active = agentTypes.includes(value);
            return (
              <button
                key={value}
                onClick={() => toggleAgent(value)}
                className="px-3 py-1.5 rounded text-[12px] font-medium transition-colors"
                style={{
                  background: active ? "var(--color-brand)" : "var(--c-bg)",
                  color: active ? "white" : "var(--c-text-2)",
                  border: `1px solid ${active ? "var(--color-brand)" : "var(--c-border)"}`,
                }}
              >
                {value === "router" ? "Router (Auto)" : value}
              </button>
            );
          })}
        </div>
        {agentTypes.length > 1 && (
          <div className="text-[11px] mt-1" style={{ color: "var(--c-text-3)" }}>
            All {agentTypes.length} agents replay these turns and are compared against the test's one shared baseline —
            a run shows them side by side. Adding or removing an agent doesn't invalidate the baseline.
          </div>
        )}
      </div>

      {/* Context — rendered entirely from the agent's own ContextArgs schema */}
      {contextSpec ? (
        <div className="p-3 rounded-lg space-y-3" style={{ background: "var(--c-bg-elevated)", border: "1px solid var(--c-border)" }}>
          <div className="flex items-center gap-3">
            <Label>Context</Label>
            <div className="flex rounded overflow-hidden mb-1" style={{ border: "1px solid var(--c-border)" }}>
              {(["mock", "real"] as ContextMode[]).map((m) => (
                <button
                  key={m}
                  onClick={() => setContextMode(m)}
                  className="px-3 py-1 text-[12px] font-medium"
                  style={{
                    background: contextMode === m ? "var(--color-brand)" : "var(--c-bg)",
                    color: contextMode === m ? "white" : "var(--c-text-2)",
                  }}
                >
                  {m === "mock" ? "Mock" : "Real data"}
                </button>
              ))}
            </div>
          </div>
          {contextMode === "real" && (
            <div className="p-2 rounded text-[12px]" style={{ background: "var(--c-bg-secondary)", color: "var(--color-warning)" }}>
              ⚠ Real mode calls the SaaS API as whoever clicks Run — each run can create real records under this
              dataset. Point it at a QA dataset.
            </div>
          )}
          <div className="grid grid-cols-3 gap-3">
            {argFields.map(([key, schema]) => (
              <div key={key}>
                <Label>{schema.title ?? key}</Label>
                <input
                  value={String(contextArgs[key] ?? "")}
                  onChange={(e) => setContextArgs({ ...contextArgs, [key]: e.target.value })}
                  className="w-full text-[13px] px-2 py-1.5 rounded font-mono"
                  style={inputStyle}
                  title={schema.description}
                />
              </div>
            ))}
          </div>
          <div className="text-[11px]" style={{ color: "var(--c-text-3)" }}>
            {contextMode === "mock"
              ? "Mock: the agent's built-in fixture context; every tool uses its mock branch. Deterministic."
              : "Real: the agent's test_context.py builds the context from the live platform using these ids."}
          </div>
        </div>
      ) : (
        <div className="text-[12px] p-2 rounded" style={{ background: "var(--c-bg-secondary)", color: "var(--c-text-3)" }}>
          {agentTypes.length === 1 && agentTypes[0] === "router"
            ? "Router tests run without a session context (routing/conversation checks)."
            : "None of the selected agents ship a test_context.py — tests run without a session context."}
        </div>
      )}

      <div>
        <Label>Conversation turns</Label>
        <TurnBuilder turns={turns} onChange={setTurns} />
      </div>

      <div>
        <button onClick={() => setShowAdvanced(!showAdvanced)} className="text-[12px] font-medium" style={{ color: "var(--c-text-3)" }}>
          {showAdvanced ? "▾" : "▸"} Advanced
        </button>
        {showAdvanced && (
          <div className="mt-2 space-y-3 p-3 rounded-lg" style={{ background: "var(--c-bg-elevated)", border: "1px solid var(--c-border)" }}>
            <div>
              <Label>On unexpected interrupt</Label>
              <select value={policy} onChange={(e) => setPolicy(e.target.value as UnexpectedInterruptPolicy)} className="text-[13px] px-2 py-1.5 rounded" style={inputStyle}>
                <option value="fail">Fail the test (default)</option>
                <option value="auto_approve">Auto-approve plan interrupts</option>
              </select>
            </div>
            <div>
              <Label>Ignore paths (one per line)</Label>
              <textarea
                value={ignorePaths}
                onChange={(e) => setIgnorePaths(e.target.value)}
                rows={3}
                placeholder={"turns[0].tool_calls[1].arguments.name\n**.someVolatileKey"}
                className="w-full text-[12px] font-mono px-2 py-1.5 rounded resize-y"
                style={inputStyle}
              />
              <div className="text-[11px] mt-1" style={{ color: "var(--c-text-3)" }}>
                Snapshot fields excluded from the regression diff — use for values that legitimately change every run.
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="flex items-center gap-3">
        <button
          onClick={handleSave}
          disabled={saving}
          className="px-4 py-1.5 rounded text-[13px] font-medium disabled:opacity-50"
          style={{ background: "var(--color-brand)", color: "white" }}
        >
          {saving ? "Saving…" : editingId ? "Save changes" : "Create test"}
        </button>
        <button onClick={onCancel} className="px-3 py-1.5 rounded text-[13px]" style={{ color: "var(--c-text-3)" }}>
          Cancel
        </button>
        {editingId && (
          <span className="text-[11px]" style={{ color: "var(--c-text-3)" }}>
            Changing context or turns re-records the shared baseline on the next run; changing agents doesn't.
          </span>
        )}
      </div>
    </div>
  );
}
