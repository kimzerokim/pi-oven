import { describe, it, expect } from "bun:test";
import { PROFILE_B, ROLES, type Role } from "../../../scripts/pi-oven-setup/profiles";
import {
  applyBucketApprovalDecision,
  materializeRoutingApprovalPayload,
} from "../../../.omp/extensions/pi-oven-runtime/model-routing-approval";

function expectedSelector(role: Role): string {
  const entry = PROFILE_B[role];
  return `${entry.primary}:${entry.thinkingLevel}`;
}

describe("model-routing-approval", () => {
  it("materializes the PROFILE_B recommendation matrix into selector buckets", () => {
    const payload = materializeRoutingApprovalPayload();

    expect(Object.keys(payload.recommendedByRole).sort()).toEqual([...ROLES].sort());
    expect(payload.recommendedByRole.executor).toBe(expectedSelector("executor"));
    expect(payload.recommendedByRole.verifier).toBe(expectedSelector("verifier"));
    expect(payload.recommendedByRole.writer).toBe(expectedSelector("writer"));
    expect(payload.buckets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          bucketKey: "openai-codex/gpt-5.5:high",
          recommendedSelector: "openai-codex/gpt-5.5:high",
          roles: expect.arrayContaining(["executor", "test-engineer", "metis"]),
        }),
        expect.objectContaining({
          bucketKey: "openai-codex/gpt-5.5:xhigh",
          recommendedSelector: "openai-codex/gpt-5.5:xhigh",
          roles: expect.arrayContaining(["planner", "verifier", "critic"]),
        }),
        expect.objectContaining({
          bucketKey: "openai-codex/gpt-5.4:high",
          recommendedSelector: "openai-codex/gpt-5.4:high",
          roles: expect.arrayContaining(["designer", "qa-tester", "data-runner"]),
        }),
        expect.objectContaining({
          bucketKey: "openai-codex/gpt-5.4:medium",
          recommendedSelector: "openai-codex/gpt-5.4:medium",
          roles: expect.arrayContaining(["explorer", "writer", "multimodal-looker"]),
        }),
      ])
    );
  });

  it("expands an approved bucket into per-role approval records for persistence", () => {
    const approved = applyBucketApprovalDecision(materializeRoutingApprovalPayload(), {
      bucketKey: "openai-codex/gpt-5.5:high",
      approved: true,
    });

    expect(approved.approvals).toEqual(
      expect.objectContaining({
        executor: expect.objectContaining({
          role: "executor",
          bucketKey: "openai-codex/gpt-5.5:high",
          status: "approved",
          recommendedSelector: "openai-codex/gpt-5.5:high",
          selectedSelector: "openai-codex/gpt-5.5:high",
        }),
        "test-engineer": expect.objectContaining({
          role: "test-engineer",
          bucketKey: "openai-codex/gpt-5.5:high",
          status: "approved",
          selectedSelector: "openai-codex/gpt-5.5:high",
        }),
        metis: expect.objectContaining({
          role: "metis",
          bucketKey: "openai-codex/gpt-5.5:high",
          status: "approved",
          selectedSelector: "openai-codex/gpt-5.5:high",
        }),
      })
    );
    expect(approved.approvals.planner).toBeUndefined();
  });

  it("replays persisted per-role overrides when a rejected bucket resumes later", () => {
    const resumed = materializeRoutingApprovalPayload({
      existingApprovals: {
        executor: {
          role: "executor",
          bucketKey: "openai-codex/gpt-5.5:high",
          status: "overridden",
          recommendedSelector: "openai-codex/gpt-5.5:high",
          selectedSelector: "openai-codex/gpt-5.4:high",
        },
      },
    });

    expect(resumed.approvals.executor).toEqual(
      expect.objectContaining({
        role: "executor",
        status: "overridden",
        selectedSelector: "openai-codex/gpt-5.4:high",
      })
    );
    expect(resumed.buckets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          bucketKey: "openai-codex/gpt-5.5:high",
          roles: expect.arrayContaining(["executor", "test-engineer", "metis"]),
        }),
      ])
    );
  });
});
