import type { Scenario, Verdict } from "./scenario-schema";

const REQUIRED_FIELDS: Array<keyof Scenario> = ["name", "skill", "tag", "input", "expected"];

export function parseScenario(yamlText: string): Scenario {
  const obj = Bun.YAML.parse(yamlText) as Partial<Scenario>;
  for (const field of REQUIRED_FIELDS) {
    if (obj[field] === undefined) {
      throw new Error(`Scenario missing required field: ${field}`);
    }
  }
  return obj as Scenario;
}

/** Minimal event shapes the runner cares about.
 *  Real SDK emits AgentSessionEvent; we only inspect these two variants.
 */
export type RunnerEvent =
  | { type: "tool_execution_start"; toolName: string; toolCallId: string }
  | { type: "message_update"; delta: string }
  | { type: "message_end" }
  | { type: string };  // catch-all for other event types

/** Contract that mirrors real AgentSession subscribe/prompt API.
 *  Real SDK: session.subscribe(listener) returns unsubscribe fn; session.prompt() returns Promise<void>.
 *  The optional options.signal is wired to an AbortController so the in-flight
 *  turn can be cancelled when the per-turn timeout fires.
 */
export interface SessionLike {
  subscribe(listener: (event: RunnerEvent) => void): () => void;
  prompt(message: string, options?: { signal?: AbortSignal }): Promise<void>;
}

/** Options passed to runScenario to control runner behaviour. */
export interface RunnerOptions {
  /** Max ms to wait for any single turn's terminal event. Default: 180_000 ms.
   *  Reasoning models doing read-heavy exploration routinely exceed 90s before
   *  emitting their final text; 90s truncated turns mid-work (content=""). */
  turnTimeoutMs?: number;
  /** Max ms for the entire scenario wall-clock. Default: 5 * turnTimeoutMs. */
  scenarioTimeoutMs?: number;
  /** Max number of turns to execute per scenario. Default: unbounded. */
  maxTurns?: number;
}

/** Terminal event types: anything that ends a turn (success OR failure path). */
const TERMINAL_EVENTS = new Set(["message_end", "error", "abort", "session_error", "stream_error"]);

/** Per-turn aggregated result collected via subscribe(). */
interface TurnBuffer {
  content: string;
  toolCalls: string[];  // toolName values in invocation order
  timedOut?: boolean;
}

async function runTurn(
  session: SessionLike,
  userMessage: string,
  turnTimeoutMs: number
): Promise<TurnBuffer> {
  const buf: TurnBuffer = { content: "", toolCalls: [] };

  // Per-turn AbortController: aborted when the timeout fires, so the in-flight
  // session.prompt() (which accepts signal) is actually cancelled — not just
  // ignored by a dangling setTimeout that only guards terminalPromise.
  const controller = new AbortController();

  const terminalPromise = new Promise<void>((resolve) => {
    let done = false;
    const timeoutHandle = setTimeout(() => {
      if (!done) {
        done = true;
        buf.timedOut = true;
        controller.abort();   // cancel the in-flight prompt()
        unsubscribe();
        resolve();
      }
    }, turnTimeoutMs);

    const unsubscribe = session.subscribe((event) => {
      if (event.type === "tool_execution_start") {
        const e = event as { type: "tool_execution_start"; toolName: string };
        buf.toolCalls.push(e.toolName);
      } else if (event.type === "message_update") {
        const e = event as { type: "message_update"; delta: string };
        buf.content += e.delta;
      }
      // Resolve on message_end OR any other terminal/error/abort event
      if (TERMINAL_EVENTS.has(event.type) && !done) {
        done = true;
        clearTimeout(timeoutHandle);
        unsubscribe();
        resolve();
      }
    });
  });

  // Race prompt() against the timeout: if prompt() is a blocking real SDK call
  // the AbortController signal aborts it; if it's a mock that ignores signal the
  // terminalPromise timeout still fires and resolves the race.
  // Errors from prompt() (e.g. AbortError when signal fires) are swallowed —
  // a timed-out turn is recorded via buf.timedOut, not thrown.
  await Promise.race([
    session.prompt(userMessage, { signal: controller.signal }).catch(() => {}),
    terminalPromise,
  ]);
  // Ensure terminalPromise is also awaited so subscription cleanup runs
  await terminalPromise;
  return buf;
}

