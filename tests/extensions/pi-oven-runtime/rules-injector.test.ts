import { describe, it, expect } from "bun:test";
import {
  RulesInjector,
  DISCIPLINE_DEDUP_KEY,
  LANGUAGE_DEDUP_KEY,
  PROJECT_INSTRUCTIONS_DEDUP_KEY,
  ORCHESTRATOR_CONDUCT_DEDUP_KEY,
  type PreservedRules,
} from "../../../.omp/extensions/pi-oven-runtime/rules-injector";

// ---------------------------------------------------------------------------
// AC3 — rule re-injection across compaction (Spec §3 Layer 4, B6)
//
// Data-flow (no fictional event shape):
//   1. inject   : before_agent_start → systemPrompt[] gains the discipline-rule
//                 block carrying FSM phase + named dedup key.
//   2. compact  : session.compacting → preserveData carries the FSM snapshot +
//                 active rule IDs (stored in the resulting CompactionEntry).
//   3. rehydrate: session_before_compact.branchEntries (or session_start
//                 hot-context) surface the prior CompactionEntry's preserveData;
//                 RulesInjector reads them and re-injects via the NEXT
//                 before_agent_start.systemPrompt — exactly ONCE (dedup key).
//   NOTE: before_agent_start does NOT carry branchEntries.
// ---------------------------------------------------------------------------

describe("RulesInjector — inject (AC3 step 1)", () => {
  it("buildSystemPromptBlock returns a discipline block carrying the FSM phase", () => {
    const inj = new RulesInjector();
    inj.setPhase("BUILD");
    const block = inj.buildSystemPromptBlock();
    expect(block).toBeTruthy();
    expect(block).toContain("BUILD");
  });

  it("the block is tagged with the named dedup key", () => {
    const inj = new RulesInjector();
    inj.setPhase("BUILD");
    expect(inj.buildSystemPromptBlock()).toContain(DISCIPLINE_DEDUP_KEY);
  });

  it("applying to a before_agent_start systemPrompt[] adds the block exactly once", () => {
    const inj = new RulesInjector();
    inj.setPhase("VERIFY");
    const sp: string[] = ["existing system prompt"];
    const out = inj.applyToSystemPrompt(sp);
    const hits = out.filter((s) => s.includes(DISCIPLINE_DEDUP_KEY));
    expect(hits).toHaveLength(1);
    expect(out).toContain("existing system prompt");
  });

  it("applying twice to an already-injected systemPrompt[] does NOT duplicate the block (dedup)", () => {
    const inj = new RulesInjector();
    inj.setPhase("VERIFY");
    let sp: string[] = ["base"];
    sp = inj.applyToSystemPrompt(sp);
    sp = inj.applyToSystemPrompt(sp);
    const hits = sp.filter((s) => s.includes(DISCIPLINE_DEDUP_KEY));
    expect(hits).toHaveLength(1);
  });

  it("includes the optional autonomous reminder in the discipline block", () => {
    const inj = new RulesInjector();
    inj.setPhase("BUILD");
    inj.setReminder("Before code-write, read skill://autonomous-loop.");
    const block = inj.buildSystemPromptBlock();
    expect(block).toContain("Current autonomous reminder:");
    expect(block).toContain("skill://autonomous-loop");
  });
});

describe("RulesInjector — preserve (AC3 step 2)", () => {
  it("buildPreserveData returns the FSM phase snapshot + active rule IDs", () => {
    const inj = new RulesInjector();
    inj.setPhase("BUILD");
    const data = inj.buildPreserveData();
    expect(data[DISCIPLINE_DEDUP_KEY]).toBeDefined();
    const preserved = data[DISCIPLINE_DEDUP_KEY] as PreservedRules;
    expect(preserved.phase).toBe("BUILD");
    expect(Array.isArray(preserved.ruleIds)).toBe(true);
    expect(preserved.ruleIds.length).toBeGreaterThan(0);
  });
});

