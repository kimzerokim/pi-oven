// ---------------------------------------------------------------------------
// rules-injector.ts — Layer 4 discipline-rule injection (Spec F §3 Layer 4, B6)
//
// Absorbs the omo `rules-injector` pattern as an extension module (N5):
//   - A session-cached discipline-rule block carrying the current FSM phase,
//     tagged with a NAMED dedup key so re-application never duplicates it.
//   - inject  : add the block to a `before_agent_start.systemPrompt[]` once.
//   - preserve: emit a snapshot (phase + active rule IDs) via
//     `session.compacting` `preserveData` (lands in a CompactionEntry).
//   - rehydrate: read the preserved snapshot back from a later
//     `session_before_compact.branchEntries` CompactionEntry OR from
//     `session_start` hot-context preserveData, restoring the phase so the
//     NEXT `before_agent_start.systemPrompt` re-injects the same block once.
//
// NOTE (corrected data-flow, AC3): `before_agent_start` carries only
// prompt/images/systemPrompt — it does NOT carry branchEntries. Preserved data
// is sourced from session_before_compact / session_start, then re-injected via
// systemPrompt.
// ---------------------------------------------------------------------------

/** Named dedup key — the discipline block is injected at most once per prompt. */
export const DISCIPLINE_DEDUP_KEY = "pi-oven:discipline-rules@v1";

/** The set of discipline rule IDs the injector currently steers on. */
export const DISCIPLINE_RULE_IDS = [
  "commit-gate",
  "push-consent",
  "forbidden-floor",
  "phase-discipline",
] as const;

export interface PreservedRules {
  phase: string;
  ruleIds: string[];
}

/** A minimal structural view of a SessionEntry we care about (CompactionEntry). */
interface CompactionEntryLike {
  type: string;
  preserveData?: Record<string, unknown>;
}

export class RulesInjector {
  private phase: string = "BUILD";

  setPhase(phase: string): void {
    this.phase = phase;
  }

  getPhase(): string {
    return this.phase;
  }

  /** Build the discipline-rule block string (tagged with the dedup key). */
  buildSystemPromptBlock(): string {
    return [
      `<!-- ${DISCIPLINE_DEDUP_KEY} -->`,
      `## pi-oven runtime discipline (phase: ${this.phase})`,
      "",
      "These rules are ALSO hard-enforced at the tool boundary by the pi-oven",
      "extension. Do not attempt to work around them:",
      "- `git commit` is blocked unless the pre-commit gate has PASSED.",
      "- `git push` is blocked unless explicit push consent is present.",
      "- Destructive `rm -rf` of repo/HOME roots and production-access commands",
      "  are always blocked (this floor is never lifted).",
    ].join("\n");
  }

  /**
   * Add the discipline block to a systemPrompt[] exactly once. If a block
   * carrying the dedup key is already present, the array is returned unchanged
   * (dedup). A non-mutating copy is returned.
   */
  applyToSystemPrompt(systemPrompt: string[]): string[] {
    if (systemPrompt.some((s) => s.includes(DISCIPLINE_DEDUP_KEY))) {
      return systemPrompt.slice();
    }
    return [...systemPrompt, this.buildSystemPromptBlock()];
  }

  /** Build the `preserveData` payload for a `session.compacting` result. */
  buildPreserveData(): Record<string, unknown> {
    const preserved: PreservedRules = {
      phase: this.phase,
      ruleIds: [...DISCIPLINE_RULE_IDS],
    };
    return { [DISCIPLINE_DEDUP_KEY]: preserved };
  }

  /**
   * Rehydrate from a `session_before_compact.branchEntries` array. Scans for a
   * CompactionEntry whose preserveData carries our dedup key and restores the
   * phase. Returns true if found.
   */
  rehydrateFromBranchEntries(branchEntries: CompactionEntryLike[]): boolean {
    for (let i = branchEntries.length - 1; i >= 0; i--) {
      const entry = branchEntries[i];
      if (entry && entry.type === "compaction" && entry.preserveData) {
        if (this.rehydrateFromPreserveData(entry.preserveData)) return true;
      }
    }
    return false;
  }

  /**
   * Rehydrate from a raw `preserveData` record (the `session_start`
   * hot-context path). Returns true if our key was present and applied.
   */
  rehydrateFromPreserveData(preserveData: Record<string, unknown>): boolean {
    const raw = preserveData[DISCIPLINE_DEDUP_KEY];
    if (raw && typeof raw === "object" && typeof (raw as PreservedRules).phase === "string") {
      this.phase = (raw as PreservedRules).phase;
      return true;
    }
    return false;
  }
}
