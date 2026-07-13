// ---------------------------------------------------------------------------

import { createHash } from "crypto";
import {
  composeRuntimePrompt,
  type PromptCompositionReceipt,
  type PromptFragment,
  type PromptPhase,
} from "./prompt-compositor";
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

/**
 * Named dedup marker for the project-instructions block (the repo-root
 * CLAUDE.md). NOT version-keyed: the content varies per repo, but re-injection
 * must dedup on the same marker so a prompt never carries two project blocks.
 */
export const PROJECT_INSTRUCTIONS_DEDUP_KEY = "pi-oven:project-instructions";

/**
 * Named dedup marker for the parent-only orchestrator-conduct block. Version-keyed
 * so a content revision forces a re-dedup. The block is placed FIRST in the parent
 * system prompt (unshifted by the extension) so it reads before everything else.
 */
export const ORCHESTRATOR_CONDUCT_DEDUP_KEY = "pi-oven:orchestrator-conduct@v3";

/** One-release rollback seam. The compositor remains the default. */
export type RuntimePromptMode = "compositor" | "legacy";

export function resolveRuntimePromptMode(
  value: string | undefined = process.env.PI_OVEN_PROMPT_MODE
): RuntimePromptMode {
  if (value === undefined || value === "" || value === "compositor") return "compositor";
  if (value === "legacy") return "legacy";
  throw new Error(
    `invalid PI_OVEN_PROMPT_MODE=${value}; expected compositor or legacy`
  );
}

function legacyPromptComposition(input: {
  audience: "parent" | "worker";
  phase: PromptPhase;
  maxBytes: number;
  existing: string[];
  fragments: PromptFragment[];
}): { systemPrompt: string[]; receipt: PromptCompositionReceipt } {
  const ids = new Set<string>();
  const dedupKeys = new Set<string>();
  for (const fragment of input.fragments) {
    if (!fragment.id || !fragment.dedupKey) {
      throw new Error("legacy prompt fragments require non-empty id and dedupKey");
    }
    if (ids.has(fragment.id)) throw new Error(`duplicate prompt fragment id: ${fragment.id}`);
    if (dedupKeys.has(fragment.dedupKey)) {
      throw new Error(`duplicate prompt fragment dedupKey: ${fragment.dedupKey}`);
    }
    ids.add(fragment.id);
    dedupKeys.add(fragment.dedupKey);
  }

  const rendered = input.fragments
    .map((fragment) => {
      const content = fragment.render();
      if (typeof content !== "string") {
        throw new Error(`fragment ${fragment.id} render() must return a string`);
      }
      return {
        fragment,
        content,
        bytes: Buffer.byteLength(content, "utf8"),
        hash: `sha256:${createHash("sha256").update(content).digest("hex")}`,
      };
    })
    .sort((left, right) =>
      right.fragment.priority - left.fragment.priority ||
      left.fragment.id.localeCompare(right.fragment.id)
    );
  const systemPrompt = [...input.existing];
  let includedBytes = 0;
  let droppedBytes = 0;
  const receipts: PromptCompositionReceipt["fragments"] = [];

  for (const entry of rendered) {
    const { fragment, content, bytes, hash } = entry;
    const audienceMatches = fragment.audience === "both" || fragment.audience === input.audience;
    const phaseMatches = fragment.phase === "always" || fragment.phase === input.phase;
    const alreadyPresent = systemPrompt.some((existing) => existing.includes(fragment.dedupKey));
    const included = audienceMatches && phaseMatches && !alreadyPresent;
    const reason = !audienceMatches
      ? "audience-mismatch"
      : !phaseMatches
        ? "phase-mismatch"
        : alreadyPresent
          ? "already-present"
          : fragment.required
            ? "required"
            : "included";
    if (included) {
      systemPrompt.push(content);
      includedBytes += bytes;
    } else {
      droppedBytes += bytes;
    }
    receipts.push({
      id: fragment.id,
      dedupKey: fragment.dedupKey,
      audience: fragment.audience,
      phase: fragment.phase,
      priority: fragment.priority,
      required: fragment.required,
      included,
      reason,
      hash,
      bytes,
    });
  }

  return {
    systemPrompt,
    receipt: {
      contractVersion: 1,
      audience: input.audience,
      phase: input.phase,
      maxBytes: input.maxBytes,
      includedBytes,
      droppedBytes,
      fragments: receipts,
    },
  };
}

