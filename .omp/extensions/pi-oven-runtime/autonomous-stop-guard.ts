// ---------------------------------------------------------------------------
// autonomous-stop-guard.ts
//
// Runtime guard for autonomous mode:
// - Detects Korean/English autonomous-intent user messages.
// - Detects polite-stop assistant outputs that should have continued.
// - Queues an immediate hidden next-turn continuation instruction.
//
// Goal: reduce premature halts after users request autonomous execution.
// ---------------------------------------------------------------------------

import {
  createAutonomousLoopResumeMarker,
  createHaltedByPolicyMarker,
  createVerifierPendingMarker,
  type ContinuationMarker,
} from "./continuation-marker";
import {
  listChangedRuntimeState,
  summarizeFailurePath,
  type RuntimeTraceSnapshot,
} from "./trace-primitives";
import {
  decideVerifierDepth,
  deriveVerifierRisk,
  type VerifierDepthDecision,
} from "./verifier-depth-policy";
import type {
  AutonomyBlockedReason,
  AutonomyNextAction,
} from "./gate-state";
import { normalizeCommand, type NormalizeRoots } from "./git-normalize";

export interface StopGuardState {
  autonomousActive: boolean;
  explicitContinueThisTurn: boolean;
  consecutiveAutoContinues: number;
  lastUserMessageId: string | null;
  continuationMarker?: ContinuationMarker;
}

export interface StopGuardTurnEndInput {
  stopReason: string | undefined;
  assistantText: string;
  runtimeTrace?: RuntimeTraceSnapshot;
  verifierDepth?: VerifierDepthDecision;
}

export interface StopGuardDecision {
  state: StopGuardState;
  shouldQueueContinuation: boolean;
  reason: "explicit-continue" | "polite-stop" | "verifier-pending" | null;
  blockedReason?: AutonomyBlockedReason;
  nextAction?: AutonomyNextAction;
  note?: string;
}

export interface DurableExternalToolEffect {
  kind: "git-commit" | "git-push" | "external-mutation";
  target: string;
  intent: {
    command: string;
    gitVerbs: string[];
    externalRules: string[];
  };
}

/** Select only consent-gated mutations that need an execute/completion receipt. */
export function classifyDurableExternalToolEffect(
  toolName: string,
  input: Record<string, unknown>,
  roots: NormalizeRoots = {}
): DurableExternalToolEffect | undefined {
  if (toolName !== "bash" || typeof input.command !== "string") return undefined;
  const normalized = normalizeCommand(input.command, roots);
  const externalMutations = normalized.externalMatches.filter(
    (match) => match.kind === "external-mutation"
  );
  const verb = normalized.gitVerbs.includes("push")
    ? "push"
    : normalized.gitVerbs.includes("commit")
      ? "commit"
      : undefined;
  if (!verb && externalMutations.length === 0) return undefined;
  return {
    kind: verb ? `git-${verb}` : "external-mutation",
    target:
      verb === "push"
        ? normalized.pushTarget ?? "git-remote"
        : verb === "commit"
          ? "HEAD"
          : externalMutations.map((match) => match.rule).join(","),
    intent: {
      command: input.command,
      gitVerbs: normalized.gitVerbs,
      externalRules: externalMutations.map((match) => match.rule),
    },
  };
}

interface MessageLike {
  role?: unknown;
  content?: unknown;
}

interface BranchEntryLike {
  id?: unknown;
  type?: unknown;
  message?: MessageLike;
}

const AUTONOMOUS_KEYWORDS = [
  "자율 실행",
  "자율실행",
  "자율로 돌려",
  "끝까지 끝내줘",
  "자동으로 끝내줘",
  "자는 동안 진행해",
  "알아서 진행해",
  "계속 진행해",
  "멈추지 말고 진행해",
  "스탑하지마",
  "ralph로 돌려",
  "autopilot",
  "ultrawork",
  "full auto",
  "must complete",
];

