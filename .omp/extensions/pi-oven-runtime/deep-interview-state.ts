import { createHash } from "crypto";
import { ROLES, type Role } from "../../../scripts/pi-oven-setup/profiles";
import {
  SUPPORTED_SESSION_PROVIDER_FAMILIES,
  type ModelRoutingApprovalBucket,
  type ModelRoutingApprovalPayload,
  type ModelRoutingApprovalRecord,
  type SessionProviderFamily,
} from "./model-routing-approval";

export type DeepInterviewStage = "topology" | "round" | "closure" | "approval";
export type DeepInterviewPhase = "idle" | "interviewing" | "handoff" | "complete";
export type DeepInterviewRoundLifecycle = "pending" | "answered" | "scored" | "cancelled";
export type DeepInterviewApprovalStatus = "pending" | "approved" | "rejected" | "cancelled";
export type DeepInterviewMilestone = "initial" | "progress" | "refined" | "ready";
export type DeepInterviewDimension = "goal" | "constraints" | "criteria" | "context";
export type DeepInterviewThresholdSource = "session" | "project" | "user" | "default";
export type ApprovalFlowKind = "spec-handoff" | "routing-bucket" | "routing-role";
export type ApprovalFlowSource = "brainstorming" | "setup" | "status" | "manual";
export type ApprovalFlowStatus = "pending" | "approved" | "rejected" | "cancelled";

export interface DeepInterviewApprovalHandoffMeta {
  decisionKey: string;
  summary: string;
}

export interface DeepInterviewEstablishedFact {
  summary: string;
  sourceRoundKey?: string;
  componentId?: string;
  dimension?: DeepInterviewDimension;
}

export interface DeepInterviewTopologyNode {
  id: string;
  label: string;
  kind?: string;
}

export interface DeepInterviewTopologyEdge {
  from: string;
  to: string;
  label?: string;
}

export interface DeepInterviewTopology {
  confirmed?: boolean;
  summary?: string;
  nodes: DeepInterviewTopologyNode[];
  edges?: DeepInterviewTopologyEdge[];
}

export interface DeepInterviewOntologySnapshot {
  id?: string;
  summary: string;
  capturedAt?: string;
  stable?: boolean;
}

export interface DeepInterviewNextTarget {
  componentId: string;
  dimension: DeepInterviewDimension;
  rationale: string;
}

export interface DeepInterviewSpecReceipt {
  path: string;
  sha256: string;
  persistedAt: string;
  stage: "draft" | "final";
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
  ambiguityAtAsk?: number;
  approvalHandoff?: DeepInterviewApprovalHandoffMeta;
  routingApproval?: ModelRoutingApprovalPayload;
  threshold?: number;
  thresholdSource?: DeepInterviewThresholdSource;
  scores?: Partial<Record<DeepInterviewDimension, number>>;
  triggers?: string[];
  topologySummary?: string;
  ontologySummary?: string;
  milestone?: DeepInterviewMilestone;
  nextTarget?: DeepInterviewNextTarget;
  establishedFacts?: DeepInterviewEstablishedFact[];
  topology?: DeepInterviewTopology;
  ontologySnapshot?: DeepInterviewOntologySnapshot;
  currentAmbiguity?: number;
  initialIdea?: string;
  spec?: DeepInterviewSpecReceipt;
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
  ambiguityAtAsk?: number;
  ambiguity?: number;
  recommended?: number;
  lifecycle: DeepInterviewRoundLifecycle;
  askedAt: string;
  answeredAt?: string;
  scores?: Partial<Record<DeepInterviewDimension, number>>;
  triggers?: string[];
  topologySummary?: string;
  ontologySummary?: string;
  milestone?: DeepInterviewMilestone;
  nextTarget?: DeepInterviewNextTarget;
  approvalHandoff?: DeepInterviewApprovalHandoff;
  routingApproval?: ModelRoutingApprovalPayload;
}

export interface DeepInterviewPendingQuestion {
  roundKey: string;
  question: string;
  recommended?: number;
  askedAt: string;
  meta: DeepInterviewAskMetadata;
}

export interface ApprovalFlowAskMetadata {
  kind: ApprovalFlowKind;
  source: ApprovalFlowSource;
  decisionKey: string;
  summary: string;
  routingApproval?: ModelRoutingApprovalPayload;
  resumedFrom?: { interviewId?: string; specPath?: string };
  status?: ApprovalFlowStatus;
}

export interface ApprovalFlowPendingQuestion {
  question: string;
  askedAt: string;
  recommended?: number;
}

export interface ApprovalFlowState {
  version: 1;
  active: boolean;
  kind: ApprovalFlowKind;
  source: ApprovalFlowSource;
  decisionKey: string;
  summary: string;
  status: ApprovalFlowStatus;
  recommended?: unknown;
  resolved?: unknown;
  pendingQuestion?: ApprovalFlowPendingQuestion;
  resumedFrom?: { interviewId?: string; specPath?: string };
  requestedAt: string;
  resolvedAt?: string;
  routingApproval?: ModelRoutingApprovalPayload;
}

