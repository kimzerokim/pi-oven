export interface ScenarioTurn {
  turn: number;
  user: string;
}

/** Only these 5 fields are evaluable in Plan 1 (event-aggregation, no LLM-as-judge).
 *  Deferred fields (agent_must_resist_pressure, skill_must_force_grep_first,
 *  agent_response_must_explain, state_transition_must_reach) land in Plan 3.
 */
export interface ScenarioExpectation {
  skill_triggered?: boolean | string;          // true = any activation, false = no activation, string = token must appear in tool-call name or response text
  agent_response_must_contain?: string[];      // substrings required in aggregated content
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