const CONTINUE_KEYWORDS = [
  "계속 진행해",
  "계속 진행해줘",
  "자율 실행해줘",
  "자율로 진행해",
  "멈추지 말고 진행해",
  "끝까지 진행해",
  "keep going",
  "continue",
  "do not stop",
  "don't stop",
];

const DISABLE_KEYWORDS = [
  "자율 실행 중지",
  "자율 중지",
  "멈춰",
  "중단",
  "stop autonomous",
  "disable autonomous",
  "halt autonomous",
];

const POLITE_STOP_PATTERNS: RegExp[] = [
  /다음\s*(단계|작업|진행|지시)/i,
  /원하시면\s*(계속|진행)/i,
  /필요하시면\s*(계속|진행)/i,
  /요청하시면\s*(계속|진행)/i,
  /진행할까요\??$/i,
  /should\s+i\s+proceed/i,
  /awaiting\s+(your\s+)?next\s+instruction/i,
  /let\s+me\s+know\s+if\s+you\s+want\s+me\s+to\s+continue/i,
  /done[,\s]+awaiting\s+next\s+instruction/i,
];

const BRANCH_CONTRACT_PATTERNS: RegExp[] = [
  /destination/i,
  /branch\s*name/i,
  /pr\s*mode/i,
  /목적지/i,
  /브랜치명/i,
  /브랜치\s*이름/i,
  /pr\s*모드/i,
];

const TERMINAL_COMPLETION_PATTERNS: RegExp[] = [
  /all\s+(requested\s+)?deliverables\s+(are\s+)?complete/i,
  /all\s+tasks\s+complete/i,
  /final\s+verification\s+pass/i,
  /모든\s*(요청된\s*)?작업\s*(이)?\s*완료/i,
  /최종\s*검증\s*통과/i,
  /완료되었습니다/i,
];

const MAX_CONSECUTIVE_AUTO_CONTINUES = 3;

export const STOP_GUARD_MESSAGE = [
  "[pi-oven-autonomous-stop-guard]",
  "Continue autonomous execution immediately.",
  "Dispatch the next tool call in this turn.",
  "Do not wait for additional confirmation.",
  "Only ask the user when a destructive action needs explicit consent or when a required external input is missing.",
].join("\n");

const RUN_DEEP_VERIFIER_NEXT_ACTION: AutonomyNextAction = {
  kind: "run-deep-verifier",
  message: "Run the deep verifier lane before exit.",
};

export function createStopGuardState(): StopGuardState {
  return {
    autonomousActive: false,
    explicitContinueThisTurn: false,
    consecutiveAutoContinues: 0,
    lastUserMessageId: null,
    continuationMarker: undefined,
  };
}

export function updateStopGuardOnTurnStart(
  state: StopGuardState,
  branchEntries: BranchEntryLike[]
): StopGuardState {
  const latestUser = getLatestUserMessage(branchEntries);

  if (!latestUser) {
    return {
      ...state,
      explicitContinueThisTurn: false,
    };
  }

  if (state.lastUserMessageId === latestUser.id) {
    return {
      ...state,
      explicitContinueThisTurn: false,
    };
  }

  const text = latestUser.text;
  const disable = matchesAny(text, DISABLE_KEYWORDS);
  const activate = matchesAny(text, AUTONOMOUS_KEYWORDS);
  const explicitContinue = matchesAny(text, CONTINUE_KEYWORDS);

  return {
    autonomousActive: disable ? false : activate ? true : state.autonomousActive,
    explicitContinueThisTurn: explicitContinue || activate,
    consecutiveAutoContinues: disable ? 0 : state.consecutiveAutoContinues,
    lastUserMessageId: latestUser.id,
    continuationMarker: undefined,
  };
}