export interface DeepInterviewState {
  version: 2;
  interviewId: string;
  active: boolean;
  phase: DeepInterviewPhase;
  threshold?: number;
  thresholdSource?: DeepInterviewThresholdSource;
  spec?: DeepInterviewSpecReceipt;
  pendingQuestion?: DeepInterviewPendingQuestion;
  state: {
    initialIdea?: string;
    rounds: DeepInterviewRoundRecord[];
    establishedFacts: DeepInterviewEstablishedFact[];
    topology?: DeepInterviewTopology;
    ontologySnapshots: DeepInterviewOntologySnapshot[];
    currentAmbiguity?: number;
    milestone?: DeepInterviewMilestone;
    nextTarget?: DeepInterviewNextTarget;
  };
  approvalHandoff?: DeepInterviewApprovalHandoff;
  routingApproval?: ModelRoutingApprovalPayload;
  lastUpdatedAt?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function asBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function asRole(value: unknown): Role | undefined {
  return typeof value === "string" && ROLES.includes(value as Role) ? (value as Role) : undefined;
}

function asStage(value: unknown): DeepInterviewStage | undefined {
  return value === "topology" || value === "round" || value === "closure" || value === "approval"
    ? value
    : undefined;
}

function asPhase(value: unknown): DeepInterviewPhase | undefined {
  if (value === "approval_pending" || value === "ready_to_resume") return "handoff";
  return value === "idle" || value === "interviewing" || value === "handoff" || value === "complete"
    ? value
    : undefined;
}

function asLifecycle(value: unknown): DeepInterviewRoundLifecycle | undefined {
  return value === "pending" || value === "answered" || value === "scored" || value === "cancelled"
    ? value
    : undefined;
}

function asApprovalStatus(value: unknown): DeepInterviewApprovalStatus | undefined {
  return value === "pending" || value === "approved" || value === "rejected" || value === "cancelled"
    ? value
    : undefined;
}

function asMilestone(value: unknown): DeepInterviewMilestone | undefined {
  return value === "initial" || value === "progress" || value === "refined" || value === "ready"
    ? value
    : undefined;
}

function asThresholdSource(value: unknown): DeepInterviewThresholdSource | undefined {
  return value === "session" || value === "project" || value === "user" || value === "default"
    ? value
    : undefined;
}

function asDimension(value: unknown): DeepInterviewDimension | undefined {
  return value === "goal" || value === "constraints" || value === "criteria" || value === "context"
    ? value
    : undefined;
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

function normalizeRoutingApprovalBucket(value: unknown): ModelRoutingApprovalBucket | undefined {
  if (!isRecord(value)) return undefined;
  const bucketKey = asString(value.bucketKey);
  const recommendedSelector = asString(value.recommendedSelector);
  const roles = Array.isArray(value.roles)
    ? value.roles.map((role) => asRole(role)).filter((role): role is Role => role !== undefined)
    : [];
  if (!bucketKey || !recommendedSelector || roles.length === 0) return undefined;
  return {
    bucketKey,
    recommendedSelector,
    roles,
  };
}

function normalizeRoutingApprovalRecord(
  value: unknown,
  fallbackRole?: Role
): ModelRoutingApprovalRecord | undefined {
  if (!isRecord(value)) return undefined;
  const role = asRole(value.role) ?? fallbackRole;
  const bucketKey = asString(value.bucketKey);
  const status =
    value.status === "pending" || value.status === "approved" || value.status === "overridden"
      ? value.status
      : undefined;
  const recommendedSelector = asString(value.recommendedSelector);
  const selectedSelector = asString(value.selectedSelector);
  if (!role || !bucketKey || !status || !recommendedSelector || !selectedSelector) return undefined;
  return {
    role,
    bucketKey,
    status,
    recommendedSelector,
    selectedSelector,
  };
}

function asSessionProviderFamily(value: unknown): SessionProviderFamily | undefined {
  const normalized = asString(value)?.toLowerCase();
  return normalized &&
    SUPPORTED_SESSION_PROVIDER_FAMILIES.includes(normalized as SessionProviderFamily)
    ? (normalized as SessionProviderFamily)
    : undefined;
}

function resolveRoutingApprovalSessionProviderFamily(
  value: Record<string, unknown>,
  recommendedByRole: Partial<Record<Role, string>>,
  buckets: ModelRoutingApprovalBucket[],
  approvals: Partial<Record<Role, ModelRoutingApprovalRecord>>
): SessionProviderFamily | undefined {
  const explicit = asSessionProviderFamily(value.sessionProviderFamily);
  if (explicit) return explicit;

  for (const selector of Object.values(recommendedByRole)) {
    const family = asSessionProviderFamily(selector.split("/", 1)[0]);
    if (family) return family;
  }
  for (const bucket of buckets) {
    const bucketFamily =
      asSessionProviderFamily(bucket.bucketKey.split("/", 1)[0]) ??
      asSessionProviderFamily(bucket.recommendedSelector.split("/", 1)[0]);
    if (bucketFamily) return bucketFamily;
  }
  for (const record of Object.values(approvals)) {
    if (!record) continue;
    const recordFamily =
      asSessionProviderFamily(record.bucketKey.split("/", 1)[0]) ??
      asSessionProviderFamily(record.recommendedSelector.split("/", 1)[0]) ??
      asSessionProviderFamily(record.selectedSelector.split("/", 1)[0]);
    if (recordFamily) return recordFamily;
  }
  return undefined;
}

function normalizeRoutingApprovalPayload(value: unknown): ModelRoutingApprovalPayload | undefined {
  if (!isRecord(value)) return undefined;

  const recommendedByRole = {} as Partial<Record<Role, string>>;
  if (isRecord(value.recommendedByRole)) {
    for (const role of ROLES) {
      const selector = asString(value.recommendedByRole[role]);
      if (selector) recommendedByRole[role] = selector;
    }
  }

  const buckets = Array.isArray(value.buckets)
    ? value.buckets
        .map((entry) => normalizeRoutingApprovalBucket(entry))
        .filter((entry): entry is ModelRoutingApprovalBucket => entry !== undefined)
    : [];

  const approvals = {} as Partial<Record<Role, ModelRoutingApprovalRecord>>;
  if (isRecord(value.approvals)) {
    for (const role of ROLES) {
      const record = normalizeRoutingApprovalRecord(value.approvals[role], role);
      if (record) approvals[role] = record;
    }
  }

  const sessionProviderFamily = resolveRoutingApprovalSessionProviderFamily(
    value,
    recommendedByRole,
    buckets,
    approvals
  );
  if (!sessionProviderFamily) return undefined;

  return {
    sessionProviderFamily,
    recommendedByRole,
    buckets,
    approvals,
  };
}

function normalizeEstablishedFact(value: unknown): DeepInterviewEstablishedFact | undefined {
  if (typeof value === "string" && value.trim().length > 0) return { summary: value };
  if (!isRecord(value)) return undefined;
  const summary = asString(value.summary);
  if (!summary) return undefined;
  const sourceRoundKey = asString(value.sourceRoundKey);
  const componentId = asString(value.componentId);
  const dimension = asDimension(value.dimension);
  return {
    summary,
    ...(sourceRoundKey ? { sourceRoundKey } : {}),
    ...(componentId ? { componentId } : {}),
    ...(dimension ? { dimension } : {}),
  };
}

function normalizeTopologyNode(value: unknown): DeepInterviewTopologyNode | undefined {
  if (!isRecord(value)) return undefined;
  const id = asString(value.id);
  const label = asString(value.label);
  const kind = asString(value.kind);
  if (!id || !label) return undefined;
  return {
    id,
    label,
    ...(kind ? { kind } : {}),
  };
}

function normalizeTopologyEdge(value: unknown): DeepInterviewTopologyEdge | undefined {
  if (!isRecord(value)) return undefined;
  const from = asString(value.from);
  const to = asString(value.to);
  const label = asString(value.label);
  if (!from || !to) return undefined;
  return {
    from,
    to,
    ...(label ? { label } : {}),
  };
}

function normalizeTopology(value: unknown): DeepInterviewTopology | undefined {
  if (!isRecord(value)) return undefined;
  const nodes = Array.isArray(value.nodes)
    ? value.nodes.map((entry) => normalizeTopologyNode(entry)).filter((entry): entry is DeepInterviewTopologyNode => entry !== undefined)
    : [];
  if (nodes.length === 0) return undefined;
  const confirmed = asBoolean(value.confirmed);
  const summary = asString(value.summary);
  const edges = Array.isArray(value.edges)
    ? value.edges.map((entry) => normalizeTopologyEdge(entry)).filter((entry): entry is DeepInterviewTopologyEdge => entry !== undefined)
    : [];
  return {
    nodes,
    ...(confirmed !== undefined ? { confirmed } : {}),
    ...(summary ? { summary } : {}),
    ...(edges.length > 0 ? { edges } : {}),
  };
}

function normalizeOntologySnapshot(value: unknown): DeepInterviewOntologySnapshot | undefined {
  if (!isRecord(value)) return undefined;
  const summary = asString(value.summary);
  if (!summary) return undefined;
  const id = asString(value.id);
  const capturedAt = asString(value.capturedAt);
  const stable = asBoolean(value.stable);
  return {
    summary,
    ...(id ? { id } : {}),
    ...(capturedAt ? { capturedAt } : {}),
    ...(stable !== undefined ? { stable } : {}),
  };
}

function normalizeNextTarget(value: unknown): DeepInterviewNextTarget | undefined {
  if (!isRecord(value)) return undefined;
  const componentId = asString(value.componentId);
  const dimension = asDimension(value.dimension);
  const rationale = asString(value.rationale);
  if (!componentId || !dimension || !rationale) return undefined;
  return {
    componentId,
    dimension,
    rationale,
  };
}

function normalizeSpecReceipt(value: unknown): DeepInterviewSpecReceipt | undefined {
  if (!isRecord(value)) return undefined;
  const path = asString(value.path);
  const sha256 = asString(value.sha256);
  const persistedAt = asString(value.persistedAt);
  const stage = value.stage === "draft" || value.stage === "final" ? value.stage : undefined;
  if (!path || !sha256 || !persistedAt || !stage) return undefined;
  return {
    path,
    sha256,
    persistedAt,
    stage,
  };
}

function normalizeScores(
  value: unknown
): Partial<Record<DeepInterviewDimension, number>> | undefined {
  if (!isRecord(value)) return undefined;
  const scores = {} as Partial<Record<DeepInterviewDimension, number>>;
  for (const key of ["goal", "constraints", "criteria", "context"] as const) {
    const score = asNumber(value[key]);
    if (score !== undefined) scores[key] = score;
  }
  return Object.keys(scores).length > 0 ? scores : undefined;
}

function normalizeTriggers(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const triggers = value.map((entry) => asString(entry)).filter((entry): entry is string => entry !== undefined);
  return triggers.length > 0 ? Array.from(new Set(triggers)) : undefined;
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
  const ambiguityAtAsk = asNumber(value.ambiguityAtAsk);
  const approval = isRecord(value.approvalHandoff)
    ? (() => {
        const decisionKey = asString(value.approvalHandoff.decisionKey);
        const summary = asString(value.approvalHandoff.summary);
        if (!decisionKey || !summary) return undefined;
        return { decisionKey, summary } satisfies DeepInterviewApprovalHandoffMeta;
      })()
    : undefined;
  const routingApproval = normalizeRoutingApprovalPayload(value.routingApproval);
  const threshold = asNumber(value.threshold);
  const thresholdSource = asThresholdSource(value.thresholdSource);
  const scores = normalizeScores(value.scores);
  const triggers = normalizeTriggers(value.triggers);
  const topologySummary = asString(value.topologySummary);
  const ontologySummary = asString(value.ontologySummary);
  const milestone = asMilestone(value.milestone);
  const nextTarget = normalizeNextTarget(value.nextTarget);
  const establishedFacts = Array.isArray(value.establishedFacts)
    ? value.establishedFacts
        .map((entry) => normalizeEstablishedFact(entry))
        .filter((entry): entry is DeepInterviewEstablishedFact => entry !== undefined)
    : [];
  const topology = normalizeTopology(value.topology);
  const ontologySnapshot = normalizeOntologySnapshot(value.ontologySnapshot);
  const currentAmbiguity = asNumber(value.currentAmbiguity);
  const initialIdea = asString(value.initialIdea);
  const spec = normalizeSpecReceipt(value.spec);
  return {
    ...(interviewId ? { interviewId } : {}),
    round,
    ...(roundId ? { roundId } : {}),
    ...(questionId ? { questionId } : {}),
    stage,
    ...(component ? { component } : {}),
    ...(dimension ? { dimension } : {}),
    ...(ambiguity !== undefined ? { ambiguity } : {}),
    ...(ambiguityAtAsk !== undefined ? { ambiguityAtAsk } : {}),
    ...(approval ? { approvalHandoff: approval } : {}),
    ...(routingApproval ? { routingApproval } : {}),
    ...(threshold !== undefined ? { threshold } : {}),
    ...(thresholdSource ? { thresholdSource } : {}),
    ...(scores ? { scores } : {}),
    ...(triggers ? { triggers } : {}),
    ...(topologySummary ? { topologySummary } : {}),
    ...(ontologySummary ? { ontologySummary } : {}),
    ...(milestone ? { milestone } : {}),
    ...(nextTarget ? { nextTarget } : {}),
    ...(establishedFacts.length > 0 ? { establishedFacts } : {}),
    ...(topology ? { topology } : {}),
    ...(ontologySnapshot ? { ontologySnapshot } : {}),
    ...(currentAmbiguity !== undefined ? { currentAmbiguity } : {}),
    ...(initialIdea ? { initialIdea } : {}),
    ...(spec ? { spec } : {}),
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
  if (!roundKey || !interviewId || round === undefined || !stage || !question || !questionHash || !lifecycle || !askedAt) {
    return undefined;
  }
  const roundId = asString(value.roundId);
  const questionId = asString(value.questionId);
  const answerHash = asString(value.answerHash);
  const selected = asString(value.selected);
  const customInput = asString(value.customInput);
  const component = asString(value.component);
  const dimension = asString(value.dimension);
  const ambiguityAtAsk = asNumber(value.ambiguityAtAsk);
  const ambiguity = asNumber(value.ambiguity);
  const recommended = asNumber(value.recommended);
  const answeredAt = asString(value.answeredAt);
  const scores = normalizeScores(value.scores);
  const triggers = normalizeTriggers(value.triggers);
  const topologySummary = asString(value.topologySummary);
  const ontologySummary = asString(value.ontologySummary);
  const milestone = asMilestone(value.milestone);
  const nextTarget = normalizeNextTarget(value.nextTarget);
  const approvalHandoff = normalizeApprovalHandoff(value.approvalHandoff);
  const routingApproval = normalizeRoutingApprovalPayload(value.routingApproval);
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
    ...(ambiguityAtAsk !== undefined ? { ambiguityAtAsk } : {}),
    ...(ambiguity !== undefined ? { ambiguity } : {}),
    ...(recommended !== undefined ? { recommended } : {}),
    ...(answeredAt ? { answeredAt } : {}),
    ...(scores ? { scores } : {}),
    ...(triggers ? { triggers } : {}),
    ...(topologySummary ? { topologySummary } : {}),
    ...(ontologySummary ? { ontologySummary } : {}),
    ...(milestone ? { milestone } : {}),
    ...(nextTarget ? { nextTarget } : {}),
    ...(approvalHandoff ? { approvalHandoff } : {}),
    ...(routingApproval ? { routingApproval } : {}),
  };
}

function normalizeApprovalFlowPendingQuestion(value: unknown): ApprovalFlowPendingQuestion | undefined {
  if (!isRecord(value)) return undefined;
  const question = asString(value.question);
  const askedAt = asString(value.askedAt);
  if (!question || !askedAt) return undefined;
  const recommended = asNumber(value.recommended);
  return {
    question,
    askedAt,
    ...(recommended !== undefined ? { recommended } : {}),
  };
}

function resolveLegacyApprovalArtifacts(
  deepInterview: DeepInterviewState | undefined
): {
  approvalHandoff?: DeepInterviewApprovalHandoff;
  routingApproval?: ModelRoutingApprovalPayload;
  pendingQuestion?: ApprovalFlowPendingQuestion;
} {
  if (!deepInterview) return {};
  const roundApproval = [...deepInterview.state.rounds].reverse().find((round) => round.approvalHandoff)?.approvalHandoff;
  const roundRouting = [...deepInterview.state.rounds].reverse().find((round) => round.routingApproval)?.routingApproval;
  const pendingQuestion =
    deepInterview.pendingQuestion?.meta.stage === "approval"
      ? {
          question: deepInterview.pendingQuestion.question,
          askedAt: deepInterview.pendingQuestion.askedAt,
          ...(deepInterview.pendingQuestion.recommended !== undefined
            ? { recommended: deepInterview.pendingQuestion.recommended }
            : {}),
        }
      : undefined;
  const pendingApprovalHandoff: DeepInterviewApprovalHandoff | undefined = deepInterview.pendingQuestion?.meta
    .approvalHandoff
    ? {
        ...deepInterview.pendingQuestion.meta.approvalHandoff,
        status: "pending",
        requestedAt: deepInterview.pendingQuestion.askedAt,
      }
    : undefined;
  const approvalHandoff =
    deepInterview.approvalHandoff?.status && deepInterview.approvalHandoff.status !== "pending"
      ? deepInterview.approvalHandoff
      : roundApproval?.status && roundApproval.status !== "pending"
        ? roundApproval
        : deepInterview.approvalHandoff ?? roundApproval ?? pendingApprovalHandoff;
  return {
    approvalHandoff,
    routingApproval:
      deepInterview.routingApproval ??
      deepInterview.pendingQuestion?.meta.routingApproval ??
      roundRouting,
    pendingQuestion,
  };
}

function isRoutingApprovalResolved(payload: ModelRoutingApprovalPayload): boolean {
  return payload.buckets.every((bucket) => bucket.roles.every((role) => payload.approvals[role] !== undefined));
}

function buildLegacyApprovalFlowState(
  deepInterview: DeepInterviewState | undefined
): ApprovalFlowState | undefined {
  const legacy = resolveLegacyApprovalArtifacts(deepInterview);
  if (!legacy.approvalHandoff && !legacy.routingApproval) return undefined;

  const kind: ApprovalFlowKind = legacy.routingApproval ? "routing-bucket" : "spec-handoff";
  const source: ApprovalFlowSource = legacy.routingApproval ? "setup" : "brainstorming";
  const requestedAt =
    legacy.approvalHandoff?.requestedAt ??
    legacy.pendingQuestion?.askedAt ??
    deepInterview?.lastUpdatedAt ??
    new Date(0).toISOString();
  const status: ApprovalFlowStatus = legacy.approvalHandoff
    ? legacy.approvalHandoff.status
    : legacy.routingApproval && isRoutingApprovalResolved(legacy.routingApproval)
      ? "approved"
      : "pending";
  return {
    version: 1,
    active: status === "pending",
    kind,
    source,
    decisionKey: legacy.approvalHandoff?.decisionKey ?? "approve-routing-bucket",
    summary:
      legacy.approvalHandoff?.summary ??
      "Approve the current routing bucket recommendations before resuming execution.",
    status,
    ...(status === "pending" && legacy.pendingQuestion ? { pendingQuestion: legacy.pendingQuestion } : {}),
    resumedFrom: {
      ...(deepInterview?.interviewId ? { interviewId: deepInterview.interviewId } : {}),
      ...(deepInterview?.spec?.path ? { specPath: deepInterview.spec.path } : {}),
    },
    requestedAt,
    ...(legacy.approvalHandoff?.resolvedAt ? { resolvedAt: legacy.approvalHandoff.resolvedAt } : {}),
    ...(legacy.routingApproval ? { routingApproval: legacy.routingApproval } : {}),
  };
}

function reconcileRootApprovalFlowState(
  current: ApprovalFlowState,
  legacy: ApprovalFlowState | undefined
): ApprovalFlowState {
  if (
    !legacy ||
    current.status !== "pending" ||
    legacy.status === "pending" ||
    current.decisionKey !== legacy.decisionKey
  ) {
    return current;
  }

  const mergedRouting = mergeApprovalFlowRoutingState(current, legacy);
  const reconciled: ApprovalFlowState = {
    ...current,
    active: false,
    status: legacy.status,
    ...(legacy.resolvedAt ? { resolvedAt: legacy.resolvedAt } : current.resolvedAt ? { resolvedAt: current.resolvedAt } : {}),
    ...(mergedRouting ? { routingApproval: mergedRouting } : {}),
  };
  const { pendingQuestion: _pendingQuestion, ...withoutPendingQuestion } = reconciled;
  return withoutPendingQuestion;
}

export function normalizeApprovalFlowState(
  value: unknown,
  deepInterview?: DeepInterviewState
): ApprovalFlowState | undefined {
  const legacyState = buildLegacyApprovalFlowState(deepInterview);

  if (isRecord(value)) {
    const active = value.active === true;
    const kind =
      value.kind === "spec-handoff" || value.kind === "routing-bucket" || value.kind === "routing-role"
        ? value.kind
        : undefined;
    const source =
      value.source === "brainstorming" || value.source === "setup" || value.source === "status" || value.source === "manual"
        ? value.source
        : undefined;
    const decisionKey = asString(value.decisionKey);
    const summary = asString(value.summary);
    const status =
      value.status === "pending" ||
      value.status === "approved" ||
      value.status === "rejected" ||
      value.status === "cancelled"
        ? value.status
        : undefined;
    const requestedAt = asString(value.requestedAt);
    if (kind && source && decisionKey && summary && status && requestedAt) {
      const pendingQuestion = normalizeApprovalFlowPendingQuestion(value.pendingQuestion);
      const resumedFrom = isRecord(value.resumedFrom)
        ? {
            ...(asString(value.resumedFrom.interviewId)
              ? { interviewId: asString(value.resumedFrom.interviewId)! }
              : {}),
            ...(asString(value.resumedFrom.specPath) ? { specPath: asString(value.resumedFrom.specPath)! } : {}),
          }
        : undefined;
      const resolvedAt = asString(value.resolvedAt);
      const routingApproval = normalizeRoutingApprovalPayload(value.routingApproval);
      return reconcileRootApprovalFlowState(
        {
          version: 1,
          active,
          kind,
          source,
          decisionKey,
          summary,
          status,
          ...(Object.hasOwn(value, "recommended") ? { recommended: value.recommended } : {}),
          ...(Object.hasOwn(value, "resolved") ? { resolved: value.resolved } : {}),
          ...(pendingQuestion ? { pendingQuestion } : {}),
          ...(resumedFrom && Object.keys(resumedFrom).length > 0 ? { resumedFrom } : {}),
          requestedAt,
          ...(resolvedAt ? { resolvedAt } : {}),
          ...(routingApproval ? { routingApproval } : {}),
        },
        legacyState
      );
    }
  }

  return legacyState;
}

function normalizeRounds(value: Record<string, unknown>, interviewId: string): DeepInterviewRoundRecord[] {
  const stateRecord = isRecord(value.state) ? value.state : undefined;
  const rawRounds = Array.isArray(stateRecord?.rounds) ? stateRecord.rounds : Array.isArray(value.rounds) ? value.rounds : [];
  return rawRounds
    .map((entry) => normalizeRoundRecord(entry, interviewId))
    .filter((entry): entry is DeepInterviewRoundRecord => entry !== undefined);
}

function normalizeEnvelopeState(value: Record<string, unknown>): DeepInterviewState["state"] {
  const stateRecord = isRecord(value.state) ? value.state : undefined;
  const interviewId = asString(value.interviewId) ?? "pi-oven-default";
  const rounds = normalizeRounds(value, interviewId);
  const establishedFacts = Array.isArray(stateRecord?.establishedFacts)
    ? stateRecord.establishedFacts
        .map((entry) => normalizeEstablishedFact(entry))
        .filter((entry): entry is DeepInterviewEstablishedFact => entry !== undefined)
    : [];
  const topology = normalizeTopology(stateRecord?.topology);
  const ontologySnapshots = Array.isArray(stateRecord?.ontologySnapshots)
    ? stateRecord.ontologySnapshots
        .map((entry) => normalizeOntologySnapshot(entry))
        .filter((entry): entry is DeepInterviewOntologySnapshot => entry !== undefined)
    : [];
  const currentAmbiguity = asNumber(stateRecord?.currentAmbiguity);
  const milestone = asMilestone(stateRecord?.milestone);
  const nextTarget = normalizeNextTarget(stateRecord?.nextTarget);
  const initialIdea = asString(stateRecord?.initialIdea) ?? asString(value.initialIdea);
  return {
    rounds,
    establishedFacts,
    ontologySnapshots,
    ...(topology ? { topology } : {}),
    ...(currentAmbiguity !== undefined ? { currentAmbiguity } : {}),
    ...(milestone ? { milestone } : {}),
    ...(nextTarget ? { nextTarget } : {}),
    ...(initialIdea ? { initialIdea } : {}),
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
      version: 2,
      interviewId: "pi-oven-default",
      active: false,
      phase: "idle",
      state: {
        rounds: [],
        establishedFacts: [],
        ontologySnapshots: [],
      },
    };
  }
  const interviewId = asString(value.interviewId) ?? "pi-oven-default";
  const active = value.active === true;
  const threshold = asNumber(value.threshold);
  const thresholdSource = asThresholdSource(value.thresholdSource);
  const spec = normalizeSpecReceipt(value.spec);
  const pendingQuestion = normalizePendingQuestion(value.pendingQuestion);
  const approvalHandoff = normalizeApprovalHandoff(value.approvalHandoff);
  const routingApproval = normalizeRoutingApprovalPayload(value.routingApproval);
  const lastUpdatedAt = asString(value.lastUpdatedAt);
  const state = normalizeEnvelopeState(value);
  const explicitPhase = asPhase(value.phase);
  const phase =
    explicitPhase ??
    (spec?.stage === "final"
      ? "complete"
      : active && (approvalHandoff !== undefined || routingApproval !== undefined)
        ? "handoff"
        : active
          ? "interviewing"
          : "idle");

  return {
    version: 2,
    interviewId,
    active,
    phase,
    ...(threshold !== undefined ? { threshold } : {}),
    ...(thresholdSource ? { thresholdSource } : {}),
    ...(spec ? { spec } : {}),
    ...(pendingQuestion ? { pendingQuestion } : {}),
    state,
    ...(approvalHandoff ? { approvalHandoff } : {}),
    ...(routingApproval ? { routingApproval } : {}),
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
    ...(incoming.resolvedAt
      ? { resolvedAt: incoming.resolvedAt }
      : existing.resolvedAt
        ? { resolvedAt: existing.resolvedAt }
        : {}),
  };
}

function mergeRoutingApprovalPayload(
  existing: ModelRoutingApprovalPayload | undefined,
  incoming: ModelRoutingApprovalPayload | undefined
): ModelRoutingApprovalPayload | undefined {
  if (!existing) return incoming;
  if (!incoming) return existing;

  const mergedBuckets = [...existing.buckets];
  const byBucketKey = new Map<string, number>();
  for (let i = 0; i < mergedBuckets.length; i++) {
    byBucketKey.set(mergedBuckets[i]!.bucketKey, i);
  }
  for (const bucket of incoming.buckets) {
    const index = byBucketKey.get(bucket.bucketKey);
    if (index === undefined) {
      byBucketKey.set(bucket.bucketKey, mergedBuckets.length);
      mergedBuckets.push(bucket);
      continue;
    }
    const existingBucket = mergedBuckets[index]!;
    mergedBuckets[index] = {
      ...existingBucket,
      ...bucket,
      roles: Array.from(new Set([...existingBucket.roles, ...bucket.roles])),
    };
  }

  return {
    sessionProviderFamily: incoming.sessionProviderFamily ?? existing.sessionProviderFamily,
    recommendedByRole: {
      ...existing.recommendedByRole,
      ...incoming.recommendedByRole,
    },
    buckets: mergedBuckets,
    approvals: {
      ...existing.approvals,
      ...incoming.approvals,
    },
  };
}

function lifecycleRank(value: DeepInterviewRoundLifecycle): number {
  switch (value) {
    case "scored":
      return 3;
    case "answered":
    case "cancelled":
      return 2;
    case "pending":
    default:
      return 1;
  }
}

function mergeStringArrays(existing: string[] | undefined, incoming: string[] | undefined): string[] | undefined {
  const merged = Array.from(new Set([...(existing ?? []), ...(incoming ?? [])]));
  return merged.length > 0 ? merged : undefined;
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
    routingApproval: mergeRoutingApprovalPayload(existing.routingApproval, incoming.routingApproval),
    scores: {
      ...(existing.scores ?? {}),
      ...(incoming.scores ?? {}),
    },
    triggers: mergeStringArrays(existing.triggers, incoming.triggers),
  };
  if (!incoming.answeredAt && existing.answeredAt) merged.answeredAt = existing.answeredAt;
  if (!incoming.answerHash && existing.answerHash) merged.answerHash = existing.answerHash;
  if (!incoming.selected && existing.selected) merged.selected = existing.selected;
  if (!incoming.customInput && existing.customInput) merged.customInput = existing.customInput;
  if (Object.keys(merged.scores ?? {}).length === 0) delete merged.scores;
  if (!merged.triggers || merged.triggers.length === 0) delete merged.triggers;
  return merged;
}

