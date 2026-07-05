import { describe, it, expect } from "bun:test";
import { PROFILE_B, ROLES, type Role } from "../../../scripts/pi-oven-setup/profiles";
import {
  deriveRoundKey,
  mergeDeepInterviewState,
  normalizeDeepInterviewState,
  type DeepInterviewAskMetadata,
} from "../../../.omp/extensions/pi-oven-runtime/deep-interview-state";
import { buildDeepInterviewContractPrompt } from "../../../.omp/extensions/pi-oven-runtime/deep-interview-render";

const META: DeepInterviewAskMetadata = {
  interviewId: "di-1",
  round: 0,
  roundId: "topology",
  questionId: "q-topology",
  stage: "topology",
  component: "runtime-routing",
  dimension: "scope",
  ambiguity: 1,
  approvalHandoff: {
    decisionKey: "approve-option-c",
    summary: "Implement Option C after approval",
  },
};
function buildRecommendedByRole(): Record<Role, string> {
  return Object.fromEntries(
    ROLES.map((role) => {
      const entry = PROFILE_B[role];
      return [role, `${entry.primary}:${entry.thinkingLevel}`];
    })
  ) as Record<Role, string>;
}

const ROUTING_APPROVAL_PAYLOAD: NonNullable<DeepInterviewAskMetadata["routingApproval"]> = {
  recommendedByRole: buildRecommendedByRole(),
  buckets: [
    {
      bucketKey: "openai-codex/gpt-5.5:high",
      recommendedSelector: "openai-codex/gpt-5.5:high",
      roles: ["executor", "test-engineer", "metis"],
    },
  ],
  approvals: {
    executor: {
      role: "executor",
      bucketKey: "openai-codex/gpt-5.5:high",
      status: "approved",
      recommendedSelector: "openai-codex/gpt-5.5:high",
      selectedSelector: "openai-codex/gpt-5.5:high",
    },
  },
};

