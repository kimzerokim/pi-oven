import { createHash } from "crypto";

export type DeepInterviewStage = "topology" | "round" | "closure" | "approval";
export type DeepInterviewPhase = "idle" | "interviewing" | "approval_pending" | "ready_to_resume";
export type DeepInterviewRoundLifecycle = "pending" | "answered" | "cancelled";
export type DeepInterviewApprovalStatus = "pending" | "approved" | "rejected";

export interface DeepInterviewApprovalHandoffMeta {
  decisionKey: string;
  summary: string;
}

export interface DeepInterviewAskMetadata {
  interviewId?: string;
  round: number;
  roundId?: string;
  questionId?: string;
  stage: DeepInterviewStage;
  component?: string;
  dimension?: string;
  ambiguity?: number;
  approvalHandoff?: DeepInterviewApprovalHandoffMeta;
}

export interface DeepInterviewApprovalHandoff extends DeepInterviewApprovalHandoffMeta {
  status: DeepInterviewApprovalStatus;
  requestedAt: string;
  resolvedAt?: string;
}

export interface DeepInterviewRoundRecord {
  roundKey: string;
  interviewId: string;
  round: number;
  roundId?: string;
  questionId?: string;
  stage: DeepInterviewStage;
  question: string;
  questionHash: string;
  answerHash?: string;
  selected?: string;
  customInput?: string;
  component?: string;
  dimension?: string;
  ambiguity?: number;
  recommended?: number;
  lifecycle: DeepInterviewRoundLifecycle;
  askedAt: string;
  answeredAt?: string;
  approvalHandoff?: DeepInterviewApprovalHandoff;
}

export interface DeepInterviewPendingQuestion {
  roundKey: string;
  question: string;
  recommended?: number;
  askedAt: string;
  meta: DeepInterviewAskMetadata;
}

