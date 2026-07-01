export interface ScenarioTurn {
  turn: number;
  user: string;
}

/** Only these 5 fields are evaluable in Plan 1 (event-aggregation, no LLM-as-judge).
 *  Deferred fields (agent_must_resist_pressure, skill_must_force_grep_first,
 *  agent_response_must_explain, state_transition_must_reach) land in Plan 3.
 *
 *  D1 "stable-signal" scoring contract:
 *  - TELEMETRY (recorded, never a failure): agent_response_must_contain,
 *    agent_response_must_contain_match, tool_calls_required, skill_read_required (soft).
 *  - HARD GATE (deterministic, stable — real omp-native contract):
 *    agent_response_must_not_contain, tool_calls_forbidden_first,
 *    skill_triggered===false (expected NO activation).
 *  - LIVENESS gate: if the turn produced no content and no tool calls and did not
 *    time out, the scenario fails with a "liveness" failure.
 *  - INCONCLUSIVE: a timed-out turn with empty content sets verdict.inconclusive=true
 *    and passed=false without attributing any behavioral failure.
 */
export interface ScenarioExpectation {
  /**
   * Liveness / negative-activation check (D1 contract).
   * - true: liveness gate — passes when the turn produced any tool call or non-empty content.
   *   (Distinct from the generic liveness gate which fires when NO exp sets skill_triggered.)
   * - false: HARD GATE — fails when ANY activation evidence is present.
   * - string form: DEPRECATED — treated as liveness (true) regardless of value;
   *   the old name-search path (string appears in toolCalls/content) is removed.
   *   Use skill_read_required for activation checks; use agent_response_must_contain
   *   for behavioral telemetry.
   */
  skill_triggered?: boolean | string;
  /**
   * Soft-by-default telemetry: records whether the turn's tool calls include a read
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
  /** TELEMETRY — recorded as observations, never a failure (D1 contract).
   *  Hits and misses both record a "response_contains[telemetry]" observation. */
  agent_response_must_contain?: string[];
  /** Match mode for agent_response_must_contain telemetry.
   *  "all" (default) = every phrase must be present; "any" = at least one phrase. */
  agent_response_must_contain_match?: "all" | "any";
  /** HARD GATE — fails the scenario when any forbidden substring is found in content.
   *  The primary omp-native violation detector (e.g. legacy foreign namespace refs, "omo:"). */
  agent_response_must_not_contain?: string[];
  /** TELEMETRY — recorded as observations, never a failure (D1 contract).
   *  Each pattern records a "tool_required[telemetry]" hit (✓) or MISS observation. */
  tool_calls_required?: string[];
  /** HARD GATE — fails the scenario when the FIRST tool call matches any forbidden pattern. */
  tool_calls_forbidden_first?: string[];
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
  /** True when the turn timed out with no final text — measurement incomplete,
   *  NOT a skill failure. Distinct from passed===false: an inconclusive scenario
   *  should not count as a hard failure in exit-code decisions. */
  inconclusive: boolean;
  failures: string[];
  observations: string[];
  latency_ms: number;
  token_in: number;
  token_out: number;
}
