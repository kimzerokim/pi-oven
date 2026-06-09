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
//   - The forbidden-command floor (rm -rf repo/HOME roots, prod-access) is
//     ALWAYS-ON, independent of the FSM and of PI_OVEN_GATE_BYPASS.
// ---------------------------------------------------------------------------

import type { NormalizedCommand } from "./git-normalize";
import type { BranchContractView } from "./gate-state";

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
  skillReads?: string[];
}

export type ConsentSource = "env" | "file" | "none";

export interface GateDecision {
  block: boolean;
  reason?: string;
  /** True when the decision was reached via PI_OVEN_GATE_BYPASS (audit at warn). */
  bypassed?: boolean;
  /** True when a file consent should be consumed (single-use) on this allow. */
  consumeFileConsent?: boolean;
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

function getRemainingSkills(requiredSkills: string[] | undefined, skillReads: string[] | undefined): string[] {
  if (!requiredSkills || requiredSkills.length === 0) return [];
  const readSet = new Set(skillReads ?? []);
  return requiredSkills.filter((name) => !readSet.has(name));
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
    skillReads,
  } = input;

  // 1. Forbidden floor — ALWAYS-ON, independent of FSM and of PI_OVEN_GATE_BYPASS.
  if (normalized.forbiddenMatches.length > 0) {
    const rules = normalized.forbiddenMatches.map((m) => m.rule).join(", ");
    return {
      block: true,
      reason: `pi-oven: forbidden command blocked (${rules}). This floor is always-on and is not lifted by PI_OVEN_GATE_BYPASS.`,
    };
  }

  const wantsCommit = normalized.gitVerbs.includes("commit");
  const wantsPush = normalized.gitVerbs.includes("push");
  const wantsCodeWrite = isCodeWriteTool(toolName);

  // No gated verb → allow.
  if (!wantsCommit && !wantsPush && !wantsCodeWrite) {
    return { block: false };
  }

  // 2. Anti-brick bypass for the gated checks only.
  if (isBypass(env)) {
    return {
      block: false,
      bypassed: true,
      reason: "pi-oven: PI_OVEN_GATE_BYPASS=1 — gated tool restriction bypassed (recovery mode).",
    };
  }

  // 3. Gate is ACTIVE only when state OK + active. ABSENT / inactive → allow.
  if (fsm.kind === "ABSENT") {
    return { block: false };
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
    return { block: false };
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

    const remainingSkills = getRemainingSkills(requiredSkills, skillReads);
    if (remainingSkills.length > 0) {
      const required = remainingSkills.map((name) => `skill://pi-oven:${name}`).join(", ");
      return {
        block: true,
        reason: `pi-oven: code-write blocked — required skills not yet read: ${required}. Read them first.`,
      };
    }

    return { block: false };
  }

  // --- Active gate path ---
  if (wantsPush) {
    // env source (per-process) takes precedence; not consumed.
    if (env.PI_OVEN_PUSH_CONSENT && env.PI_OVEN_PUSH_CONSENT.length > 0) {
      return { block: false, consentSource: "env" };
    }
    // file source (single-use) — consume on use.
    if (fileConsentValid) {
      return { block: false, consentSource: "file", consumeFileConsent: true };
    }
    return {
      block: true,
      consentSource: "none",
      reason: "pi-oven: git push blocked — no valid push consent. Set PI_OVEN_PUSH_CONSENT=<ref> inline or grant a .pi-oven/state/push-consent.json file.",
    };
  }

  // wantsCommit
  if (fsm.state.gateCache.commit === "PASS" && fsm.state.gateCache.regression === "PASS") {
    return { block: false };
  }
  return {
    block: true,
    reason:
      "pi-oven: git commit blocked — full regression gate has not PASSED (requires gateCache.commit === PASS and gateCache.regression === PASS).",
  };
}
