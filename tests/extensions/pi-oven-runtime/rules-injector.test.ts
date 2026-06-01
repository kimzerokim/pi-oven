import { describe, it, expect } from "bun:test";
import {
  RulesInjector,
  DISCIPLINE_DEDUP_KEY,
  LANGUAGE_DEDUP_KEY,
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
