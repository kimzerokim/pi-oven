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
    it("returns verdict object with passed/false on assertion mismatch", async () => {
      // fakeSession mirrors real session.subscribe() + session.prompt() contract:
      // subscribe installs a listener that receives events; prompt() returns Promise<void>.
      const fakeSession: SessionLike = {
        subscribe(listener) {
          // Emit a fake tool_execution_start event synchronously after being subscribed,
          // then a text_delta message_update, then message_end — no tools called.
          // (called on next tick so subscribe() can return unsubscribe first)
          setTimeout(() => {
            listener({ type: "message_update", delta: "I will not search." });
            listener({ type: "message_end" });
          }, 0);
          return () => {};
        },
        async prompt(_msg: string): Promise<void> {
          // returns void — real SDK contract
        },
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
      expect(verdict.passed).toBe(false);
      expect(verdict.failures).toContain("tool_calls_required: search not invoked");
    });

    it("returns passed/true when tool_calls_required matches emitted tool", async () => {
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
    });

    it("fails when skill_triggered expects a specific token that is absent", async () => {
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
      expect(verdict.passed).toBe(false);
      expect(verdict.failures).toContain(
        'skill_triggered: expected "autonomous-loop" in tool calls or response content'
      );
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

    it("passes when skill_triggered expects a specific token that is present", async () => {
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
});