describe("deep-interview-state", () => {
  it("derives a durable round key from interview + round_id when present", () => {
    expect(deriveRoundKey("di-1", { round: 0, roundId: "topology", questionId: "q-topology" })).toBe(
      "di-1::rid:topology"
    );
  });

  it("falls back to round + question identity when round_id is absent", () => {
    expect(deriveRoundKey("di-1", { round: 2, questionId: "q-closure" })).toBe(
      "di-1::r:2::q:q-closure"
    );
  });

  it("normalizes sparse input into the canonical runtime shape", () => {
    expect(normalizeDeepInterviewState({ interviewId: "di-1" })).toEqual(
      expect.objectContaining({
        version: 1,
        interviewId: "di-1",
        phase: "idle",
        rounds: [],
      })
    );
  });

  it("merges duplicate rounds canonically while preserving approval handoff state", () => {
    const existing = {
      interviewId: "di-1",
      phase: "interviewing",
      rounds: [
        {
          roundKey: "di-1::rid:topology",
          round: 0,
          roundId: "topology",
          questionId: "q-topology",
          stage: "topology",
          question: "Confirm the topology.",
          questionHash: "qhash",
          lifecycle: "pending",
          askedAt: "2026-07-05T00:00:00.000Z",
        },
      ],
      pendingQuestion: {
        roundKey: "di-1::rid:topology",
        question: "Confirm the topology.",
        recommended: 0,
        askedAt: "2026-07-05T00:00:00.000Z",
        meta: META,
      },
      lastUpdatedAt: "2026-07-05T00:00:00.000Z",
    };
    const incoming = {
      interviewId: "di-1",
      phase: "approval_pending",
      rounds: [
        {
          roundKey: "di-1::rid:topology",
          round: 0,
          roundId: "topology",
          questionId: "q-topology",
          stage: "topology",
          question: "Confirm the topology.",
          questionHash: "qhash",
          answerHash: "ahash",
          selected: "Option C",
          lifecycle: "answered",
          askedAt: "2026-07-05T00:00:00.000Z",
          answeredAt: "2026-07-05T00:01:00.000Z",
          approvalHandoff: {
            decisionKey: "approve-option-c",
            summary: "Implement Option C after approval",
            status: "pending",
            requestedAt: "2026-07-05T00:01:00.000Z",
          },
        },
      ],
      pendingQuestion: null,
      approvalHandoff: {
        decisionKey: "approve-option-c",
        summary: "Implement Option C after approval",
        status: "pending",
        requestedAt: "2026-07-05T00:01:00.000Z",
      },
      lastUpdatedAt: "2026-07-05T00:01:00.000Z",
    };

    const merged = mergeDeepInterviewState(existing, incoming);
    expect(merged.phase).toBe("approval_pending");
    expect(merged.pendingQuestion).toBeUndefined();
    expect(merged.approvalHandoff).toEqual(
      expect.objectContaining({
        decisionKey: "approve-option-c",
        status: "pending",
      })
    );
    expect(merged.rounds).toHaveLength(1);
    expect(merged.rounds[0]).toEqual(
      expect.objectContaining({
        roundKey: "di-1::rid:topology",
        questionHash: "qhash",
        answerHash: "ahash",
        selected: "Option C",
        lifecycle: "answered",
        answeredAt: "2026-07-05T00:01:00.000Z",
      })
    );
  });
  it("preserves routing approval records when bucket approvals expand into per-role resume state", () => {
    const merged = mergeDeepInterviewState(
      {
        interviewId: "di-1",
        phase: "approval_pending",
        rounds: [],
        routingApproval: {
          ...ROUTING_APPROVAL_PAYLOAD,
          approvals: {},
        },
        lastUpdatedAt: "2026-07-05T00:00:00.000Z",
      },
      {
        interviewId: "di-1",
        phase: "ready_to_resume",
        rounds: [
          {
            roundKey: "di-1::rid:approval-bucket-gpt-5-5-high",
            round: 1,
            roundId: "approval-bucket-gpt-5-5-high",
            questionId: "q-approval-bucket-gpt-5-5-high",
            stage: "approval",
            question: "Approve the codex routing bucket.",
            questionHash: "qhash-approval-bucket",
            answerHash: "ahash-approval-bucket",
            selected: "Approve",
            lifecycle: "answered",
            askedAt: "2026-07-05T00:00:00.000Z",
            answeredAt: "2026-07-05T00:01:00.000Z",
            routingApproval: ROUTING_APPROVAL_PAYLOAD,
          },
        ],
        routingApproval: ROUTING_APPROVAL_PAYLOAD,
        lastUpdatedAt: "2026-07-05T00:01:00.000Z",
      }
    ) as unknown as {
      routingApproval?: {
        approvals?: {
          executor?: { status?: string; selectedSelector?: string };
        };
      };
      rounds: Array<{
        routingApproval?: {
          buckets?: Array<{ bucketKey?: string }>;
        };
      }>;
    };

    expect(merged.routingApproval?.approvals?.executor).toEqual(
      expect.objectContaining({
        status: "approved",
        selectedSelector: "openai-codex/gpt-5.5:high",
      })
    );
    expect(merged.rounds[0]?.routingApproval?.buckets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          bucketKey: "openai-codex/gpt-5.5:high",
        }),
      ])
    );
  });
  it("buildDeepInterviewContractPrompt renders topology and closure stages as explicit sections", () => {
    const prompt = buildDeepInterviewContractPrompt({
      version: 1,
      interviewId: "di-1",
      active: true,
      phase: "approval_pending",
      rounds: [
        {
          roundKey: "di-1::rid:topology",
          interviewId: "di-1",
          round: 0,
          roundId: "topology",
          questionId: "q-topology",
          stage: "topology",
          question: "Confirm the topology.",
          questionHash: "qhash-topology",
          answerHash: "ahash-topology",
          selected: "Auth + billing",
          lifecycle: "answered",
          askedAt: "2026-07-05T00:00:00.000Z",
          answeredAt: "2026-07-05T00:01:00.000Z",
        },
      ],
      pendingQuestion: {
        roundKey: "di-1::rid:closure",
        question: "If someone read only this line, would they reach the same outcome you have in mind?",
        askedAt: "2026-07-05T00:02:00.000Z",
        meta: {
          interviewId: "di-1",
          round: 1,
          roundId: "closure",
          questionId: "q-closure",
          stage: "closure",
          component: "runtime-routing",
          dimension: "scope",
          ambiguity: 0.2,
        },
      },
      lastUpdatedAt: "2026-07-05T00:02:00.000Z",
    });

    expect(prompt).toMatch(/^### Topology\b/m);
    expect(prompt).toContain("Confirm the topology.");
    expect(prompt).toMatch(/^### Closure \/ restate gate\b/m);
    expect(prompt).toContain("If someone read only this line");
  });

  it("buildDeepInterviewContractPrompt renders approval progress explicitly for routing approval resume", () => {
    const prompt = buildDeepInterviewContractPrompt({
      version: 1,
      interviewId: "di-1",
      active: true,
      phase: "approval_pending",
      rounds: [],
      pendingQuestion: {
        roundKey: "di-1::rid:approval-bucket-gpt-5-5-high",
        question: "Approve the codex routing bucket.",
        askedAt: "2026-07-05T00:03:00.000Z",
        meta: {
          interviewId: "di-1",
          round: 1,
          roundId: "approval-bucket-gpt-5-5-high",
          questionId: "q-approval-bucket-gpt-5-5-high",
          stage: "approval",
          component: "runtime-routing",
          dimension: "routing-approval",
          ambiguity: 0.25,
          approvalHandoff: {
            decisionKey: "approve-option-c",
            summary: "Implement Option C after approval",
          },
          routingApproval: ROUTING_APPROVAL_PAYLOAD,
        },
      },
      approvalHandoff: {
        decisionKey: "approve-option-c",
        summary: "Implement Option C after approval",
        status: "pending",
        requestedAt: "2026-07-05T00:03:00.000Z",
      },
      routingApproval: ROUTING_APPROVAL_PAYLOAD,
      lastUpdatedAt: "2026-07-05T00:03:00.000Z",
    });

    expect(prompt).toMatch(/^### Approval\b/m);
    expect(prompt).toContain("Approval progress: 1/3 roles approved");
    expect(prompt).toContain("Approve the codex routing bucket.");
  });
  it("clears stale routing approval state when the next interview round omits routing metadata", () => {
    const merged = mergeDeepInterviewState(
      {
        interviewId: "di-1",
        phase: "approval_pending",
        rounds: [],
        routingApproval: ROUTING_APPROVAL_PAYLOAD,
        lastUpdatedAt: "2026-07-05T00:00:00.000Z",
      },
      {
        interviewId: "di-2",
        phase: "interviewing",
        rounds: [
          {
            roundKey: "di-2::rid:topology",
            round: 0,
            roundId: "topology",
            questionId: "q-topology",
            stage: "topology",
            question: "Confirm the topology.",
            questionHash: "qhash-topology",
            lifecycle: "pending",
            askedAt: "2026-07-05T00:02:00.000Z",
          },
        ],
        pendingQuestion: {
          roundKey: "di-2::rid:topology",
          question: "Confirm the topology.",
          askedAt: "2026-07-05T00:02:00.000Z",
          meta: {
            interviewId: "di-2",
            round: 0,
            roundId: "topology",
            questionId: "q-topology",
            stage: "topology",
            dimension: "scope",
            ambiguity: 1,
          },
        },
        lastUpdatedAt: "2026-07-05T00:02:00.000Z",
      }
    ) as unknown as {
      routingApproval?: unknown;
      pendingQuestion?: { meta?: { routingApproval?: unknown } };
    };

    expect(merged.routingApproval).toBeUndefined();
    expect(merged.pendingQuestion?.meta?.routingApproval).toBeUndefined();
  });
});
