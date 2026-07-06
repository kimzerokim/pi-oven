import { describe, it, expect } from "bun:test";
import {
  PROFILE_A,
  PROFILE_C,
  PROFILE_D,
  ROLES,
  type ProfileMap,
  type Role,
} from "../../../scripts/pi-oven-setup/profiles";
import {
  ModelRoutingApprovalError,
  applyBucketApprovalDecision,
  materializeRoutingApprovalPayload,
} from "../../../.omp/extensions/pi-oven-runtime/model-routing-approval";

function expectedSelector(profile: ProfileMap, role: Role): string {
  const entry = profile[role];
  return `${entry.primary}:${entry.thinkingLevel}`;
}

describe("model-routing-approval", () => {
  it("materializes the current-session openai-codex routing matrix into selector buckets", () => {
    const payload = materializeRoutingApprovalPayload({
      sessionProviderFamily: "openai-codex",
    });

    expect(payload.sessionProviderFamily).toBe("openai-codex");
    expect(Object.keys(payload.recommendedByRole).sort()).toEqual([...ROLES].sort());
    expect(payload.recommendedByRole.executor).toBe(expectedSelector(PROFILE_A, "executor"));
    expect(payload.recommendedByRole.verifier).toBe(expectedSelector(PROFILE_A, "verifier"));
    expect(payload.recommendedByRole.writer).toBe(expectedSelector(PROFILE_A, "writer"));
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

  it("materializes the current-session anthropic routing matrix from provider family input", () => {
    const payload = materializeRoutingApprovalPayload({
      sessionProviderFamily: "anthropic",
    });

    expect(payload.sessionProviderFamily).toBe("anthropic");
    expect(payload.recommendedByRole.executor).toBe(expectedSelector(PROFILE_C, "executor"));
    expect(payload.recommendedByRole.verifier).toBe(expectedSelector(PROFILE_C, "verifier"));
    expect(payload.recommendedByRole.writer).toBe(expectedSelector(PROFILE_C, "writer"));
  });

  it("materializes the current-session opencode-zen routing matrix from provider family input", () => {
    const payload = materializeRoutingApprovalPayload({
      sessionProviderFamily: "opencode-zen",
    });

    expect(payload.sessionProviderFamily).toBe("opencode-zen");
    expect(payload.recommendedByRole.executor).toBe(expectedSelector(PROFILE_D, "executor"));
    expect(payload.recommendedByRole.verifier).toBe(expectedSelector(PROFILE_D, "verifier"));
    expect(payload.recommendedByRole.writer).toBe(expectedSelector(PROFILE_D, "writer"));
  });

  it("expands an approved bucket into per-role approval records for persistence", () => {
    const approved = applyBucketApprovalDecision(
      materializeRoutingApprovalPayload({
        sessionProviderFamily: "openai-codex",
      }),
      {
        bucketKey: "openai-codex/gpt-5.5:high",
        approved: true,
      }
    );

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
      sessionProviderFamily: "openai-codex",
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

  it("refuses unsupported current-session provider families with an explicit diagnostic", () => {
    expect(() =>
      materializeRoutingApprovalPayload({
        sessionProviderFamily: "google",
      })
    ).toThrow(
      expect.objectContaining({
        name: "ModelRoutingApprovalError",
        diagnostic: expect.objectContaining({
          code: "unsupported_provider_family",
          sessionProviderFamily: "google",
        }),
      })
    );
  });

  it("refuses supported-but-unmapped current-session provider families with an explicit diagnostic", () => {
    expect(() =>
      materializeRoutingApprovalPayload({
        sessionProviderFamily: "anthropic",
        profilesByProviderFamily: {
          "openai-codex": PROFILE_A,
          "opencode-zen": PROFILE_D,
        },
      })
    ).toThrow(
      expect.objectContaining({
        name: "ModelRoutingApprovalError",
        diagnostic: expect.objectContaining({
          code: "unmapped_provider_family",
          sessionProviderFamily: "anthropic",
        }),
      })
    );
  });

  it("surfaces provider-family refusal messages that explain the runtime routing problem", () => {
    try {
      materializeRoutingApprovalPayload({
        sessionProviderFamily: "anthropic",
        profilesByProviderFamily: {
          "openai-codex": PROFILE_A,
          "opencode-zen": PROFILE_D,
        },
      });
      throw new Error("expected routing approval materialization to refuse");
    } catch (error) {
      expect(error).toBeInstanceOf(ModelRoutingApprovalError);
      expect((error as ModelRoutingApprovalError).message).toContain(
        'Current session provider family "anthropic" does not map to a supported release path.'
      );
    }
  });
});
