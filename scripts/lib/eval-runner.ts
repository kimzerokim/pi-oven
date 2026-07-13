import {
  ScenarioSchema,
  type Scenario,
  type Verdict,
} from "./scenario-schema";
import type {
  EvidenceEvent,
  ModelReceipt,
  UsageDelta,
} from "./omp-eval-event-adapter";

export function parseScenario(yamlText: string): Scenario {
  return ScenarioSchema.parse(Bun.YAML.parse(yamlText));
}

/** Stable runner-facing event type. Raw OMP SDK events are converted by the adapter. */
export type RunnerEvent = EvidenceEvent;

export interface SessionLike {
  subscribe(listener: (event: EvidenceEvent) => void): () => void;
  prompt(message: string, options?: { signal?: AbortSignal }): Promise<void>;
}

export interface RunnerOptions {
  turnTimeoutMs?: number;
  scenarioTimeoutMs?: number;
  maxTurns?: number;
}

interface TurnBuffer {
  events: EvidenceEvent[];
  timedOut: boolean;
  infrastructureError?: string;
}

const DEFAULT_TURN_TIMEOUT_MS = 180_000;

function abortReasonCode(signal: AbortSignal): string {
  const reason = signal.reason;
  if (reason instanceof Error && reason.message) return reason.message;
  return typeof reason === "string" && reason ? reason : "aborted";
}

/**
 * Run one prompt while the scenario-owned AbortController owns cancellation.
 * Every timer, listener, and SDK subscription is released in `finally`.
 */
async function runTurn(
  session: SessionLike,
  userMessage: string,
  turnTimeoutMs: number,
  controller: AbortController,
): Promise<TurnBuffer> {
  const buffer: TurnBuffer = { events: [], timedOut: false };
  let unsubscribe: () => void = () => {};
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let settle!: () => void;
  const terminal = new Promise<void>((resolve) => {
    settle = resolve;
  });

  const onAbort = () => {
    if (abortReasonCode(controller.signal) === "turn_timeout") buffer.timedOut = true;
    settle();
  };

  try {
    unsubscribe = session.subscribe((event) => {
      buffer.events.push(event);
      if (event.type === "terminal_error") {
        buffer.infrastructureError = event.code;
        settle();
      } else if (event.type === "turn_end") {
        settle();
      }
    });
    controller.signal.addEventListener("abort", onAbort, { once: true });
    timeout = setTimeout(() => {
      if (!controller.signal.aborted) controller.abort(new Error("turn_timeout"));
    }, turnTimeoutMs);

    void session.prompt(userMessage, { signal: controller.signal }).catch((error: unknown) => {
      if (!controller.signal.aborted) {
        buffer.infrastructureError = error instanceof Error ? error.message : String(error);
      }
      settle();
    });
    await terminal;
    return buffer;
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
    controller.signal.removeEventListener("abort", onAbort);
    unsubscribe();
  }
}

function normalize(value: string): string {
  return value.toLocaleLowerCase("en-US");
}

function evaluateResponse(
  scenario: Scenario,
  response: string,
  failures: string[],
  observations: string[],
  suppressMissing: boolean,
): void {
  const haystack = normalize(response);
  for (const expectation of scenario.expected) {
    if (expectation.response_must_contain !== undefined) {
      const matches = expectation.response_must_contain.map((phrase) =>
        haystack.includes(normalize(phrase)),
      );
      const passed = expectation.response_must_contain_match === "any"
        ? matches.some(Boolean)
        : matches.every(Boolean);
      if (!passed && !suppressMissing) {
        const missing = expectation.response_must_contain.filter((_, index) => !matches[index]);
        failures.push(
          `response_must_contain(${expectation.response_must_contain_match ?? "all"}): missing ${JSON.stringify(missing)}`,
        );
      }
    }

    for (const phrase of expectation.response_must_not_contain ?? []) {
      if (haystack.includes(normalize(phrase))) {
        failures.push(`response_must_not_contain: found forbidden ${JSON.stringify(phrase)}`);
      }
    }

    if (expectation.observe_response_contains !== undefined) {
      for (const phrase of expectation.observe_response_contains) {
        observations.push(
          `observe_response_contains: ${JSON.stringify(phrase)} ${haystack.includes(normalize(phrase)) ? "HIT" : "MISS"}`,
        );
      }
    }
  }
}

