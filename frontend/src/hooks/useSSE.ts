/**
 * React hook wrapping the SSE stream parser with AbortController lifecycle.
 *
 * Automatically aborts any existing stream before starting a new one.
 * Returns `send` to initiate a stream and `abort` to cancel.
 */

import { useCallback, useRef } from "react";
import { streamSSE } from "../api/sse";
import type { SSEEvent } from "../api/types";

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "/api";

/** Hook for streaming SSE events from POST /api/chat. */
export function useSSE() {
  const abortRef = useRef<AbortController | null>(null);

  const send = useCallback(
    async (
      body: object,
      onEvent: (event: SSEEvent) => void,
      onError: (error: Error) => void,
    ) => {
      // Abort any existing stream
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      await streamSSE(
        `${API_BASE}/chat`,
        body,
        onEvent,
        onError,
        controller.signal,
      );
    },
    [],
  );

  const abort = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
  }, []);

  return { send, abort };
}
