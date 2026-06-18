import { describe, it, expect } from "bun:test";
import {
  EXPECTED_AGENT_COUNT,
  ROLES,
  PROFILE_A,
  PROFILE_B,
  PROFILE_A_ORCHESTRATOR,
  PROFILE_B_ORCHESTRATOR,
  PROFILE_C,
  PROFILE_C_ORCHESTRATOR,
  PROFILE_C_FALLBACK_CHAINS,
  PROFILE_A_FALLBACK_CHAINS,
  PROFILE_B_FALLBACK_CHAINS,
  PROFILE_D,
  PROFILE_D_ORCHESTRATOR,
  PROFILE_D_FALLBACK_CHAINS,
  type Role,
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

    it("EXPECTED_AGENT_COUNT is 24", () => {
      expect(EXPECTED_AGENT_COUNT).toBe(24);
    });
  });

  describe("PROFILE_A", () => {
    it("contains all 24 roles", () => {
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

    it("all registry_alternates use opencode-zen/, openai-codex/, or anthropic/ prefix", () => {
      // Default fallback policy is opencode-zen/ wrapper of the same model;
      // a small number of roles (planner) intentionally cross-route to openai-codex/.
      // Vision roles (multimodal-looker, qa-tester) use anthropic/claude-sonnet-4-6 as
      // alternate for vision capability + enabled status.
      for (const role of ROLES) {
        const p = PROFILE_A[role].registry_alternate;
        const ok =
          p.startsWith("opencode-zen/") ||
          p.startsWith("openai-codex/") ||
          p.startsWith("anthropic/");
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

    // openai-codex primary + opencode-zen fallback on the SAME gpt-5.4 (not the
    // -pro variant): both providers carry gpt-5.4, so the frontmatter model array
    // resolves openai-codex-first with opencode-zen fallback.
    it("executor/debugger/test-engineer alternate is opencode-zen/gpt-5.4", () => {
      for (const role of ["executor", "debugger", "test-engineer"] as const) {
        expect(PROFILE_A[role].registry_alternate).toBe("opencode-zen/gpt-5.4");
      }
    });

    // PROFILE_A model routing — new assignments (v0.1.7+)
    it("explorer primary is opencode-zen/minimax-m2.5", () => {
      expect(PROFILE_A["explorer"].primary).toBe("opencode-zen/minimax-m2.5");
    });

    it("explorer registry_alternate is opencode-zen/glm-5.1", () => {
      expect(PROFILE_A["explorer"].registry_alternate).toBe("opencode-zen/glm-5.1");
    });

    it("code-reviewer primary is opencode-zen/kimi-k2.6", () => {
      expect(PROFILE_A["code-reviewer"].primary).toBe("opencode-zen/kimi-k2.6");
    });

    it("verifier primary is opencode-zen/kimi-k2.6", () => {
      expect(PROFILE_A["verifier"].primary).toBe("opencode-zen/kimi-k2.6");
    });

    it("analyst primary is opencode-zen/kimi-k2.6", () => {
      expect(PROFILE_A["analyst"].primary).toBe("opencode-zen/kimi-k2.6");
    });

    it("tracer primary is opencode-zen/kimi-k2.6", () => {
      expect(PROFILE_A["tracer"].primary).toBe("opencode-zen/kimi-k2.6");
    });

    it("verifier/code-reviewer/analyst/tracer registry_alternate is opencode-zen/glm-5.1", () => {
      for (const role of ["verifier", "code-reviewer", "analyst", "tracer"] as const) {
        expect(PROFILE_A[role].registry_alternate).toBe("opencode-zen/glm-5.1");
      }
    });

    it("multimodal-looker primary is openai-codex/gpt-5.4-mini", () => {
      expect(PROFILE_A["multimodal-looker"].primary).toBe("openai-codex/gpt-5.4-mini");
    });

    it("multimodal-looker registry_alternate is anthropic/claude-sonnet-4-6", () => {
      expect(PROFILE_A["multimodal-looker"].registry_alternate).toBe("anthropic/claude-sonnet-4-6");
    });

    it("qa-tester primary is openai-codex/gpt-5.4-mini", () => {
      expect(PROFILE_A["qa-tester"].primary).toBe("openai-codex/gpt-5.4-mini");
    });

    it("qa-tester registry_alternate is anthropic/claude-sonnet-4-6", () => {
      expect(PROFILE_A["qa-tester"].registry_alternate).toBe("anthropic/claude-sonnet-4-6");
    });

    it("git-master primary is opencode-zen/minimax-m2.5", () => {
      expect(PROFILE_A["git-master"].primary).toBe("opencode-zen/minimax-m2.5");
    });

    it("git-master registry_alternate is opencode-zen/glm-5.1", () => {
      expect(PROFILE_A["git-master"].registry_alternate).toBe("opencode-zen/glm-5.1");
    });

    it("code-simplifier primary is opencode-zen/glm-5.1", () => {
      expect(PROFILE_A["code-simplifier"].primary).toBe("opencode-zen/glm-5.1");
    });

    it("code-simplifier registry_alternate is opencode-zen/minimax-m2.5", () => {
      expect(PROFILE_A["code-simplifier"].registry_alternate).toBe("opencode-zen/minimax-m2.5");
    });

    it("librarian primary is opencode-zen/minimax-m2.5", () => {
      expect(PROFILE_A["librarian"].primary).toBe("opencode-zen/minimax-m2.5");
    });

    it("librarian registry_alternate is opencode-zen/glm-5.1", () => {
      expect(PROFILE_A["librarian"].registry_alternate).toBe("opencode-zen/glm-5.1");
    });

    it("designer primary is opencode-zen/glm-5.1", () => {
      expect(PROFILE_A["designer"].primary).toBe("opencode-zen/glm-5.1");
    });

    it("designer registry_alternate is opencode-zen/minimax-m2.5", () => {
      expect(PROFILE_A["designer"].registry_alternate).toBe("opencode-zen/minimax-m2.5");
    });

    it("writer primary is opencode-zen/minimax-m2.5", () => {
      expect(PROFILE_A["writer"].primary).toBe("opencode-zen/minimax-m2.5");
    });

    it("document-specialist primary is opencode-zen/minimax-m2.5", () => {
      expect(PROFILE_A["document-specialist"].primary).toBe("opencode-zen/minimax-m2.5");
    });

    it("deep-researcher primary is opencode-zen/minimax-m2.5", () => {
      expect(PROFILE_A["deep-researcher"].primary).toBe("opencode-zen/minimax-m2.5");
    });

    it("contains no gpt-5.3-codex anywhere", () => {
      for (const role of ROLES) {
        const { primary, registry_alternate } = PROFILE_A[role];
        for (const id of [primary, registry_alternate]) {
          expect(id).not.toContain("gpt-5.3-codex");
        }
      }
    });

    // Disabled-model invariants: no PROFILE_A primary or alternate may use a disabled model
    it("no primary or registry_alternate is a disabled model", () => {
      const DISABLED = new Set([
        "opencode-zen/qwen3.5-plus",
        "opencode-zen/qwen3.6-plus",
        "opencode-zen/glm-5",
        "opencode-zen/claude-opus-4-8",
        "opencode-zen/claude-sonnet-4-6",
        "opencode-zen/claude-haiku-4-5",
      ]);
      for (const role of ROLES) {
        const { primary, registry_alternate } = PROFILE_A[role];
        expect(DISABLED.has(primary)).toBe(false);
        expect(DISABLED.has(registry_alternate)).toBe(false);
      }
    });

    // Advisory (anthropic) roles whose alternate was previously opencode-zen/claude-opus-4-8
    // now use openai-codex/gpt-5.5
    it("critic/security-reviewer/oracle registry_alternate is openai-codex/gpt-5.5", () => {
      for (const role of ["critic", "security-reviewer", "oracle"] as const) {
        expect(PROFILE_A[role].registry_alternate).toBe("openai-codex/gpt-5.5");
      }
    });
  });

  describe("PROFILE_A_ORCHESTRATOR new assignments", () => {
    it("default is openai-codex/gpt-5.4:high", () => {
      expect(PROFILE_A_ORCHESTRATOR.default).toBe("openai-codex/gpt-5.4:high");
    });

    it("title is unchanged gpt-5.4-mini:low", () => {
      expect(PROFILE_A_ORCHESTRATOR.title).toBe("gpt-5.4-mini:low");
    });
  });

  describe("PROFILE_A_FALLBACK_CHAINS new assignments", () => {
    it("default chain is opencode-zen/kimi-k2.6", () => {
      expect(PROFILE_A_FALLBACK_CHAINS.default).toEqual(["opencode-zen/kimi-k2.6"]);
    });

    it("title chain is unchanged opencode-zen/gpt-5.4-mini", () => {
      expect(PROFILE_A_FALLBACK_CHAINS.title).toEqual(["opencode-zen/gpt-5.4-mini"]);
    });
  });

  describe("PROFILE_B", () => {
    it("contains all 24 roles", () => {
      for (const role of ROLES) {
        expect(PROFILE_B[role]).toBeDefined();
      }
    });

    it("all primaries use openai-codex/ prefix (openai-codex-only profile)", () => {
      for (const role of ROLES) {
        const p = PROFILE_B[role].primary;
        expect(p.startsWith("openai-codex/")).toBe(true);
      }
    });

    it("all registry_alternates use opencode-zen/ prefix", () => {
      for (const role of ROLES) {
        const alt = PROFILE_B[role].registry_alternate;
        expect(alt.startsWith("opencode-zen/")).toBe(true);
      }
    });

    it("routes reasoning-heavy roles to openai-codex/gpt-5.5 and fan-out roles to gpt-5.4", () => {
      const gpt55Roles = new Set<Role>([
        "executor",
        "verifier",
        "critic",
        "planner",
        "code-reviewer",
        "debugger",
        "test-engineer",
        "security-reviewer",
        "code-simplifier",
        "tracer",
        "analyst",
        "architect",
        "oracle",
        "metis",
        "deep-researcher",
      ]);

      for (const role of ROLES) {
        const expectedPrimary = gpt55Roles.has(role) ? "openai-codex/gpt-5.5" : "openai-codex/gpt-5.4";
        const expectedAlternate = gpt55Roles.has(role) ? "opencode-zen/gpt-5.5" : "opencode-zen/gpt-5.4";
        expect(PROFILE_B[role].primary).toBe(expectedPrimary);
        expect(PROFILE_B[role].registry_alternate).toBe(expectedAlternate);
      }
    });

    it("does not use mini or nano models in Profile B", () => {
      for (const role of ROLES) {
        expect(PROFILE_B[role].primary).not.toContain("mini");
        expect(PROFILE_B[role].primary).not.toContain("nano");
        expect(PROFILE_B[role].registry_alternate).not.toContain("mini");
        expect(PROFILE_B[role].registry_alternate).not.toContain("nano");
      }
    });
  });

  describe("PROFILE_B_ORCHESTRATOR new assignments", () => {
    it("default is openai-codex/gpt-5.4:high for the 1M OpenAI window", () => {
      expect(PROFILE_B_ORCHESTRATOR.default).toBe("openai-codex/gpt-5.4:high");
    });

    it("title is openai-codex/gpt-5.4:medium", () => {
      expect(PROFILE_B_ORCHESTRATOR.title).toBe("openai-codex/gpt-5.4:medium");
    });
  });

  describe("PROFILE_B_FALLBACK_CHAINS new assignments", () => {
    it("default chain is empty so Profile B stays openai-codex-only at runtime", () => {
      expect(PROFILE_B_FALLBACK_CHAINS.default).toEqual([]);
    });

    it("title chain is empty so Profile B does not use opencode-zen fallback", () => {
      expect(PROFILE_B_FALLBACK_CHAINS.title).toEqual([]);
    });
  });

  describe("thinkingLevel invariants", () => {
    it("PROFILE_B uses performance-first reasoning efforts by role", () => {
      const xhighRoles = new Set<Role>(["verifier", "critic", "planner", "code-reviewer", "debugger", "security-reviewer", "code-simplifier", "tracer", "analyst", "architect", "oracle", "deep-researcher"]);
      const mediumRoles = new Set<Role>(["explorer", "writer", "git-master", "document-specialist", "librarian", "multimodal-looker"]);

      for (const role of ROLES) {
        const expected = xhighRoles.has(role) ? "xhigh" : mediumRoles.has(role) ? "medium" : "high";
        expect(PROFILE_B[role].thinkingLevel).toBe(expected);
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
      expect(PROFILE_A_ORCHESTRATOR.title).toBe("gpt-5.4-mini:low");
    });

    it("PROFILE_B_ORCHESTRATOR uses openai-codex/gpt-5.4 high as default and gpt-5.4 medium for title", () => {
      expect(PROFILE_B_ORCHESTRATOR.default).toBe("openai-codex/gpt-5.4:high");
      expect(PROFILE_B_ORCHESTRATOR.title).toBe("openai-codex/gpt-5.4:medium");
    });
  });
});

describe("PROFILE_C", () => {
  it("has all 24 roles", () => {
    for (const role of ROLES) {
      expect(PROFILE_C[role]).toBeDefined();
    }
  });

  it("every entry's primary is an anthropic/ model", () => {
    for (const role of ROLES) {
      expect(PROFILE_C[role].primary).toMatch(/^anthropic\//);
    }
  });

  it("every entry's registry_alternate is the matching opencode-zen/ mirror", () => {
    for (const role of ROLES) {
      const primary = PROFILE_C[role].primary;
      const alternate = PROFILE_C[role].registry_alternate;
      // primary: anthropic/claude-X → alternate: opencode-zen/claude-X
      const modelId = primary.replace(/^anthropic\//, "");
      expect(alternate).toBe(`opencode-zen/${modelId}`);
    }
  });

  it("tier mapping: critic (xhigh) = opus-4-8", () => {
    expect(PROFILE_C["critic"].primary).toBe("anthropic/claude-opus-4-8");
  });

  it("tier mapping: explorer (medium) = sonnet-4-6", () => {
    expect(PROFILE_C["explorer"].primary).toBe("anthropic/claude-sonnet-4-6");
  });

  it("tier mapping: git-master (low) = sonnet-4-6 (haiku-4-5 disabled)", () => {
    expect(PROFILE_C["git-master"].primary).toBe("anthropic/claude-sonnet-4-6");
  });

  it("tier mapping: qa-tester (high thinkingLevel) = opus-4-8 (strict tier rule)", () => {
    expect(PROFILE_C["qa-tester"].primary).toBe("anthropic/claude-opus-4-8");
  });

  it("all xhigh/high roles use opus-4-8", () => {
    for (const role of ROLES) {
      const level = PROFILE_C[role].thinkingLevel;
      if (level === "xhigh" || level === "high") {
        expect(PROFILE_C[role].primary).toBe("anthropic/claude-opus-4-8");
      }
    }
  });

  it("all medium roles use sonnet-4-6", () => {
    for (const role of ROLES) {
      if (PROFILE_C[role].thinkingLevel === "medium") {
        expect(PROFILE_C[role].primary).toBe("anthropic/claude-sonnet-4-6");
      }
    }
  });

  it("all low roles use sonnet-4-6 (haiku-4-5 disabled on this account)", () => {
    for (const role of ROLES) {
      if (PROFILE_C[role].thinkingLevel === "low") {
        expect(PROFILE_C[role].primary).toBe("anthropic/claude-sonnet-4-6");
      }
    }
  });

  it("thinkingLevel per role matches PROFILE_A verbatim", () => {
    for (const role of ROLES) {
      expect(PROFILE_C[role].thinkingLevel).toBe(PROFILE_A[role].thinkingLevel);
    }
  });

  it("tools per role matches PROFILE_A verbatim", () => {
    for (const role of ROLES) {
      expect(PROFILE_C[role].tools).toEqual(PROFILE_A[role].tools);
    }
  });

  it("blocked_tools per role matches PROFILE_A verbatim", () => {
    for (const role of ROLES) {
      expect(PROFILE_C[role].blocked_tools).toEqual(PROFILE_A[role].blocked_tools);
    }
  });

  describe("PROFILE_C_ORCHESTRATOR", () => {
    it("default is anthropic/claude-opus-4-8:high", () => {
      expect(PROFILE_C_ORCHESTRATOR.default).toBe("anthropic/claude-opus-4-8:high");
    });

    it("title is anthropic/claude-sonnet-4-6:low (haiku-4-5 disabled)", () => {
      expect(PROFILE_C_ORCHESTRATOR.title).toBe("anthropic/claude-sonnet-4-6:low");
    });
  });

  describe("PROFILE_C_FALLBACK_CHAINS", () => {
    it("default chain is opencode-zen/claude-opus-4-8", () => {
      expect(PROFILE_C_FALLBACK_CHAINS.default).toEqual(["opencode-zen/claude-opus-4-8"]);
    });

    it("title chain is opencode-zen/claude-sonnet-4-6 (haiku-4-5 disabled)", () => {
      expect(PROFILE_C_FALLBACK_CHAINS.title).toEqual(["opencode-zen/claude-sonnet-4-6"]);
    });
  });
});

// ---------------------------------------------------------------------------
// PROFILE_D — opencode-zen only, kimi-k2.6 heavy ("quality tone")
// ---------------------------------------------------------------------------

const ENABLED_OPENCODE_ZEN = new Set([
  "opencode-zen/minimax-m2.5",
  "opencode-zen/minimax-m2.7",
  "opencode-zen/glm-5.1",
  "opencode-zen/kimi-k2.6",
  "opencode-zen/gemini-3-flash",
]);

describe("PROFILE_D", () => {
  it("has all 24 roles", () => {
    for (const role of ROLES) {
      expect(PROFILE_D[role]).toBeDefined();
    }
  });

  it("every primary starts with opencode-zen/", () => {
    for (const role of ROLES) {
      expect(PROFILE_D[role].primary.startsWith("opencode-zen/")).toBe(true);
    }
  });

  it("every primary and registry_alternate is in the enabled opencode-zen set", () => {
    for (const role of ROLES) {
      const { primary, registry_alternate } = PROFILE_D[role];
      expect(ENABLED_OPENCODE_ZEN.has(primary)).toBe(true);
      expect(ENABLED_OPENCODE_ZEN.has(registry_alternate)).toBe(true);
    }
  });

  it("xhigh/high non-vision roles use kimi-k2.6 as primary", () => {
    // Vision roles (multimodal-looker, qa-tester) use gemini-3-flash regardless of thinkingLevel
    const visionRoles = new Set(["multimodal-looker", "qa-tester"]);
    for (const role of ROLES) {
      const level = PROFILE_D[role].thinkingLevel;
      if ((level === "xhigh" || level === "high") && !visionRoles.has(role)) {
        expect(PROFILE_D[role].primary).toBe("opencode-zen/kimi-k2.6");
      }
    }
  });

  it("critic primary is opencode-zen/kimi-k2.6", () => {
    expect(PROFILE_D["critic"].primary).toBe("opencode-zen/kimi-k2.6");
  });

  it("executor primary is opencode-zen/kimi-k2.6", () => {
    expect(PROFILE_D["executor"].primary).toBe("opencode-zen/kimi-k2.6");
  });

  it("explorer primary is opencode-zen/minimax-m2.5 (medium non-vision)", () => {
    expect(PROFILE_D["explorer"].primary).toBe("opencode-zen/minimax-m2.5");
  });

  it("medium non-vision roles use minimax-m2.5 as primary", () => {
    const mediumNonVision = ["explorer", "writer", "document-specialist", "librarian"] as const;
    for (const role of mediumNonVision) {
      expect(PROFILE_D[role].primary).toBe("opencode-zen/minimax-m2.5");
    }
  });

  it("multimodal-looker primary is opencode-zen/gemini-3-flash (vision)", () => {
    expect(PROFILE_D["multimodal-looker"].primary).toBe("opencode-zen/gemini-3-flash");
  });

  it("qa-tester primary is opencode-zen/gemini-3-flash (vision)", () => {
    expect(PROFILE_D["qa-tester"].primary).toBe("opencode-zen/gemini-3-flash");
  });

  it("git-master primary is opencode-zen/minimax-m2.5 (low)", () => {
    expect(PROFILE_D["git-master"].primary).toBe("opencode-zen/minimax-m2.5");
  });

  it("xhigh/high non-vision registry_alternate is opencode-zen/glm-5.1", () => {
    const visionRoles = new Set(["multimodal-looker", "qa-tester"]);
    for (const role of ROLES) {
      const level = PROFILE_D[role].thinkingLevel;
      if ((level === "xhigh" || level === "high") && !visionRoles.has(role)) {
        expect(PROFILE_D[role].registry_alternate).toBe("opencode-zen/glm-5.1");
      }
    }
  });

  it("thinkingLevel per role matches PROFILE_A verbatim", () => {
    for (const role of ROLES) {
      expect(PROFILE_D[role].thinkingLevel).toBe(PROFILE_A[role].thinkingLevel);
    }
  });

  it("tools per role matches PROFILE_A verbatim", () => {
    for (const role of ROLES) {
      expect(PROFILE_D[role].tools).toEqual(PROFILE_A[role].tools);
    }
  });

  it("blocked_tools per role matches PROFILE_A verbatim", () => {
    for (const role of ROLES) {
      expect(PROFILE_D[role].blocked_tools).toEqual(PROFILE_A[role].blocked_tools);
    }
  });

  describe("PROFILE_D_ORCHESTRATOR", () => {
    it("default is opencode-zen/kimi-k2.6:high", () => {
      expect(PROFILE_D_ORCHESTRATOR.default).toBe("opencode-zen/kimi-k2.6:high");
    });

    it("title is opencode-zen/minimax-m2.5:low", () => {
      expect(PROFILE_D_ORCHESTRATOR.title).toBe("opencode-zen/minimax-m2.5:low");
    });
  });

  describe("PROFILE_D_FALLBACK_CHAINS", () => {
    it("default chain is opencode-zen/glm-5.1", () => {
      expect(PROFILE_D_FALLBACK_CHAINS.default).toEqual(["opencode-zen/glm-5.1"]);
    });

    it("title chain is opencode-zen/minimax-m2.5", () => {
      expect(PROFILE_D_FALLBACK_CHAINS.title).toEqual(["opencode-zen/minimax-m2.5"]);
    });
  });
});

// ---------------------------------------------------------------------------
// PROFILE_B — tools/blocked_tools must mirror PROFILE_A verbatim (lint + SoT)
// ---------------------------------------------------------------------------

describe("PROFILE_B", () => {
  it("tools per role matches PROFILE_A verbatim", () => {
    for (const role of ROLES) {
      expect(PROFILE_B[role].tools).toEqual(PROFILE_A[role].tools);
    }
  });

  it("blocked_tools per role matches PROFILE_A verbatim", () => {
    for (const role of ROLES) {
      expect(PROFILE_B[role].blocked_tools).toEqual(PROFILE_A[role].blocked_tools);
    }
  });
});
