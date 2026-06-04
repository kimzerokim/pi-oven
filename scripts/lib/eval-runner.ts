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
  /** Max ms to wait for any single turn's terminal event. Default: 90_000 ms. */
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
  const turnTimeoutMs = options?.turnTimeoutMs ?? 90_000;
  const scenarioTimeoutMs = options?.scenarioTimeoutMs ?? 5 * turnTimeoutMs;
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

  for (const exp of scenario.expected) {
    // 1. skill_triggered — liveness check only (D1 contract).
    //    boolean true/false: checks for any activity (tool calls or content).
    //    string form: DEPRECATED — treated as liveness (true) so old scenarios still
    //    pass/fail on the presence-of-activity signal; name-search is intentionally
    //    removed. Migrate to skill_read_required for activation checks.
    if (exp.skill_triggered !== undefined) {
      const anyTriggered = lastBuf.toolCalls.length > 0 || lastBuf.content.length > 0;
      if (exp.skill_triggered === false && anyTriggered) {
        failures.push(`skill_triggered: expected no activation evidence, but activation was observed`);
      } else if (exp.skill_triggered !== false && !anyTriggered) {
        // true or any string value — liveness requires at least some activity
        failures.push(`skill_triggered: no evidence of skill activation`);
      }
    }

    // 1b. skill_read_required — honest activation check (D1 contract).
    //     Passes when the turn's tool calls include a read of skill://<name>.
    //     omp records skill body loads as a tool invocation whose name contains
    //     the skill:// URI, e.g. "read skill://codebase-survey".
    if (exp.skill_read_required !== undefined) {
      const name = exp.skill_read_required;
      const uri = `skill://${name}`;
      const read = lastBuf.toolCalls.some((n) => n.includes(uri));
      if (!read) {
        failures.push(`skill_read_required: ${uri} not read (no matching tool call found)`);
      }
    }

    // 2. agent_response_must_contain
    if (exp.agent_response_must_contain !== undefined) {
      const raw = exp.agent_response_must_contain;
      let phrases: string[];
      if (Array.isArray(raw)) {
        phrases = raw;
      } else if (typeof raw === "string") {
        phrases = [raw];
      } else {
        failures.push(
          `agent_response_must_contain: invalid shape — expected string[] but got ${JSON.stringify(raw)}; fix the scenario YAML`
        );
        phrases = null as unknown as string[];
      }
      if (phrases !== null) {
        const matchMode = exp.agent_response_must_contain_match ?? "all";
        if (matchMode === "any") {
          const anyFound = phrases.some((phrase) =>
            lastBuf.content.includes(phrase)
          );
          if (!anyFound) {
            failures.push(
              `agent_response_must_contain(any): none of ${JSON.stringify(phrases)} found`
            );
          }
        } else {
          for (const phrase of phrases) {
            if (!lastBuf.content.includes(phrase)) {
              failures.push(`agent_response_must_contain: missing "${phrase}"`);
            }
          }
        }
      }
    }

    // 3. agent_response_must_not_contain
    if (exp.agent_response_must_not_contain) {
      for (const phrase of exp.agent_response_must_not_contain) {
        if (lastBuf.content.includes(phrase)) {
          failures.push(`agent_response_must_not_contain: found forbidden "${phrase}"`);
        }
      }
    }

    // 4. tool_calls_required: each pattern must match at least one invoked tool
    if (exp.tool_calls_required) {
      for (const pattern of exp.tool_calls_required) {
        const re = new RegExp(pattern);
        const matched = lastBuf.toolCalls.some((n) => re.test(n));
        if (!matched) failures.push(`tool_calls_required: ${pattern} not invoked`);
      }
    }

    // 5. tool_calls_forbidden_first: the FIRST tool call must not match any pattern
    if (exp.tool_calls_forbidden_first && lastBuf.toolCalls.length > 0) {
      const first = lastBuf.toolCalls[0];
      for (const pattern of exp.tool_calls_forbidden_first) {
        if (new RegExp(pattern).test(first)) {
          failures.push(`tool_calls_forbidden_first: first tool "${first}" matched forbidden pattern "${pattern}"`);
        }
      }
    }
  }

  return {
    scenario: scenario.name,
    skill: scenario.skill,
    passed: failures.length === 0,
    failures,
    observations,
    latency_ms: Math.round(performance.now() - t0),
    token_in: 0,   // token counting requires model event not yet standardised
    token_out: 0,
  };
}
