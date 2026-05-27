import { describe, it, expect } from "bun:test";
import {
  EXPECTED_AGENT_COUNT,
  ROLES,
  PROFILE_A,
  PROFILE_B,
} from "../../../scripts/pi-oven-setup/profiles";

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
    it("executor.primary is opencode-zen/gpt-5.3-codex", () => {
      expect(PROFILE_A.executor.primary).toBe("opencode-zen/gpt-5.3-codex");
    });

    it("contains all 23 roles", () => {
      for (const role of ROLES) {
        expect(PROFILE_A[role]).toBeDefined();
      }
    });

    it("all entries use opencode-zen/ or openai-codex/ prefix for primary", () => {
      for (const role of ROLES) {
        const p = PROFILE_A[role].primary;
        const ok = p.startsWith("opencode-zen/") || p.startsWith("openai-codex/");
        expect(ok).toBe(true);
      }
    });

    it("all entries use opencode-zen/ or openai-codex/ prefix for registry_alternate", () => {
      for (const role of ROLES) {
        const p = PROFILE_A[role].registry_alternate;
        const ok = p.startsWith("opencode-zen/") || p.startsWith("openai-codex/");
        expect(ok).toBe(true);
      }
    });

    it("no anthropic/ prefix in any Profile A entry", () => {
      for (const role of ROLES) {
        expect(PROFILE_A[role].primary).not.toContain("anthropic/");
        expect(PROFILE_A[role].registry_alternate).not.toContain("anthropic/");
      }
    });
  });

  describe("PROFILE_B", () => {
    it("executor.primary is anthropic/claude-sonnet-4-6", () => {
      expect(PROFILE_B.executor.primary).toBe("anthropic/claude-sonnet-4-6");
    });

    it("contains all 23 roles", () => {
      for (const role of ROLES) {
        expect(PROFILE_B[role]).toBeDefined();
      }
    });

    it("all entries use anthropic/ or opencode-zen/ prefix for primary (no openai-codex)", () => {
      for (const role of ROLES) {
        const p = PROFILE_B[role].primary;
        const ok = p.startsWith("anthropic/") || p.startsWith("opencode-zen/");
        expect(ok).toBe(true);
      }
    });

    it("explorer keeps opencode-zen/glm-5 as primary in Profile B", () => {
      expect(PROFILE_B.explorer.primary).toBe("opencode-zen/glm-5");
    });

    it("librarian keeps opencode-zen/glm-5 as primary in Profile B", () => {
      expect(PROFILE_B.librarian.primary).toBe("opencode-zen/glm-5");
    });
  });
});
