/**
 * React Context provider for chat state.
 *
 * Wraps the chat reducer in a context so any component in the tree
 * can access chat state and dispatch actions.
 */

import {
  createContext,
  useContext,
  useReducer,
  type Dispatch,
  type ReactNode,
} from "react";
import { chatReducer, type ChatAction, type ChatState } from "../hooks/useChat";
import { generateId } from "../utils";

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

interface ChatContextValue {
  state: ChatState;
  dispatch: Dispatch<ChatAction>;
}

const ChatContext = createContext<ChatContextValue | null>(null);

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

function createInitialState(): ChatState {
  return {
    messages: [],
    currentSessionId: generateId(),
    isStreaming: false,
    awaitingApproval: false,
  };
}

/** Provides chat state and dispatch to the component tree. */
export function ChatProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(chatReducer, null, createInitialState);

  return (
    <ChatContext.Provider value={{ state, dispatch }}>
      {children}
    </ChatContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/** Access chat state and dispatch. Must be used within a ChatProvider. */
export function useChatContext(): ChatContextValue {
  const ctx = useContext(ChatContext);
  if (!ctx) {
    throw new Error("useChatContext must be used within a ChatProvider");
  }
  return ctx;
}
