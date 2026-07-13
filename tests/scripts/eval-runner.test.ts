import { describe, expect, it } from "bun:test";
import {
  parseScenario,
  runScenario,
  type SessionLike,
} from "../../scripts/lib/eval-runner";
import type { EvidenceEvent } from "../../scripts/lib/omp-eval-event-adapter";

function scenario(expected: string, extra = ""): string {
  return `
name: runner-contract
skill: eval-runner
kind: positive
tag: smoke
${extra}
input:
  - turn: 1
    user: "exercise the contract"
expected:
${expected}
`.trim();
}

function sessionReturning(events: EvidenceEvent[]): SessionLike {
  return {
    subscribe(listener) {
      queueMicrotask(() => events.forEach(listener));
      return () => {};
    },
    async prompt() {},
  };
}

describe("eval-runner", () => {
  it("strictly parses the scenario contract and hard-fails a missing required response", async () => {
    expect(() =>
      parseScenario(
        scenario('  - response_must_contain: ["required phrase"]') + "\nunknown: true",
      ),
    ).toThrow();

    const verdict = await runScenario(
      parseScenario(scenario('  - response_must_contain: ["required phrase"]')),
      sessionReturning([
        { type: "assistant_end", text: "ok", at: 1 },
        { type: "turn_end", at: 2 },
      ]),
    );

    expect(verdict.passed).toBe(false);
    expect(verdict.failures.join("\n")).toMatch(/response_must_contain.*required phrase/i);
  });

  it("requires a matching tool call with deep-partial args and successful correlated end", async () => {
    const parsed = parseScenario(
      scenario(
        '  - tool_call_required: { namePattern: "^task$", args: { agent: "pov:executor" } }',
      ),
    );
    const wrongArgs = await runScenario(
      parsed,
      sessionReturning([
        { type: "tool_start", name: "task", args: { agent: "pov:planner" }, callId: "c1", at: 1 },
        { type: "tool_end", name: "task", callId: "c1", outcome: "success", at: 2 },
        { type: "turn_end", at: 3 },
      ]),
    );
    expect(wrongArgs.passed).toBe(false);

    const failedEnd = await runScenario(
      parsed,
      sessionReturning([
        { type: "tool_start", name: "task", args: { agent: "pov:executor", extra: true }, callId: "c2", at: 1 },
        { type: "tool_end", name: "task", callId: "c2", outcome: "error", at: 2 },
        { type: "turn_end", at: 3 },
      ]),
    );
    expect(failedEnd.passed).toBe(false);

    const successful = await runScenario(
      parsed,
      sessionReturning([
        { type: "tool_start", name: "task", args: { agent: "pov:executor", extra: true }, callId: "c3", at: 1 },
        { type: "tool_end", name: "task", callId: "c3", outcome: "success", at: 2 },
        { type: "turn_end", at: 3 },
      ]),
    );
    expect(successful.passed).toBe(true);
  });

  it("requires an exact skill activation/read receipt while observe fields stay non-gating", async () => {
    const parsed = parseScenario(
      scenario(`  - skill_activation_required: "pov:autonomous-loop"
  - observe_response_contains: ["optional"]
  - observe_tool_call: { namePattern: "^search$" }`),
    );
    const wrong = await runScenario(
      parsed,
      sessionReturning([
        { type: "skill_activation", skill: "autonomous-loop-extra", receipt: "read", at: 1 },
        { type: "assistant_end", text: "not optional", at: 2 },
        { type: "turn_end", at: 3 },
      ]),
    );
    expect(wrong.passed).toBe(false);
    expect(wrong.observations.join("\n")).toMatch(/observe_tool_call.*MISS/);

    const exact = await runScenario(
      parsed,
      sessionReturning([
        { type: "skill_activation", skill: "autonomous-loop", receipt: "read", at: 1 },
        { type: "assistant_end", text: "still not optional", at: 2 },
        { type: "turn_end", at: 3 },
      ]),
    );
    expect(exact.passed).toBe(true);
  });

  it("sums assistant and task-subagent usage deltas and records the exact provider/model", async () => {
    const verdict = await runScenario(
      parseScenario(scenario('  - response_must_contain: ["done"]')),
      sessionReturning([
        {
          type: "assistant_end",
          text: "done",
          usage: { input: 10, output: 4, cacheRead: 20, cacheWrite: 2, cost: 0.25 },
          model: { provider: "openai-codex", model: "gpt-5.4" },
          at: 1,
        },
        {
          type: "tool_end",
          name: "task",
          callId: "task-1",
          outcome: "success",
          usage: { input: 30, output: 9, cacheRead: 12, cacheWrite: 1, cost: 0.75 },
          at: 2,
        },
        { type: "turn_end", at: 3 },
      ]),
    );

    expect(verdict).toMatchObject({
      token_in: 40,
      token_out: 13,
      cache_read: 32,
      cache_write: 3,
      cost: 1,
      model_receipts: [{ provider: "openai-codex", model: "gpt-5.4" }],
    });
  });

  it("aborts a hung prompt at the deadline and always releases the subscription", async () => {
    let unsubscribed = 0;
    let promptAborted = 0;
    const hung: SessionLike = {
      subscribe() {
        return () => {
          unsubscribed += 1;
        };
      },
      async prompt(_message, options) {
        await new Promise<void>((_resolve, reject) => {
          options?.signal?.addEventListener(
            "abort",
            () => {
              promptAborted += 1;
              reject(new DOMException("aborted", "AbortError"));
            },
            { once: true },
          );
        });
      },
    };

    const verdict = await runScenario(
      parseScenario(scenario('  - response_must_contain: ["done"]')),
      hung,
      { turnTimeoutMs: 20, scenarioTimeoutMs: 100 },
    );

    expect(verdict).toMatchObject({ passed: false, timed_out: true, infrastructure_error: false });
    expect(verdict.failures.join("\n")).not.toMatch(/response_must_contain/);
    expect(promptAborted).toBe(1);
    expect(unsubscribed).toBe(1);
  });

  it("lets the scenario-level controller abort the active prompt before its turn deadline", async () => {
    let promptAborted = 0;
    const hung: SessionLike = {
      subscribe() {
        return () => {};
      },
      async prompt(_message, options) {
        await new Promise<void>((_resolve, reject) => {
          options?.signal?.addEventListener("abort", () => {
            promptAborted += 1;
            reject(new DOMException("aborted", "AbortError"));
          }, { once: true });
        });
      },
    };
    const verdict = await runScenario(
      parseScenario(scenario('  - response_must_contain: ["done"]')),
      hung,
      { turnTimeoutMs: 500, scenarioTimeoutMs: 20 },
    );
    expect(verdict.timed_out).toBe(true);
    expect(verdict.failures.join("\n")).toMatch(/scenario_timeout/);
    expect(promptAborted).toBe(1);
  });

  it("preserves prompt rejection as infrastructure failure evidence", async () => {
    let unsubscribed = 0;
    const broken: SessionLike = {
      subscribe() {
        return () => {
          unsubscribed += 1;
        };
      },
      async prompt() {
        throw new Error("provider unavailable");
      },
    };

    const verdict = await runScenario(
      parseScenario(scenario('  - response_must_contain: ["done"]')),
      broken,
      { turnTimeoutMs: 1_000 },
    );
    expect(verdict.infrastructure_error).toBe(true);
    expect(verdict.failures.join("\n")).toMatch(/infrastructure_error.*provider unavailable/i);
    expect(unsubscribed).toBe(1);
  });

  it("clears the successful scenario deadline without aborting the completed prompt signal", async () => {
    let signal: AbortSignal | undefined;
    const completed: SessionLike = {
      subscribe(listener) {
        queueMicrotask(() => {
          listener({ type: "assistant_end", text: "done", at: 1 });
          listener({ type: "turn_end", at: 2 });
        });
        return () => {};
      },
      async prompt(_message, options) {
        signal = options?.signal;
      },
    };
    const verdict = await runScenario(
      parseScenario(scenario('  - response_must_contain: ["done"]')),
      completed,
      { turnTimeoutMs: 50, scenarioTimeoutMs: 10 },
    );
    await Bun.sleep(25);
    expect(verdict.passed).toBe(true);
    expect(signal?.aborted).toBe(false);
  });
});
