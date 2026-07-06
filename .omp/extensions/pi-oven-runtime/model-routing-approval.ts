import {
  PROFILE_A,
  PROFILE_C,
  PROFILE_D,
  ROLES,
  type ProfileMap,
  type Role,
} from "../../../scripts/pi-oven-setup/profiles";

export const SUPPORTED_SESSION_PROVIDER_FAMILIES = [
  "openai-codex",
  "anthropic",
  "opencode-zen",
] as const;

export type SessionProviderFamily = (typeof SUPPORTED_SESSION_PROVIDER_FAMILIES)[number];
export type ModelRoutingApprovalStatus = "pending" | "approved" | "overridden";
export type ModelRoutingApprovalDiagnosticCode =
  | "unsupported_provider_family"
  | "unmapped_provider_family";

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
  recommendedByRole: Partial<Record<Role, string>>;
  buckets: ModelRoutingApprovalBucket[];
  approvals: Partial<Record<Role, ModelRoutingApprovalRecord>>;
}

export interface MaterializeRoutingApprovalOptions {
  sessionProviderFamily: string;
  existingApprovals?: Partial<Record<Role, ModelRoutingApprovalRecord>>;
  profilesByProviderFamily?: Partial<Record<SessionProviderFamily, ProfileMap>>;
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

const DEFAULT_PROFILES_BY_PROVIDER_FAMILY: Record<SessionProviderFamily, ProfileMap> = {
  "openai-codex": PROFILE_A,
  anthropic: PROFILE_C,
  "opencode-zen": PROFILE_D,
};

function normalizeProviderFamily(providerFamily: string): string {
  return providerFamily.trim().toLowerCase();
}


function resolveRoutingProfileForProviderFamily(
  sessionProviderFamily: string,
  profilesByProviderFamily: Partial<Record<SessionProviderFamily, ProfileMap>> = DEFAULT_PROFILES_BY_PROVIDER_FAMILY
): { sessionProviderFamily: SessionProviderFamily; profile: ProfileMap } {
  const normalized = normalizeProviderFamily(sessionProviderFamily);
  const displayFamily = normalized || "(missing)";
  const supportedFamilies = [...SUPPORTED_SESSION_PROVIDER_FAMILIES];
  if (!SUPPORTED_SESSION_PROVIDER_FAMILIES.includes(normalized as SessionProviderFamily)) {
    throw new ModelRoutingApprovalError({
      code: "unsupported_provider_family",
      sessionProviderFamily: displayFamily,
      supportedProviderFamilies: supportedFamilies,
      message:
        `Current session provider family "${displayFamily}" is unsupported for runtime routing approval. ` +
        `Supported families: ${supportedFamilies.join(", ")}.`,
    });
  }

  const resolvedFamily = normalized as SessionProviderFamily;
  const profile = profilesByProviderFamily[resolvedFamily];
  if (!profile) {
    throw new ModelRoutingApprovalError({
      code: "unmapped_provider_family",
      sessionProviderFamily: resolvedFamily,
      supportedProviderFamilies: supportedFamilies,
      message:
        `Current session provider family "${resolvedFamily}" does not map to a supported release path. ` +
        `Supported families: ${supportedFamilies.join(", ")}.`,
    });
  }

  return { sessionProviderFamily: resolvedFamily, profile };
}

export function materializeRoutingApprovalPayload(
  {
    sessionProviderFamily,
    existingApprovals = {},
    profilesByProviderFamily = DEFAULT_PROFILES_BY_PROVIDER_FAMILY,
  }: MaterializeRoutingApprovalOptions
): ModelRoutingApprovalPayload {
  const { sessionProviderFamily: resolvedFamily, profile } = resolveRoutingProfileForProviderFamily(
    sessionProviderFamily,
    profilesByProviderFamily
  );
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
    const selectedSelector = decision.approved
      ? recommendedSelector
      : decision.overrides?.[role] ?? approvals[role]?.selectedSelector ?? recommendedSelector;
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
