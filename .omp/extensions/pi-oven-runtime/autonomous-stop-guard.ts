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

export interface StopGuardState {
  autonomousActive: boolean;
  explicitContinueThisTurn: boolean;
  consecutiveAutoContinues: number;
  lastUserMessageId: string | null;
}

export interface StopGuardTurnEndInput {
  stopReason: string | undefined;
  assistantText: string;
}

export interface StopGuardDecision {
  state: StopGuardState;
  shouldQueueContinuation: boolean;
  reason: "explicit-continue" | "polite-stop" | null;
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

export function createStopGuardState(): StopGuardState {
  return {
    autonomousActive: false,
    explicitContinueThisTurn: false,
    consecutiveAutoContinues: 0,
    lastUserMessageId: null,
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
  };
}

export function decideStopGuardOnTurnEnd(
  state: StopGuardState,
  input: StopGuardTurnEndInput
): StopGuardDecision {
  const normalized = normalize(input.assistantText);

  if (!state.autonomousActive) {
    return {
      state: {
        ...state,
        explicitContinueThisTurn: false,
        consecutiveAutoContinues: 0,
      },
      shouldQueueContinuation: false,
      reason: null,
    };
  }

  if (input.stopReason !== "stop") {
    return {
      state: {
        ...state,
        explicitContinueThisTurn: false,
      },
      shouldQueueContinuation: false,
      reason: null,
    };
  }

  if (isTerminalCompletion(normalized) || isBranchContractQuestion(normalized)) {
    return {
      state: {
        ...state,
        explicitContinueThisTurn: false,
        consecutiveAutoContinues: 0,
      },
      shouldQueueContinuation: false,
      reason: null,
    };
  }

  const triggeredByExplicit = state.explicitContinueThisTurn;
  const triggeredByPoliteStop = isPoliteStop(normalized);
  const shouldQueue =
    (triggeredByExplicit || triggeredByPoliteStop) &&
    state.consecutiveAutoContinues < MAX_CONSECUTIVE_AUTO_CONTINUES;

  if (!shouldQueue) {
    return {
      state: {
        ...state,
        explicitContinueThisTurn: false,
        consecutiveAutoContinues: 0,
      },
      shouldQueueContinuation: false,
      reason: null,
    };
  }

  return {
    state: {
      ...state,
      explicitContinueThisTurn: false,
      consecutiveAutoContinues: state.consecutiveAutoContinues + 1,
    },
    shouldQueueContinuation: true,
    reason: triggeredByExplicit ? "explicit-continue" : "polite-stop",
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
    const part = item as { type?: unknown; text?: unknown };
    if (part.type === "text" && typeof part.text === "string") {
      texts.push(part.text);
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
