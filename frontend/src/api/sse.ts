/**
 * Fetch-based SSE stream parser for POST requests.
 *
 * Native EventSource only supports GET. This module uses fetch with
 * ReadableStream to parse SSE events from POST /api/chat responses.
 */

import type { SSEEvent } from "./types";

type SSEEventHandler = (event: SSEEvent) => void;

/**
 * Stream SSE events from a POST endpoint.
 *
 * Sends a POST request with a JSON body and parses the response as an SSE
 * stream. Calls `onEvent` for each parsed SSEEvent. Handles AbortError
 * silently (not treated as an error).
 */
export async function streamSSE(
  url: string,
  body: object,
  onEvent: SSEEventHandler,
  onError: (error: Error) => void,
  signal?: AbortSignal,
): Promise<void> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(body),
    signal,
  });

  if (response.status === 401) {
    window.dispatchEvent(new CustomEvent("auth-expired"));
  }

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (line.startsWith("event: ")) {
          // Event type is tracked inside the SSEEvent JSON envelope,
          // so we only need to parse data lines.
          continue;
        } else if (line.startsWith("data: ")) {
          const jsonStr = line.slice(6);
          try {
            const parsed: SSEEvent = JSON.parse(jsonStr);
            onEvent(parsed);
          } catch {
            // Non-JSON data line, skip
          }
        }
        // Empty line = end of event block (handled by split)
      }
    }
  } catch (err) {
    if ((err as Error).name !== "AbortError") {
      onError(err as Error);
    }
  }
}