export function decideStopGuardOnTurnEnd(
  state: StopGuardState,
  input: StopGuardTurnEndInput
): StopGuardDecision {
  const normalized = normalize(input.assistantText);
  const trace = input.runtimeTrace;
  const verifierDepth =
    input.verifierDepth ??
    decideVerifierDepth({
      mode: state.autonomousActive ? "autonomous" : "interactive",
      risk: deriveVerifierRisk({
        mutationScope: trace?.mutationScope ?? "none",
        materialEdit: trace?.materialEdit ?? false,
      }),
      mutationScope: trace?.mutationScope ?? "none",
      materialEdit: trace?.materialEdit ?? false,
    });
  const autoContinueHardCap =
    verifierDepth.hardCap.maxConsecutiveAutoContinues > 0
      ? verifierDepth.hardCap.maxConsecutiveAutoContinues
      : MAX_CONSECUTIVE_AUTO_CONTINUES;

  if (!state.autonomousActive) {
    return {
      state: {
        ...state,
        explicitContinueThisTurn: false,
        consecutiveAutoContinues: 0,
        continuationMarker: undefined,
      },
      shouldQueueContinuation: false,
      reason: null,
      blockedReason: undefined,
      nextAction: undefined,
    };
  }

  if (input.stopReason !== "stop") {
    return {
      state: {
        ...state,
        explicitContinueThisTurn: false,
        continuationMarker: undefined,
      },
      shouldQueueContinuation: false,
      reason: null,
      blockedReason: undefined,
      nextAction: undefined,
    };
  }

  if (isTerminalCompletion(normalized)) {
    if (verifierDepth.depth === "deep" && (trace?.materialEdit ?? false)) {
      const nextState: StopGuardState = {
        ...state,
        explicitContinueThisTurn: false,
        consecutiveAutoContinues: state.consecutiveAutoContinues + 1,
        continuationMarker: createVerifierPendingMarker("pi-oven:verifier/deep"),
      };
      const stateKeys = listChangedRuntimeState(
        state as unknown as Record<string, unknown>,
        nextState as unknown as Record<string, unknown>,
        ["explicitContinueThisTurn", "consecutiveAutoContinues", "continuationMarker"]
      ).map((entry) => entry.key);
      const note = summarizeFailurePath({
        surface: "completion-gate",
        message: `deep verifier required before exit (${verifierDepth.reason})`,
        functions: ["decideStopGuardOnTurnEnd", "decideVerifierDepth"],
        symbols: ["pi-oven:verifier/deep"],
        stateKeys,
      }).summary;
      if (state.consecutiveAutoContinues >= autoContinueHardCap) {
        return {
          state: {
            ...state,
            explicitContinueThisTurn: false,
            consecutiveAutoContinues: 0,
            continuationMarker: createHaltedByPolicyMarker("verifier-depth-hard-cap"),
          },
          shouldQueueContinuation: false,
          reason: null,
          blockedReason: {
            kind: "verifier-depth-hard-cap",
            message:
              `pi-oven: autonomy paused — deep verifier follow-up hit the policy cap before the run could safely finish (${verifierDepth.reason}).`,
          },
          nextAction: {
            kind: "continue-in-same-repo",
            message:
              "Run the deep verifier lane, then continue in the same repo/branch if more work remains.",
          },
          note,
        };
      }
      return {
        state: nextState,
        shouldQueueContinuation: true,
        reason: "verifier-pending",
        blockedReason: {
          kind: "verifier-pending",
          message:
            `pi-oven: autonomous exit paused — deep verifier lane must run before completion (${verifierDepth.reason}).`,
        },
        nextAction: RUN_DEEP_VERIFIER_NEXT_ACTION,
        note,
      };
    }
    return {
      state: {
        ...state,
        explicitContinueThisTurn: false,
        consecutiveAutoContinues: 0,
        continuationMarker: undefined,
      },
      shouldQueueContinuation: false,
      reason: null,
      blockedReason: undefined,
      nextAction: undefined,
    };
  }

  if (isBranchContractQuestion(normalized)) {
    return {
      state: {
        ...state,
        explicitContinueThisTurn: false,
        consecutiveAutoContinues: 0,
        continuationMarker: createHaltedByPolicyMarker("branch-contract"),
      },
      shouldQueueContinuation: false,
      reason: null,
      blockedReason: {
        kind: "branch-contract",
        message:
          "pi-oven: autonomy paused — the branch contract is still missing destination/branch/pr_mode for code-write.",
      },
      nextAction: {
        kind: "write-branch-contract",
        message:
          "Write .pi-oven/state/branch-contract.json with destination, branch, and pr_mode, then continue in the same repo/branch.",
      },
    };
  }

  const triggeredByExplicit = state.explicitContinueThisTurn;
  const triggeredByPoliteStop = isPoliteStop(normalized);
  const triggered = triggeredByExplicit || triggeredByPoliteStop;
  const shouldQueue = triggered && state.consecutiveAutoContinues < autoContinueHardCap;

  if (!shouldQueue) {
    return {
      state: {
        ...state,
        explicitContinueThisTurn: false,
        consecutiveAutoContinues: 0,
        continuationMarker: triggered
          ? createHaltedByPolicyMarker("max-consecutive-auto-continues")
          : undefined,
      },
      shouldQueueContinuation: false,
      reason: null,
      blockedReason: triggered
        ? {
            kind: "max-consecutive-auto-continues",
            message:
              "pi-oven: autonomy paused — the max consecutive auto-continue cap was reached before the run could safely finish.",
          }
        : undefined,
      nextAction: triggered
        ? {
            kind: "continue-in-same-repo",
            message:
              "Continue manually in the same repo/branch when more work remains, or ask for an explicit continue after reviewing the last stop.",
          }
        : undefined,
    };
  }

  return {
    state: {
      ...state,
      explicitContinueThisTurn: false,
      consecutiveAutoContinues: state.consecutiveAutoContinues + 1,
      continuationMarker: createAutonomousLoopResumeMarker(
        triggeredByExplicit ? "explicit-continue" : "polite-stop"
      ),
    },
    shouldQueueContinuation: true,
    reason: triggeredByExplicit ? "explicit-continue" : "polite-stop",
    blockedReason: undefined,
    nextAction: undefined,
  };
}