function isDeepSubset(expected: unknown, actual: unknown): boolean {
  if (Object.is(expected, actual)) return true;
  if (Array.isArray(expected)) {
    return Array.isArray(actual) &&
      expected.length === actual.length &&
      expected.every((item, index) => isDeepSubset(item, actual[index]));
  }
  if (expected !== null && typeof expected === "object") {
    if (actual === null || typeof actual !== "object" || Array.isArray(actual)) return false;
    return Object.entries(expected as Record<string, unknown>).every(([key, value]) =>
      Object.prototype.hasOwnProperty.call(actual, key) &&
      isDeepSubset(value, (actual as Record<string, unknown>)[key]),
    );
  }
  return false;
}

function toolRequirementMatches(
  requirement: { namePattern: string; args?: unknown },
  events: EvidenceEvent[],
): boolean {
  const successfulEnds = new Map(
    events
      .filter(
        (event): event is Extract<EvidenceEvent, { type: "tool_end" }> =>
          event.type === "tool_end" && event.outcome === "success",
      )
      .map((event) => [event.callId, event]),
  );
  const namePattern = new RegExp(requirement.namePattern, "i");
  return events.some((event) => {
    if (event.type !== "tool_start" || !namePattern.test(event.name)) return false;
    const end = successfulEnds.get(event.callId);
    if (!end || end.name !== event.name) return false;
    return requirement.args === undefined || isDeepSubset(requirement.args, event.args);
  });
}

function evaluateTools(
  scenario: Scenario,
  events: EvidenceEvent[],
  failures: string[],
  observations: string[],
  suppressMissing: boolean,
): void {
  for (const expectation of scenario.expected) {
    if (expectation.tool_call_required !== undefined) {
      if (!toolRequirementMatches(expectation.tool_call_required, events) && !suppressMissing) {
        failures.push(
          `tool_call_required: no successfully completed tool matched ${JSON.stringify(expectation.tool_call_required)}`,
        );
      }
    }
    if (expectation.observe_tool_call !== undefined) {
      observations.push(
        `observe_tool_call: ${expectation.observe_tool_call.namePattern} ${toolRequirementMatches(expectation.observe_tool_call, events) ? "HIT" : "MISS"}`,
      );
    }
  }
}

function canonicalSkillName(value: string): string {
  const trimmed = value.trim().toLocaleLowerCase("en-US");
  return trimmed.startsWith("pov:") ? trimmed : `pov:${trimmed}`;
}

function evaluateSkillActivations(
  scenario: Scenario,
  events: EvidenceEvent[],
  failures: string[],
  suppressMissing: boolean,
): void {
  const receipts = new Set(
    events
      .filter(
        (event): event is Extract<EvidenceEvent, { type: "skill_activation" }> =>
          event.type === "skill_activation",
      )
      .map((event) => canonicalSkillName(event.skill)),
  );
  for (const expectation of scenario.expected) {
    if (
      expectation.skill_activation_required !== undefined &&
      !receipts.has(canonicalSkillName(expectation.skill_activation_required)) &&
      !suppressMissing
    ) {
      failures.push(
        `skill_activation_required: exact receipt for ${JSON.stringify(expectation.skill_activation_required)} not observed`,
      );
    }
  }
}

function zeroUsage(): UsageDelta {
  return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 };
}

