import { describe, expect, it } from "bun:test";
import { DEFAULT_PROFILE, type ProfileMap, type Role } from "../../../scripts/pi-oven-setup/profiles";
import {
  applyBucketApprovalDecision,
  materializeRoutingApprovalPayload,
  type ModelRoutingApprovalPayload,
} from "../../../.omp/extensions/pi-oven-runtime/model-routing-approval";

function expectedSelector(profile: ProfileMap, role: Role): string {
  const entry = profile[role];
  return `${entry.primary}:${entry.thinkingLevel}`;
}

describe("model-routing-approval", () => {
  it("materializes codex-only buckets regardless of parent provider family", () => {
    const payload = materializeRoutingApprovalPayload({
      sessionProviderFamily: "anthropic",
    });

    expect(payload.sessionProviderFamily).toBe("openai-codex");
    expect(payload.diagnostics?.[0]?.code).toBe("non_codex_session_provider");
    expect(payload.recommendedByRole.executor).toBe(expectedSelector(DEFAULT_PROFILE, "executor"));
    expect(payload.recommendedByRole.verifier).toBe(expectedSelector(DEFAULT_PROFILE, "verifier"));
    expect(payload.buckets.every((bucket) => bucket.recommendedSelector.startsWith("openai-codex/"))).toBe(true);
  });

  it("keeps existing codex approvals and filters stale non-codex records", () => {
    const payload = materializeRoutingApprovalPayload({
      sessionProviderFamily: "openai-codex",
      existingApprovals: {
        executor: {
          role: "executor",
          bucketKey: expectedSelector(DEFAULT_PROFILE, "executor"),
          status: "approved",
          recommendedSelector: expectedSelector(DEFAULT_PROFILE, "executor"),
          selectedSelector: expectedSelector(DEFAULT_PROFILE, "executor"),
        },
        critic: {
          role: "critic",
          bucketKey: "anthropic/claude-opus-4-8:xhigh",
          status: "approved",
          recommendedSelector: "anthropic/claude-opus-4-8:xhigh",
          selectedSelector: "anthropic/claude-opus-4-8:xhigh",
        },
      },
    });

    expect(payload.approvals.executor?.selectedSelector).toBe(expectedSelector(DEFAULT_PROFILE, "executor"));
    expect(payload.approvals.critic).toBeUndefined();
  });

  it("applies bucket approval decisions and rejects non-codex overrides", () => {
    const payload = materializeRoutingApprovalPayload({
      sessionProviderFamily: "openai-codex",
    });
    const bucket = payload.buckets.find((candidate) =>
      candidate.roles.includes("executor")
    )!;

    const next = applyBucketApprovalDecision(payload, {
      bucketKey: bucket.bucketKey,
      approved: false,
      overrides: {
        executor: "anthropic/claude-opus-4-8:high",
      },
    }) as ModelRoutingApprovalPayload;

    expect(next.approvals.executor?.selectedSelector).toBe(
      expectedSelector(DEFAULT_PROFILE, "executor")
    );
  });
});
