// ---------------------------------------------------------------------------
// gate.ts — PURE gate decision (Spec F §3 Layer 1 B2/B3, §5.4)
//
// Given a normalized command + a discriminated FSM-state view + env flags +
// a (pre-computed) file-consent-valid flag, decide {block, reason?}.
//
// CRITICAL B2 refinement (this implementation, documented in the ADR):
//   - gate is ACTIVE only when state.kind === "OK" AND state.active === true.
//   - ABSENT file        → gate INACTIVE → ALLOW ALL gated verbs (a normal,
//                          non-autonomous dev session must NEVER be blocked).
//   - CORRUPT (present-but-unreadable) → fail-CLOSED for commit/push.
//   - PI_OVEN_GATE_BYPASS=1 bypasses ONLY the gateCache-dependent gates
//     (commit/push); it NEVER lifts the forbidden floor.
//   - The permanent always-on floor (rm -rf repo/HOME roots + inline-secret
//     literals) is independent of the FSM and of PI_OVEN_GATE_BYPASS.
// ---------------------------------------------------------------------------

import type { NormalizedCommand, ExternalCommandKind } from "./git-normalize";
import type { BranchContractView, ExternalExecConsent } from "./gate-state";

export interface FsmStateData {
  active: boolean;
  gateCache: { commit?: string; regression?: string };
}

/** Discriminated view of the FSM state file as seen by the gate. */
export type FsmStateView =
  | { kind: "ABSENT" }
  | { kind: "CORRUPT" }
  | { kind: "OK"; state: FsmStateData };

export interface GateEnv {
  PI_OVEN_PUSH_CONSENT?: string;
  PI_OVEN_GATE_BYPASS?: string;
}

export interface GateInput {
  normalized: NormalizedCommand;
  fsm: FsmStateView;
  env: GateEnv;
  /** Whether a valid (non-expired, present) file consent exists. */
  fileConsentValid: boolean;
  toolName?: string;
  targetPath?: string | null;
  branchContract?: BranchContractView;
  requiredSkills?: string[];
  ownedSkillReadTargets?: string[];
  skillReads?: string[];
  externalExecConsent?: ExternalExecConsent;
}

export type ConsentSource = "env" | "file" | "none";

export interface GateDecision {
  block: boolean;
  reason?: string;
  /** True when the decision was reached via PI_OVEN_GATE_BYPASS (audit at warn). */
  bypassed?: boolean;
  /** True when a file consent should be consumed (single-use) on this allow. */
  consumeFileConsent?: boolean;
  /** True when an external execution consent should be consumed (single-use) on this allow. */
  consumeExternalExecConsent?: boolean;
  /** Which consent source authorized a push (for audit). */
  consentSource?: ConsentSource;
}

function isBypass(env: GateEnv): boolean {
  return env.PI_OVEN_GATE_BYPASS === "1";
}

export const CODE_WRITE_TOOLS: ReadonlySet<string> = new Set(["write", "edit", "ast_edit"]);
const BRANCH_CONTRACT_MARKER = ".pi-oven/state/branch-contract.json";

function isCodeWriteTool(toolName: string | undefined): boolean {
  return typeof toolName === "string" && CODE_WRITE_TOOLS.has(toolName);
}

function isBranchContractBootstrapWrite(
  toolName: string | undefined,
  targetPath: string | null | undefined
): boolean {
  if (toolName !== "write" || typeof targetPath !== "string") return false;
  const normalized = targetPath.replace(/\\/g, "/");
  return (
    normalized === BRANCH_CONTRACT_MARKER ||
    normalized.endsWith(`/${BRANCH_CONTRACT_MARKER}`) ||
    normalized.endsWith("/branch-contract.json")
  );
}

