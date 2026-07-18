/**
 * Global agent selector context.
 *
 * Fetches available agents from GET /api/agents on mount and exposes
 * the currently selected agent to every tab (Chat, Playground, Tests, Runs).
 *
 * "router" is a special value meaning "auto-route via LLM".
 */

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { apiGet } from "../api/client";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AgentOption {
  name: string;
  description: string;
  when_to_use?: string | null;
}

interface AgentContextValue {
  /** All agents fetched from the backend registry. */
  agents: AgentOption[];
  /** Currently selected agent name, or "router" for auto-routing. */
  selectedAgent: string;
  /** Update the selected agent. */
  setSelectedAgent: (name: string) => void;
  /** The value to send as `agent_type` in requests (null when "router"). */
  agentTypeForRequest: string | null;
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

const AgentContext = createContext<AgentContextValue | null>(null);

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export function AgentProvider({ children }: { children: ReactNode }) {
  const [agents, setAgents] = useState<AgentOption[]>([]);
  const [selectedAgent, setSelectedAgent] = useState<string>("router");

  useEffect(() => {
    apiGet<AgentOption[]>("/agents")
      .then((list) => setAgents(list))
      .catch((err) => console.error("Failed to fetch agents:", err));
  }, []);

  const agentTypeForRequest =
    selectedAgent === "router" ? null : selectedAgent;

  return (
    <AgentContext.Provider
      value={{ agents, selectedAgent, setSelectedAgent, agentTypeForRequest }}
    >
      {children}
    </AgentContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useAgentContext(): AgentContextValue {
  const ctx = useContext(AgentContext);
  if (!ctx) {
    throw new Error("useAgentContext must be used within an AgentProvider");
  }
  return ctx;
}