function mergeEstablishedFacts(
  existing: DeepInterviewEstablishedFact[],
  incoming: DeepInterviewEstablishedFact[]
): DeepInterviewEstablishedFact[] {
  const merged = [...existing];
  const seen = new Set(existing.map((entry) => `${entry.summary}::${entry.sourceRoundKey ?? ""}`));
  for (const fact of incoming) {
    const key = `${fact.summary}::${fact.sourceRoundKey ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(fact);
  }
  return merged;
}

function mergeTopology(
  existing: DeepInterviewTopology | undefined,
  incoming: DeepInterviewTopology | undefined
): DeepInterviewTopology | undefined {
  if (!existing) return incoming;
  if (!incoming) return existing;
  const nodes = [...existing.nodes];
  const nodeIds = new Set(nodes.map((node) => node.id));
  for (const node of incoming.nodes) {
    if (nodeIds.has(node.id)) continue;
    nodeIds.add(node.id);
    nodes.push(node);
  }
  const edges = Array.from(
    new Map(
      [...(existing.edges ?? []), ...(incoming.edges ?? [])].map((edge) => [`${edge.from}->${edge.to}:${edge.label ?? ""}`, edge])
    ).values()
  );
  return {
    nodes,
    ...(incoming.confirmed !== undefined ? { confirmed: incoming.confirmed } : existing.confirmed !== undefined ? { confirmed: existing.confirmed } : {}),
    ...(incoming.summary ? { summary: incoming.summary } : existing.summary ? { summary: existing.summary } : {}),
    ...(edges.length > 0 ? { edges } : {}),
  };
}

function mergeOntologySnapshots(
  existing: DeepInterviewOntologySnapshot[],
  incoming: DeepInterviewOntologySnapshot[]
): DeepInterviewOntologySnapshot[] {
  const merged = [...existing];
  const seen = new Set(existing.map((entry) => entry.id ?? `${entry.summary}::${entry.capturedAt ?? ""}`));
  for (const snapshot of incoming) {
    const key = snapshot.id ?? `${snapshot.summary}::${snapshot.capturedAt ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(snapshot);
  }
  return merged;
}

function mergeEnvelopeState(
  existing: DeepInterviewState["state"],
  incoming: DeepInterviewState["state"]
): DeepInterviewState["state"] {
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
  for (const round of existing.rounds) addRound(round);
  for (const round of incoming.rounds) addRound(round);
  return {
    rounds: mergedRounds,
    establishedFacts: mergeEstablishedFacts(existing.establishedFacts, incoming.establishedFacts),
    ontologySnapshots: mergeOntologySnapshots(existing.ontologySnapshots, incoming.ontologySnapshots),
    ...(mergeTopology(existing.topology, incoming.topology) ? { topology: mergeTopology(existing.topology, incoming.topology)! } : {}),
    ...(incoming.currentAmbiguity !== undefined
      ? { currentAmbiguity: incoming.currentAmbiguity }
      : existing.currentAmbiguity !== undefined
        ? { currentAmbiguity: existing.currentAmbiguity }
        : {}),
    ...(incoming.milestone ? { milestone: incoming.milestone } : existing.milestone ? { milestone: existing.milestone } : {}),
    ...(incoming.nextTarget ? { nextTarget: incoming.nextTarget } : existing.nextTarget ? { nextTarget: existing.nextTarget } : {}),
    ...(incoming.initialIdea ? { initialIdea: incoming.initialIdea } : existing.initialIdea ? { initialIdea: existing.initialIdea } : {}),
  };
}

function hasOwn(record: Record<string, unknown>, key: string): boolean {
  return Object.hasOwn(record, key);
}

export function mergeDeepInterviewState(existing: unknown, incoming: unknown): DeepInterviewState {
  const existingState = normalizeDeepInterviewState(existing);
  const incomingState = normalizeDeepInterviewState(incoming);
  const incomingRecord = isRecord(incoming) ? incoming : {};
  const hasPendingQuestion = hasOwn(incomingRecord, "pendingQuestion");
  const hasPhase = hasOwn(incomingRecord, "phase");
  const hasActive = hasOwn(incomingRecord, "active");
  const hasInterviewId = hasOwn(incomingRecord, "interviewId");
  const hasLastUpdatedAt = hasOwn(incomingRecord, "lastUpdatedAt");
  const hasThreshold = hasOwn(incomingRecord, "threshold");
  const hasThresholdSource = hasOwn(incomingRecord, "thresholdSource");
  const hasSpec = hasOwn(incomingRecord, "spec");
  const hasState = hasOwn(incomingRecord, "state") || hasOwn(incomingRecord, "rounds");

  return {
    version: 2,
    interviewId: hasInterviewId ? incomingState.interviewId : existingState.interviewId,
    active: hasActive ? incomingState.active : existingState.active,
    phase: hasPhase ? incomingState.phase : existingState.phase,
    ...(hasThreshold
      ? incomingState.threshold !== undefined
        ? { threshold: incomingState.threshold }
        : {}
      : existingState.threshold !== undefined
        ? { threshold: existingState.threshold }
        : {}),
    ...(hasThresholdSource
      ? incomingState.thresholdSource
        ? { thresholdSource: incomingState.thresholdSource }
        : {}
      : existingState.thresholdSource
        ? { thresholdSource: existingState.thresholdSource }
        : {}),
    ...(hasSpec
      ? incomingState.spec
        ? { spec: incomingState.spec }
        : {}
      : existingState.spec
        ? { spec: existingState.spec }
        : {}),
    ...(hasPendingQuestion
      ? incomingState.pendingQuestion
        ? { pendingQuestion: incomingState.pendingQuestion }
        : {}
      : existingState.pendingQuestion
        ? { pendingQuestion: existingState.pendingQuestion }
        : {}),
    state: hasState ? mergeEnvelopeState(existingState.state, incomingState.state) : existingState.state,
    ...(hasLastUpdatedAt
      ? incomingState.lastUpdatedAt
        ? { lastUpdatedAt: incomingState.lastUpdatedAt }
        : {}
      : existingState.lastUpdatedAt
        ? { lastUpdatedAt: existingState.lastUpdatedAt }
        : {}),
  };
}

function mergeApprovalFlowRoutingState(
  existing: ApprovalFlowState | undefined,
  incoming: ApprovalFlowState | undefined
): ModelRoutingApprovalPayload | undefined {
  return mergeRoutingApprovalPayload(existing?.routingApproval, incoming?.routingApproval);
}

export function mergeApprovalFlowState(
  existing: unknown,
  incoming: unknown,
  deepInterview?: DeepInterviewState
): ApprovalFlowState | undefined {
  const existingState = normalizeApprovalFlowState(existing, deepInterview);
  const incomingState = normalizeApprovalFlowState(incoming, deepInterview);
  if (!existingState) return incomingState;
  if (!incomingState) return existingState;
  return {
    version: 1,
    active: incomingState.active,
    kind: incomingState.kind,
    source: incomingState.source,
    decisionKey: incomingState.decisionKey,
    summary: incomingState.summary,
    status: incomingState.status,
    ...(Object.hasOwn(incomingState, "recommended") ? { recommended: incomingState.recommended } : Object.hasOwn(existingState, "recommended") ? { recommended: existingState.recommended } : {}),
    ...(Object.hasOwn(incomingState, "resolved") ? { resolved: incomingState.resolved } : Object.hasOwn(existingState, "resolved") ? { resolved: existingState.resolved } : {}),
    ...(incomingState.pendingQuestion ? { pendingQuestion: incomingState.pendingQuestion } : {}),
    ...(incomingState.resumedFrom ?? existingState.resumedFrom
      ? {
          resumedFrom: {
            ...(existingState.resumedFrom ?? {}),
            ...(incomingState.resumedFrom ?? {}),
          },
        }
      : {}),
    requestedAt: incomingState.requestedAt,
    ...(incomingState.resolvedAt ? { resolvedAt: incomingState.resolvedAt } : existingState.resolvedAt ? { resolvedAt: existingState.resolvedAt } : {}),
    ...(mergeApprovalFlowRoutingState(existingState, incomingState)
      ? { routingApproval: mergeApprovalFlowRoutingState(existingState, incomingState)! }
      : {}),
  };
}
