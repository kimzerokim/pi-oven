import { describe, expect, it } from "bun:test";
import {
  DEFAULT_FALLBACK_CHAINS,
  DEFAULT_ORCHESTRATOR,
  DEFAULT_PROFILE,
  EXPECTED_AGENT_COUNT,
  ROLES,
} from "../../../scripts/pi-oven-setup/profiles";

describe("DEFAULT_PROFILE", () => {
  it("covers every shipped role with openai-codex primaries only", () => {
    expect(ROLES.length).toBe(EXPECTED_AGENT_COUNT);
    for (const role of ROLES) {
      expect(DEFAULT_PROFILE[role]).toBeDefined();
      expect(DEFAULT_PROFILE[role].primary).toMatch(/^openai-codex\//);
      expect(DEFAULT_PROFILE[role].primary).not.toContain("mini");
      expect(DEFAULT_PROFILE[role].primary).not.toContain("nano");
    }
  });

  it("uses the balanced reasoning tiers", () => {
    const xhigh = new Set([
      "verifier",
      "critic",
      "security-reviewer",
      "oracle",
      "deep-researcher",
    ]);
    const high = new Set([
      "executor",
      "planner",
      "code-reviewer",
      "debugger",
      "test-engineer",
      "architect",
      "code-simplifier",
      "tracer",
      "analyst",
      "metis",
      "designer",
      "qa-tester",
      "data-runner",
    ]);

    for (const role of ROLES) {
      const level = DEFAULT_PROFILE[role].thinkingLevel;
      if (xhigh.has(role)) expect(level).toBe("xhigh");
      else if (high.has(role)) expect(level).toBe("high");
      else expect(level).toBe("medium");
    }
  });

  it("declares explicit tool lists and no tool/block overlap", () => {
    for (const role of ROLES) {
      const entry = DEFAULT_PROFILE[role];
      expect(entry.tools.length).toBeGreaterThan(0);
      expect(entry.tools).not.toContain("*");
      for (const blocked of entry.blocked_tools) {
        expect(entry.tools).not.toContain(blocked);
      }
    }
  });
});

describe("default orchestrator routing", () => {
  it("uses codex-only orchestrator selectors and empty fallback chains", () => {
    expect(DEFAULT_ORCHESTRATOR).toEqual({
      default: "openai-codex/gpt-5.4:high",
      title: "openai-codex/gpt-5.4:medium",
    });
    expect(DEFAULT_FALLBACK_CHAINS).toEqual({ default: [], title: [] });
  });
});