describe("RulesInjector — rehydrate (AC3 step 3)", () => {
  it("rehydrateFromBranchEntries reads preserved rules from a CompactionEntry's preserveData", () => {
    const inj = new RulesInjector();
    // a fresh injector with no phase
    const branchEntries = [
      { type: "message", id: "1", parentId: null, timestamp: "t" },
      {
        type: "compaction",
        id: "2",
        parentId: "1",
        timestamp: "t",
        summary: "s",
        firstKeptEntryId: "1",
        tokensBefore: 100,
        preserveData: {
          [DISCIPLINE_DEDUP_KEY]: { phase: "VERIFY", ruleIds: ["r1", "r2"] } as PreservedRules,
        },
      },
    ];
    const found = inj.rehydrateFromBranchEntries(branchEntries as never);
    expect(found).toBe(true);
    expect(inj.getPhase()).toBe("VERIFY");
  });

  it("rehydrateFromBranchEntries returns false when no compaction entry carries our key", () => {
    const inj = new RulesInjector();
    const branchEntries = [
      { type: "message", id: "1", parentId: null, timestamp: "t" },
    ];
    expect(inj.rehydrateFromBranchEntries(branchEntries as never)).toBe(false);
  });

  it("rehydrateFromPreserveData (session_start hot-context path) restores phase", () => {
    const inj = new RulesInjector();
    const ok = inj.rehydrateFromPreserveData({
      [DISCIPLINE_DEDUP_KEY]: { phase: "BUILD", ruleIds: ["r1"] } as PreservedRules,
    });
    expect(ok).toBe(true);
    expect(inj.getPhase()).toBe("BUILD");
  });

  it("full cycle: inject → preserve → rehydrate into a fresh injector → re-inject exactly once", () => {
    const a = new RulesInjector();
    a.setPhase("VERIFY");
    a.applyToSystemPrompt(["base"]); // step 1
    const preserved = a.buildPreserveData(); // step 2

    // simulate the CompactionEntry landing in the next compaction's branchEntries
    const b = new RulesInjector();
    const branchEntries = [
      {
        type: "compaction", id: "c", parentId: null, timestamp: "t",
        summary: "s", firstKeptEntryId: "x", tokensBefore: 1,
        preserveData: preserved,
      },
    ];
    expect(b.rehydrateFromBranchEntries(branchEntries as never)).toBe(true);
    // step 3: re-inject via the NEXT before_agent_start.systemPrompt
    const sp = b.applyToSystemPrompt(["fresh base after compaction"]);
    const hits = sp.filter((s) => s.includes(DISCIPLINE_DEDUP_KEY));
    expect(hits).toHaveLength(1);
    expect(sp.some((s) => s.includes("VERIFY"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Orchestrator conduct block (Spec §4 / Plan B1 — parent-only standing conduct)
//
//   - Interactive variant: SKILL-FIRST + WAIT-FOR-USER + ASK-WHEN-AMBIGUOUS,
//     names exact plugin-owned SKILL.md target reads, carries the dedup marker.
//   - Autonomous variant: SKILL-FIRST + KEEP GOING per the boundary contract,
//     relaxes the WAIT-FOR-USER rule (no polite stop in a running loop).
// ---------------------------------------------------------------------------

describe("orchestrator conduct block", () => {
  it("interactive: contains SKILL-FIRST + WAIT-FOR-USER + plugin-owned target wording + dedup marker", () => {
    const inj = new RulesInjector();
    const b = inj.buildOrchestratorConductBlock({ autonomousActive: false });
    expect(b).toContain(ORCHESTRATOR_CONDUCT_DEDUP_KEY);
    expect(b).toMatch(/SKILL-FIRST/);
    expect(b).toMatch(/WAIT FOR THE USER|wait for the user/i);
    expect(b).toMatch(/ASK WHEN AMBIGUOUS|ask when ambiguous/i);
    expect(b).toMatch(/exact plugin-owned .*SKILL\.md target/i);
  });

  it("autonomous: relaxes WAIT and points to the boundary contract / keep going", () => {
    const inj = new RulesInjector();
    const b = inj.buildOrchestratorConductBlock({ autonomousActive: true });
    expect(b).toContain(ORCHESTRATOR_CONDUCT_DEDUP_KEY);
    expect(b).toMatch(/SKILL-FIRST/);
    expect(b).toMatch(/autonomous/i);
    expect(b).toMatch(/boundary contract|keep going/i);
    // the running-loop variant must NOT impose the interactive WAIT-FOR-USER stop
    expect(b).not.toMatch(/WAIT FOR THE USER/);
  });

  it("the conduct block starts with the dedup marker comment", () => {
    const inj = new RulesInjector();
    const b = inj.buildOrchestratorConductBlock({ autonomousActive: false });
    expect(b.startsWith(`<!-- ${ORCHESTRATOR_CONDUCT_DEDUP_KEY} -->`)).toBe(true);
  });

  it("ORCHESTRATOR_CONDUCT_DEDUP_KEY ends with @v2", () => {
    expect(ORCHESTRATOR_CONDUCT_DEDUP_KEY).toMatch(/@v2$/);
  });

  it("interactive: does not point agents at unresolved namespaced skill aliases", () => {
    const inj = new RulesInjector();
    const b = inj.buildOrchestratorConductBlock({ autonomousActive: false });
    expect(b).not.toContain("skill://pi-oven:");
    expect(b).toMatch(/\/pi-oven:\*.*commands, not skills/i);
    expect(b).toMatch(/\/pi-oven:setup.*commands\/setup\.md/i);
  });

  it("autonomous: does not point agents at unresolved namespaced skill aliases", () => {
    const inj = new RulesInjector();
    const b = inj.buildOrchestratorConductBlock({ autonomousActive: true });
    expect(b).not.toContain("skill://pi-oven:");
    expect(b).toMatch(/exact plugin-owned .*SKILL\.md target/i);
    expect(b).toMatch(/\/pi-oven:setup.*commands\/setup\.md/i);
  });

  it("interactive: contains SKILL PRECEDENCE rule forbidding superpowers:* namespace", () => {
    const inj = new RulesInjector();
    const b = inj.buildOrchestratorConductBlock({ autonomousActive: false });
    expect(b).toContain("superpowers:");
    expect(b).toMatch(/pi-oven skills are authoritative|SKILL PRECEDENCE/i);
  });

  it("interactive: contains AGENT NAMING rule that keeps foreign namespaces user-explicit only", () => {
    const inj = new RulesInjector();
    const b = inj.buildOrchestratorConductBlock({ autonomousActive: false });
    expect(b).toContain("kzk:");
    expect(b).toMatch(/pi-oven:<role>|AGENT NAMING/i);
    expect(b).toMatch(/user-explicit|explicitly asked/i);
  });

  it("autonomous: contains SKILL PRECEDENCE rule forbidding superpowers:* namespace", () => {
    const inj = new RulesInjector();
    const b = inj.buildOrchestratorConductBlock({ autonomousActive: true });
    expect(b).toContain("superpowers:");
    expect(b).toMatch(/pi-oven skills are authoritative|SKILL PRECEDENCE/i);
  });

  it("autonomous: contains AGENT NAMING rule that keeps foreign namespaces user-explicit only", () => {
    const inj = new RulesInjector();
    const b = inj.buildOrchestratorConductBlock({ autonomousActive: true });
    expect(b).toContain("kzk:");
    expect(b).toMatch(/pi-oven:<role>|AGENT NAMING/i);
    expect(b).toMatch(/user-explicit|explicitly asked/i);
  });
});

// ---------------------------------------------------------------------------
// Language directive (Plan 2026-06-02 — per-project default response language)
//
//   - KO directive contains 한국어 + the language dedup marker.
//   - EN directive is English-only.
//   - null language => inject NOTHING for language (ambient respected).
//   - dedup: re-injection never produces a second language block.
//   - coexists with the discipline block (separate dedup keys).
// ---------------------------------------------------------------------------

describe("RulesInjector — language directive", () => {
  it("KO directive contains 한국어 and the language dedup marker", () => {
    const inj = new RulesInjector();
    inj.setLanguage("ko");
    const directive = inj.buildLanguageDirective();
    expect(directive).not.toBeNull();
    expect(directive!).toContain("한국어");
    expect(directive!).toContain(LANGUAGE_DEDUP_KEY);
  });

  it("EN directive is English (mentions English, no 한국어) and carries the marker", () => {
    const inj = new RulesInjector();
    inj.setLanguage("en");
    const directive = inj.buildLanguageDirective();
    expect(directive).not.toBeNull();
    expect(directive!).toContain("English");
    expect(directive!).not.toContain("한국어");
    expect(directive!).toContain(LANGUAGE_DEDUP_KEY);
  });

  it("buildLanguageDirective returns null when no language is set", () => {
    const inj = new RulesInjector();
    expect(inj.buildLanguageDirective()).toBeNull();
  });

  it("custom language directive names the language, is English-generic, and carries the marker", () => {
    const inj = new RulesInjector();
    inj.setLanguage("Español");
    const directive = inj.buildLanguageDirective();
    expect(directive).not.toBeNull();
    expect(directive!).toContain("Español");
    expect(directive!).toContain(LANGUAGE_DEDUP_KEY);
    // English-generic phrasing, NOT the KO block
    expect(directive!).toContain("The default response language for this project is Español.");
    expect(directive!).not.toContain("한국어");
  });

  it("custom language => applyToSystemPrompt appends the language block exactly once", () => {
    const inj = new RulesInjector();
    inj.setLanguage("日本語");
    const out = inj.applyToSystemPrompt(["base"]);
    const langHits = out.filter((s) => s.includes(LANGUAGE_DEDUP_KEY));
    expect(langHits).toHaveLength(1);
    expect(langHits[0]).toContain("日本語");
  });

  it("null language => applyToSystemPrompt injects NO language block (ambient respected)", () => {
    const inj = new RulesInjector();
    // language left unset
    const out = inj.applyToSystemPrompt(["base"]);
    expect(out.some((s) => s.includes(LANGUAGE_DEDUP_KEY))).toBe(false);
    // discipline block still injected (behavior unchanged)
    expect(out.some((s) => s.includes(DISCIPLINE_DEDUP_KEY))).toBe(true);
  });

  it("setLanguage(null) clears a previously-set language => no language block", () => {
    const inj = new RulesInjector();
    inj.setLanguage("ko");
    inj.setLanguage(null);
    expect(inj.buildLanguageDirective()).toBeNull();
    const out = inj.applyToSystemPrompt(["base"]);
    expect(out.some((s) => s.includes(LANGUAGE_DEDUP_KEY))).toBe(false);
  });

  it("KO language => applyToSystemPrompt appends the language block exactly once", () => {
    const inj = new RulesInjector();
    inj.setLanguage("ko");
    const out = inj.applyToSystemPrompt(["base"]);
    const langHits = out.filter((s) => s.includes(LANGUAGE_DEDUP_KEY));
    expect(langHits).toHaveLength(1);
    expect(langHits[0]).toContain("한국어");
  });

  it("dedup: re-applying does NOT inject a second language block", () => {
    const inj = new RulesInjector();
    inj.setLanguage("en");
    let sp: string[] = ["base"];
    sp = inj.applyToSystemPrompt(sp);
    sp = inj.applyToSystemPrompt(sp);
    const langHits = sp.filter((s) => s.includes(LANGUAGE_DEDUP_KEY));
    expect(langHits).toHaveLength(1);
  });

  it("language block coexists with the discipline block (both present, deduped)", () => {
    const inj = new RulesInjector();
    inj.setPhase("BUILD");
    inj.setLanguage("ko");
    const out = inj.applyToSystemPrompt(["base"]);
    expect(out.filter((s) => s.includes(DISCIPLINE_DEDUP_KEY))).toHaveLength(1);
    expect(out.filter((s) => s.includes(LANGUAGE_DEDUP_KEY))).toHaveLength(1);
    // original prompt preserved
    expect(out).toContain("base");
  });

  it("does not change discipline-block behavior: discipline still deduped when language set", () => {
    const inj = new RulesInjector();
    inj.setLanguage("ko");
    let sp = inj.applyToSystemPrompt(["base"]);
    sp = inj.applyToSystemPrompt(sp);
    expect(sp.filter((s) => s.includes(DISCIPLINE_DEDUP_KEY))).toHaveLength(1);
    expect(sp.filter((s) => s.includes(LANGUAGE_DEDUP_KEY))).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Project instructions (repo root CLAUDE.md injection)
//
//   - The repo's own root CLAUDE.md is injected into the main+sub agent system
//     prompt so omp honors project-local guidance that it does not natively
//     read (omp reads .claude/CLAUDE.md + ~/.claude/CLAUDE.md only — never the
//     repo-root CLAUDE.md that is the Claude Code project-memory convention).
//   - null/empty => inject NOTHING (no project block).
//   - the block carries the project-instructions dedup marker and the verbatim
//     CLAUDE.md content.
//   - dedup: re-injection never produces a second project block.
//   - coexists with discipline + language blocks (three separate dedup keys).
// ---------------------------------------------------------------------------

describe("RulesInjector — project instructions", () => {
  it("buildProjectInstructionsBlock returns null when none set", () => {
    const inj = new RulesInjector();
    expect(inj.buildProjectInstructionsBlock()).toBeNull();
  });

  it("setProjectInstructions then build contains the content + dedup marker", () => {
    const inj = new RulesInjector();
    inj.setProjectInstructions("# Project guide\nUse bun, not npm.");
    const block = inj.buildProjectInstructionsBlock();
    expect(block).not.toBeNull();
    expect(block!).toContain("Use bun, not npm.");
    expect(block!).toContain(PROJECT_INSTRUCTIONS_DEDUP_KEY);
  });

  it("the block states it is project-local (not from global ~/.claude)", () => {
    const inj = new RulesInjector();
    inj.setProjectInstructions("anything");
    const block = inj.buildProjectInstructionsBlock();
    expect(block!.toLowerCase()).toContain("claude.md");
    // the framing must disambiguate project-local from global config
    expect(block!).toMatch(/\.claude/);
  });

  it("empty content is treated as null (no block)", () => {
    const inj = new RulesInjector();
    inj.setProjectInstructions("");
    expect(inj.buildProjectInstructionsBlock()).toBeNull();
  });

  it("setProjectInstructions(null) clears a previously-set value", () => {
    const inj = new RulesInjector();
    inj.setProjectInstructions("content");
    inj.setProjectInstructions(null);
    expect(inj.buildProjectInstructionsBlock()).toBeNull();
  });

  it("applyToSystemPrompt appends the project block exactly once", () => {
    const inj = new RulesInjector();
    inj.setProjectInstructions("PROJECT-RULES-MARKER");
    const out = inj.applyToSystemPrompt(["base"]);
    const hits = out.filter((s) => s.includes(PROJECT_INSTRUCTIONS_DEDUP_KEY));
    expect(hits).toHaveLength(1);
    expect(hits[0]).toContain("PROJECT-RULES-MARKER");
    expect(out).toContain("base");
  });

  it("dedup: re-applying does NOT inject a second project block", () => {
    const inj = new RulesInjector();
    inj.setProjectInstructions("PROJECT-RULES-MARKER");
    let sp: string[] = ["base"];
    sp = inj.applyToSystemPrompt(sp);
    sp = inj.applyToSystemPrompt(sp);
    expect(sp.filter((s) => s.includes(PROJECT_INSTRUCTIONS_DEDUP_KEY))).toHaveLength(1);
  });

  it("no project instructions => applyToSystemPrompt injects NO project block (discipline still present)", () => {
    const inj = new RulesInjector();
    const out = inj.applyToSystemPrompt(["base"]);
    expect(out.some((s) => s.includes(PROJECT_INSTRUCTIONS_DEDUP_KEY))).toBe(false);
    expect(out.some((s) => s.includes(DISCIPLINE_DEDUP_KEY))).toBe(true);
  });

  it("coexists with discipline + language blocks (all three present, each once)", () => {
    const inj = new RulesInjector();
    inj.setPhase("BUILD");
    inj.setLanguage("ko");
    inj.setProjectInstructions("PROJECT-RULES-MARKER");
    const out = inj.applyToSystemPrompt(["base"]);
    expect(out.filter((s) => s.includes(DISCIPLINE_DEDUP_KEY))).toHaveLength(1);
    expect(out.filter((s) => s.includes(LANGUAGE_DEDUP_KEY))).toHaveLength(1);
    expect(out.filter((s) => s.includes(PROJECT_INSTRUCTIONS_DEDUP_KEY))).toHaveLength(1);
    expect(out).toContain("base");
  });
});
