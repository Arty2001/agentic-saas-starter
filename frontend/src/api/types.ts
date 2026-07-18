/**
 * TypeScript types mirroring the backend Pydantic schemas in
 * src/agent_platform/api/schemas.py and SSE event data types from
 * src/agent_platform/api/routes/chat.py.
 */

// ---------------------------------------------------------------------------
// SSE event envelope
// ---------------------------------------------------------------------------

export interface SSEEvent {
  type: string;
  data: unknown;
  timestamp: string;
}

// ---------------------------------------------------------------------------
// Request models
// ---------------------------------------------------------------------------

export interface ChatRequest {
  message: string;
  session_id: string;
  agent_type?: string;
  approval_action?: "approve" | "reject" | "edit" | "clarification_response";
  modifications?: Record<string, unknown>[];
}

// ---------------------------------------------------------------------------
// Response models
// ---------------------------------------------------------------------------

export interface MessageResponse {
  id: string;
  thread_id: string;
  role: string;
  content: string | null;
  tool_calls: string | null;
  created_at: string;
}

export interface ToolCallDetail {
  id: string;
  tool_name: string;
  arguments: string | null;
  result: string | null;
  error: string | null;
  started_at: string;
  duration_ms: number | null;
}

export interface LLMCallDetail {
  id: string;
  provider: string;
  model: string;
  messages: string | null;
  response: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  started_at: string;
  duration_ms: number | null;
}

export interface StepDetail {
  id: string;
  node_name: string;
  input_state: string | null;
  output_state: string | null;
  started_at: string;
  ended_at: string | null;
  duration_ms: number | null;
  tool_calls: ToolCallDetail[];
  llm_calls: LLMCallDetail[];
}

export interface EdgeDetail {
  id: string;
  from_node: string;
  to_node: string;
  condition: string | null;
  timestamp: string;
}

export interface RunMetadata {
  tenant_id?: string | null;
  workspace_id?: string | null;
  user_role?: string | null;
  [key: string]: unknown;
}

export interface RunFeedback {
  feedback_type: "up" | "down";
  category: string | null;
  comment: string | null;
}

export interface RunSummary {
  id: string;
  thread_id: string;
  user_id: string | null;
  agent_type: string | null;
  status: string;
  started_at: string;
  ended_at: string | null;
  total_tokens: number | null;
  run_metadata: RunMetadata | null;
  feedback: RunFeedback | null;
}

export interface RunDetail extends RunSummary {
  error: string | null;
  steps: StepDetail[];
  edges: EdgeDetail[];
}

export interface RunsListResponse {
  runs: RunSummary[];
  total: number;
  limit: number;
  offset: number;
}

// ---------------------------------------------------------------------------
// Feedback dashboard
// ---------------------------------------------------------------------------

export interface FeedbackItem {
  id: string;
  run_id: string | null;
  username: string | null;
  feedback_type: "up" | "down";
  category: string | null;
  comment: string | null;
  prompt_text: string | null;
  ai_reply_text: string | null;
  metadata: RunMetadata | null;
  created_at: string;
}

export interface FeedbackListResponse {
  items: FeedbackItem[];
  total: number;
  up_count: number;
  down_count: number;
  limit: number;
  offset: number;
}

export interface FeedbackCategoryCount {
  category: string;
  count: number;
}

export interface FeedbackStats {
  total: number;
  up_count: number;
  down_count: number;
  by_category: FeedbackCategoryCount[];
  usernames: string[];
  categories: string[];
}

// ---------------------------------------------------------------------------
// SSE event data types (from chat.py event_stream)
// ---------------------------------------------------------------------------

export interface RouterDecisionData {
  decision: string;
  selected_agent: string;
}

export interface ClarificationData {
  content: string;
}

export interface TextDeltaData {
  content: string;
}

export interface StepStartData {
  step_index: number;
  step: Record<string, unknown>;
}

export interface StepCompleteData {
  step: Record<string, unknown>;
  result: string;
}

export interface ToolCallData {
  tool_name: string;
  arguments: Record<string, unknown>;
}

export interface ToolResultData {
  tool_name: string;
  result: string;
}

export interface DoneData {
  awaiting_approval: boolean;
}

