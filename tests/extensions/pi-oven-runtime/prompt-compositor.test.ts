import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  PromptCompositionError,
  composeRuntimePrompt,
  type PromptFragment,
} from "../../../.omp/extensions/pi-oven-runtime/prompt-compositor";
import {
  createWorkerContextFragments,
  composeWorkerContextCapsule,
} from "../../../.omp/extensions/pi-oven-runtime/context-capsule";
import {
  RulesInjector,
  resolveRuntimePromptMode,
} from "../../../.omp/extensions/pi-oven-runtime/rules-injector";

function fragment(
  id: string,
  content: string,
  overrides: Partial<PromptFragment> = {}
): PromptFragment {
  return {
    id,
    audience: "both",
    phase: "always",
    priority: 10,
    required: false,
    dedupKey: `pi-oven:${id}`,
    render: () => content,
    ...overrides,
  };
}

describe("composeRuntimePrompt", () => {
  test("defaults to the compositor and exposes only the one-release legacy rollback mode", () => {
    expect(resolveRuntimePromptMode(undefined)).toBe("compositor");
    expect(resolveRuntimePromptMode("")).toBe("compositor");
    expect(resolveRuntimePromptMode("compositor")).toBe("compositor");
    expect(resolveRuntimePromptMode("legacy")).toBe("legacy");
    expect(() => resolveRuntimePromptMode("old-and-unknown")).toThrow(/PI_OVEN_PROMPT_MODE/);
  });

  test("separates parent and worker audiences with reproducible drop receipts", () => {
    const result = composeRuntimePrompt({
      audience: "worker",
      phase: "mutate",
      maxBytes: 1_000,
      existing: ["base"],
      fragments: [
        fragment("parent", "parent-only", { audience: "parent" }),
        fragment("worker", "worker-only", { audience: "worker" }),
      ],
    });
    expect(result.systemPrompt).toEqual(["base", "worker-only"]);
    expect(result.receipt.fragments).toEqual([
      expect.objectContaining({ id: "parent", included: false, reason: "audience-mismatch", bytes: 11 }),
      expect.objectContaining({ id: "worker", included: true, reason: "included", bytes: 11 }),
    ]);
    expect(result.receipt.fragments.every((entry) => /^sha256:[0-9a-f]{64}$/.test(entry.hash))).toBe(true);
  });

  test("rejects duplicate dedup keys before composition", () => {
    expect(() =>
      composeRuntimePrompt({
        audience: "parent",
        phase: "always",
        maxBytes: 100,
        existing: [],
        fragments: [
          fragment("one", "a", { dedupKey: "same" }),
          fragment("two", "b", { dedupKey: "same" }),
        ],
      })
    ).toThrow(PromptCompositionError);
  });

  test("never budget-drops required safety and records optional budget drops", () => {
    const result = composeRuntimePrompt({
      audience: "worker",
      phase: "verify",
      maxBytes: 5,
      existing: [],
      fragments: [
        fragment("required", "required-safety", { required: true, priority: 1, maxBytes: 2 }),
        fragment("optional", "optional", { priority: 100 }),
      ],
    });
    expect(result.systemPrompt).toEqual(["required-safety"]);
    expect(result.receipt.fragments).toEqual([
      expect.objectContaining({ id: "optional", included: false, reason: "budget-exceeded" }),
      expect.objectContaining({ id: "required", included: true, reason: "required" }),
    ]);
    expect(result.receipt.includedBytes).toBe(Buffer.byteLength("required-safety"));
  });

  test("orders deterministically by priority then id regardless of input order", () => {
    const make = (fragments: PromptFragment[]) => composeRuntimePrompt({
      audience: "parent" as const,
      phase: "plan" as const,
      maxBytes: 1_000,
      existing: [],
      fragments,
    });
    const a = fragment("a", "A", { priority: 10 });
    const b = fragment("b", "B", { priority: 20 });
    const c = fragment("c", "C", { priority: 10 });
    expect(make([a, b, c])).toEqual(make([c, a, b]));
    expect(make([a, b, c]).systemPrompt).toEqual(["B", "A", "C"]);
  });
});

