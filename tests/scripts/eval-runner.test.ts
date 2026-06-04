import { describe, it, expect } from "bun:test";
import { parseScenario, runScenario, type SessionLike, type RunnerEvent } from "../../scripts/lib/eval-runner";

describe("eval-runner", () => {
  describe("parseScenario", () => {
    it("parses a smoke YAML scenario into typed object", () => {
      const yaml = `
name: test-smoke
skill: test-skill
tag: smoke
input:
  - turn: 1
    user: "hello"
expected:
  - skill_triggered: true
      `.trim();
      const parsed = parseScenario(yaml);
      expect(parsed.name).toBe("test-smoke");
      expect(parsed.tag).toBe("smoke");
      expect(parsed.input).toHaveLength(1);
      expect(parsed.expected[0].skill_triggered).toBe(true);
    });

    it("rejects scenario missing required fields", () => {
      const yaml = `name: bad`;
      expect(() => parseScenario(yaml)).toThrow(/missing required field/i);
    });
  });

  describe("runScenario", () => {
    it("records telemetry MISS for tool_calls_required when no match — PASSES (D1: telemetry, not gate)", async () => {
      // D1 contract: tool_calls_required is TELEMETRY. A miss records an observation but
      // does NOT fail the scenario. Use tool_calls_forbidden_first for hard gate checks.
      const fakeSession: SessionLike = {
        subscribe(listener) {
          setTimeout(() => {
            listener({ type: "message_update", delta: "I will not search." });
            listener({ type: "message_end" });
          }, 0);
          return () => {};
        },
        async prompt(_msg: string): Promise<void> {},
      };
      const scenario = parseScenario(`
name: t
skill: x
tag: smoke
input:
  - turn: 1
    user: "search"
expected:
  - tool_calls_required: ["search"]
      `.trim());
      const verdict = await runScenario(scenario, fakeSession);
      // D1: telemetry — passes even on miss
      expect(verdict.passed).toBe(true);
      expect(verdict.failures).toHaveLength(0);
      const obs = verdict.observations.join("\n");
      expect(obs).toMatch(/tool_required\[telemetry\].*search.*MISS/i);
    });

    it("records telemetry HIT for tool_calls_required when tool matches — PASSES", async () => {
      const fakeSession: SessionLike = {
        subscribe(listener) {
          setTimeout(() => {
            listener({ type: "tool_execution_start", toolName: "grep", toolCallId: "c1" });
            listener({ type: "message_update", delta: "Searching..." });
            listener({ type: "message_end" });
          }, 0);
          return () => {};
        },
        async prompt(_msg: string): Promise<void> {},
      };
      const scenario = parseScenario(`
name: t2
skill: x
tag: smoke
input:
  - turn: 1
    user: "search files"
expected:
  - tool_calls_required: ["grep"]
      `.trim());
      const verdict = await runScenario(scenario, fakeSession);
      expect(verdict.passed).toBe(true);
      // Under D1: telemetry hit recorded as observation
      const obs = verdict.observations.join("\n");
      expect(obs).toMatch(/tool_required\[telemetry\].*grep.*✓/i);
    });

    it("skill_triggered string form passes via liveness when activity exists (name-search removed)", async () => {
      // D1 contract: the string form of skill_triggered is liveness-only.
      // A session that produces tool calls + content passes regardless of whether
      // the skill name appears in those outputs. Use skill_read_required instead.
      const fakeSession: SessionLike = {
        subscribe(listener) {
          setTimeout(() => {
            listener({ type: "tool_execution_start", toolName: "task", toolCallId: "c1" });
            listener({ type: "message_update", delta: "running generic flow" });
            listener({ type: "message_end" });
          }, 0);
          return () => {};
        },
        async prompt(_msg: string): Promise<void> {},
      };
      const scenario = parseScenario(`
name: t3
skill: x
tag: smoke
input:
  - turn: 1
    user: "run"
expected:
  - skill_triggered: "autonomous-loop"
      `.trim());
      const verdict = await runScenario(scenario, fakeSession);
      // Passes via liveness (activity exists) — name-search is intentionally removed
      expect(verdict.passed).toBe(true);
    });

    it("fails when skill_triggered is false but activation evidence exists", async () => {
      const fakeSession: SessionLike = {
        subscribe(listener) {
          setTimeout(() => {
            listener({ type: "tool_execution_start", toolName: "task", toolCallId: "c1" });
            listener({ type: "message_update", delta: "response text" });
            listener({ type: "message_end" });
          }, 0);
          return () => {};
        },
        async prompt(_msg: string): Promise<void> {},
      };
      const scenario = parseScenario(`
name: t4
skill: x
tag: smoke
input:
  - turn: 1
    user: "run"
expected:
  - skill_triggered: false
      `.trim());
      const verdict = await runScenario(scenario, fakeSession);
      expect(verdict.passed).toBe(false);
      expect(verdict.failures).toContain(
        "skill_triggered: expected no activation evidence, but activation was observed"
      );
    });

    it("skill_triggered string form passes via liveness when tool calls exist (token value ignored)", async () => {
      const fakeSession: SessionLike = {
        subscribe(listener) {
          setTimeout(() => {
            listener({ type: "tool_execution_start", toolName: "autonomous-loop-check", toolCallId: "c1" });
            listener({ type: "message_update", delta: "ok" });
            listener({ type: "message_end" });
          }, 0);
          return () => {};
        },
        async prompt(_msg: string): Promise<void> {},
      };
      const scenario = parseScenario(`
name: t5
skill: x
tag: smoke
input:
  - turn: 1
    user: "run"
expected:
  - skill_triggered: "autonomous-loop"
      `.trim());
      const verdict = await runScenario(scenario, fakeSession);
      expect(verdict.passed).toBe(true);
    });

    it("passes when skill_triggered is false and no activation evidence exists", async () => {
      const fakeSession: SessionLike = {
        subscribe(listener) {
          setTimeout(() => {
            listener({ type: "message_end" });
          }, 0);
          return () => {};
        },
        async prompt(_msg: string): Promise<void> {},
      };
      const scenario = parseScenario(`
name: t6
skill: x
tag: smoke
input:
  - turn: 1
    user: "run"
expected:
  - skill_triggered: false
      `.trim());
      const verdict = await runScenario(scenario, fakeSession);
      expect(verdict.passed).toBe(true);
    });
  });

  describe("runScenario — abort-signal timeout (Issue 1)", () => {
    /**
     * RED: prompt() never settles (simulates a hung LLM stream).
     * The runner must ABORT the turn at turnTimeoutMs, set timedOut, and stop
     * the scenario — not hang forever.
     * The session's prompt() receives an AbortSignal that gets aborted when the
     * timer fires (so a real session.prompt would reject/resolve).
     */
    it("aborts a hung prompt() at turnTimeoutMs and timedOut stops the scenario", async () => {
      let receivedSignal: AbortSignal | undefined;
      let abortCalled = false;

      const fakeSession: SessionLike = {
        subscribe(listener) {
          // No events emitted — simulates a completely silent/hung stream
          return () => {};
        },
        async prompt(_msg: string, options?: { signal?: AbortSignal }): Promise<void> {
          receivedSignal = options?.signal;
          // Block forever unless the signal fires
          await new Promise<void>((resolve, reject) => {
            if (options?.signal?.aborted) {
              reject(new DOMException("aborted", "AbortError"));
              return;
            }
            options?.signal?.addEventListener("abort", () => {
              abortCalled = true;
              reject(new DOMException("aborted", "AbortError"));
            });
          });
        },
      };

      const scenario = parseScenario(`
name: abort-signal-test
skill: x
tag: smoke
input:
  - turn: 1
    user: "first"
  - turn: 2
    user: "second"
expected:
  - skill_triggered: false
      `.trim());

      const t0 = Date.now();
      const result = await Promise.race([
        runScenario(scenario, fakeSession, { turnTimeoutMs: 200 }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("HANG: runScenario did not complete within timeout")), 3000)
        ),
      ]);

      const elapsed = Date.now() - t0;
      // Must complete near turnTimeoutMs (not run the second turn)
      expect(elapsed).toBeLessThan(2000);
      // Should have received a signal
      expect(receivedSignal).toBeDefined();
      // Signal should have been aborted
      expect(abortCalled).toBe(true);
      // Scenario stops after first timedOut turn — only 1 turn attempted, result is a Verdict
      expect((result as { scenario: string }).scenario).toBe("abort-signal-test");
    });

    /**
     * RED: scenario with 2 turns — if turn 1 times out, turn 2 must NOT execute.
     * This verifies the `if (lastBuf.timedOut) break` guard.
     */
    it("does not execute subsequent turns after a timed-out turn", async () => {
      let promptCallCount = 0;

      const fakeSession: SessionLike = {
        subscribe(_listener) {
          return () => {};
        },
        async prompt(_msg: string, options?: { signal?: AbortSignal }): Promise<void> {
          promptCallCount++;
          // Block until aborted
          await new Promise<void>((resolve, reject) => {
            if (options?.signal?.aborted) {
              reject(new DOMException("aborted", "AbortError"));
              return;
            }
            options?.signal?.addEventListener("abort", () => {
              reject(new DOMException("aborted", "AbortError"));
            });
            // If no signal, just resolve immediately (shouldn't happen for turn 1 but guard)
            if (!options?.signal) resolve();
          });
        },
      };

      const scenario = parseScenario(`
name: two-turns
skill: x
tag: smoke
input:
  - turn: 1
    user: "first"
  - turn: 2
    user: "second"
expected:
  - skill_triggered: false
      `.trim());

      await Promise.race([
        runScenario(scenario, fakeSession, { turnTimeoutMs: 150 }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("HANG")), 2000)
        ),
      ]);

      // Only 1 prompt call — second turn was skipped due to timedOut break
      expect(promptCallCount).toBe(1);
    });
  });

  describe("runScenario — per-scenario wall-clock cap (Issue 3)", () => {
    /**
     * RED: a scenario with many turns each completing JUST under turnTimeoutMs
     * (so per-turn cap never fires) but whose TOTAL exceeds scenarioTimeoutMs.
     * Without a per-scenario cap the runner loops all turns; with the cap it must
     * stop early and return a timed-out verdict, then the outer runner continues.
     *
     * Implementation target: runScenario accepts options.scenarioTimeoutMs; when
     * the wall-clock for the whole scenario exceeds it, runScenario resolves with
     * a timed-out Verdict (passed:false, failures includes "scenario_timeout").
     */
    it("bounds a scenario whose total turns exceed scenarioTimeoutMs even though no single turn exceeds turnTimeoutMs", async () => {
      let promptCallCount = 0;

      // Each turn completes quickly (50ms), well under any turnTimeoutMs.
      // But with 10 turns * 50ms = ~500ms total, which exceeds scenarioTimeoutMs=200ms.
      const fakeSession: SessionLike = {
        subscribe(listener) {
          setTimeout(() => {
            listener({ type: "message_update", delta: "ok" });
            listener({ type: "message_end" });
          }, 50);
          return () => {};
        },
        async prompt(_msg: string): Promise<void> {},
      };

      const turns = Array.from({ length: 10 }, (_, i) => `  - turn: ${i + 1}\n    user: "msg${i + 1}"`).join("\n");
      const scenario = parseScenario(
        `name: scenario-deadline\nskill: x\ntag: smoke\ninput:\n${turns}\nexpected:\n  - skill_triggered: false`.trim()
      );

      const t0 = Date.now();
      const result = await Promise.race([
        runScenario(scenario, fakeSession, { turnTimeoutMs: 500, scenarioTimeoutMs: 200 }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("HANG: scenario-deadline cap did not fire")), 3000)
        ),
      ]);
      const elapsed = Date.now() - t0;

      // Must complete well under the sum of all turns (10 * 50ms = 500ms)
      expect(elapsed).toBeLessThan(450);
      // Scenario must be marked as failed (timed out)
      expect((result as { passed: boolean }).passed).toBe(false);
      expect((result as { failures: string[] }).failures.some((f) => f.includes("scenario_timeout"))).toBe(true);
      // Must not have run all 10 prompts (cap stopped it early)
      expect(promptCallCount).toBeLessThan(10);
    });

    it("continues to the next scenario after a scenario deadline fires", async () => {
      const results: Array<Awaited<ReturnType<typeof runScenario>>> = [];

      // Slow session: each turn takes 80ms
      const slowSession: SessionLike = {
        subscribe(listener) {
          setTimeout(() => {
            listener({ type: "message_update", delta: "slow" });
            listener({ type: "message_end" });
          }, 80);
          return () => {};
        },
        async prompt(_msg: string): Promise<void> {},
      };

      const mkScenario = (name: string, numTurns: number) => {
        const turns = Array.from({ length: numTurns }, (_, i) => `  - turn: ${i + 1}\n    user: "go"`).join("\n");
        return parseScenario(`name: ${name}\nskill: x\ntag: smoke\ninput:\n${turns}\nexpected:\n  - skill_triggered: false`.trim());
      };

      // Scenario 1: 5 turns * 80ms = 400ms total — exceeds scenarioTimeoutMs=150ms
      const verdict1 = await runScenario(mkScenario("slow-scenario", 5), slowSession, {
        turnTimeoutMs: 500,
        scenarioTimeoutMs: 150,
      });
      results.push(verdict1);

      // Scenario 2: 1 turn — should complete normally (fresh session simulated by fast turns)
      const fastSession: SessionLike = {
        subscribe(listener) {
          setTimeout(() => {
            listener({ type: "message_end" });
          }, 0);
          return () => {};
        },
        async prompt(_msg: string): Promise<void> {},
      };
      const verdict2 = await runScenario(mkScenario("fast-scenario", 1), fastSession, {
        turnTimeoutMs: 500,
        scenarioTimeoutMs: 5000,
      });
      results.push(verdict2);

      // Scenario 1 timed out
      expect(results[0].passed).toBe(false);
      expect(results[0].failures.some((f) => f.includes("scenario_timeout"))).toBe(true);
      // Scenario 2 passed (runner continued after scenario 1's deadline)
      expect(results[1].scenario).toBe("fast-scenario");
      expect(results[1].passed).toBe(true);
    });
  });

  describe("runScenario — session lifecycle fixes", () => {
    /**
     * RED: turn ends via 'error' event (non-message_end terminal).
     * The runner must NOT hang — must complete within the turn timeout.
     * The scenario must still return a Verdict (not throw / not hang forever).
     */
    it("completes without hanging when turn ends via non-message_end terminal event (error)", async () => {
      const fakeSession: SessionLike = {
        subscribe(listener) {
          setTimeout(() => {
            listener({ type: "message_update", delta: "partial" });
            // Emit 'error' terminal — NOT 'message_end'
            listener({ type: "error" });
          }, 0);
          return () => {};
        },
        async prompt(_msg: string): Promise<void> {},
      };
      const scenario = parseScenario(`
name: error-terminal
skill: x
tag: smoke
input:
  - turn: 1
    user: "trigger error"
expected:
  - skill_triggered: false
      `.trim());

      // Must resolve within 2 s (well under any ~23 min hang).
      const result = await Promise.race([
        runScenario(scenario, fakeSession),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("HANG: runScenario did not complete within timeout")), 2000)
        ),
      ]);
      // Should return a Verdict, not throw
      expect(result).toBeDefined();
      expect((result as { scenario: string }).scenario).toBe("error-terminal");
    });

    /**
     * RED: turn ends via 'abort' event (non-message_end terminal).
     * Second call to runScenario on the SAME session must also succeed
     * (per-scenario isolation or reset guard).
     */
    it("does not throw AgentBusyError on next scenario after abort-terminal turn", async () => {
      let callCount = 0;
      const listeners: Array<(e: RunnerEvent) => void> = [];

      const fakeSession: SessionLike = {
        subscribe(listener) {
          listeners.push(listener);
          return () => {
            const idx = listeners.indexOf(listener);
            if (idx !== -1) listeners.splice(idx, 1);
          };
        },
        async prompt(_msg: string): Promise<void> {
          callCount++;
          setTimeout(() => {
            for (const l of listeners) {
              if (callCount === 1) {
                // First scenario: ends via 'abort' — NOT 'message_end'
                l({ type: "message_update", delta: "aborting" });
                l({ type: "abort" });
              } else {
                // Second scenario: normal completion
                l({ type: "message_update", delta: "ok" });
                l({ type: "message_end" });
              }
            }
          }, 0);
        },
      };

      const mkScenario = (name: string) =>
        parseScenario(
          `name: ${name}\nskill: x\ntag: smoke\ninput:\n  - turn: 1\n    user: "go"\nexpected:\n  - skill_triggered: false`.trim()
        );

      // First scenario — ends via abort
      await Promise.race([
        runScenario(mkScenario("s1"), fakeSession),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("HANG on scenario 1")), 2000)
        ),
      ]);

      // Second scenario — must NOT throw AgentBusyError or hang
      const result2 = await Promise.race([
        runScenario(mkScenario("s2"), fakeSession),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("HANG on scenario 2 — AgentBusyError or stuck")), 2000)
        ),
      ]);
      expect((result2 as { scenario: string }).scenario).toBe("s2");
    });

    /**
     * RED: runScenario must complete within a finite timeout even if NO terminal
     * event is ever emitted (simulates a completely silent / dropped stream).
     */
    it("completes within timeout when no terminal event is ever emitted", async () => {
      const fakeSession: SessionLike = {
        subscribe(listener) {
          setTimeout(() => {
            // Only a partial update — no message_end, no error, no abort
            listener({ type: "message_update", delta: "stuck partial" });
          }, 0);
          return () => {};
        },
        async prompt(_msg: string): Promise<void> {},
      };
      const scenario = parseScenario(`
name: timeout-scenario
skill: x
tag: smoke
input:
  - turn: 1
    user: "silent"
expected:
  - skill_triggered: false
      `.trim());

      const result = await Promise.race([
        runScenario(scenario, fakeSession, { turnTimeoutMs: 300 }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("HANG: no terminal event and no timeout fired")), 2000)
        ),
      ]);
      expect((result as { scenario: string }).scenario).toBe("timeout-scenario");
    });
  });

  describe("runScenario — skill_read_required (D1 contract)", () => {
    it("PASSES when toolCalls contains a read of skill://<name>", async () => {
      const fakeSession: SessionLike = {
        subscribe(listener) {
          setTimeout(() => {
            // omp records skill body load as a read of skill://<name>
            listener({ type: "tool_execution_start", toolName: "read skill://codebase-survey", toolCallId: "c1" });
            listener({ type: "message_update", delta: "loaded skill" });
            listener({ type: "message_end" });
          }, 0);
          return () => {};
        },
        async prompt(_msg: string): Promise<void> {},
      };
      const scenario = parseScenario(`
name: skill-read-pass
skill: codebase-survey
tag: smoke
input:
  - turn: 1
    user: "survey the codebase"
expected:
  - skill_read_required: "codebase-survey"
      `.trim());
      const verdict = await runScenario(scenario, fakeSession);
      expect(verdict.passed).toBe(true);
    });

    it("soft default: PASSES (non-blocking observation) when no read of skill://<name> in toolCalls", async () => {
      // D1 contract update: skill_read_required is soft by default — a missing
      // read is a non-blocking observation, NOT a failure. Behavioral assertions
      // (agent_response_must_contain / tool_calls_required) are the gate.
      const fakeSession: SessionLike = {
        subscribe(listener) {
          setTimeout(() => {
            // Only content mention — no skill:// read in tool calls
            listener({ type: "message_update", delta: "I will run codebase-survey now" });
            listener({ type: "message_end" });
          }, 0);
          return () => {};
        },
        async prompt(_msg: string): Promise<void> {},
      };
      const scenario = parseScenario(`
name: skill-read-soft-no-read
skill: codebase-survey
tag: smoke
input:
  - turn: 1
    user: "survey the codebase"
expected:
  - skill_read_required: "codebase-survey"
      `.trim());
      const verdict = await runScenario(scenario, fakeSession);
      // Soft mode: missing read is not a failure
      expect(verdict.passed).toBe(true);
      // An observation records the missing read
      expect(verdict.observations.join("\n")).toMatch(/skill_read.*codebase-survey.*NOT read/i);
    });

    it("hard mode: FAILS when no read of skill://<name> is in toolCalls", async () => {
      // skill_read_required_mode:"hard" restores the blocking-gate behavior for
      // cases where loading the body is genuinely load-bearing.
      const fakeSession: SessionLike = {
        subscribe(listener) {
          setTimeout(() => {
            listener({ type: "message_update", delta: "I will run codebase-survey now" });
            listener({ type: "message_end" });
          }, 0);
          return () => {};
        },
        async prompt(_msg: string): Promise<void> {},
      };
      const scenario = parseScenario(`
name: skill-read-hard-fail
skill: codebase-survey
tag: smoke
input:
  - turn: 1
    user: "survey the codebase"
expected:
  - skill_read_required: "codebase-survey"
    skill_read_required_mode: "hard"
      `.trim());
      const verdict = await runScenario(scenario, fakeSession);
      expect(verdict.passed).toBe(false);
      expect(verdict.failures).toContain(
        'skill_read_required(hard): skill://codebase-survey not read (no matching tool call found)'
      );
    });

    it("soft default: PASSES (non-blocking) when a different skill was read", async () => {
      // Soft mode: reading a different skill is still just an observation.
      const fakeSession: SessionLike = {
        subscribe(listener) {
          setTimeout(() => {
            listener({ type: "tool_execution_start", toolName: "read skill://other-skill", toolCallId: "c1" });
            listener({ type: "message_end" });
          }, 0);
          return () => {};
        },
        async prompt(_msg: string): Promise<void> {},
      };
      const scenario = parseScenario(`
name: skill-read-soft-wrong
skill: codebase-survey
tag: smoke
input:
  - turn: 1
    user: "survey the codebase"
expected:
  - skill_read_required: "codebase-survey"
      `.trim());
      const verdict = await runScenario(scenario, fakeSession);
      expect(verdict.passed).toBe(true);
      expect(verdict.observations.join("\n")).toMatch(/skill_read.*codebase-survey.*NOT read/i);
    });

    it("skill_triggered string form no longer searches tool names or content", async () => {
      // Under the NEW contract, skill_triggered:string is removed as a signal.
      // This test documents that the string form is gone: parseScenario still parses it
      // (backward-compat schema), but runScenario ignores the string value and treats it
      // as a liveness check (same as skill_triggered:true).
      const fakeSession: SessionLike = {
        subscribe(listener) {
          setTimeout(() => {
            // Tool name happens to contain the skill name — old code passed this
            listener({ type: "tool_execution_start", toolName: "autonomous-loop-check", toolCallId: "c1" });
            listener({ type: "message_update", delta: "ok" });
            listener({ type: "message_end" });
          }, 0);
          return () => {};
        },
        async prompt(_msg: string): Promise<void> {},
      };
      // skill_triggered:"autonomous-loop" — under old code: passes (name in toolName)
      // Under new code: treated as liveness (any activity) — also passes since there IS activity
      // The key assertion: the old name-search path is gone; this passes only via liveness
      const scenario = parseScenario(`
name: skill-triggered-liveness-only
skill: x
tag: smoke
input:
  - turn: 1
    user: "run"
expected:
  - skill_triggered: "autonomous-loop"
      `.trim());
      const verdict = await runScenario(scenario, fakeSession);
      // Passes via liveness (activity exists) not via name-search
      expect(verdict.passed).toBe(true);
    });
  });

  describe("runScenario — per-scenario turn_timeout_ms field (T1)", () => {
    it("T1: scenario with turn_timeout_ms:250 times out at ~250ms without hanging to 90s", async () => {
      // Session never emits a terminal event — simulates hung stream
      const fakeSession: SessionLike = {
        subscribe(_listener) {
          return () => {};
        },
        async prompt(_msg: string, options?: { signal?: AbortSignal }): Promise<void> {
          await new Promise<void>((resolve, reject) => {
            if (options?.signal?.aborted) {
              reject(new DOMException("aborted", "AbortError"));
              return;
            }
            options?.signal?.addEventListener("abort", () => {
              reject(new DOMException("aborted", "AbortError"));
            });
            if (!options?.signal) resolve();
          });
        },
      };

      const yaml = `
name: timeout-override-test
skill: x
tag: smoke
turn_timeout_ms: 250
input:
  - turn: 1
    user: "go"
expected:
  - skill_triggered: false
      `.trim();
      const scenario = parseScenario(yaml);

      const t0 = Date.now();
      const result = await Promise.race([
        runScenario(scenario, fakeSession),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("HANG: did not complete within 3s")), 3000)
        ),
      ]);
      const elapsed = Date.now() - t0;

      // Must time out near 250ms, not at 90_000ms
      expect(elapsed).toBeLessThan(2000);
      // Scenario name preserved in result
      expect((result as { scenario: string }).scenario).toBe("timeout-override-test");
    });
  });

  describe("runScenario — skill_read_required soft/hard mode (T2–T5)", () => {
    it("T2: soft default — missing read is non-blocking when behavior assertion passes", async () => {
      const fakeSession: SessionLike = {
        subscribe(listener) {
          setTimeout(() => {
            // Content contains "hypothesis" but toolCalls do NOT include skill://deep-dive
            listener({ type: "message_update", delta: "hypothesis: the system is correct" });
            listener({ type: "message_end" });
          }, 0);
          return () => {};
        },
        async prompt(_msg: string): Promise<void> {},
      };

      const scenario = parseScenario(`
name: soft-mode-pass
skill: deep-dive
tag: smoke
input:
  - turn: 1
    user: "investigate"
expected:
  - skill_read_required: "deep-dive"
    agent_response_must_contain: ["hypothesis"]
    agent_response_must_contain_match: "any"
      `.trim());

      const verdict = await runScenario(scenario, fakeSession);
      expect(verdict.passed).toBe(true);
      // An observation must mention the skill_read NOT read (soft signal)
      const obs = verdict.observations.join("\n");
      expect(obs).toMatch(/skill_read.*deep-dive.*NOT read/i);
    });

    it("T3: soft default — read present records positive observation, passes", async () => {
      const fakeSession: SessionLike = {
        subscribe(listener) {
          setTimeout(() => {
            listener({ type: "tool_execution_start", toolName: "read skill://deep-dive", toolCallId: "c1" });
            listener({ type: "message_update", delta: "hypothesis: confirmed" });
            listener({ type: "message_end" });
          }, 0);
          return () => {};
        },
        async prompt(_msg: string): Promise<void> {},
      };

      const scenario = parseScenario(`
name: soft-mode-read-present
skill: deep-dive
tag: smoke
input:
  - turn: 1
    user: "investigate"
expected:
  - skill_read_required: "deep-dive"
    agent_response_must_contain: ["hypothesis"]
    agent_response_must_contain_match: "any"
      `.trim());

      const verdict = await runScenario(scenario, fakeSession);
      expect(verdict.passed).toBe(true);
      const obs = verdict.observations.join("\n");
      // Observation must say read confirmed (not "NOT read")
      expect(obs).toMatch(/skill_read.*deep-dive.*✓/i);
    });

    it("T4: hard mode — missing read is a failure", async () => {
      const fakeSession: SessionLike = {
        subscribe(listener) {
          setTimeout(() => {
            listener({ type: "message_update", delta: "some output without reading skill" });
            listener({ type: "message_end" });
          }, 0);
          return () => {};
        },
        async prompt(_msg: string): Promise<void> {},
      };

      const scenario = parseScenario(`
name: hard-mode-fail
skill: deep-dive
tag: smoke
input:
  - turn: 1
    user: "investigate"
expected:
  - skill_read_required: "deep-dive"
    skill_read_required_mode: "hard"
      `.trim());

      const verdict = await runScenario(scenario, fakeSession);
      expect(verdict.passed).toBe(false);
      const failuresText = verdict.failures.join("\n");
      expect(failuresText).toMatch(/skill_read_required\(hard\)/);
    });

    it("T5: positive must_contain MISS is telemetry, not a gate — scenario PASSES", async () => {
      // D1 contract: agent_response_must_contain is TELEMETRY (non-failing).
      // A scenario with only a positive behavioral miss (must_contain) and no negative
      // violation still passes. The miss is recorded as an observation, not a failure.
      const fakeSession: SessionLike = {
        subscribe(listener) {
          setTimeout(() => {
            // Content does NOT contain "needle"; toolCalls do NOT include skill://x
            listener({ type: "message_update", delta: "unrelated output" });
            listener({ type: "message_end" });
          }, 0);
          return () => {};
        },
        async prompt(_msg: string): Promise<void> {},
      };

      const scenario = parseScenario(`
name: soft-behavior-gate
skill: x
tag: smoke
input:
  - turn: 1
    user: "investigate"
expected:
  - skill_read_required: "x"
    agent_response_must_contain: ["needle"]
      `.trim());

      const verdict = await runScenario(scenario, fakeSession);
      // D1: positive must_contain miss is TELEMETRY → scenario passes
      expect(verdict.passed).toBe(true);
      // The miss must be recorded as a telemetry observation
      const obs = verdict.observations.join("\n");
      expect(obs).toMatch(/response_contains\[telemetry\].*MISS.*needle/i);
      // No failures attributed to must_contain
      const failuresText = verdict.failures.join("\n");
      expect(failuresText).not.toMatch(/agent_response_must_contain/i);
    });
  });

  describe("runScenario — agent_response_must_contain TELEMETRY (D1 contract)", () => {
    // D1: agent_response_must_contain is TELEMETRY — hits and misses are recorded as
    // observations, never as failures. The scenario passes regardless.

    it("records telemetry HIT when match:any and at least one phrase is present", async () => {
      const fakeSession: SessionLike = {
        subscribe(listener) {
          setTimeout(() => {
            listener({ type: "message_update", delta: "autonomous-loop activated" });
            listener({ type: "message_end" });
          }, 0);
          return () => {};
        },
        async prompt(_msg: string): Promise<void> {},
      };
      const scenario = parseScenario(`
name: any-of-telemetry-hit
skill: x
tag: smoke
input:
  - turn: 1
    user: "run"
expected:
  - agent_response_must_contain: ["autonomous-loop", "self-improve", "bugfix"]
    agent_response_must_contain_match: "any"
      `.trim());
      const verdict = await runScenario(scenario, fakeSession);
      // D1: telemetry — passes regardless of hit/miss
      expect(verdict.passed).toBe(true);
      // Must record the hit as a telemetry observation
      const obs = verdict.observations.join("\n");
      expect(obs).toMatch(/response_contains\[telemetry\].*matched/i);
    });

    it("records telemetry MISS when match:any and none of the phrases are present — still PASSES", async () => {
      const fakeSession: SessionLike = {
        subscribe(listener) {
          setTimeout(() => {
            listener({ type: "message_update", delta: "some unrelated output" });
            listener({ type: "message_end" });
          }, 0);
          return () => {};
        },
        async prompt(_msg: string): Promise<void> {},
      };
      const scenario = parseScenario(`
name: any-of-telemetry-miss
skill: x
tag: smoke
input:
  - turn: 1
    user: "run"
expected:
  - agent_response_must_contain: ["autonomous-loop", "self-improve", "bugfix"]
    agent_response_must_contain_match: "any"
      `.trim());
      const verdict = await runScenario(scenario, fakeSession);
      // D1: telemetry — PASSES even when none found
      expect(verdict.passed).toBe(true);
      expect(verdict.failures).toHaveLength(0);
      // Miss recorded as telemetry observation
      const obs = verdict.observations.join("\n");
      expect(obs).toMatch(/response_contains\[telemetry\].*MISS/i);
    });

    it("records telemetry MISS for each missing phrase in all-of mode — still PASSES", async () => {
      const fakeSession: SessionLike = {
        subscribe(listener) {
          setTimeout(() => {
            listener({ type: "message_update", delta: "autonomous-loop activated" });
            listener({ type: "message_end" });
          }, 0);
          return () => {};
        },
        async prompt(_msg: string): Promise<void> {},
      };
      const scenario = parseScenario(`
name: all-of-telemetry-miss
skill: x
tag: smoke
input:
  - turn: 1
    user: "run"
expected:
  - agent_response_must_contain: ["autonomous-loop", "self-improve"]
      `.trim());
      const verdict = await runScenario(scenario, fakeSession);
      // D1: telemetry — PASSES even when "self-improve" is missing
      expect(verdict.passed).toBe(true);
      expect(verdict.failures).toHaveLength(0);
      // MISS for "self-improve" recorded as observation
      const obs = verdict.observations.join("\n");
      expect(obs).toMatch(/response_contains\[telemetry\].*MISS.*self-improve/i);
    });
  });

  describe("runScenario — D1 new gates (negative/safety + liveness)", () => {
    it("HARD GATE: agent_response_must_not_contain forbidden substring → passed===false", async () => {
      // This is the omp-native violation detector: e.g. detecting "oh-my-claudecode:"
      const fakeSession: SessionLike = {
        subscribe(listener) {
          setTimeout(() => {
            listener({ type: "message_update", delta: "I will use oh-my-claudecode: to do this" });
            listener({ type: "message_end" });
          }, 0);
          return () => {};
        },
        async prompt(_msg: string): Promise<void> {},
      };
      const scenario = parseScenario(`
name: negative-gate-fail
skill: x
tag: smoke
input:
  - turn: 1
    user: "run"
expected:
  - agent_response_must_not_contain: ["oh-my-claudecode:"]
      `.trim());
      const verdict = await runScenario(scenario, fakeSession);
      expect(verdict.passed).toBe(false);
      const failuresText = verdict.failures.join("\n");
      expect(failuresText).toMatch(/agent_response_must_not_contain.*oh-my-claudecode:/i);
    });

    it("HARD GATE: tool_calls_forbidden_first violation → passed===false", async () => {
      const fakeSession: SessionLike = {
        subscribe(listener) {
          setTimeout(() => {
            listener({ type: "tool_execution_start", toolName: "oh-my-claudecode:executor", toolCallId: "c1" });
            listener({ type: "message_update", delta: "dispatching" });
            listener({ type: "message_end" });
          }, 0);
          return () => {};
        },
        async prompt(_msg: string): Promise<void> {},
      };
      const scenario = parseScenario(`
name: forbidden-first-fail
skill: x
tag: smoke
input:
  - turn: 1
    user: "run"
expected:
  - tool_calls_forbidden_first: ["oh-my-claudecode:"]
      `.trim());
      const verdict = await runScenario(scenario, fakeSession);
      expect(verdict.passed).toBe(false);
      const failuresText = verdict.failures.join("\n");
      expect(failuresText).toMatch(/tool_calls_forbidden_first/i);
    });

    it("TELEMETRY: tool_calls_required MISS records observation but PASSES", async () => {
      const fakeSession: SessionLike = {
        subscribe(listener) {
          setTimeout(() => {
            listener({ type: "message_update", delta: "I decided not to search" });
            listener({ type: "message_end" });
          }, 0);
          return () => {};
        },
        async prompt(_msg: string): Promise<void> {},
      };
      const scenario = parseScenario(`
name: tool-required-telemetry-miss
skill: x
tag: smoke
input:
  - turn: 1
    user: "search"
expected:
  - tool_calls_required: ["grep"]
      `.trim());
      const verdict = await runScenario(scenario, fakeSession);
      // D1: tool_calls_required is TELEMETRY — PASSES on miss
      expect(verdict.passed).toBe(true);
      expect(verdict.failures).toHaveLength(0);
      const obs = verdict.observations.join("\n");
      expect(obs).toMatch(/tool_required\[telemetry\].*grep.*MISS/i);
    });

    it("LIVENESS: empty content AND zero tool calls AND not timed out → passed===false", async () => {
      // A turn that produced absolutely nothing (not even a timeout) is a liveness failure
      const fakeSession: SessionLike = {
        subscribe(listener) {
          setTimeout(() => {
            // message_end with no prior content or tools
            listener({ type: "message_end" });
          }, 0);
          return () => {};
        },
        async prompt(_msg: string): Promise<void> {},
      };
      const scenario = parseScenario(`
name: liveness-fail
skill: x
tag: smoke
input:
  - turn: 1
    user: "run"
expected:
  - skill_triggered: true
      `.trim());
      const verdict = await runScenario(scenario, fakeSession);
      expect(verdict.passed).toBe(false);
      const failuresText = verdict.failures.join("\n");
      expect(failuresText).toMatch(/liveness/i);
    });

    it("INCONCLUSIVE: timed-out turn with empty content → verdict.inconclusive===true, passed===false, no behavioral failure", async () => {
      // A turn that timed out with empty content is INCONCLUSIVE — not a skill failure
      const fakeSession: SessionLike = {
        subscribe(_listener) {
          // Never emits any event — simulates totally hung stream
          return () => {};
        },
        async prompt(_msg: string, options?: { signal?: AbortSignal }): Promise<void> {
          // Block until aborted
          await new Promise<void>((_resolve, reject) => {
            if (options?.signal?.aborted) {
              reject(new DOMException("aborted", "AbortError"));
              return;
            }
            options?.signal?.addEventListener("abort", () => {
              reject(new DOMException("aborted", "AbortError"));
            });
          });
        },
      };
      const scenario = parseScenario(`
name: inconclusive-test
skill: x
tag: smoke
turn_timeout_ms: 150
input:
  - turn: 1
    user: "run"
expected:
  - agent_response_must_contain: ["some phrase"]
    agent_response_must_not_contain: ["forbidden"]
      `.trim());

      const verdict = await Promise.race([
        runScenario(scenario, fakeSession),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("HANG: inconclusive test did not complete")), 3000)
        ),
      ]);
      // Must be inconclusive
      expect((verdict as { inconclusive: boolean }).inconclusive).toBe(true);
      // passed must be false when inconclusive
      expect((verdict as { passed: boolean }).passed).toBe(false);
      // Failures must NOT contain behavioral assertions (the miss is inconclusive, not a violation)
      const failuresText = (verdict as { failures: string[] }).failures.join("\n");
      expect(failuresText).not.toMatch(/agent_response_must_contain/i);
      expect(failuresText).not.toMatch(/agent_response_must_not_contain/i);
    });
  });
});