export async function runScenario(
  scenario: Scenario,
  session: SessionLike,
  options?: RunnerOptions
): Promise<Verdict> {
  const turnTimeoutMs = scenario.turn_timeout_ms ?? options?.turnTimeoutMs ?? 180_000;
  const scenarioTimeoutMs = scenario.scenario_timeout_ms ?? options?.scenarioTimeoutMs ?? 5 * turnTimeoutMs;
  const maxTurns = options?.maxTurns;
  const t0 = performance.now();
  const failures: string[] = [];
  const observations: string[] = [];

  // Per-scenario wall-clock deadline: resolves to a sentinel after scenarioTimeoutMs
  let scenarioTimedOut = false;
  const scenarioDeadlinePromise = new Promise<"scenario_deadline">((resolve) =>
    setTimeout(() => {
      scenarioTimedOut = true;
      resolve("scenario_deadline");
    }, scenarioTimeoutMs)
  );

  // Aggregate across all turns; evaluations run against the LAST turn's buffer
  let lastBuf: TurnBuffer = { content: "", toolCalls: [] };
  let turnIndex = 0;
  for (const turn of scenario.input) {
    if (scenarioTimedOut) break;
    if (maxTurns !== undefined && turnIndex >= maxTurns) break;
    turnIndex++;

    const turnResult = await Promise.race([
      runTurn(session, turn.user, turnTimeoutMs),
      scenarioDeadlinePromise,
    ]);

    if (turnResult === "scenario_deadline") {
      scenarioTimedOut = true;
      break;
    }

    lastBuf = turnResult;
    observations.push(`turn ${turn.turn}: tools=[${lastBuf.toolCalls.join(",")}] content="${lastBuf.content.slice(0, 80)}"`);
    if (lastBuf.timedOut) break;  // timed-out turn: stop scenario, don't run subsequent turns
  }

  if (scenarioTimedOut) {
    failures.push(`scenario_timeout: scenario exceeded ${scenarioTimeoutMs}ms wall-clock cap`);
  }

  // D1: Compute inconclusive and liveness BEFORE the expectation loop.
  // inconclusive: the last turn timed out AND produced no content — measurement
  // incomplete, NOT a skill failure. Distinct from "liveness failure" (no output
  // without a timeout).
  const inconclusive = lastBuf.timedOut === true && lastBuf.content.length === 0;
  const producedOutput = lastBuf.content.length > 0 || lastBuf.toolCalls.length > 0;

  if (inconclusive) {
    observations.push(`timeout: turn exceeded ${scenario.turn_timeout_ms ?? options?.turnTimeoutMs ?? 180_000}ms (inconclusive)`);
  }

  for (const exp of scenario.expected) {
    // 1. skill_triggered — liveness/negative-gate (D1 contract).
    //    false: HARD GATE — fails when any activation evidence is observed.
    //    true or string: liveness check — fails when no activity produced AND not inconclusive.
    //    string form: DEPRECATED — treated as liveness (true).
    if (exp.skill_triggered !== undefined) {
      const anyTriggered = lastBuf.toolCalls.length > 0 || lastBuf.content.length > 0;
      if (exp.skill_triggered === false && anyTriggered) {
        // HARD GATE: expected no activation, but got some
        failures.push(`skill_triggered: expected no activation evidence, but activation was observed`);
      } else if (exp.skill_triggered !== false && !anyTriggered && !inconclusive) {
        // Liveness check: expected some activation; not inconclusive (timeout with no output
        // is inconclusive — don't blame as a gate failure)
        failures.push(`liveness: no skill activation evidence`);
      }
    }

    // 1b. skill_read_required — soft-by-default telemetry (D1 contract).
    //     Under D1, reading the skill body is the model's discretion; behavior
    //     is the gate. A missing read is a non-blocking observation ("soft").
    //     Use mode:"hard" only when loading the body is genuinely load-bearing.
    if (exp.skill_read_required !== undefined) {
      const name = exp.skill_read_required;
      const uri = `skill://${name}`;
      const read = lastBuf.toolCalls.some((n) => n.includes(uri));
      const mode = exp.skill_read_required_mode ?? "soft";
      if (read) {
        observations.push(`skill_read: ${uri} read ✓`);
      } else if (mode === "hard") {
        failures.push(`skill_read_required(hard): ${uri} not read (no matching tool call found)`);
      } else {
        observations.push(`skill_read: ${uri} NOT read (soft — behavior is the gate)`);
      }
    }

    // 2. agent_response_must_contain — TELEMETRY (D1 contract).
    //    Hits and misses are recorded as observations; NEVER pushed to failures.
    if (exp.agent_response_must_contain !== undefined) {
      const raw = exp.agent_response_must_contain;
      let phrases: string[];
      if (Array.isArray(raw)) {
        phrases = raw;
      } else if (typeof raw === "string") {
        phrases = [raw];
      } else {
        observations.push(
          `response_contains[telemetry]: invalid shape — expected string[] but got ${JSON.stringify(raw)}; fix the scenario YAML`
        );
        phrases = null as unknown as string[];
      }
      if (phrases !== null) {
        const matchMode = exp.agent_response_must_contain_match ?? "all";
        if (matchMode === "any") {
          const anyFound = phrases.some((phrase) => lastBuf.content.includes(phrase));
          if (anyFound) {
            observations.push(`response_contains[telemetry]: matched (any) in ${JSON.stringify(phrases)}`);
          } else {
            observations.push(`response_contains[telemetry]: MISS (any) — none of ${JSON.stringify(phrases)} found`);
          }
        } else {
          for (const phrase of phrases) {
            if (lastBuf.content.includes(phrase)) {
              observations.push(`response_contains[telemetry]: matched "${phrase}"`);
            } else {
              observations.push(`response_contains[telemetry]: MISS "${phrase}"`);
            }
          }
        }
      }
    }

    // 3. agent_response_must_not_contain — HARD GATE (D1 contract).
    //    The primary omp-native violation detector (e.g. legacy foreign namespace refs, "omo:").
    if (exp.agent_response_must_not_contain) {
      for (const phrase of exp.agent_response_must_not_contain) {
        if (lastBuf.content.includes(phrase)) {
          failures.push(`agent_response_must_not_contain: found forbidden "${phrase}"`);
        }
      }
    }

    // 4. tool_calls_required — TELEMETRY (D1 contract).
    //    Each pattern records a hit (✓) or MISS observation; NEVER pushed to failures.
    if (exp.tool_calls_required) {
      for (const pattern of exp.tool_calls_required) {
        const re = new RegExp(pattern);
        const matched = lastBuf.toolCalls.some((n) => re.test(n));
        if (matched) {
          observations.push(`tool_required[telemetry]: ${pattern} ✓`);
        } else {
          observations.push(`tool_required[telemetry]: ${pattern} MISS`);
        }
      }
    }

    // 5. tool_calls_forbidden_first — HARD GATE (D1 contract).
    //    The FIRST tool call must not match any forbidden pattern.
    if (exp.tool_calls_forbidden_first && lastBuf.toolCalls.length > 0) {
      const first = lastBuf.toolCalls[0];
      for (const pattern of exp.tool_calls_forbidden_first) {
        if (new RegExp(pattern).test(first)) {
          failures.push(`tool_calls_forbidden_first: first tool "${first}" matched forbidden pattern "${pattern}"`);
        }
      }
    }
  }

  // Generic liveness gate: if the turn produced no content and no tool calls and
  // did NOT time out, that's a liveness failure (the agent was silent with no excuse).
  // Skip when any expectation explicitly expects no activation (skill_triggered===false),
  // because silence is the correct outcome in that case.
  const expectsNoActivation = scenario.expected.some((e) => e.skill_triggered === false);
  if (!inconclusive && !producedOutput && !scenarioTimedOut && !expectsNoActivation) {
    failures.push(`liveness: produced no content and no tool calls`);
  }

  return {
    scenario: scenario.name,
    skill: scenario.skill,
    passed: failures.length === 0 && !inconclusive,
    inconclusive,
    failures,
    observations,
    latency_ms: Math.round(performance.now() - t0),
    token_in: 0,   // token counting requires model event not yet standardised
    token_out: 0,
  };
}