function collectUsage(events: EvidenceEvent[]): {
  usage: UsageDelta;
  modelReceipts: ModelReceipt[];
} {
  const usage = zeroUsage();
  const modelReceipts: ModelReceipt[] = [];
  const seenModels = new Set<string>();
  for (const event of events) {
    if ((event.type === "assistant_end" || event.type === "tool_end") && event.usage) {
      usage.input += event.usage.input;
      usage.output += event.usage.output;
      usage.cacheRead += event.usage.cacheRead;
      usage.cacheWrite += event.usage.cacheWrite;
      usage.cost += event.usage.cost;
    }
    if (event.type === "assistant_end" && event.model) {
      const key = `${event.model.provider}\u0000${event.model.model}`;
      if (!seenModels.has(key)) {
        seenModels.add(key);
        modelReceipts.push(event.model);
      }
    }
  }
  return { usage, modelReceipts };
}

export async function runScenario(
  scenario: Scenario,
  session: SessionLike,
  options: RunnerOptions = {},
): Promise<Verdict> {
  const startedAt = performance.now();
  const turnTimeoutMs = scenario.turn_timeout_ms ?? options.turnTimeoutMs ?? DEFAULT_TURN_TIMEOUT_MS;
  const scenarioTimeoutMs =
    scenario.scenario_timeout_ms ?? options.scenarioTimeoutMs ?? turnTimeoutMs * 5;
  const controller = new AbortController();
  const allEvents: EvidenceEvent[] = [];
  const failures: string[] = [];
  const observations: string[] = [];
  let timedOut = false;
  let infrastructureError = false;
  let deadline: ReturnType<typeof setTimeout> | undefined;

  try {
    deadline = setTimeout(() => {
      if (!controller.signal.aborted) controller.abort(new Error("scenario_timeout"));
    }, scenarioTimeoutMs);

    let turnCount = 0;
    for (const turn of scenario.input) {
      if (controller.signal.aborted) break;
      if (options.maxTurns !== undefined && turnCount >= options.maxTurns) break;
      turnCount += 1;
      const buffer = await runTurn(session, turn.user, turnTimeoutMs, controller);
      allEvents.push(...buffer.events);
      if (buffer.infrastructureError) {
        infrastructureError = true;
        failures.push(`infrastructure_error: ${buffer.infrastructureError}`);
        break;
      }
      if (buffer.timedOut) {
        timedOut = true;
        observations.push(`timeout: turn exceeded ${turnTimeoutMs}ms`);
        break;
      }
    }

    if (controller.signal.aborted && abortReasonCode(controller.signal) === "scenario_timeout") {
      timedOut = true;
      failures.push(`scenario_timeout: scenario exceeded ${scenarioTimeoutMs}ms wall-clock cap`);
    }
  } finally {
    if (deadline !== undefined) clearTimeout(deadline);
  }

  const response = allEvents
    .filter((event): event is Extract<EvidenceEvent, { type: "assistant_end" }> =>
      event.type === "assistant_end",
    )
    .map((event) => event.text)
    .join("\n");
  const measurementIncomplete = timedOut || infrastructureError;
  evaluateResponse(scenario, response, failures, observations, measurementIncomplete);
  evaluateTools(scenario, allEvents, failures, observations, measurementIncomplete);
  evaluateSkillActivations(scenario, allEvents, failures, measurementIncomplete);

  const inconclusive = timedOut && allEvents.length === 0;
  if (timedOut && !failures.some((failure) => failure.startsWith("scenario_timeout"))) {
    failures.push(`turn_timeout: turn exceeded ${turnTimeoutMs}ms`);
  }
  const { usage, modelReceipts } = collectUsage(allEvents);

  return {
    scenario: scenario.name,
    skill: scenario.skill,
    passed: failures.length === 0 && !inconclusive,
    inconclusive,
    failures,
    observations,
    latency_ms: Math.round(performance.now() - startedAt),
    token_in: usage.input,
    token_out: usage.output,
    cache_read: usage.cacheRead,
    cache_write: usage.cacheWrite,
    cost: usage.cost,
    timed_out: timedOut,
    infrastructure_error: infrastructureError,
    model_receipts: modelReceipts,
  };
}
