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
   * Soft-by-default telemetry: passes when the turn's tool calls include a read
   * of skill://<name>. Under the D1 contract, reading the skill body is the
   * model's discretion — behavior is the gate. A missing read is a non-blocking
   * observation unless skill_read_required_mode is "hard".
   * omp records skill body loads as a tool invocation whose name contains the
   * skill:// URI, e.g. "read skill://codebase-survey".
   */
  skill_read_required?: string;
  /** How skill_read_required is scored.
   *  - "soft" (DEFAULT): a missing skill:// read is a non-blocking observation,
   *    NOT a failure — behavioral assertions are the gate (D1: behavior is the
   *    contract, reading the body is the model's discretion).
   *  - "hard": a missing read pushes a failure (only when loading the body is
   *    genuinely load-bearing and unobservable from output). */
  skill_read_required_mode?: "hard" | "soft";
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
  /** Per-scenario override for the per-turn terminal-event timeout (ms).
   *  Scenarios whose skill spawns task subagents need >90s. Falls back to
   *  RunnerOptions.turnTimeoutMs, then the 90_000 default. */
  turn_timeout_ms?: number;
  /** Per-scenario override for the whole-scenario wall-clock cap (ms).
   *  Falls back to RunnerOptions.scenarioTimeoutMs, then 5 * turnTimeoutMs. */
  scenario_timeout_ms?: number;
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
