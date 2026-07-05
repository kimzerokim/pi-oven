import { join } from "path";
import { GateStateStore } from "./gate-state";
import {
  answerHash,
  deriveRoundKey,
  mergeDeepInterviewState,
  normalizeDeepInterviewState,
  questionHash,
  type DeepInterviewAskMetadata,
  type DeepInterviewApprovalHandoff,
  type DeepInterviewRoundLifecycle,
  type DeepInterviewRoundRecord,
  type DeepInterviewState,
} from "./deep-interview-state";

export interface DeepInterviewQuestionInput {
  question: string;
  recommended?: number;
  deepInterview: DeepInterviewAskMetadata;
}

export interface DeepInterviewAnswerInput extends DeepInterviewQuestionInput {
  selected?: string;
  customInput?: string;
}


export interface DeepInterviewRuntime {
  readState(): Promise<DeepInterviewState | undefined>;
  seedQuestion(input: DeepInterviewQuestionInput): Promise<DeepInterviewState>;
  recordAnswer(input: DeepInterviewAnswerInput): Promise<DeepInterviewState>;
}

interface DeepInterviewRuntimeDeps {
  store?: GateStateStore;
  now?: () => string;
}

function readDeepInterviewFromUnknown(value: unknown): DeepInterviewState | undefined {
  if (value === undefined) return undefined;
  const normalized = normalizeDeepInterviewState(value);
  const hasActivity =
    normalized.rounds.length > 0 || normalized.pendingQuestion !== undefined || normalized.approvalHandoff !== undefined;
  return hasActivity ? normalized : undefined;
}

function resolveInterviewId(
  meta: DeepInterviewAskMetadata,
  existing: DeepInterviewState | undefined
): string {
  return meta.interviewId ?? existing?.interviewId ?? "pi-oven-default";
}

function buildApprovalHandoff(
  meta: DeepInterviewAskMetadata,
  now: string,
  existing: DeepInterviewApprovalHandoff | undefined
): DeepInterviewApprovalHandoff | undefined {
  if (!meta.approvalHandoff) return undefined;
  return {
    decisionKey: meta.approvalHandoff.decisionKey,
    summary: meta.approvalHandoff.summary,
    status: existing?.status === "approved" || existing?.status === "rejected" ? existing.status : "pending",
    requestedAt: existing?.requestedAt ?? now,
    ...(existing?.resolvedAt ? { resolvedAt: existing.resolvedAt } : {}),
  };
}

function buildRoundRecord(
  interviewId: string,
  input: DeepInterviewAnswerInput,
  now: string,
  lifecycle: DeepInterviewRoundLifecycle,
  approvalHandoff: DeepInterviewApprovalHandoff | undefined
): DeepInterviewRoundRecord {
  const roundKey = deriveRoundKey(interviewId, {
    round: input.deepInterview.round,
    roundId: input.deepInterview.roundId,
    questionId: input.deepInterview.questionId,
  });
  return {
    roundKey,
    interviewId,
    round: input.deepInterview.round,
    stage: input.deepInterview.stage,
    question: input.question,
    questionHash: questionHash(input.question),
    lifecycle,
    askedAt: now,
    ...(input.deepInterview.roundId ? { roundId: input.deepInterview.roundId } : {}),
    ...(input.deepInterview.questionId ? { questionId: input.deepInterview.questionId } : {}),
    ...(input.selected ? { selected: input.selected } : {}),
    ...(input.customInput ? { customInput: input.customInput } : {}),
    ...(input.deepInterview.component ? { component: input.deepInterview.component } : {}),
    ...(input.deepInterview.dimension ? { dimension: input.deepInterview.dimension } : {}),
    ...(input.deepInterview.ambiguity !== undefined ? { ambiguity: input.deepInterview.ambiguity } : {}),
    ...(input.recommended !== undefined ? { recommended: input.recommended } : {}),
    ...(lifecycle !== "pending"
      ? {
          answeredAt: now,
          answerHash: answerHash(input.selected, input.customInput),
        }
      : {}),
    ...(approvalHandoff ? { approvalHandoff } : {}),
  };
}

export function createDeepInterviewRuntime(
  projectRoot: string,
  deps: DeepInterviewRuntimeDeps = {}
): DeepInterviewRuntime {
  const store = deps.store ?? new GateStateStore(join(projectRoot, ".pi-oven"));
  const now = deps.now ?? (() => new Date().toISOString());

  const readCurrent = async (): Promise<DeepInterviewState | undefined> => {
    const view = await store.readState();
    if (view.kind !== "OK") return undefined;
    const current = view.state as unknown as { deepInterview?: unknown };
    return readDeepInterviewFromUnknown(current.deepInterview);
  };

  const persist = async (next: unknown): Promise<DeepInterviewState> => {
    await store.mutate((current) => {
      const currentState = current as unknown as { deepInterview?: unknown };
      return {
        ...current,
        deepInterview: mergeDeepInterviewState(currentState.deepInterview, next),
      };
    });
    const persisted = await readCurrent();
    return persisted ?? normalizeDeepInterviewState(next);
  };

  return {
    async readState() {
      return readCurrent();
    },

    async seedQuestion(input) {
      const existing = await readCurrent();
      const currentNow = now();
      const interviewId = resolveInterviewId(input.deepInterview, existing);
      const roundKey = deriveRoundKey(interviewId, {
        round: input.deepInterview.round,
        roundId: input.deepInterview.roundId,
        questionId: input.deepInterview.questionId,
      });
      return persist({
        interviewId,
        active: true,
        phase: "interviewing",
        rounds: [
          buildRoundRecord(
            interviewId,
            { ...input, selected: undefined, customInput: undefined },
            currentNow,
            "pending",
            existing?.approvalHandoff
          ),
        ],
        pendingQuestion: {
          roundKey,
          question: input.question,
          askedAt: currentNow,
          meta: { ...input.deepInterview, interviewId },
          ...(input.recommended !== undefined ? { recommended: input.recommended } : {}),
        },
        ...(existing?.approvalHandoff ? { approvalHandoff: existing.approvalHandoff } : {}),
        lastUpdatedAt: currentNow,
      });
    },

    async recordAnswer(input) {
      const existing = await readCurrent();
      const currentNow = now();
      const interviewId = resolveInterviewId(input.deepInterview, existing);
      const lifecycle: DeepInterviewRoundLifecycle =
        input.selected || input.customInput ? "answered" : "cancelled";
      const baseApprovalHandoff =
        lifecycle === "cancelled"
          ? undefined
          : buildApprovalHandoff(input.deepInterview, currentNow, existing?.approvalHandoff);
      const approvalHandoff =
        baseApprovalHandoff &&
        input.deepInterview.stage === "approval" &&
        lifecycle === "answered"
          ? {
              ...baseApprovalHandoff,
              status: "approved" as const,
              resolvedAt: currentNow,
            }
          : baseApprovalHandoff;
      return persist({
        interviewId,
        active: true,
        phase:
          approvalHandoff?.status === "approved"
            ? "ready_to_resume"
            : approvalHandoff
              ? "approval_pending"
              : "interviewing",
        rounds: [buildRoundRecord(interviewId, input, currentNow, lifecycle, approvalHandoff)],
        pendingQuestion: null,
        ...(lifecycle === "cancelled"
          ? { approvalHandoff: null }
          : approvalHandoff
            ? { approvalHandoff }
            : {}),
        lastUpdatedAt: currentNow,
      });
    },
  };
}