function getLatestUserMessage(
  entries: BranchEntryLike[]
): { id: string; text: string } | null {
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i];
    if (entry?.type !== "message") continue;
    if (!entry.message || entry.message.role !== "user") continue;

    const id = typeof entry.id === "string" ? entry.id : String(i);
    const text = extractTextFromContent(entry.message.content);
    if (text.length === 0) continue;

    return { id, text };
  }
  return null;
}

export function extractTextFromContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";

  const texts: string[] = [];
  for (const item of content) {
    if (!item || typeof item !== "object") continue;
    if (!("type" in item) || !("text" in item)) continue;
    if (item.type === "text" && typeof item.text === "string") {
      texts.push(item.text);
    }
  }
  return texts.join("\n");
}

function normalize(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function matchesAny(text: string, keywords: string[]): boolean {
  const lowered = normalize(text).toLowerCase();
  return keywords.some((keyword) => lowered.includes(keyword.toLowerCase()));
}

function isPoliteStop(text: string): boolean {
  return POLITE_STOP_PATTERNS.some((pattern) => pattern.test(text));
}

function isBranchContractQuestion(text: string): boolean {
  const isQuestion = /\?$/.test(text) || /(어떻게|어떤|선택|확인)/.test(text);
  if (!isQuestion) return false;
  return BRANCH_CONTRACT_PATTERNS.some((pattern) => pattern.test(text));
}

function isTerminalCompletion(text: string): boolean {
  return TERMINAL_COMPLETION_PATTERNS.some((pattern) => pattern.test(text));
}