export interface DeepInterviewState {
  version: 1;
  interviewId: string;
  active: boolean;
  phase: DeepInterviewPhase;
  rounds: DeepInterviewRoundRecord[];
  pendingQuestion?: DeepInterviewPendingQuestion;
  approvalHandoff?: DeepInterviewApprovalHandoff;
  lastUpdatedAt?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function asStage(value: unknown): DeepInterviewStage | undefined {
  return value === "topology" || value === "round" || value === "closure" || value === "approval"
    ? value
    : undefined;
}

function asPhase(value: unknown): DeepInterviewPhase | undefined {
  return value === "idle" ||
    value === "interviewing" ||
    value === "approval_pending" ||
    value === "ready_to_resume"
    ? value
    : undefined;
}

function asLifecycle(value: unknown): DeepInterviewRoundLifecycle | undefined {
  return value === "pending" || value === "answered" || value === "cancelled" ? value : undefined;
}

function asApprovalStatus(value: unknown): DeepInterviewApprovalStatus | undefined {
  return value === "pending" || value === "approved" || value === "rejected" ? value : undefined;
}

function normalizeApprovalHandoff(value: unknown): DeepInterviewApprovalHandoff | undefined {
  if (!isRecord(value)) return undefined;
  const decisionKey = asString(value.decisionKey);
  const summary = asString(value.summary);
  const status = asApprovalStatus(value.status);
  const requestedAt = asString(value.requestedAt);
  if (!decisionKey || !summary || !status || !requestedAt) return undefined;
  const resolvedAt = asString(value.resolvedAt);
  return {
    decisionKey,
    summary,
    status,
    requestedAt,
    ...(resolvedAt ? { resolvedAt } : {}),
  };
}

function normalizeAskMetadata(value: unknown): DeepInterviewAskMetadata | undefined {
  if (!isRecord(value)) return undefined;
  const round = asNumber(value.round);
  const stage = asStage(value.stage);
  if (round === undefined || stage === undefined) return undefined;
  const interviewId = asString(value.interviewId);
  const roundId = asString(value.roundId);
  const questionId = asString(value.questionId);
  const component = asString(value.component);
  const dimension = asString(value.dimension);
  const ambiguity = asNumber(value.ambiguity);
  const approval = isRecord(value.approvalHandoff)
    ? (() => {
        const decisionKey = asString(value.approvalHandoff.decisionKey);
        const summary = asString(value.approvalHandoff.summary);
        if (!decisionKey || !summary) return undefined;
        return { decisionKey, summary } satisfies DeepInterviewApprovalHandoffMeta;
      })()
    : undefined;
  return {
    ...(interviewId ? { interviewId } : {}),
    round,
    ...(roundId ? { roundId } : {}),
    ...(questionId ? { questionId } : {}),
    stage,
    ...(component ? { component } : {}),
    ...(dimension ? { dimension } : {}),
    ...(ambiguity !== undefined ? { ambiguity } : {}),
    ...(approval ? { approvalHandoff: approval } : {}),
  };
}

function normalizePendingQuestion(value: unknown): DeepInterviewPendingQuestion | undefined {
  if (!isRecord(value)) return undefined;
  const roundKey = asString(value.roundKey);
  const question = asString(value.question);
  const askedAt = asString(value.askedAt);
  const meta = normalizeAskMetadata(value.meta);
  if (!roundKey || !question || !askedAt || !meta) return undefined;
  const recommended = asNumber(value.recommended);
  return {
    roundKey,
    question,
    askedAt,
    meta,
    ...(recommended !== undefined ? { recommended } : {}),
  };
}

function normalizeRoundRecord(
  value: unknown,
  fallbackInterviewId?: string
): DeepInterviewRoundRecord | undefined {
  if (!isRecord(value)) return undefined;
  const roundKey = asString(value.roundKey);
  const interviewId = asString(value.interviewId) ?? fallbackInterviewId;
  const round = asNumber(value.round);
  const stage = asStage(value.stage);
  const question = asString(value.question);
  const questionHash = asString(value.questionHash);
  const lifecycle = asLifecycle(value.lifecycle);
  const askedAt = asString(value.askedAt);
  if (
    !roundKey ||
    !interviewId ||
    round === undefined ||
    !stage ||
    !question ||
    !questionHash ||
    !lifecycle ||
    !askedAt
  ) {
    return undefined;
  }
  const roundId = asString(value.roundId);
  const questionId = asString(value.questionId);
  const answerHash = asString(value.answerHash);
  const selected = asString(value.selected);
  const customInput = asString(value.customInput);
  const component = asString(value.component);
  const dimension = asString(value.dimension);
  const ambiguity = asNumber(value.ambiguity);
  const recommended = asNumber(value.recommended);
  const answeredAt = asString(value.answeredAt);
  const approvalHandoff = normalizeApprovalHandoff(value.approvalHandoff);
  return {
    roundKey,
    interviewId,
    round,
    stage,
    question,
    questionHash,
    lifecycle,
    askedAt,
    ...(roundId ? { roundId } : {}),
    ...(questionId ? { questionId } : {}),
    ...(answerHash ? { answerHash } : {}),
    ...(selected ? { selected } : {}),
    ...(customInput ? { customInput } : {}),
    ...(component ? { component } : {}),
    ...(dimension ? { dimension } : {}),
    ...(ambiguity !== undefined ? { ambiguity } : {}),
    ...(recommended !== undefined ? { recommended } : {}),
    ...(answeredAt ? { answeredAt } : {}),
    ...(approvalHandoff ? { approvalHandoff } : {}),
  };
}

export function hashContent(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 32);
}

export function questionHash(question: string): string {
  return hashContent(question);
}

export function answerHash(selected: string | undefined, customInput: string | undefined): string {
  return hashContent(JSON.stringify({ selected: selected ?? null, customInput: customInput ?? null }));
}

export function deriveRoundKey(
  interviewId: string | undefined,
  input: { round: number; roundId?: string; questionId?: string }
): string {
  const interview = interviewId && interviewId.trim().length > 0 ? interviewId : "pi-oven-default";
  if (input.roundId && input.roundId.trim().length > 0) {
    return `${interview}::rid:${input.roundId}`;
  }
  return `${interview}::r:${input.round}::q:${input.questionId ?? "no-question"}`;
}

export function normalizeDeepInterviewState(value: unknown): DeepInterviewState {
  if (!isRecord(value)) {
    return {
      version: 1,
      interviewId: "pi-oven-default",
      active: false,
      phase: "idle",
      rounds: [],
    };
  }
  const interviewId = asString(value.interviewId) ?? "pi-oven-default";
  const active = value.active === true;
  const phase = asPhase(value.phase) ?? (active ? "interviewing" : "idle");
  const rounds = Array.isArray(value.rounds)
    ? value.rounds
        .map((entry) => normalizeRoundRecord(entry, interviewId))
        .filter((entry): entry is DeepInterviewRoundRecord => entry !== undefined)
    : [];
  const pendingQuestion = normalizePendingQuestion(value.pendingQuestion);
  const approvalHandoff = normalizeApprovalHandoff(value.approvalHandoff);
  const lastUpdatedAt = asString(value.lastUpdatedAt);
  return {
    version: 1,
    interviewId,
    active,
    phase,
    rounds,
    ...(pendingQuestion ? { pendingQuestion } : {}),
    ...(approvalHandoff ? { approvalHandoff } : {}),
    ...(lastUpdatedAt ? { lastUpdatedAt } : {}),
  };
}

