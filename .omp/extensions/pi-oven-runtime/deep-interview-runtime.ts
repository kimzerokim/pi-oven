import { existsSync, lstatSync, mkdirSync, writeFileSync } from "fs";
import { dirname, isAbsolute, join, posix, relative, resolve } from "path";
import { GateStateStore } from "./gate-state";
import { applyBucketApprovalDecision, type ModelRoutingApprovalPayload } from "./model-routing-approval";
import {
  answerHash,
  deriveRoundKey,
  hashContent,
  mergeApprovalFlowState,
  mergeDeepInterviewState,
  normalizeApprovalFlowState,
  normalizeDeepInterviewState,
  questionHash,
  type ApprovalFlowAskMetadata,
  type ApprovalFlowKind,
  type ApprovalFlowSource,
  type ApprovalFlowState,
  type DeepInterviewAskMetadata,
  type DeepInterviewApprovalHandoff,
  type DeepInterviewRoundLifecycle,
  type DeepInterviewRoundRecord,
  type DeepInterviewSpecReceipt,
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
  approval?: ApprovalFlowAskMetadata;
}

export interface DeepInterviewAnswerInput extends DeepInterviewQuestionInput {
  selected?: string;
  selectedDisplayLabel?: string;
  customInput?: string;
}

interface PersistFinalSpecAndSeedApprovalFlowInput {
  specPath: string;
  content: string;
  decisionKey: string;
  summary: string;
  question?: string;
  recommended?: number;
  source?: ApprovalFlowSource;
}

export interface DeepInterviewRuntime {
  readState(): Promise<DeepInterviewState | undefined>;
  readApprovalFlow(): Promise<ApprovalFlowState | undefined>;
  seedQuestion(input: DeepInterviewQuestionInput): Promise<DeepInterviewState>;
  recordAnswer(input: DeepInterviewAnswerInput): Promise<DeepInterviewState>;
}
interface DeepInterviewCompletionRuntime extends DeepInterviewRuntime {
  persistFinalSpecAndSeedApprovalFlow(
    input: PersistFinalSpecAndSeedApprovalFlowInput
  ): Promise<{ deepInterview: DeepInterviewState; approvalFlow: ApprovalFlowState }>;
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
    normalized.state.rounds.length > 0 ||
    normalized.pendingQuestion !== undefined ||
    normalized.spec !== undefined ||
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

function sanitizeRuntimeDeepInterview(deepInterview: DeepInterviewState | undefined): DeepInterviewState | undefined {
  if (!deepInterview) return undefined;
  const { approvalHandoff: _approvalHandoff, routingApproval: _routingApproval, pendingQuestion, ...rest } =
    deepInterview;
  if (!pendingQuestion) {
    return rest;
  }
  const { approvalHandoff: _pendingApprovalHandoff, routingApproval: _pendingRoutingApproval, ...meta } =
    pendingQuestion.meta;
  return {
    ...rest,
    pendingQuestion: {
      ...pendingQuestion,
      meta,
    },
  };
}

function assertNoSymlinkTraversal(projectRoot: string, targetPath: string, specPath: string): void {
  const resolvedProjectRoot = resolve(projectRoot);
  const relativeToProjectRoot = relative(resolvedProjectRoot, targetPath);
  if (
    relativeToProjectRoot.length === 0 ||
    relativeToProjectRoot.startsWith("..") ||
    isAbsolute(relativeToProjectRoot)
  ) {
    throw new Error(`Final spec persistence path must stay under docs/specs/: ${specPath}`);
  }
  let current = resolvedProjectRoot;
  for (const segment of relativeToProjectRoot.split(/[/\\]+/).filter(Boolean)) {
    current = join(current, segment);
    if (!existsSync(current)) break;
    if (lstatSync(current).isSymbolicLink()) {
      throw new Error(`Final spec persistence path must not traverse symlinks under docs/specs/: ${specPath}`);
    }
  }
}

function resolveFinalSpecPersistenceTarget(
  projectRoot: string,
  specPath: string
): { normalizedSpecPath: string; targetPath: string } {
  const normalizedSpecPath = posix.normalize(specPath.replaceAll("\\", "/"));
  const specsRoot = resolve(projectRoot, "docs/specs");
  const targetPath = resolve(projectRoot, normalizedSpecPath);
  const relativeToSpecsRoot = relative(specsRoot, targetPath);
  if (
    normalizedSpecPath.startsWith("/") ||
    !normalizedSpecPath.startsWith("docs/specs/") ||
    relativeToSpecsRoot.length === 0 ||
    relativeToSpecsRoot.startsWith("..") ||
    isAbsolute(relativeToSpecsRoot)
  ) {
    throw new Error(`Final spec persistence path must stay under docs/specs/: ${specPath}`);
  }
  assertNoSymlinkTraversal(projectRoot, targetPath, specPath);
  return { normalizedSpecPath, targetPath };
}

function buildApprovalHandoff(
  approval: ApprovalFlowAskMetadata | undefined,
  now: string,
  existing: DeepInterviewApprovalHandoff | undefined
): DeepInterviewApprovalHandoff | undefined {
  const handoff = approval ?? existing;
  if (!handoff) return undefined;
  return {
    decisionKey: handoff.decisionKey,
    summary: handoff.summary,
    status: "pending",
    requestedAt: existing?.status === "pending" ? existing.requestedAt : now,
  };
}

function buildApprovalHandoffFromFlow(flow: ApprovalFlowState | undefined): DeepInterviewApprovalHandoff | undefined {
  if (!flow) return undefined;
  return {
    decisionKey: flow.decisionKey,
    summary: flow.summary,
    status: flow.status,
    requestedAt: flow.requestedAt,
    ...(flow.resolvedAt ? { resolvedAt: flow.resolvedAt } : {}),
  };
}


export type CanonicalApprovalSelection =
  | "approve"
  | "proceed"
  | "override per role"
  | "ask about these choices";

function normalizeApprovalSelectionToken(value: string): string {
  return value
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/[,_/]+/g, " ")
    .replace(/\s+/g, " ");
}

