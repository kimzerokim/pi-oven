export interface ScenarioTurn {
  turn: number;
  user: string;
}

/** Only these 5 fields are evaluable in Plan 1 (event-aggregation, no LLM-as-judge).
 *  Deferred fields (agent_must_resist_pressure, skill_must_force_grep_first,
 *  agent_response_must_explain, state_transition_must_reach) land in Plan 3.
 */
export interface ScenarioExpectation {
  /**
   * Liveness check only (D1 contract).
   * - true: passes when the turn produced any tool call or non-empty content
   * - false: passes when the turn produced no tool calls and empty content
   * - string form: DEPRECATED — treated as liveness (true) regardless of value;
   *   the old name-search path (string appears in toolCalls/content) is removed.
   *   Use skill_read_required for activation checks; use agent_response_must_contain
   *   for behavioral checks.
   */
  skill_triggered?: boolean | string;
  /**
   * Passes when the turn's tool calls include a read of skill://<name>.
   * This is the honest "the model loaded the skill" signal under D1: omp records
   * skill body loads as a tool invocation whose name contains "skill://<name>".
   * Use for loadable/procedural skills (codebase-survey, spec-and-review, etc.).
   */
  skill_read_required?: string;
  agent_response_must_contain?: string[];      // substrings required in aggregated content
  agent_response_must_contain_match?: "all" | "any";  // "all" (default) = every phrase required; "any" = at least one phrase required
  agent_response_must_not_contain?: string[];  // substrings forbidden in aggregated content
  tool_calls_required?: string[];              // regex patterns: at least one tool call must match each
  tool_calls_forbidden_first?: string[];       // regex patterns: first tool call must NOT match any
}

export interface Scenario {
  name: string;
  skill: string;
  tag: "smoke" | "adversarial" | "regression" | "canary";
  input: ScenarioTurn[];
  expected: ScenarioExpectation[];
}

export interface Verdict {
  scenario: string;
  skill: string;
  passed: boolean;
  failures: string[];
  observations: string[];
  latency_ms: number;
  token_in: number;
  token_out: number;
}