function getRemainingSkillProofs(
  requiredSkills: string[] | undefined,
  ownedSkillReadTargets: string[] | undefined,
  skillReads: string[] | undefined
): { missingOwnershipSkills: string[]; unreadProofTargets: Array<{ name: string; target: string }> } {
  if (!requiredSkills || requiredSkills.length === 0) {
    return { missingOwnershipSkills: [], unreadProofTargets: [] };
  }
  const readSet = new Set(skillReads ?? []);
  const missingOwnershipSkills: string[] = [];
  const unreadProofTargets: Array<{ name: string; target: string }> = [];
  for (let i = 0; i < requiredSkills.length; i++) {
    const name = requiredSkills[i];
    const target = ownedSkillReadTargets?.[i];
    if (typeof name !== "string" || name.length === 0) continue;
    if (typeof target !== "string" || target.length === 0) {
      missingOwnershipSkills.push(name);
      continue;
    }
    if (!readSet.has(target)) {
      unreadProofTargets.push({ name, target });
    }
  }
  return { missingOwnershipSkills, unreadProofTargets };
}

function matchesExternalConsent(
  consent: ExternalExecConsent | undefined,
  kind: Exclude<ExternalCommandKind, "inline-secret">
): boolean {
  if (!consent || consent.remainingUses < 1) return false;
  switch (kind) {
    case "external-read":
      return consent.scope === "read" || consent.scope === "all";
    case "external-session":
      return consent.scope === "access" || consent.scope === "all";
    case "external-mutation":
      return consent.scope === "mutation" || consent.scope === "all";
  }
}

function requiredConsentScope(kind: Exclude<ExternalCommandKind, "inline-secret">): "read" | "access" | "mutation" {
  switch (kind) {
    case "external-read":
      return "read";
    case "external-session":
      return "access";
    case "external-mutation":
      return "mutation";
  }
}

function externalConsentBlockReason(kind: Exclude<ExternalCommandKind, "inline-secret">): string {
  const scope = requiredConsentScope(kind);
  return (
    `pi-oven: ${kind} command blocked — explicit external execution consent is required. ` +
    `Ask the user to send \`PI_OVEN_EXTERNAL_EXEC: once scope=${scope} creds=local\` ` +
    "(or a broader matching scope such as `scope=all`)."
  );
}