/**
 * Project response language (mirrors scripts/pi-oven-setup/project-config.ts).
 * Canonical `"ko"`/`"en"` carry rich directives; any other value is a
 * free-form language NAME and gets a generic English directive.
 */
export type ProjectLanguage = string;

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

  /**
   * The repo-root CLAUDE.md content (project-local instructions). `null` =>
   * inject NOTHING. Set once at extension load from `<repoRoot>/CLAUDE.md`.
   * omp does not natively read the repo-root CLAUDE.md (its claude provider
   * reads `.claude/CLAUDE.md` + `~/.claude/CLAUDE.md` only), so this is how the
   * main+sub agents come to honor the Claude-Code project-memory convention.
   */
  private projectInstructions: string | null = null;
  /** Optional per-turn autonomous reminder appended to the discipline block. */
  private reminder: string | null = null;
  private lastCompositionReceipt: PromptCompositionReceipt | null = null;


  setPhase(phase: string): void {
    this.phase = phase;
  }

  getPhase(): string {
    return this.phase;
  }

  getPromptPhase(): PromptPhase {
    switch (this.phase.trim().toLowerCase()) {
      case "explore":
        return "explore";
      case "plan":
        return "plan";
      case "verify":
        return "verify";
      default:
        return "mutate";
    }
  }

  getLastCompositionReceipt(): PromptCompositionReceipt | null {
    return this.lastCompositionReceipt === null
      ? null
      : structuredClone(this.lastCompositionReceipt);
  }

  /**
   * Set the project default response language. `"ko"`/`"en"` get rich
   * directives; any other free-form name gets a generic directive. `null` =
   * ambient, inject nothing.
   */
  setLanguage(lang: string | null): void {
    this.language = lang;
  }

  /**
   * Set the repo-root project instructions (the verbatim CLAUDE.md content).
   * Empty/whitespace-only or `null` => cleared (inject nothing).
   */
  setProjectInstructions(content: string | null): void {
    this.projectInstructions = content && content.trim().length > 0 ? content : null;
  }

  setReminder(reminder: string | null): void {
    this.reminder = reminder && reminder.trim().length > 0 ? reminder : null;
  }


  /**
   * Build the language-directive block (tagged with the language dedup marker),
   * or `null` when no language is set. Branch order: null → null; "ko" → KO
   * block; "en" → EN block; any other free-form language name → a GENERIC
   * English directive naming that language. KO/EN/generic all keep
   * code/identifiers/string literals/logs in their original form — only
   * USER-FACING output switches.
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
    if (this.language === "en") {
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
    const lang = this.language;
    return [
      `<!-- ${LANGUAGE_DEDUP_KEY} -->`,
      "## pi-oven response language",
      "",
      `The default response language for this project is ${lang}.`,
      `- Write all user-facing output (explanations, summaries, questions, progress) in ${lang}.`,
      "- If the user writes in another language, mirror their language.",
      "- Keep code/identifiers/string literals/logs/commands in their original form.",
    ].join("\n");
  }

  /**
   * Build the project-instructions block (tagged with the project dedup
   * marker), or `null` when no project instructions are set. The CLAUDE.md
   * content is embedded verbatim. The framing states the source is the repo's
   * own root CLAUDE.md and that it is project-LOCAL (not the global
   * `~/.claude/CLAUDE.md`) so the agent does not conflate it with global config.
   */
  buildProjectInstructionsBlock(): string | null {
    if (this.projectInstructions === null) return null;
    return [
      `<!-- ${PROJECT_INSTRUCTIONS_DEDUP_KEY} -->`,
      "## Project instructions (repository CLAUDE.md)",
      "",
      "The following are this repository's own instructions, loaded from its",
      "root `CLAUDE.md`. Treat them as authoritative project-specific guidance",
      "for work in this repo. They are project-LOCAL — NOT loaded from any global",
      "`~/.claude` configuration.",
      "",
      "---",
      "",
      this.projectInstructions,
    ].join("\n");
  }

  /**
   * Build the parent-only orchestrator-conduct block (tagged with the conduct
   * dedup marker as the FIRST line). kimi-fit: short, blunt, numbered imperatives.
   *
   * Interactive variant (autonomousActive=false): SKILL-FIRST + WAIT-FOR-USER +
   * ASK-WHEN-AMBIGUOUS — the orchestrator must load any matching skill before
   * acting, must STOP on a pending question, and must ask rather than assume.
   *
   * Autonomous variant (autonomousActive=true): SKILL-FIRST + KEEP GOING per the
   * autonomous boundary contract — the WAIT/ASK stops are suspended so a running
   * loop is not stalled by a polite stop.
   */
  buildOrchestratorConductBlock(opts: { autonomousActive: boolean }): string {
    const head = [
      `<!-- ${ORCHESTRATOR_CONDUCT_DEDUP_KEY} -->`,
      "## pi-oven orchestrator conduct (READ FIRST — hard rules)",
      "",
    ];
    const sharedRules = [
      "CONTROL-PLANE FRONT DOOR: gated lanes open only through explicit runtime capability proofs — `requiredSkills`, exact `ownedSkillReadTargets` reads, the branch contract, and `externalExecConsent` where relevant. Bootstrap message injection and tool remap are NOT control-plane paths in pi-oven.",
      "SKILL PRECEDENCE: pi-oven skills are authoritative. When the runtime keyword block lists exact plugin-owned SKILL.md targets, read those exact file targets; do not invent namespaced skill aliases. `/pi-oven:*` entries are commands, not skills; `/pi-oven:setup` follows `commands/setup.md`. NEVER load a same-purpose skill from another sibling marketplace namespace or legacy external alias. On any name/purpose overlap, the pi-oven skill wins.",
      "AGENT NAMING: Dispatch pi-oven-owned automatic subagents ONLY by their canonical runtime name `pov:<role>` (e.g. `pov:explorer`). Bare owned roles canonicalize to `pov:<role>`. Treat legacy `pi-oven:<role>` as stale-state migration feedback, never as a silent success path. Foreign namespaces such as `kzk:<role>` are allowed only when the user explicitly asked for that exact foreign agent.",
    ];
    if (opts.autonomousActive) {
      return [
        ...head,
        "Autonomous mode is ACTIVE. The autonomous boundary contract governs:",
        "1. SKILL-FIRST. Before substantive action, if the request matches a pi-oven skill and a runtime keyword block lists an exact plugin-owned SKILL.md target, read that file target and follow it first.",
        "2. KEEP GOING per the boundary contract. Do NOT stall waiting for user input; do not emit a polite stop.",
        "3. When ambiguity or a user-owned decision still requires input, route it through `pi-oven_ask` with structured `deepInterview` metadata so topology, milestone band, weakest-target selection, threshold, spec persistence, approval handoff, and resume state persist.",
        ...sharedRules,
      ].join("\n");
    }
    return [
      ...head,
      "1. SKILL-FIRST. Before ANY substantive action, decide if the request matches a pi-oven skill (the runtime keyword whitelist AND your judgment). If the runtime keyword block lists an exact plugin-owned SKILL.md target, read that file target and follow it BEFORE acting. `/pi-oven:*` command requests are not skill requests.",
      "2. WAIT FOR THE USER. When you ask the user anything or present options (e.g. AskUserQuestion), STOP and wait for their reply. NEVER begin executing until the user answers. A pending question is a hard stop.",
      "3. ASK WHEN AMBIGUOUS. If the request is ambiguous or the decision is the user's, ask first — do not assume a default and run.",
      "4. Route that question through `pi-oven_ask` with structured `deepInterview` metadata so round identity, topology, milestone band, weakest-target selection, threshold, spec persistence, approval handoff, and resume state persist in the native runtime.",
      ...sharedRules,
    ].join("\n");
  }

  /** Build the discipline-rule block string (tagged with the dedup key). */
  buildSystemPromptBlock(): string {
    const lines = [
      `<!-- ${DISCIPLINE_DEDUP_KEY} -->`,
      `## pi-oven runtime discipline (phase: ${this.phase})`,
      "",
      "These rules are ALSO hard-enforced at the tool boundary by the pi-oven",
      "extension. Do not attempt to work around them:",
      "- `git commit` is blocked unless the pre-commit gate has PASSED, plus any",
      "  heavy verifier requirement selected by the verifier risk matrix.",
      "- `git push` is blocked unless explicit push consent is present.",
      "- Destructive `rm -rf` of repo/HOME roots and inline secret literals are",
      "  always blocked (this floor is never lifted).",
      "- External infra/production commands are blocked unless the latest user",
      "  message explicitly approves a direct external mutation/all command in",
      "  natural language, or provides a still-valid pasted AWS temporary bundle",
      "  for matching read/access use.",
      "- Local credential files already on the machine may be used only while",
      "  that latest-message consent is active, and only for read/access scopes.",
      "- Pasted AWS temporary bundles auto-authorize only matching direct",
      "  external read/access commands; mutation/all still require explicit",
      "  scope wording plus the full unexpired bundle (`ASIA...` + secret access",
      "  key + session token + matching fingerprints + `expiresAt`).",
    ];
    if (this.reminder !== null) {
      lines.push("", "Current autonomous reminder:", `- ${this.reminder}`);
    }
    return lines.join("\n");
  }

  buildRuntimeFragments(opts: {
    audience: "parent" | "worker";
    autonomousActive?: boolean;
    includeDiscipline?: boolean;
    includeLanguage?: boolean;
    includeProjectInstructions?: boolean;
  }): PromptFragment[] {
    const fragments: PromptFragment[] = [];
    if (opts.audience === "parent" && opts.autonomousActive !== undefined) {
      fragments.push({
        id: "orchestrator-conduct",
        audience: "parent",
        phase: "always",
        priority: 100,
        required: true,
        dedupKey: ORCHESTRATOR_CONDUCT_DEDUP_KEY,
        render: () => this.buildOrchestratorConductBlock({
          autonomousActive: opts.autonomousActive ?? false,
        }),
      });
    }
    if (opts.includeDiscipline !== false) {
      fragments.push({
        id: "runtime-discipline",
        audience: opts.audience,
        phase: "always",
        priority: 90,
        required: true,
        dedupKey: DISCIPLINE_DEDUP_KEY,
        render: () => this.buildSystemPromptBlock(),
      });
    }
    const language = this.buildLanguageDirective();
    if (opts.includeLanguage !== false && language !== null) {
      fragments.push({
        id: "response-language",
        audience: opts.audience,
        phase: "always",
        priority: 85,
        required: true,
        dedupKey: LANGUAGE_DEDUP_KEY,
        render: () => language,
      });
    }
    const project = this.buildProjectInstructionsBlock();
    if (
      opts.audience === "parent" &&
      opts.includeProjectInstructions !== false &&
      project !== null
    ) {
      fragments.push({
        id: "project-instructions",
        audience: "parent",
        phase: "always",
        priority: 80,
        required: true,
        dedupKey: PROJECT_INSTRUCTIONS_DEDUP_KEY,
        render: () => project,
      });
    }
    return fragments;
  }

  composeSystemPrompt(opts: {
    systemPrompt: string[];
    audience: "parent" | "worker";
    phase?: PromptPhase;
    autonomousActive?: boolean;
    includeDiscipline?: boolean;
    includeLanguage?: boolean;
    includeProjectInstructions?: boolean;
    maxBytes?: number;
    additionalFragments?: PromptFragment[];
    mode?: RuntimePromptMode;
  }): { systemPrompt: string[]; receipt: PromptCompositionReceipt } {
    const input = {
      audience: opts.audience,
      phase: opts.phase ?? this.getPromptPhase(),
      maxBytes: opts.maxBytes ?? (opts.audience === "worker" ? 8_192 : 64 * 1_024),
      existing: opts.systemPrompt,
      fragments: [
        ...this.buildRuntimeFragments(opts),
        ...(opts.additionalFragments ?? []),
      ],
    };
    const mode = opts.mode ?? resolveRuntimePromptMode();
    const result = mode === "legacy"
      ? legacyPromptComposition(input)
      : composeRuntimePrompt(input);
    this.lastCompositionReceipt = result.receipt;
    return result;
  }

  /**
   * Add the discipline block to a systemPrompt[] exactly once. If a block
   * carrying the dedup key is already present, the array is returned unchanged
   * (dedup). A non-mutating copy is returned.
   */
  applyToSystemPrompt(systemPrompt: string[]): string[] {
    return this.composeSystemPrompt({
      systemPrompt,
      audience: "parent",
    }).systemPrompt;
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
