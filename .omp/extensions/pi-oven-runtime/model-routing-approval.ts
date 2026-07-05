import { PROFILE_B, ROLES, type ProfileMap, type Role } from "../../../scripts/pi-oven-setup/profiles";

export type ModelRoutingApprovalStatus = "pending" | "approved" | "overridden";

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

export interface ModelRoutingApprovalPayload {
  recommendedByRole: Partial<Record<Role, string>>;
  buckets: ModelRoutingApprovalBucket[];
  approvals: Partial<Record<Role, ModelRoutingApprovalRecord>>;
}

export interface MaterializeRoutingApprovalOptions {
  profile?: ProfileMap;
  existingApprovals?: Partial<Record<Role, ModelRoutingApprovalRecord>>;
}

export interface ApplyBucketApprovalDecisionInput {
  bucketKey: string;
  approved: boolean;
  overrides?: Partial<Record<Role, string>>;
}

export function materializeRoutingApprovalPayload(
  { profile = PROFILE_B, existingApprovals = {} }: MaterializeRoutingApprovalOptions = {}
): ModelRoutingApprovalPayload {
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
