import { describe, it, expect } from "bun:test";
import {
  EXPECTED_AGENT_COUNT,
  ROLES,
  PROFILE_A,
  PROFILE_B,
  PROFILE_A_ORCHESTRATOR,
  PROFILE_B_ORCHESTRATOR,
} from "../../../scripts/pi-oven-setup/profiles";

/**
 * profiles.test.ts — structural invariants only.
 * Model IDs and per-role assignments are tuning territory; they MUST NOT be
 * pinned here, or every routing experiment breaks the test suite. The rules
 * below describe the policy shape (provider prefixes, fallback wrapper,
 * thinking-level domain) rather than which model a specific role uses.
 */

describe("profiles", () => {
  describe("ROLES", () => {
    it("has exactly EXPECTED_AGENT_COUNT entries", () => {
      expect(ROLES.length).toBe(EXPECTED_AGENT_COUNT);
    });

    it("EXPECTED_AGENT_COUNT is 22", () => {
      expect(EXPECTED_AGENT_COUNT).toBe(22);
    });
  });

  describe("PROFILE_A", () => {
    it("contains all 22 roles", () => {
      for (const role of ROLES) {
        expect(PROFILE_A[role]).toBeDefined();
      }
    });

    it("all primaries use opencode-zen/, openai-codex/, or anthropic/ prefix", () => {
      for (const role of ROLES) {
        const p = PROFILE_A[role].primary;
        const ok =
          p.startsWith("opencode-zen/") ||
          p.startsWith("openai-codex/") ||
          p.startsWith("anthropic/");
        expect(ok).toBe(true);
      }
    });

    it("all registry_alternates use opencode-zen/ or openai-codex/ prefix", () => {
      // Default fallback policy is opencode-zen/ wrapper of the same model;
      // a small number of roles (planner) intentionally cross-route to
      // openai-codex/ for review/fan-out reasons. anthropic/ is never an
      // alternate because Anthropic auth is opt-in.
      for (const role of ROLES) {
        const p = PROFILE_A[role].registry_alternate;
        const ok =
          p.startsWith("opencode-zen/") || p.startsWith("openai-codex/");
        expect(ok).toBe(true);
      }
    });

    // Retired-model invariants: kimi-k2.6 and gpt-5.3-codex were swapped out of
    // PROFILE_A (kimi→glm-5.1 reasoning roles; gpt-5.3-codex→gpt-5.4 codex roles).
    // These pin the swap so a regression that reintroduces either id fails CI.
    it("executor/debugger/test-engineer primary is openai-codex/gpt-5.4", () => {
      for (const role of ["executor", "debugger", "test-engineer"] as const) {
        expect(PROFILE_A[role].primary).toBe("openai-codex/gpt-5.4");
      }
    });

    it("the 6 reasoning roles primary is opencode-zen/glm-5.1", () => {
      for (const role of [
        "verifier",
        "code-reviewer",
        "code-simplifier",
        "tracer",
        "analyst",
        "librarian",
      ] as const) {
        expect(PROFILE_A[role].primary).toBe("opencode-zen/glm-5.1");
      }
    });

    it("contains no kimi-k2.6 and no gpt-5.3-codex anywhere", () => {
      for (const role of ROLES) {
        const { primary, registry_alternate } = PROFILE_A[role];
        for (const id of [primary, registry_alternate]) {
          expect(id).not.toContain("kimi-k2.6");
          expect(id).not.toContain("gpt-5.3-codex");
        }
      }
    });
  });

  describe("PROFILE_B", () => {
    it("contains all 22 roles", () => {
      for (const role of ROLES) {
        expect(PROFILE_B[role]).toBeDefined();
      }
    });

    it("all primaries use anthropic/ or opencode-zen/ prefix (no openai-codex direct)", () => {
      for (const role of ROLES) {
        const p = PROFILE_B[role].primary;
        const ok = p.startsWith("anthropic/") || p.startsWith("opencode-zen/");
        expect(ok).toBe(true);
      }
    });
  });

  describe("thinkingLevel invariants", () => {
    it("PROFILE_A and PROFILE_B share thinkingLevel per role", () => {
      for (const role of ROLES) {
        expect(PROFILE_B[role].thinkingLevel).toBe(PROFILE_A[role].thinkingLevel);
      }
    });

    it("all thinkingLevel values are in the allowed set", () => {
      const allowed = new Set(["minimal", "low", "medium", "high", "xhigh"]);
      for (const role of ROLES) {
        expect(allowed.has(PROFILE_A[role].thinkingLevel)).toBe(true);
        expect(allowed.has(PROFILE_B[role].thinkingLevel)).toBe(true);
      }
    });
  });

  describe("orchestrator models", () => {
    it("PROFILE_A_ORCHESTRATOR sets the main session + title models", () => {
      expect(PROFILE_A_ORCHESTRATOR.default).toBe("openai-codex/gpt-5.4:high");
      expect(PROFILE_A_ORCHESTRATOR.title).toBe(
        "openai-codex/gpt-5.4-mini:low"
      );
    });

    it("PROFILE_B_ORCHESTRATOR reuses deferred-B anthropic ids", () => {
      expect(PROFILE_B_ORCHESTRATOR.default).toBe(
        "anthropic/claude-opus-4-7:high"
      );
      expect(PROFILE_B_ORCHESTRATOR.title).toBe(
        "anthropic/claude-haiku-4-5:low"
      );
    });
  });
});
