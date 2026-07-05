import { join } from "path";
import { GateStateStore } from "./gate-state";
import { applyBucketApprovalDecision, type ModelRoutingApprovalPayload } from "./model-routing-approval";
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
import {
  createRuntimeTraceSnapshot,
  listChangedRuntimeState,
  recordTouchedPath,
  traceFunction,
  type RuntimeTraceSnapshot,
} from "./trace-primitives";

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
  onRuntimeTrace?: (trace: RuntimeTraceSnapshot) => void;
}

function readDeepInterviewFromUnknown(value: unknown): DeepInterviewState | undefined {
  if (value === undefined) return undefined;
  const normalized = normalizeDeepInterviewState(value);
  const hasActivity =
    normalized.rounds.length > 0 ||
    normalized.pendingQuestion !== undefined ||
    normalized.approvalHandoff !== undefined ||
    normalized.routingApproval !== undefined;
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
    status: "pending",
    requestedAt: existing?.status === "pending" ? existing.requestedAt : now,
  };
}

function mergeRoutingApprovalPayload(
  existing: ModelRoutingApprovalPayload | undefined,
  incoming: ModelRoutingApprovalPayload | undefined
): ModelRoutingApprovalPayload | undefined {
  if (!existing) return incoming;
  if (!incoming) return existing;
  return {
    recommendedByRole: {
      ...existing.recommendedByRole,
      ...incoming.recommendedByRole,
    },
    buckets: incoming.buckets.length > 0 ? incoming.buckets : existing.buckets,
    approvals: {
      ...existing.approvals,
      ...incoming.approvals,
    },
  };
}

function resolveRoutingApprovalPayload(
  existing: ModelRoutingApprovalPayload | undefined,
  incoming: ModelRoutingApprovalPayload | undefined,
  roundId: string | undefined,
  selected: string | undefined
): ModelRoutingApprovalPayload | undefined {
  const payload = mergeRoutingApprovalPayload(existing, incoming);
  if (!payload) return undefined;
  if (!selected) return payload;

  const roundBucketSlug = roundId?.startsWith("approval-bucket-")
    ? roundId.slice("approval-bucket-".length)
    : undefined;
  const bucket = roundBucketSlug
    ? payload.buckets.find((entry) => {
        const normalized = entry.bucketKey.includes("/")
          ? (entry.bucketKey.split("/").at(-1) ?? entry.bucketKey)
          : entry.bucketKey;
        return (
          normalized.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase() ===
          roundBucketSlug
        );
      })
    : payload.buckets.length === 1
      ? payload.buckets[0]
      : undefined;
  if (!bucket || selected.trim().toLowerCase() !== "approve") return payload;

  return applyBucketApprovalDecision(payload, {
    bucketKey: bucket.bucketKey,
    approved: true,
  });
}

function isRoutingApprovalResolved(payload: ModelRoutingApprovalPayload): boolean {
  return payload.buckets.every((bucket) => bucket.roles.every((role) => payload.approvals[role] !== undefined));
}

function buildRuntimeTraceSnapshot(
  phase: "seedQuestion" | "recordAnswer",
  before: DeepInterviewState | undefined,
  after: DeepInterviewState
): RuntimeTraceSnapshot {
  const approvalRoles = new Set<string>([
    ...Object.keys(before?.routingApproval?.approvals ?? {}),
    ...Object.keys(after.routingApproval?.approvals ?? {}),
  ]);
  const stateKeys = ["deepInterview.approvalHandoff.status"];
  for (const role of approvalRoles) {
    stateKeys.push(
      `deepInterview.routingApproval.approvals.${role}.status`,
      `deepInterview.routingApproval.approvals.${role}.selectedSelector`
    );
  }
  const stateChanges = listChangedRuntimeState(
    { deepInterview: before ?? {} },
    { deepInterview: after },
    stateKeys
  );
  return {
    ...recordTouchedPath(
      traceFunction(
        createRuntimeTraceSnapshot(),
        phase,
        ".omp/extensions/pi-oven-runtime/deep-interview-runtime.ts"
      ),
      ".omp/extensions/pi-oven-runtime/deep-interview-runtime.ts"
    ),
    stateChanges,
  };
}