export interface ErrorData {
  error_type: string;
  message: string;
}

// ---------------------------------------------------------------------------
// Chat state types
// ---------------------------------------------------------------------------

export interface PlanStep {
  tool_name: string;
  arguments: Record<string, unknown>;
  expected_output?: string;
}

export type PlanStatus =
  | "pending_approval"
  | "editing"
  | "approved"
  | "rejected"
  | "executing"
  | "completed"
  | "failed";

export interface ExecutionStep {
  stepIndex: number;
  step: PlanStep;
  status: "pending" | "running" | "done" | "failed";
  result?: string;
  toolCalls: Array<{ toolName: string; arguments: unknown; result?: string }>;
  startedAt?: string;
  completedAt?: string;
}

/** Tool-level clarification from a mid-execution interrupt (one at a time). */
export interface ToolClarificationData {
  type: "clarification";
  item_name: string;
  item_index: number;
  tool: string;
  /** Which request param the picked option corrects. */
  answer_key?: string | null;
  original_request: Record<string, unknown>;
  tool_response: Record<string, unknown>;
  message: string;
  /** How many parallel branches still need clarification (including this one). */
  remaining: number;
  /** 1-based ask count for this tool call; >1 means the previous answer didn't match. */
  clarification_round?: number;
}

export type ChatMessage =
  | { kind: "user"; content: string }
  | { kind: "assistant"; content: string }
  | { kind: "system_event"; eventType: string; data: unknown }
  | { kind: "plan"; payload: unknown; status: PlanStatus }
  | { kind: "execution_progress"; steps: ExecutionStep[] }
  | { kind: "tool_clarification"; data: ToolClarificationData; response: Record<string, unknown> | null; status: "pending" | "resolved" }
  | { kind: "error"; errorType: string; message: string };

// ---------------------------------------------------------------------------
// Testing platform types
// ---------------------------------------------------------------------------

export interface ExpectedToolCall {
  tool_name: string;
  args: Record<string, unknown>;
}

export interface ToolInfo {
  name: string;
  description: string;
  category: string | null;
  tags: string[];
  args_schema: {
    properties?: Record<string, { type?: string; description?: string; enum?: unknown[] }>;
    required?: string[];
  } | null;
}

export interface SessionContext {
  tenant_id: string;
  workspace_id: string;
  /** Free-form workspace snapshot, e.g. { team: [...], projects: [...] }. */
  payload?: Record<string, unknown> | null;
}

export interface TestCase {
  id: string;
  name: string;
  description: string | null;
  tags: string[];
  prompt: string;
  expected_tool_calls: ExpectedToolCall[];
  session_context: SessionContext | null;
  created_at: string;
  updated_at: string;
}

export interface TestCaseCreate {
  name: string;
  description?: string | null;
  tags?: string[];
  prompt: string;
  expected_tool_calls: ExpectedToolCall[];
  session_context?: SessionContext | null;
}

export interface TestCaseListResponse {
  test_cases: TestCase[];
  total: number;
}

export interface BulkImportRequest {
  test_cases: TestCaseCreate[];
}

export interface BulkImportResponse {
  created: number;
  errors: Array<{ index: number; name: string; error: string }>;
}

export interface BulkDeleteRequest {
  test_case_ids: string[];
}

export interface BulkDeleteResponse {
  deleted: number;
}

export interface ToolCallResult {
  tool_name: string;
  arguments: Record<string, unknown>;
}

export interface TestResultItem {
  id: string;
  test_case_id: string;
  test_case_name: string;
  test_case_prompt: string;
  status: string;
  passed: boolean;
  expected_tool_calls: ExpectedToolCall[];
  actual_tool_calls: ToolCallResult[];
  mismatches: Array<Record<string, unknown>>;
  error: string | null;
  duration_ms: number | null;
}

export interface TestRunSummary {
  id: string;
  status: string;
  total_cases: number;
  passed: number;
  failed: number;
  started_at: string;
  ended_at: string | null;
  duration_ms: number | null;
}

export interface TestRunDetail extends TestRunSummary {
  results: TestResultItem[];
}

export interface TestRunListResponse {
  test_runs: TestRunSummary[];
  total: number;
}