export function canonicalizeApprovalSelection(
  value: string | null | undefined
): CanonicalApprovalSelection | undefined {
  if (typeof value !== "string" || value.trim().length === 0) return undefined;
  const normalized = normalizeApprovalSelectionToken(value);
  if (normalized === "ask about these choices") return "ask about these choices";
  if (normalized === "override per role") return "override per role";
  if (normalized === "approve" || normalized === "approved" || normalized === "승인") return "approve";
  if (
    normalized === "proceed" ||
    normalized === "continue" ||
    normalized === "continue execution" ||
    normalized === "go ahead" ||
    normalized === "계속" ||
    normalized === "계속 진행" ||
    normalized === "이대로 진행" ||
    normalized === "승인 plan으로 진행" ||
    normalized === "승인 plan 으로 진행"
  ) {
    return "proceed";
  }
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readApprovalSelectionFromResolved(
  resolved: unknown
): { selected?: string; selectedDisplayLabel?: string } {
  if (!isRecord(resolved)) return {};
  return {
    ...(typeof resolved.selected === "string" ? { selected: resolved.selected } : {}),
    ...(typeof resolved.displayLabel === "string" ? { selectedDisplayLabel: resolved.displayLabel } : {}),
  };
}

function readLatestApprovalRoundSelection(
  deepInterview: DeepInterviewState | undefined
): { selected?: string; selectedDisplayLabel?: string } {
  if (!deepInterview) return {};
  const latestApprovalRound = [...deepInterview.state.rounds]
    .reverse()
    .find((round) => round.stage === "approval" && typeof round.selected === "string");
  if (!latestApprovalRound?.selected) return {};
  return {
    selected: latestApprovalRound.selected,
    selectedDisplayLabel: latestApprovalRound.selected,
  };
}

function resolveEffectiveApprovalStatus(
  approvalFlow: ApprovalFlowState | undefined,
  deepInterview: DeepInterviewState | undefined
): {
  status: ApprovalFlowState["status"] | undefined;
  selected?: string;
  selectedDisplayLabel?: string;
} {
  if (!approvalFlow) return { status: undefined };
  const fromResolved = readApprovalSelectionFromResolved(approvalFlow.resolved);
  const fromRound = readLatestApprovalRoundSelection(deepInterview);
  const selected = fromResolved.selected ?? fromRound.selected;
  const selectedDisplayLabel =
    fromResolved.selectedDisplayLabel ?? fromRound.selectedDisplayLabel ?? fromResolved.selected;
  if (approvalFlow.status !== "rejected") {
    return { status: approvalFlow.status, selected, selectedDisplayLabel };
  }
  const canonicalSelection =
    canonicalizeApprovalSelection(selected) ?? canonicalizeApprovalSelection(selectedDisplayLabel);
  if (!canonicalSelection) {
    return { status: approvalFlow.status, selected, selectedDisplayLabel };
  }
  if (canonicalSelection === "ask about these choices") {
    return { status: "pending", selected: canonicalSelection, selectedDisplayLabel };
  }
  if (canonicalSelection === "override per role") {
    const routingResolved = approvalFlow.routingApproval ? isRoutingApprovalResolved(approvalFlow.routingApproval) : true;
    return {
      status: routingResolved ? "approved" : "pending",
      selected: canonicalSelection,
      selectedDisplayLabel,
    };
  }
  return { status: "approved", selected: canonicalSelection, selectedDisplayLabel };
}

function repairApprovalFlowState(
  approvalFlow: ApprovalFlowState | undefined,
  deepInterview: DeepInterviewState | undefined
): ApprovalFlowState | undefined {
  if (!approvalFlow) return undefined;
  const effective = resolveEffectiveApprovalStatus(approvalFlow, deepInterview);
  if (!effective.status) return approvalFlow;
  const nextResolved =
    effective.selected || approvalFlow.resolved
      ? {
          ...(isRecord(approvalFlow.resolved) ? approvalFlow.resolved : {}),
          ...(effective.selected ? { selected: effective.selected } : {}),
          ...(effective.selectedDisplayLabel ? { displayLabel: effective.selectedDisplayLabel } : {}),
        }
      : approvalFlow.resolved;
  if (
    effective.status === approvalFlow.status &&
    (!effective.selected || (isRecord(approvalFlow.resolved) && approvalFlow.resolved.selected === effective.selected)) &&
    (!effective.selectedDisplayLabel ||
      (isRecord(approvalFlow.resolved) && approvalFlow.resolved.displayLabel === effective.selectedDisplayLabel))
  ) {
    return approvalFlow;
  }
  const repaired: ApprovalFlowState = {
    ...approvalFlow,
    active: effective.status === "pending",
    status: effective.status,
    ...(nextResolved ? { resolved: nextResolved } : {}),
    ...(effective.status === "pending"
      ? {}
      : { resolvedAt: approvalFlow.resolvedAt ?? deepInterview?.lastUpdatedAt ?? approvalFlow.requestedAt }),
  };
  if (effective.status !== "pending") {
    const { pendingQuestion: _pendingQuestion, ...withoutPendingQuestion } = repaired;
    return withoutPendingQuestion;
  }
  return repaired;
}

function canonicalizeRecordedAnswer(input: DeepInterviewAnswerInput): DeepInterviewAnswerInput {
  const canonicalSelected = canonicalizeApprovalSelection(input.selected) ?? input.selected;
  const selectedDisplayLabel =
    input.selectedDisplayLabel ?? (canonicalSelected && canonicalSelected !== input.selected ? input.selected : undefined);
  return {
    ...input,
    ...(canonicalSelected ? { selected: canonicalSelected } : {}),
    ...(selectedDisplayLabel ? { selectedDisplayLabel } : {}),
  };
}

function mergeRoutingApprovalPayload(
  existing: ModelRoutingApprovalPayload | undefined,
  incoming: ModelRoutingApprovalPayload | undefined
): ModelRoutingApprovalPayload | undefined {
  if (!existing) return incoming;
  if (!incoming) return existing;
  return {
    sessionProviderFamily: incoming.sessionProviderFamily ?? existing.sessionProviderFamily,
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
  if (!bucket) return payload;
  if (canonicalizeApprovalSelection(selected) !== "approve") return payload;

  return applyBucketApprovalDecision(payload, {
    bucketKey: bucket.bucketKey,
    approved: true,
  });
}

function isRoutingApprovalResolved(payload: ModelRoutingApprovalPayload): boolean {
  return payload.buckets.every((bucket) => bucket.roles.every((role) => payload.approvals[role] !== undefined));
}

function buildRuntimeTraceSnapshot(
  phase: "seedQuestion" | "recordAnswer" | "persistFinalSpecAndSeedApprovalFlow",
  beforeDeepInterview: DeepInterviewState | undefined,
  afterDeepInterview: DeepInterviewState,
  beforeApprovalFlow: ApprovalFlowState | undefined,
  afterApprovalFlow: ApprovalFlowState | undefined
): RuntimeTraceSnapshot {
  const approvalRoles = new Set<string>([
    ...Object.keys(beforeApprovalFlow?.routingApproval?.approvals ?? {}),
    ...Object.keys(afterApprovalFlow?.routingApproval?.approvals ?? {}),
  ]);
  const stateKeys = ["approvalFlow.status", "deepInterview.spec.path", "deepInterview.phase"];
  for (const role of approvalRoles) {
    stateKeys.push(
      `approvalFlow.routingApproval.approvals.${role}.status`,
      `approvalFlow.routingApproval.approvals.${role}.selectedSelector`
    );
  }
  const stateChanges = listChangedRuntimeState(
    { deepInterview: beforeDeepInterview ?? {}, approvalFlow: beforeApprovalFlow ?? {} },
    { deepInterview: afterDeepInterview, approvalFlow: afterApprovalFlow ?? {} },
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
    ...(input.deepInterview.ambiguityAtAsk !== undefined
      ? { ambiguityAtAsk: input.deepInterview.ambiguityAtAsk }
      : input.deepInterview.ambiguity !== undefined
        ? { ambiguityAtAsk: input.deepInterview.ambiguity }
        : {}),
    ...(input.deepInterview.ambiguity !== undefined ? { ambiguity: input.deepInterview.ambiguity } : {}),
    ...(input.recommended !== undefined ? { recommended: input.recommended } : {}),
    ...(input.deepInterview.scores ? { scores: input.deepInterview.scores } : {}),
    ...(input.deepInterview.triggers ? { triggers: input.deepInterview.triggers } : {}),
    ...(input.deepInterview.topologySummary ? { topologySummary: input.deepInterview.topologySummary } : {}),
    ...(input.deepInterview.ontologySummary ? { ontologySummary: input.deepInterview.ontologySummary } : {}),
    ...(input.deepInterview.milestone ? { milestone: input.deepInterview.milestone } : {}),
    ...(input.deepInterview.nextTarget ? { nextTarget: input.deepInterview.nextTarget } : {}),
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

function buildDeepInterviewStatePatch(
  existing: DeepInterviewState | undefined,
  input: DeepInterviewQuestionInput | DeepInterviewAnswerInput,
  interviewId: string,
  now: string,
  phase: DeepInterviewState["phase"],
  lifecycle: DeepInterviewRoundLifecycle,
  pendingQuestion: DeepInterviewState["pendingQuestion"] | null,
  approvalHandoff: DeepInterviewApprovalHandoff | undefined,
  routingApproval: ModelRoutingApprovalPayload | undefined,
  overrides: Partial<DeepInterviewState> = {}
): DeepInterviewState {
  const existingState = existing?.state;
  const establishedFacts = [
    ...(existingState?.establishedFacts ?? []),
    ...(input.deepInterview.establishedFacts ?? []),
  ];
  const ontologySnapshots = [
    ...(existingState?.ontologySnapshots ?? []),
    ...(input.deepInterview.ontologySnapshot ? [input.deepInterview.ontologySnapshot] : []),
  ];
  const nextState: DeepInterviewState = {
    version: 2,
    interviewId,
    active: phase !== "complete",
    phase,
    ...(input.deepInterview.threshold !== undefined
      ? { threshold: input.deepInterview.threshold }
      : existing?.threshold !== undefined
        ? { threshold: existing.threshold }
        : {}),
    ...(input.deepInterview.thresholdSource
      ? { thresholdSource: input.deepInterview.thresholdSource }
      : existing?.thresholdSource
        ? { thresholdSource: existing.thresholdSource }
        : {}),
    ...(existing?.spec ? { spec: existing.spec } : {}),
    state: {
      rounds: [buildRoundRecord(interviewId, input as DeepInterviewAnswerInput, now, lifecycle, approvalHandoff, routingApproval)],
      establishedFacts,
      ontologySnapshots,
      ...(input.deepInterview.topology ? { topology: input.deepInterview.topology } : existingState?.topology ? { topology: existingState.topology } : {}),
      ...(input.deepInterview.currentAmbiguity !== undefined
        ? { currentAmbiguity: input.deepInterview.currentAmbiguity }
        : input.deepInterview.ambiguity !== undefined
          ? { currentAmbiguity: input.deepInterview.ambiguity }
          : existingState?.currentAmbiguity !== undefined
            ? { currentAmbiguity: existingState.currentAmbiguity }
            : {}),
      ...(input.deepInterview.milestone
        ? { milestone: input.deepInterview.milestone }
        : existingState?.milestone
          ? { milestone: existingState.milestone }
          : {}),
      ...(input.deepInterview.nextTarget
        ? { nextTarget: input.deepInterview.nextTarget }
        : existingState?.nextTarget
          ? { nextTarget: existingState.nextTarget }
          : {}),
      ...(input.deepInterview.initialIdea
        ? { initialIdea: input.deepInterview.initialIdea }
        : existingState?.initialIdea
          ? { initialIdea: existingState.initialIdea }
          : {}),
    },
    ...(pendingQuestion ? { pendingQuestion } : {}),
    ...(overrides.lastUpdatedAt ? { lastUpdatedAt: overrides.lastUpdatedAt } : { lastUpdatedAt: now }),
    ...overrides,
  };
  return nextState;
}

function buildApprovalFlowSeed(
  question: string,
  recommended: number | undefined,
  interviewId: string,
  now: string,
  approval: ApprovalFlowAskMetadata | undefined,
  existingApprovalFlow: ApprovalFlowState | undefined,
  deepInterview: DeepInterviewState | undefined,
  routingApproval: ModelRoutingApprovalPayload | undefined
): ApprovalFlowState {
  const kind: ApprovalFlowKind = approval?.kind ?? (routingApproval ? "routing-bucket" : "spec-handoff");
  const source: ApprovalFlowSource = approval?.source ?? (routingApproval ? "setup" : "brainstorming");
  const resumedFrom = {
    ...(approval?.resumedFrom ?? {}),
    interviewId: approval?.resumedFrom?.interviewId ?? interviewId,
    ...(approval?.resumedFrom?.specPath
      ? { specPath: approval.resumedFrom.specPath }
      : deepInterview?.spec?.path
        ? { specPath: deepInterview.spec.path }
        : {}),
  };
  return {
    version: 1,
    active: true,
    kind,
    source,
    decisionKey:
      approval?.decisionKey ??
      existingApprovalFlow?.decisionKey ??
      (routingApproval ? "approve-routing-bucket" : "approve-deep-interview-spec"),
    summary:
      approval?.summary ??
      existingApprovalFlow?.summary ??
      (routingApproval
        ? "Approve the current routing bucket recommendations before resuming execution."
        : "Approve the finalized deep-interview spec handoff before continuing."),
    status: "pending",
    ...(recommended !== undefined ? { recommended: { index: recommended } } : {}),
    pendingQuestion: {
      question,
      askedAt: now,
      ...(recommended !== undefined ? { recommended } : {}),
    },
    resumedFrom,
    requestedAt: existingApprovalFlow?.status === "pending" ? existingApprovalFlow.requestedAt : now,
    ...(routingApproval ? { routingApproval } : {}),
  };
}

function buildApprovalFlowResolution(
  current: ApprovalFlowState,
  input: DeepInterviewAnswerInput,
  now: string,
  routingApproval: ModelRoutingApprovalPayload | undefined
): ApprovalFlowState {
  const canonicalSelection = canonicalizeApprovalSelection(input.selected);
  const routingResolved = routingApproval ? isRoutingApprovalResolved(routingApproval) : true;
  const cancelledWithPendingRoutingApproval =
    !input.selected &&
    !input.customInput &&
    current.kind !== "spec-handoff" &&
    routingApproval !== undefined &&
    !routingResolved;

  let status: ApprovalFlowState["status"];
  if (cancelledWithPendingRoutingApproval) {
    status = "pending";
  } else if (!input.selected && !input.customInput) {
    status = "cancelled";
  } else if (canonicalSelection === "approve") {
    status = routingResolved ? "approved" : "pending";
  } else if (canonicalSelection === "proceed") {
    status = "approved";
  } else if (canonicalSelection === "override per role") {
    status = routingResolved ? "approved" : "pending";
  } else if (canonicalSelection === "ask about these choices") {
    status = "pending";
  } else {
    status = "rejected";
  }

  return {
    ...current,
    active: status === "pending",
    status,
    pendingQuestion: undefined,
    ...(routingApproval ? { routingApproval } : {}),
    resolved:
      input.selected || input.customInput
        ? {
            selected: input.selected ?? null,
            ...(input.selectedDisplayLabel ? { displayLabel: input.selectedDisplayLabel } : {}),
            customInput: input.customInput ?? null,
          }
        : current.resolved,
    ...(status === "pending" ? {} : { resolvedAt: now }),
  };
}

export function createDeepInterviewRuntime(
  projectRoot: string,
  deps: DeepInterviewRuntimeDeps = {}
): DeepInterviewRuntime {
  const store = deps.store ?? new GateStateStore(join(projectRoot, ".pi-oven"));
  const now = deps.now ?? (() => new Date().toISOString());

  const readSnapshot = async (): Promise<{
    deepInterview: DeepInterviewState | undefined;
    approvalFlow: ApprovalFlowState | undefined;
  }> => {
    const view = await store.readState();
    if (view.kind !== "OK") return { deepInterview: undefined, approvalFlow: undefined };
    const current = view.state as unknown as { deepInterview?: unknown; approvalFlow?: unknown };
    const persistedDeepInterview = readDeepInterviewFromUnknown(current.deepInterview);
    const approvalFlow = repairApprovalFlowState(
      normalizeApprovalFlowState(current.approvalFlow, persistedDeepInterview),
      persistedDeepInterview
    );
    const deepInterview = sanitizeRuntimeDeepInterview(persistedDeepInterview);
    return { deepInterview, approvalFlow };
  };

  const persist = async (
    previousDeepInterview: DeepInterviewState | undefined,
    previousApprovalFlow: ApprovalFlowState | undefined,
    nextDeepInterviewInput: unknown,
    nextApprovalFlow: unknown,
    phase: "seedQuestion" | "recordAnswer" | "persistFinalSpecAndSeedApprovalFlow",
    replaceApprovalFlow: boolean = false
  ): Promise<{ deepInterview: DeepInterviewState; approvalFlow: ApprovalFlowState | undefined }> => {
    await store.mutate((current) => {
      const currentState = current as unknown as { deepInterview?: unknown; approvalFlow?: unknown };
      const currentDeepInterview = normalizeDeepInterviewState(currentState.deepInterview);
      return {
        ...current,
        deepInterview: mergeDeepInterviewState(currentState.deepInterview, nextDeepInterviewInput),
        approvalFlow: replaceApprovalFlow
          ? nextApprovalFlow
          : mergeApprovalFlowState(currentState.approvalFlow, nextApprovalFlow, currentDeepInterview),
      };
    });
    const next = await readSnapshot();
    const persistedDeepInterview =
      next.deepInterview ?? normalizeDeepInterviewState(nextDeepInterviewInput);
    const trace = buildRuntimeTraceSnapshot(
      phase,
      previousDeepInterview,
      persistedDeepInterview,
      previousApprovalFlow,
      next.approvalFlow
    );
    if (trace.stateChanges.length > 0) {
      deps.onRuntimeTrace?.(trace);
    }
    return {
      deepInterview: persistedDeepInterview,
      approvalFlow: next.approvalFlow,
    };
  };

  const runtime: DeepInterviewCompletionRuntime = {
    async readState() {
      return (await readSnapshot()).deepInterview;
    },

    async readApprovalFlow() {
      return (await readSnapshot()).approvalFlow;
    },

    async seedQuestion(input) {
      const existing = await readSnapshot();
      const currentNow = now();
      const interviewId = resolveInterviewId(input.deepInterview, existing.deepInterview);
      const roundKey = deriveRoundKey(interviewId, {
        round: input.deepInterview.round,
        roundId: input.deepInterview.roundId,
        questionId: input.deepInterview.questionId,
      });
      const isApprovalQuestion = input.approval !== undefined || input.deepInterview.stage === "approval";
      const {
        approvalHandoff: _ignoredApprovalHandoff,
        routingApproval: _ignoredRoutingApproval,
        ...canonicalMeta
      } = {
        ...input.deepInterview,
        interviewId,
      };
      const routingApproval = mergeRoutingApprovalPayload(existing.approvalFlow?.routingApproval, input.approval?.routingApproval);
      const approvalHandoff = isApprovalQuestion
        ? buildApprovalHandoff(input.approval, currentNow, buildApprovalHandoffFromFlow(existing.approvalFlow))
        : undefined;
      const nextDeepInterview = buildDeepInterviewStatePatch(
        existing.deepInterview,
        input,
        interviewId,
        currentNow,
        isApprovalQuestion
          ? existing.deepInterview?.spec?.stage === "final"
            ? "complete"
            : "handoff"
          : existing.deepInterview?.phase === "complete"
            ? "complete"
            : "interviewing",
        "pending",
        {
          roundKey,
          question: input.question,
          askedAt: currentNow,
          meta: canonicalMeta,
          ...(input.recommended !== undefined ? { recommended: input.recommended } : {}),
        },
        approvalHandoff,
        routingApproval,
        { lastUpdatedAt: currentNow }
      );
      const nextApprovalFlow = isApprovalQuestion
        ? buildApprovalFlowSeed(
            input.question,
            input.recommended,
            interviewId,
            currentNow,
            input.approval,
            existing.approvalFlow,
            existing.deepInterview,
            routingApproval
          )
        : undefined;
      return (
        await persist(
          existing.deepInterview,
          existing.approvalFlow,
          nextDeepInterview,
          nextApprovalFlow,
          "seedQuestion"
        )
      ).deepInterview;
    },

    async recordAnswer(input) {
      const existing = await readSnapshot();
      const currentNow = now();
      const interviewId = resolveInterviewId(input.deepInterview, existing.deepInterview);
      const normalizedInput = canonicalizeRecordedAnswer(input);
      const lifecycle: DeepInterviewRoundLifecycle =
        normalizedInput.selected || normalizedInput.customInput ? "answered" : "cancelled";
      const isApprovalQuestion = normalizedInput.approval !== undefined || normalizedInput.deepInterview.stage === "approval";
      const routingApproval = resolveRoutingApprovalPayload(
        existing.approvalFlow?.routingApproval,
        normalizedInput.approval?.routingApproval,
        normalizedInput.deepInterview.roundId,
        normalizedInput.selected
      );
      const nextApprovalFlow = isApprovalQuestion
        ? buildApprovalFlowResolution(
            existing.approvalFlow ??
              buildApprovalFlowSeed(
                normalizedInput.question,
                normalizedInput.recommended,
                interviewId,
                currentNow,
                normalizedInput.approval,
                undefined,
                existing.deepInterview,
                routingApproval
              ),
            normalizedInput,
            currentNow,
            routingApproval
          )
        : undefined;
      const approvalHandoff = isApprovalQuestion
        ? buildApprovalHandoffFromFlow(nextApprovalFlow) ??
          buildApprovalHandoff(normalizedInput.approval, currentNow, buildApprovalHandoffFromFlow(existing.approvalFlow))
        : undefined;
      const phase =
        existing.deepInterview?.spec?.stage === "final"
          ? "complete"
          : isApprovalQuestion
            ? "handoff"
            : "interviewing";
      const nextDeepInterview = {
        ...buildDeepInterviewStatePatch(
          existing.deepInterview,
          normalizedInput,
          interviewId,
          currentNow,
          phase,
          lifecycle,
          null,
          approvalHandoff,
          routingApproval,
          {
            lastUpdatedAt: currentNow,
          }
        ),
        pendingQuestion: null,
      };
      return (
        await persist(
          existing.deepInterview,
          existing.approvalFlow,
          nextDeepInterview,
          nextApprovalFlow,
          "recordAnswer"
        )
      ).deepInterview;
    },

    async persistFinalSpecAndSeedApprovalFlow(input) {
      const { normalizedSpecPath, targetPath } = resolveFinalSpecPersistenceTarget(projectRoot, input.specPath);
      const existing = await readSnapshot();
      const currentNow = now();
      mkdirSync(dirname(targetPath), { recursive: true });
      writeFileSync(targetPath, input.content, "utf-8");
      const specReceipt: DeepInterviewSpecReceipt = {
        path: normalizedSpecPath,
        sha256: hashContent(input.content),
        persistedAt: currentNow,
        stage: "final",
      };
      const interviewId = existing.deepInterview?.interviewId ?? "pi-oven-default";
      const nextDeepInterview = {
        version: 2,
        interviewId,
        active: false,
        phase: "complete",
        ...(existing.deepInterview?.threshold !== undefined ? { threshold: existing.deepInterview.threshold } : {}),
        ...(existing.deepInterview?.thresholdSource
          ? { thresholdSource: existing.deepInterview.thresholdSource }
          : {}),
        spec: specReceipt,
        state: {
          rounds: [],
          establishedFacts: existing.deepInterview?.state.establishedFacts ?? [],
          ontologySnapshots: existing.deepInterview?.state.ontologySnapshots ?? [],
          ...(existing.deepInterview?.state.topology ? { topology: existing.deepInterview.state.topology } : {}),
          ...(existing.deepInterview?.state.currentAmbiguity !== undefined
            ? { currentAmbiguity: existing.deepInterview.state.currentAmbiguity }
            : {}),
          ...(existing.deepInterview?.state.milestone ? { milestone: existing.deepInterview.state.milestone } : {}),
          ...(existing.deepInterview?.state.nextTarget ? { nextTarget: existing.deepInterview.state.nextTarget } : {}),
          ...(existing.deepInterview?.state.initialIdea ? { initialIdea: existing.deepInterview.state.initialIdea } : {}),
        },
        pendingQuestion: null,
        approvalHandoff: null,
        routingApproval: null,
        lastUpdatedAt: currentNow,
      };
      const nextApprovalFlow: ApprovalFlowState = {
        version: 1,
        active: true,
        kind: "spec-handoff",
        source: input.source ?? "brainstorming",
        decisionKey: input.decisionKey,
        summary: input.summary,
        status: "pending",
        ...(input.recommended !== undefined ? { recommended: { index: input.recommended } } : {}),
        ...(input.question
          ? {
              pendingQuestion: {
                question: input.question,
                askedAt: currentNow,
                ...(input.recommended !== undefined ? { recommended: input.recommended } : {}),
              },
            }
          : {}),
        resumedFrom: {
          interviewId,
          specPath: normalizedSpecPath,
        },
        requestedAt: currentNow,
      };
      return persist(
        existing.deepInterview,
        existing.approvalFlow,
        nextDeepInterview,
        nextApprovalFlow,
        "persistFinalSpecAndSeedApprovalFlow",
        true
      ) as Promise<{ deepInterview: DeepInterviewState; approvalFlow: ApprovalFlowState }>;
    },
  };
  return runtime;
}