/** Pure decision. No I/O, no mutation. */
export function decideGate(input: GateInput): GateDecision {
  const {
    normalized,
    fsm,
    env,
    fileConsentValid,
    toolName,
    targetPath,
    branchContract = { kind: "ABSENT" },
    requiredSkills,
    ownedSkillReadTargets,
    skillReads,
    externalExecConsent,
  } = input;

  const externalMatches = normalized.externalMatches ?? [];
  const inlineSecretMatches = normalized.inlineSecretMatches ?? [];

  // 1. Forbidden floor — ALWAYS-ON, independent of FSM and of PI_OVEN_GATE_BYPASS.
  if (normalized.forbiddenMatches.length > 0) {
    const rules = normalized.forbiddenMatches.map((m) => m.rule).join(", ");
    return {
      block: true,
      reason: `pi-oven: forbidden command blocked (${rules}). This floor is always-on and is not lifted by PI_OVEN_GATE_BYPASS.`,
    };
  }
  if (inlineSecretMatches.length > 0) {
    const rules = inlineSecretMatches.map((m) => m.rule).join(", ");
    return {
      block: true,
      reason: `pi-oven: inline secret literal blocked (${rules}). Pasted credentials stay forbidden even with explicit external execution consent.`,
    };
  }

  let consumeExternalExecConsent = false;
  if (externalMatches.length > 1) {
    return {
      block: true,
      reason:
        "pi-oven: multiple external subcommands in one bash call are blocked — split them so one consent use authorizes exactly one direct external command.",
    };
  }
  if (externalMatches.length > 0) {
    const unmet = externalMatches.find((match) => !matchesExternalConsent(externalExecConsent, match.kind));
    if (unmet) {
      return {
        block: true,
        reason: externalConsentBlockReason(unmet.kind),
      };
    }
    consumeExternalExecConsent = true;
  }

  const wantsCommit = normalized.gitVerbs.includes("commit");
  const wantsPush = normalized.gitVerbs.includes("push");
  const wantsCodeWrite = isCodeWriteTool(toolName);

  // No gated verb → allow.
  if (!wantsCommit && !wantsPush && !wantsCodeWrite) {
    return { block: false, consumeExternalExecConsent };
  }

  // 2. Anti-brick bypass for the gated checks only.
  if (isBypass(env)) {
    return {
      block: false,
      bypassed: true,
      reason: "pi-oven: PI_OVEN_GATE_BYPASS=1 — gated tool restriction bypassed (recovery mode).",
      consumeExternalExecConsent,
    };
  }

  // 3. Gate is ACTIVE only when state OK + active. ABSENT / inactive → allow.
  if (fsm.kind === "ABSENT") {
    return { block: false, consumeExternalExecConsent };
  }
  if (fsm.kind === "CORRUPT") {
    return {
      block: true,
      reason: "pi-oven state unreadable; gate fail-closed. Set PI_OVEN_GATE_BYPASS=1 to recover.",
    };
  }
  // kind === "OK"
  if (!fsm.state.active) {
    // no autonomous run in progress → gate inactive
    return { block: false, consumeExternalExecConsent };
  }

  if (wantsCodeWrite) {
    if (!isBranchContractBootstrapWrite(toolName, targetPath)) {
      if (branchContract.kind === "CORRUPT") {
        return {
          block: true,
          reason:
            "pi-oven: code-write blocked — .pi-oven/state/branch-contract.json is unreadable. Set PI_OVEN_GATE_BYPASS=1 to recover.",
        };
      }
      if (branchContract.kind === "ABSENT") {
        return {
          block: true,
          reason:
            "pi-oven: code-write blocked — write .pi-oven/state/branch-contract.json with destination/branch/pr_mode first.",
        };
      }
    }

    const { missingOwnershipSkills, unreadProofTargets } = getRemainingSkillProofs(
      requiredSkills,
      ownedSkillReadTargets,
      skillReads
    );
    if (missingOwnershipSkills.length > 0) {
      return {
        block: true,
        reason:
          "pi-oven: code-write blocked — owned skill proof targets are missing for required skills: " +
          `${missingOwnershipSkills.map((name) => `skill://pi-oven:${name}`).join(", ")}. ` +
          "Automatic pi-oven skill ownership cannot be proven until the runtime persists exact plugin-owned SKILL.md targets.",
      };
    }
    if (unreadProofTargets.length > 0) {
      const required = unreadProofTargets
        .map(({ name, target }) => `${name} -> ${target}`)
        .join(", ");
      return {
        block: true,
        reason:
          "pi-oven: code-write blocked — owned skill proof targets not yet read: " +
          `${required}. Read the exact plugin-owned SKILL.md targets first.`,
      };
    }

    return { block: false, consumeExternalExecConsent };
  }

  // --- Active gate path ---
  if (wantsPush) {
    // env source (per-process) takes precedence; not consumed.
    if (env.PI_OVEN_PUSH_CONSENT && env.PI_OVEN_PUSH_CONSENT.length > 0) {
      return { block: false, consentSource: "env", consumeExternalExecConsent };
    }
    // file source (single-use) — consume on use.
    if (fileConsentValid) {
      return {
        block: false,
        consentSource: "file",
        consumeFileConsent: true,
        consumeExternalExecConsent,
      };
    }
    return {
      block: true,
      consentSource: "none",
      reason: "pi-oven: git push blocked — no valid push consent. Set PI_OVEN_PUSH_CONSENT=<ref> inline or grant a .pi-oven/state/push-consent.json file.",
    };
  }

  // wantsCommit
  if (fsm.state.gateCache.commit === "PASS" && fsm.state.gateCache.regression === "PASS") {
    return { block: false, consumeExternalExecConsent };
  }
  return {
    block: true,
    reason:
      "pi-oven: git commit blocked — full regression gate has not PASSED (requires gateCache.commit === PASS and gateCache.regression === PASS).",
  };
}