function mergeApprovalHandoff(
  existing: DeepInterviewApprovalHandoff | undefined,
  incoming: DeepInterviewApprovalHandoff | undefined
): DeepInterviewApprovalHandoff | undefined {
  if (!existing) return incoming;
  if (!incoming) return existing;
  return {
    decisionKey: incoming.decisionKey,
    summary: incoming.summary,
    status: incoming.status,
    requestedAt: incoming.requestedAt,
    ...(incoming.resolvedAt ? { resolvedAt: incoming.resolvedAt } : existing.resolvedAt ? { resolvedAt: existing.resolvedAt } : {}),
  };
}

function lifecycleRank(value: DeepInterviewRoundLifecycle): number {
  switch (value) {
    case "answered":
    case "cancelled":
      return 1;
    case "pending":
    default:
      return 0;
  }
}

function mergeRoundRecord(
  existing: DeepInterviewRoundRecord,
  incoming: DeepInterviewRoundRecord
): DeepInterviewRoundRecord {
  const merged: DeepInterviewRoundRecord = {
    ...existing,
    ...incoming,
    lifecycle:
      lifecycleRank(incoming.lifecycle) >= lifecycleRank(existing.lifecycle)
        ? incoming.lifecycle
        : existing.lifecycle,
    questionHash: incoming.questionHash || existing.questionHash,
    question: incoming.question || existing.question,
    askedAt: existing.askedAt,
    approvalHandoff: mergeApprovalHandoff(existing.approvalHandoff, incoming.approvalHandoff),
  };
  if (!incoming.answeredAt && existing.answeredAt) {
    merged.answeredAt = existing.answeredAt;
  }
  if (!incoming.answerHash && existing.answerHash) {
    merged.answerHash = existing.answerHash;
  }
  return merged;
}

export function mergeDeepInterviewState(existing: unknown, incoming: unknown): DeepInterviewState {
  const existingState = normalizeDeepInterviewState(existing);
  const incomingState = normalizeDeepInterviewState(incoming);
  const incomingRecord = isRecord(incoming) ? incoming : {};

  const mergedRounds: DeepInterviewRoundRecord[] = [];
  const byRoundKey = new Map<string, number>();
  const addRound = (record: DeepInterviewRoundRecord) => {
    const index = byRoundKey.get(record.roundKey);
    if (index === undefined) {
      byRoundKey.set(record.roundKey, mergedRounds.length);
      mergedRounds.push(record);
      return;
    }
    mergedRounds[index] = mergeRoundRecord(mergedRounds[index]!, record);
  };
  for (const round of existingState.rounds) addRound(round);
  for (const round of incomingState.rounds) addRound(round);

  const hasPendingQuestion = Object.hasOwn(incomingRecord, "pendingQuestion");
  const hasApprovalHandoff = Object.hasOwn(incomingRecord, "approvalHandoff");
  const hasPhase = Object.hasOwn(incomingRecord, "phase");
  const hasActive = Object.hasOwn(incomingRecord, "active");
  const hasInterviewId = Object.hasOwn(incomingRecord, "interviewId");
  const hasLastUpdatedAt = Object.hasOwn(incomingRecord, "lastUpdatedAt");

  return {
    version: 1,
    interviewId: hasInterviewId ? incomingState.interviewId : existingState.interviewId,
    active: hasActive ? incomingState.active : existingState.active,
    phase: hasPhase ? incomingState.phase : existingState.phase,
    rounds: mergedRounds,
    ...(hasPendingQuestion
      ? incomingState.pendingQuestion
        ? { pendingQuestion: incomingState.pendingQuestion }
        : {}
      : existingState.pendingQuestion
        ? { pendingQuestion: existingState.pendingQuestion }
        : {}),
    ...(hasApprovalHandoff
      ? incomingState.approvalHandoff
        ? { approvalHandoff: incomingState.approvalHandoff }
        : {}
      : existingState.approvalHandoff
        ? { approvalHandoff: existingState.approvalHandoff }
        : {}),
    ...(hasLastUpdatedAt
      ? incomingState.lastUpdatedAt
        ? { lastUpdatedAt: incomingState.lastUpdatedAt }
        : {}
      : existingState.lastUpdatedAt
        ? { lastUpdatedAt: existingState.lastUpdatedAt }
        : {}),
  };
}
