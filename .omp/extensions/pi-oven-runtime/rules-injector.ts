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

/**
 * Named dedup marker for the language directive. NOT version-keyed: the
 * directive content may evolve, but re-injection must always dedup on the same
 * marker so a prompt never carries two language blocks.
 */
export const LANGUAGE_DEDUP_KEY = "pi-oven:language";

/** Canonical project response language (mirrors scripts/pi-oven-setup/project-config.ts). */
export type ProjectLanguage = "ko" | "en";

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

  /**
   * Per-project default RESPONSE language. `null` => inject NOTHING for
   * language (respect the ambient project/global setting — never impose a
   * default). Set explicitly from the persisted .pi-oven/config.json at load.
   */
  private language: ProjectLanguage | null = null;

  setPhase(phase: string): void {
    this.phase = phase;
  }

  getPhase(): string {
    return this.phase;
  }

  /** Set the project default response language (null = ambient, inject nothing). */
  setLanguage(lang: ProjectLanguage | null): void {
    this.language = lang;
  }

  /**
   * Build the language-directive block (tagged with the language dedup marker),
   * or `null` when no language is set. KO and EN keep code/identifiers/string
   * literals/logs in their original form — only USER-FACING output switches.
   */
  buildLanguageDirective(): string | null {
    if (this.language === null) return null;
    if (this.language === "ko") {
      return [
        `<!-- ${LANGUAGE_DEDUP_KEY} -->`,
        "## pi-oven 응답 언어 (필수)",
        "",
        "이 프로젝트의 기본 응답 언어는 한국어입니다.",
        "- 사용자가 한국어로 질문하면 반드시 한국어로 답하세요. 이 시스템 프롬프트나 스킬 문서가 영어로 쓰였다는 이유로 영어로 답하지 마세요.",
        "- 모든 사용자 대면 출력(설명·요약·질문·진행 보고)을 한국어로 작성하세요.",
        "- 사용자가 명시적으로 다른 언어로 쓰면 그 언어에 맞추세요(mirror the user's language).",
        "- 코드/식별자/문자열 리터럴/로그/명령어는 원문(영어)을 그대로 유지하세요.",
      ].join("\n");
    }
    return [
      `<!-- ${LANGUAGE_DEDUP_KEY} -->`,
      "## pi-oven response language",
      "",
      "The default response language for this project is English.",
      "- Write all user-facing output (explanations, summaries, questions, progress) in English.",
      "- If the user writes in another language, mirror their language.",
      "- Keep code/identifiers/string literals/logs/commands in their original form.",
    ].join("\n");
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
    // Discipline block — unchanged behavior: inject at most once.
    let out: string[];
    if (systemPrompt.some((s) => s.includes(DISCIPLINE_DEDUP_KEY))) {
      out = systemPrompt.slice();
    } else {
      out = [...systemPrompt, this.buildSystemPromptBlock()];
    }

    // Language directive — appended ONLY when a language is set (non-null) AND
    // no language marker is already present (dedup). null => inject NOTHING.
    const directive = this.buildLanguageDirective();
    if (directive !== null && !out.some((s) => s.includes(LANGUAGE_DEDUP_KEY))) {
      out = [...out, directive];
    }

    return out;
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