describe("worker context capsule", () => {
  test("contains exact role, assignment, selected targets, and safety without maintainer ritual", () => {
    const result = composeWorkerContextCapsule({
      role: "pov:executor",
      assignment: "Implement the ledger status endpoint.",
      selectedSkillTargets: [
        "/plugin/skills/tdd-strict/SKILL.md",
        "/plugin/skills/pre-commit-gate/SKILL.md",
      ],
      phase: "mutate",
      maxBytes: 8_192,
    });
    const prompt = result.systemPrompt.join("\n");
    expect(prompt).toContain("pov:executor");
    expect(prompt).toContain("Implement the ledger status endpoint.");
    expect(prompt).toContain("/plugin/skills/tdd-strict/SKILL.md");
    expect(prompt).toContain("/plugin/skills/pre-commit-gate/SKILL.md");
    expect(prompt).toMatch(/branch contract|write safety/i);
    expect(prompt).toMatch(/verify|verification/i);
    expect(prompt).not.toMatch(/release ritual|release:pi-oven|Current: v/i);
    expect(result.receipt.fragments.every((entry) => entry.included)).toBe(true);
  });

  test("legacy worker rollback restores the exact pre-capsule full injector surface", () => {
    const injector = new RulesInjector();
    injector.setLanguage("en");
    injector.setProjectInstructions("repository-specific contract");
    const capsule = createWorkerContextFragments({
      role: "pov:executor",
      assignment: "Implement the ledger status endpoint.",
      selectedSkillTargets: ["/plugin/skills/tdd-strict/SKILL.md"],
      phase: "mutate",
    });

    const legacy = injector.composeSystemPrompt({
      systemPrompt: [],
      audience: "worker",
      includeDiscipline: false,
      includeLanguage: false,
      includeProjectInstructions: false,
      additionalFragments: capsule,
      mode: "legacy",
    });
    const compositor = injector.composeSystemPrompt({
      systemPrompt: [],
      audience: "worker",
      includeDiscipline: false,
      includeLanguage: false,
      includeProjectInstructions: false,
      additionalFragments: capsule,
      mode: "compositor",
    });
    const legacyPrompt = legacy.systemPrompt.join("\n");
    const compositorPrompt = compositor.systemPrompt.join("\n");

    expect(legacyPrompt).toContain("pi-oven runtime discipline");
    expect(legacyPrompt).toContain("pi-oven response language");
    expect(legacyPrompt).toContain("repository-specific contract");
    expect(legacyPrompt).not.toContain("pov:executor");
    expect(legacyPrompt).not.toContain("/plugin/skills/tdd-strict/SKILL.md");
    expect(legacyPrompt).not.toMatch(/## Runtime safety/i);
    expect(compositorPrompt).not.toContain("repository-specific contract");
    expect(compositorPrompt).toContain("pov:executor");
    expect(compositorPrompt).toContain("/plugin/skills/tdd-strict/SKILL.md");
    expect(compositorPrompt).toMatch(/runtime safety/i);
    expect(legacy.receipt.includedBytes).toBeGreaterThan(
      compositor.receipt.includedBytes
    );
  });
});

describe("compact project instructions", () => {
  test("keeps maintainer and release detail out of the root runtime contract", () => {
    const root = path.resolve(import.meta.dir, "../../..");
    const runtimeContract = readFileSync(path.join(root, "CLAUDE.md"), "utf8");
    const maintainerHandbook = readFileSync(
      path.join(root, "docs", "maintainers", "handbook.md"),
      "utf8"
    );

    expect(Buffer.byteLength(runtimeContract, "utf8")).toBeLessThan(8_000);
    expect(runtimeContract).not.toMatch(/## Release ritual|Current: v\d|test-count badge/i);
    expect(maintainerHandbook).toMatch(/## Release ritual/);
    expect(maintainerHandbook).toMatch(/Sources of truth and generation/);
  });
});
