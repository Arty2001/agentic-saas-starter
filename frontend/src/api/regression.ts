/**
 * API types + calls for the agent eval framework (Tests).
 * Mirrors src/agent_platform/regression/schemas.py.
 */

import { apiGet, apiPost, apiPut, apiDelete } from "./client";

// ---------------------------------------------------------------------------
// Turns
// ---------------------------------------------------------------------------

export type RegressionTurn =
  | { type: "message"; text: string }
  | { type: "approve" }
  | { type: "reject" }
  | { type: "edit"; text: string }
  | { type: "clarification"; response: unknown };

export type TurnType = RegressionTurn["type"];

// ---------------------------------------------------------------------------
// Snapshots / diffs / judge
// ---------------------------------------------------------------------------

export interface TurnSnapshot {
  turn_index: number;
  input: Record<string, unknown>;
  router_decision: string | null;
  tool_calls: { tool_name: string; arguments: Record<string, unknown> }[];
  tool_results: { tool_name: string; result: string }[];
  plan: Record<string, unknown> | null;
  tool_clarification: Record<string, unknown> | null;
  items_completed: Record<string, unknown>[] | null;
  final_text: string;
  awaiting_approval: boolean;
  error: { error_type?: string; message?: string } | null;
  run_id: string | null;
  duration_ms: number | null;
}

export interface TestSnapshot {
  meta: Record<string, unknown>;
  turns: TurnSnapshot[];
}

export interface DiffEntry {
  path: string;
  kind: "changed" | "added" | "removed";
  baseline: unknown;
  actual: unknown;
}

export interface JudgeTurnVerdict {
  turn_index: number;
  equivalent: boolean | null;
  differences: string | null;
  error: string | null;
  baseline_text?: string | null;
  actual_text?: string | null;
}

export interface JudgeReport {
  verdicts: JudgeTurnVerdict[];
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

export type ContextMode = "mock" | "real";
export type UnexpectedInterruptPolicy = "fail" | "auto_approve";

export interface RegressionTestCreate {
  name: string;
  description?: string | null;
  tags: string[];
  /** Agents this test targets ("router" = auto-route). All run the same turns against one shared baseline. */
  agent_types: string[];
  context_mode: ContextMode;
  context_args: Record<string, unknown>;
  turns: RegressionTurn[];
  on_unexpected_interrupt: UnexpectedInterruptPolicy;
  ignore_paths: string[];
}

export interface LastResultSummary {
  run_id: string;
  result_id: string;
  status: string;
  created_at: string;
}

/** Per-agent result status; the baseline is shared and lives on the test. */
export interface AgentTestState {
  agent_type: string;
  last_result: LastResultSummary | null;
}

export interface RegressionTest extends RegressionTestCreate {
  id: string;
  definition_hash: string;
  baseline_version: number | null;
  baseline_stale: boolean;
  agents: AgentTestState[];
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface RegressionTestListResponse {
  tests: RegressionTest[];
  total: number;
}

export interface ContextSpec {
  args_schema: Record<string, unknown>;
  defaults: Record<string, unknown>;
}

export interface RegressionAgentInfo {
  name: string;
  description: string;
  context: ContextSpec | null;
}

// ---------------------------------------------------------------------------
// Runs / results
// ---------------------------------------------------------------------------

export type ResultStatus =
  | "passed"
  | "structural_diff"
  | "text_diff"
  | "baseline_created"
  | "needs_review"
  | "error"
  | "skipped"
  | "pending";

export interface RegressionRunSummary {
  id: string;
  status: string;
  mode: "regression" | "rebaseline";
  /** Scope: only this agent ran (null = every agent of every selected test). */
  agent_type: string | null;
  /** Number of test×agent executions. */
  total_tests: number;
  completed_tests: number;
  passed: number;
  failed: number;
  needs_review: number;
  baselines_created: number;
  triggered_by: string | null;
  started_at: string;
  ended_at: string | null;
  duration_ms: number | null;
}

export interface RegressionResult {
  id: string;
  run_id: string;
  test_id: string;
  test_name: string;
  test_tags: string[];
  /** Agent this execution ran as ("router" = auto-route). */
  agent_type: string;
  baseline_id: string | null;
  status: ResultStatus;
  snapshot: TestSnapshot | null;
  diff: DiffEntry[];
  judge: JudgeReport | null;
  error: string | null;
  mock_mode: boolean;
  duration_ms: number | null;
  created_at: string;
}

export interface RegressionRunDetail extends RegressionRunSummary {
  results: RegressionResult[];
}

export interface BaselineDetail {
  id: string;
  test_id: string;
  version: number;
  definition_hash: string;
  is_active: boolean;
  promoted_by: string | null;
  promoted_at: string;
  snapshot: TestSnapshot;
}

export interface RegressionRunListResponse {
  runs: RegressionRunSummary[];
  total: number;
}

// ---------------------------------------------------------------------------
// API calls
// ---------------------------------------------------------------------------

export const regressionApi = {
  agents: () => apiGet<RegressionAgentInfo[]>("/regression/agents"),

  listTests: (search = "", tag = "") =>
    apiGet<RegressionTestListResponse>(
      `/regression/tests?limit=10000&search=${encodeURIComponent(search)}&tag=${encodeURIComponent(tag)}`,
    ),
  getTest: (id: string) => apiGet<RegressionTest>(`/regression/tests/${id}`),
  createTest: (body: RegressionTestCreate) => apiPost<RegressionTest>("/regression/tests", body),
  updateTest: (id: string, body: Partial<RegressionTestCreate>) =>
    apiPut<RegressionTest>(`/regression/tests/${id}`, body),
  deleteTest: (id: string) => apiDelete(`/regression/tests/${id}`),
  cloneTest: (id: string) => apiPost<RegressionTest>(`/regression/tests/${id}/clone`, {}),

  getBaseline: (testId: string) =>
    apiGet<{ baseline: Record<string, unknown> | null; versions: Record<string, unknown>[] }>(
      `/regression/tests/${testId}/baseline`,
    ),
  getBaselineById: (baselineId: string) =>
    apiGet<BaselineDetail>(`/regression/baselines/${baselineId}`),
  resetBaseline: (testId: string) => apiDelete(`/regression/tests/${testId}/baseline`),
  promote: (testId: string, resultId: string) =>
    apiPost<{ baseline_id: string; version: number }>(`/regression/tests/${testId}/promote`, {
      result_id: resultId,
    }),

  startRun: (
    testIds: string[],
    mode: "regression" | "rebaseline" = "regression",
    authMode: "user" | "service" = "user",
    agentType?: string,
  ) =>
    apiPost<RegressionRunSummary>("/regression/runs", {
      test_ids: testIds,
      mode,
      auth_mode: authMode,
      agent_type: agentType ?? null,
    }),
  listRuns: (limit = 100) => apiGet<RegressionRunListResponse>(`/regression/runs?limit=${limit}`),
  getRun: (id: string) => apiGet<RegressionRunDetail>(`/regression/runs/${id}`),
  cancelRun: (id: string) => apiPost<{ status: string }>(`/regression/runs/${id}/cancel`, {}),
};