function buildRoundRecord(
  interviewId: string,
  input: DeepInterviewAnswerInput,
  now: string,
  lifecycle: DeepInterviewRoundLifecycle,
  approvalHandoff: DeepInterviewApprovalHandoff | undefined,
  routingApproval: ModelRoutingApprovalPayload | undefined
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
    ...(routingApproval ? { routingApproval } : {}),
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

  const persist = async (
    previous: DeepInterviewState | undefined,
    next: unknown,
    phase: "seedQuestion" | "recordAnswer"
  ): Promise<DeepInterviewState> => {
    await store.mutate((current) => {
      const currentState = current as unknown as { deepInterview?: unknown };
      return {
        ...current,
        deepInterview: mergeDeepInterviewState(currentState.deepInterview, next),
      };
    });
    const nextState = (await readCurrent()) ?? normalizeDeepInterviewState(next);
    const trace = buildRuntimeTraceSnapshot(phase, previous, nextState);
    const hasRoutingApprovalEvidence = nextState.routingApproval !== undefined;
    if (
      hasRoutingApprovalEvidence &&
      trace.stateChanges.some((change) => {
        if (change.key === "deepInterview.approvalHandoff.status") {
          return change.after === "approved" || change.after === "rejected";
        }
        return (
          (change.key.endsWith(".selectedSelector") &&
            typeof change.after === "string" &&
            change.after.length > 0) ||
          (change.key.endsWith(".status") &&
            (change.after === "approved" || change.after === "overridden"))
        );
      })
    ) {
      deps.onRuntimeTrace?.(trace);
    }
    return nextState;
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
      const routingApproval = input.deepInterview.routingApproval
        ? mergeRoutingApprovalPayload(existing?.routingApproval, input.deepInterview.routingApproval)
        : undefined;
      const approvalHandoff = buildApprovalHandoff(input.deepInterview, currentNow, existing?.approvalHandoff);
      const phase =
        input.deepInterview.stage === "approval" && (approvalHandoff !== undefined || routingApproval !== undefined)
          ? "approval_pending"
          : "interviewing";
      const roundApprovalHandoff =
        input.deepInterview.stage === "approval"
          ? approvalHandoff ?? existing?.approvalHandoff
          : undefined;
      return persist(
        existing,
        {
          interviewId,
          active: true,
          phase,
          rounds: [
            buildRoundRecord(
              interviewId,
              { ...input, selected: undefined, customInput: undefined },
              currentNow,
              "pending",
              roundApprovalHandoff,
              routingApproval
            ),
          ],
          pendingQuestion: {
            roundKey,
            question: input.question,
            askedAt: currentNow,
            meta: {
              ...input.deepInterview,
              interviewId,
              ...(routingApproval ? { routingApproval } : {}),
            },
            ...(input.recommended !== undefined ? { recommended: input.recommended } : {}),
          },
          ...(input.deepInterview.stage === "approval"
            ? roundApprovalHandoff
              ? { approvalHandoff: roundApprovalHandoff }
              : {}
            : { approvalHandoff: null }),
          ...(routingApproval ? { routingApproval } : {}),
          lastUpdatedAt: currentNow,
        },
        "seedQuestion"
      );
    },

    async recordAnswer(input) {
      const existing = await readCurrent();
      const currentNow = now();
      const interviewId = resolveInterviewId(input.deepInterview, existing);
      const lifecycle: DeepInterviewRoundLifecycle =
        input.selected || input.customInput ? "answered" : "cancelled";
      const routingApproval = resolveRoutingApprovalPayload(
        existing?.routingApproval,
        input.deepInterview.routingApproval,
        input.deepInterview.roundId,
        input.selected
      );
      const routingApprovalResolved = routingApproval ? isRoutingApprovalResolved(routingApproval) : true;
      const cancelledWithPendingRoutingApproval =
        lifecycle === "cancelled" &&
        input.deepInterview.stage === "approval" &&
        routingApproval !== undefined &&
        !routingApprovalResolved;
      const baseApprovalHandoff = cancelledWithPendingRoutingApproval
        ? buildApprovalHandoff(input.deepInterview, currentNow, existing?.approvalHandoff)
        : lifecycle === "cancelled"
          ? undefined
          : buildApprovalHandoff(input.deepInterview, currentNow, existing?.approvalHandoff);
      const normalizedSelection = input.selected?.trim().toLowerCase();
      const approvalHandoff =
        baseApprovalHandoff &&
        input.deepInterview.stage === "approval" &&
        lifecycle === "answered"
          ? normalizedSelection === "approve" || normalizedSelection === "proceed"
            ? routingApprovalResolved
              ? {
                  ...baseApprovalHandoff,
                  status: "approved" as const,
                  resolvedAt: currentNow,
                }
              : {
                  decisionKey: baseApprovalHandoff.decisionKey,
                  summary: baseApprovalHandoff.summary,
                  status: "pending" as const,
                  requestedAt: baseApprovalHandoff.requestedAt,
                }
            : normalizedSelection === "override per role"
              ? routingApprovalResolved
                ? {
                    ...baseApprovalHandoff,
                    status: "approved" as const,
                    resolvedAt: currentNow,
                  }
                : {
                    decisionKey: baseApprovalHandoff.decisionKey,
                    summary: baseApprovalHandoff.summary,
                    status: "pending" as const,
                    requestedAt: baseApprovalHandoff.requestedAt,
                  }
              : {
                  decisionKey: baseApprovalHandoff.decisionKey,
                  summary: baseApprovalHandoff.summary,
                  status: "rejected" as const,
                  requestedAt: baseApprovalHandoff.requestedAt,
                  resolvedAt: currentNow,
                }
          : baseApprovalHandoff;
      return persist(
        existing,
        {
          interviewId,
          active: true,
          phase:
            lifecycle === "cancelled"
              ? cancelledWithPendingRoutingApproval
                ? "approval_pending"
                : "interviewing"
              : approvalHandoff?.status === "approved"
                ? "ready_to_resume"
                : approvalHandoff || (routingApproval && !routingApprovalResolved)
                  ? "approval_pending"
                  : "interviewing",
          rounds: [
            buildRoundRecord(
              interviewId,
              input,
              currentNow,
              lifecycle,
              approvalHandoff,
              routingApproval
            ),
          ],
          pendingQuestion: null,
          ...(lifecycle === "cancelled"
            ? cancelledWithPendingRoutingApproval
              ? approvalHandoff
                ? { approvalHandoff }
                : {}
              : { approvalHandoff: null }
            : approvalHandoff
              ? { approvalHandoff }
              : {}),
          ...(routingApproval ? { routingApproval } : {}),
          lastUpdatedAt: currentNow,
        },
        "recordAnswer"
      );
    },
  };
}
