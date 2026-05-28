import { describe, it, expect } from "bun:test";
import {
  EXPECTED_AGENT_COUNT,
  ROLES,
  PROFILE_A,
  PROFILE_B,
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

    it("EXPECTED_AGENT_COUNT is 23", () => {
      expect(EXPECTED_AGENT_COUNT).toBe(23);
    });
  });

  describe("PROFILE_A", () => {
    it("contains all 23 roles", () => {
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
  });

  describe("PROFILE_B", () => {
    it("contains all 23 roles", () => {
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
});
