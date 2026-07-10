import {
  DEFAULT_PROFILE,
  ROLES,
  type ProfileMap,
  type Role,
} from "../../../scripts/pi-oven-setup/profiles";
import { isOpenAiCodexSelector } from "../../../scripts/pi-oven-setup/model-id-validator";

export const SUPPORTED_SESSION_PROVIDER_FAMILIES = ["openai-codex"] as const;

export type SessionProviderFamily = (typeof SUPPORTED_SESSION_PROVIDER_FAMILIES)[number];
export type ModelRoutingApprovalStatus = "pending" | "approved" | "overridden";
export type ModelRoutingApprovalDiagnosticCode =
  | "non_codex_session_provider";

export interface ModelRoutingApprovalBucket {
  bucketKey: string;
  recommendedSelector: string;
  roles: Role[];
}

export interface ModelRoutingApprovalRecord {
  role: Role;
  bucketKey: string;
  status: ModelRoutingApprovalStatus;
  recommendedSelector: string;
  selectedSelector: string;
}

export interface ModelRoutingApprovalDiagnostic {
  code: ModelRoutingApprovalDiagnosticCode;
  sessionProviderFamily: string;
  supportedProviderFamilies: SessionProviderFamily[];
  message: string;
}

export interface ModelRoutingApprovalPayload {
  sessionProviderFamily: SessionProviderFamily;
  diagnostics?: ModelRoutingApprovalDiagnostic[];
  recommendedByRole: Partial<Record<Role, string>>;
  buckets: ModelRoutingApprovalBucket[];
  approvals: Partial<Record<Role, ModelRoutingApprovalRecord>>;
}

export interface MaterializeRoutingApprovalOptions {
  sessionProviderFamily: string;
  existingApprovals?: Partial<Record<Role, ModelRoutingApprovalRecord>>;
  profile?: ProfileMap;
}

export interface ApplyBucketApprovalDecisionInput {
  bucketKey: string;
  approved: boolean;
  overrides?: Partial<Record<Role, string>>;
}

export class ModelRoutingApprovalError extends Error {
  diagnostic: ModelRoutingApprovalDiagnostic;

  constructor(diagnostic: ModelRoutingApprovalDiagnostic) {
    super(diagnostic.message);
    this.name = "ModelRoutingApprovalError";
    this.diagnostic = diagnostic;
  }
}

function normalizeProviderFamily(providerFamily: string): string {
  return providerFamily.trim().toLowerCase();
}


function resolveRoutingDiagnostics(
  sessionProviderFamily: string
): { sessionProviderFamily: SessionProviderFamily; diagnostics: ModelRoutingApprovalDiagnostic[] } {
  const normalized = normalizeProviderFamily(sessionProviderFamily);
  const displayFamily = normalized || "(missing)";
  const supportedFamilies = [...SUPPORTED_SESSION_PROVIDER_FAMILIES];
  if (displayFamily !== "openai-codex") {
    return {
      sessionProviderFamily: "openai-codex",
      diagnostics: [{
      code: "non_codex_session_provider",
      sessionProviderFamily: displayFamily,
      supportedProviderFamilies: supportedFamilies,
      message:
        `Current session provider family "${displayFamily}" differs from pi-oven's codex-only routing default; using openai-codex recommendations.`,
      }],
    };
  }

  return { sessionProviderFamily: "openai-codex", diagnostics: [] };
}

export function materializeRoutingApprovalPayload(
  {
    sessionProviderFamily,
    existingApprovals = {},
    profile = DEFAULT_PROFILE,
  }: MaterializeRoutingApprovalOptions
): ModelRoutingApprovalPayload {
  const { sessionProviderFamily: resolvedFamily, diagnostics } =
    resolveRoutingDiagnostics(sessionProviderFamily);
  const recommendedByRole = {} as Record<Role, string>;
  const rolesByBucket = new Map<string, Role[]>();

  for (const role of ROLES) {
    const entry = profile[role];
    const selector = `${entry.primary}:${entry.thinkingLevel}`;
    recommendedByRole[role] = selector;
    const bucketRoles = rolesByBucket.get(selector);
    if (bucketRoles) {
      bucketRoles.push(role);
    } else {
      rolesByBucket.set(selector, [role]);
    }
  }

  const approvals: Partial<Record<Role, ModelRoutingApprovalRecord>> = {};
  for (const role of ROLES) {
    const existing = existingApprovals[role];
    if (!existing) continue;
    if (
      !isOpenAiCodexSelector(existing.recommendedSelector) ||
      !isOpenAiCodexSelector(existing.selectedSelector)
    ) {
      continue;
    }
    approvals[role] = {
      role,
      bucketKey: existing.bucketKey,
      status: existing.status,
      recommendedSelector: existing.recommendedSelector || recommendedByRole[role],
      selectedSelector:
        existing.selectedSelector || existing.recommendedSelector || recommendedByRole[role],
    };
  }

  return {
    sessionProviderFamily: resolvedFamily,
    diagnostics,
    recommendedByRole,
    buckets: Array.from(rolesByBucket.entries()).map(([bucketKey, roles]) => ({
      bucketKey,
      recommendedSelector: bucketKey,
      roles,
    })),
    approvals,
  };
}

export function applyBucketApprovalDecision(
  payload: ModelRoutingApprovalPayload,
  decision: ApplyBucketApprovalDecisionInput
): ModelRoutingApprovalPayload {
  const bucket = payload.buckets.find((entry) => entry.bucketKey === decision.bucketKey);
  if (!bucket) return payload;

  const approvals: Partial<Record<Role, ModelRoutingApprovalRecord>> = { ...payload.approvals };
  for (const role of bucket.roles) {
    const recommendedSelector = payload.recommendedByRole[role] ?? bucket.recommendedSelector;
    const rawSelectedSelector = decision.approved
      ? recommendedSelector
      : decision.overrides?.[role] ?? approvals[role]?.selectedSelector ?? recommendedSelector;
    const selectedSelector = isOpenAiCodexSelector(rawSelectedSelector)
      ? rawSelectedSelector
      : recommendedSelector;
    approvals[role] = {
      role,
      bucketKey: bucket.bucketKey,
      status: decision.approved ? "approved" : "overridden",
      recommendedSelector,
      selectedSelector,
    };
  }

  return {
    ...payload,
    approvals,
  };
}
