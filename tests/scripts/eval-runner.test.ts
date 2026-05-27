import { describe, it, expect } from "bun:test";
import { parseScenario, runScenario, type SessionLike } from "../../scripts/lib/eval-runner";

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
  });
});
