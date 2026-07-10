import { describe, it, expect } from "bun:test";
import { DEFAULT_PROFILE, ROLES, type Role } from "../../../scripts/pi-oven-setup/profiles";
import {
  deriveRoundKey,
  mergeDeepInterviewState,
  normalizeApprovalFlowState,
  normalizeDeepInterviewState,
  type ApprovalFlowState,
  type DeepInterviewAskMetadata,
  type DeepInterviewState,
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
  threshold: 0.35,
  thresholdSource: "session",
  milestone: "initial",
  nextTarget: {
    componentId: "runtime-routing",
    dimension: "constraints",
    rationale: "Lock the control-plane boundary before approval.",
  },
  topology: {
    confirmed: true,
    summary: "Routing depends on runtime state and approval ownership.",
    nodes: [{ id: "runtime-routing", label: "Runtime routing" }],
  },
  ontologySnapshot: {
    id: "ontology-1",
    summary: "routing approval, completion boundary, approval flow",
    capturedAt: "2026-07-05T00:00:00.000Z",
  },
};

function buildRecommendedByRole(): Record<Role, string> {
  return Object.fromEntries(
    ROLES.map((role) => {
      const entry = DEFAULT_PROFILE[role];
      return [role, `${entry.primary}:${entry.thinkingLevel}`];
    })
  ) as Record<Role, string>;
}

const ROUTING_APPROVAL_PAYLOAD: NonNullable<DeepInterviewAskMetadata["routingApproval"]> = {
  sessionProviderFamily: "openai-codex",
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

  it("normalizes sparse input into the V2 runtime envelope", () => {
    expect(normalizeDeepInterviewState({ interviewId: "di-1" })).toEqual({
      version: 2,
      interviewId: "di-1",
      active: false,
      phase: "idle",
      state: {
        rounds: [],
        establishedFacts: [],
        ontologySnapshots: [],
      },
    });
  });

  it("migrates legacy V1 approval ownership into root approvalFlow on read", () => {
    const deepInterview = normalizeDeepInterviewState({
      interviewId: "di-1",
      active: true,
      phase: "approval_pending",
      rounds: [],
      approvalHandoff: {
        decisionKey: "approve-option-c",
        summary: "Implement Option C after approval",
        status: "pending",
        requestedAt: "2026-07-05T00:00:00.000Z",
      },
      routingApproval: ROUTING_APPROVAL_PAYLOAD,
      lastUpdatedAt: "2026-07-05T00:00:00.000Z",
    });

    const approvalFlow = normalizeApprovalFlowState(undefined, deepInterview) as ApprovalFlowState;

    expect(approvalFlow).toEqual(
      expect.objectContaining({
        kind: "routing-bucket",
        source: "setup",
        decisionKey: "approve-option-c",
        status: "pending",
        routingApproval: expect.objectContaining({
          approvals: expect.objectContaining({
            executor: expect.objectContaining({
              status: "approved",
              selectedSelector: "openai-codex/gpt-5.5:high",
            }),
          }),
        }),
        resumedFrom: {
          interviewId: "di-1",
        },
      })
    );
  });

  it("prefers resolved legacy approval mirrors over stale pending handoff metadata during migration", () => {
    const deepInterview = normalizeDeepInterviewState({
      interviewId: "di-1",
      active: true,
      phase: "handoff",
      approvalHandoff: {
        decisionKey: "approve-option-c",
        summary: "Implement Option C after approval",
        status: "pending",
        requestedAt: "2026-07-05T00:00:00.000Z",
      },
      pendingQuestion: {
        roundKey: "di-1::rid:approval",
        question: "Approve the implementation handoff.",
        askedAt: "2026-07-05T00:00:00.000Z",
        meta: {
          ...META,
          round: 1,
          roundId: "approval",
          questionId: "q-approval",
          stage: "approval",
          approvalHandoff: {
            decisionKey: "approve-option-c",
            summary: "Implement Option C after approval",
          },
        },
      },
      state: {
        rounds: [
          {
            roundKey: "di-1::rid:approval",
            interviewId: "di-1",
            round: 1,
            roundId: "approval",
            questionId: "q-approval",
            stage: "approval",
            question: "Approve the implementation handoff.",
            questionHash: "qhash-approval",
            lifecycle: "answered",
            selected: "Reject",
            answerHash: "ahash-approval",
            askedAt: "2026-07-05T00:00:00.000Z",
            answeredAt: "2026-07-05T00:01:00.000Z",
            approvalHandoff: {
              decisionKey: "approve-option-c",
              summary: "Implement Option C after approval",
              status: "rejected",
              requestedAt: "2026-07-05T00:00:00.000Z",
              resolvedAt: "2026-07-05T00:01:00.000Z",
            },
          },
        ],
        establishedFacts: [],
        ontologySnapshots: [],
      },
      lastUpdatedAt: "2026-07-05T00:01:00.000Z",
    });

    const approvalFlow = normalizeApprovalFlowState(undefined, deepInterview) as ApprovalFlowState;

    expect(approvalFlow).toEqual(
      expect.objectContaining({
        decisionKey: "approve-option-c",
        status: "rejected",
        resolvedAt: "2026-07-05T00:01:00.000Z",
      })
    );
    expect(approvalFlow.pendingQuestion).toBeUndefined();
  });

  it("reconciles a stale root pending approvalFlow against terminal legacy approval artifacts", () => {
    const deepInterview = normalizeDeepInterviewState({
      interviewId: "di-1",
      active: true,
      phase: "handoff",
      approvalHandoff: {
        decisionKey: "approve-option-c",
        summary: "Implement Option C after approval",
        status: "pending",
        requestedAt: "2026-07-05T00:00:00.000Z",
      },
      pendingQuestion: {
        roundKey: "di-1::rid:approval",
        question: "Approve the implementation handoff.",
        askedAt: "2026-07-05T00:00:00.000Z",
        meta: {
          ...META,
          round: 1,
          roundId: "approval",
          questionId: "q-approval",
          stage: "approval",
          approvalHandoff: {
            decisionKey: "approve-option-c",
            summary: "Implement Option C after approval",
          },
        },
      },
      state: {
        rounds: [
          {
            roundKey: "di-1::rid:approval",
            interviewId: "di-1",
            round: 1,
            roundId: "approval",
            questionId: "q-approval",
            stage: "approval",
            question: "Approve the implementation handoff.",
            questionHash: "qhash-approval",
            lifecycle: "answered",
            selected: "Reject",
            answerHash: "ahash-approval",
            askedAt: "2026-07-05T00:00:00.000Z",
            answeredAt: "2026-07-05T00:01:00.000Z",
            approvalHandoff: {
              decisionKey: "approve-option-c",
              summary: "Implement Option C after approval",
              status: "rejected",
              requestedAt: "2026-07-05T00:00:00.000Z",
              resolvedAt: "2026-07-05T00:01:00.000Z",
            },
          },
        ],
        establishedFacts: [],
        ontologySnapshots: [],
      },
      lastUpdatedAt: "2026-07-05T00:01:00.000Z",
    });

    const approvalFlow = normalizeApprovalFlowState(
      {
        version: 1,
        active: true,
        kind: "spec-handoff",
        source: "brainstorming",
        decisionKey: "approve-option-c",
        summary: "Implement Option C after approval",
        status: "pending",
        pendingQuestion: {
          question: "Approve the implementation handoff.",
          askedAt: "2026-07-05T00:00:00.000Z",
          recommended: 0,
        },
        requestedAt: "2026-07-05T00:00:00.000Z",
      },
      deepInterview
    ) as ApprovalFlowState;

    expect(approvalFlow).toEqual(
      expect.objectContaining({
        decisionKey: "approve-option-c",
        active: false,
        status: "rejected",
        resolvedAt: "2026-07-05T00:01:00.000Z",
      })
    );
    expect(approvalFlow.pendingQuestion).toBeUndefined();
  });

  it("drops legacy top-level approval ownership when canonical V2 writes merge back", () => {
    const merged = mergeDeepInterviewState(
      {
        interviewId: "di-1",
        active: true,
        phase: "handoff",
        approvalHandoff: {
          decisionKey: "approve-option-c",
          summary: "Implement Option C after approval",
          status: "pending",
          requestedAt: "2026-07-05T00:00:00.000Z",
        },
        routingApproval: ROUTING_APPROVAL_PAYLOAD,
        pendingQuestion: {
          roundKey: "di-1::rid:approval",
          question: "Approve the implementation handoff.",
          askedAt: "2026-07-05T00:00:00.000Z",
          meta: {
            ...META,
            round: 1,
            roundId: "approval",
            questionId: "q-approval",
            stage: "approval",
            approvalHandoff: {
              decisionKey: "approve-option-c",
              summary: "Implement Option C after approval",
            },
            routingApproval: ROUTING_APPROVAL_PAYLOAD,
          },
        },
        state: {
          rounds: [],
          establishedFacts: [],
          ontologySnapshots: [],
        },
      },
      {
        version: 2,
        interviewId: "di-1",
        active: true,
        phase: "handoff",
        pendingQuestion: {
          roundKey: "di-1::rid:approval",
          question: "Approve the implementation handoff.",
          askedAt: "2026-07-05T00:00:00.000Z",
          meta: {
            ...META,
            round: 1,
            roundId: "approval",
            questionId: "q-approval",
            stage: "approval",
          },
        },
        state: {
          rounds: [],
          establishedFacts: [],
          ontologySnapshots: [],
        },
        lastUpdatedAt: "2026-07-05T00:01:00.000Z",
      }
    );

    expect(merged.approvalHandoff).toBeUndefined();
    expect(merged.routingApproval).toBeUndefined();
    expect(merged.pendingQuestion?.meta.approvalHandoff).toBeUndefined();
    expect(merged.pendingQuestion?.meta.routingApproval).toBeUndefined();
  });

  it("merges answered rounds into scored rounds while preserving the original answer evidence", () => {
    const merged = mergeDeepInterviewState(
      {
        interviewId: "di-1",
        active: true,
        phase: "interviewing",
        state: {
          rounds: [
            {
              roundKey: "di-1::rid:scope-1",
              interviewId: "di-1",
              round: 1,
              roundId: "scope-1",
              questionId: "q-scope-1",
              stage: "round",
              question: "What matters most?",
              questionHash: "qhash-scope-1",
              lifecycle: "answered",
              selected: "Correctness",
              answerHash: "ahash-scope-1",
              askedAt: "2026-07-05T00:00:00.000Z",
              answeredAt: "2026-07-05T00:01:00.000Z",
            },
          ],
          establishedFacts: [],
          ontologySnapshots: [],
        },
      },
      {
        interviewId: "di-1",
        active: true,
        phase: "interviewing",
        state: {
          rounds: [
            {
              roundKey: "di-1::rid:scope-1",
              interviewId: "di-1",
              round: 1,
              roundId: "scope-1",
              questionId: "q-scope-1",
              stage: "round",
              question: "What matters most?",
              questionHash: "qhash-scope-1",
              lifecycle: "scored",
              askedAt: "2026-07-05T00:00:00.000Z",
              answeredAt: "2026-07-05T00:01:00.000Z",
              scores: {
                goal: 0.9,
                constraints: 0.6,
              },
              ambiguityAtAsk: 1,
              ambiguity: 0.4,
              milestone: "progress",
              nextTarget: {
                componentId: "runtime-routing",
                dimension: "constraints",
                rationale: "Constraints still lag the goal definition.",
              },
              topologySummary: "Runtime routing controls approval handoff sequencing.",
              ontologySummary: "approval flow + spec boundary",
            },
          ],
          establishedFacts: [],
          ontologySnapshots: [],
          currentAmbiguity: 0.4,
          milestone: "progress",
          nextTarget: {
            componentId: "runtime-routing",
            dimension: "constraints",
            rationale: "Constraints still lag the goal definition.",
          },
        },
      }
    );

    expect(merged.state.rounds).toEqual([
      expect.objectContaining({
        lifecycle: "scored",
        selected: "Correctness",
        answerHash: "ahash-scope-1",
        ambiguityAtAsk: 1,
        ambiguity: 0.4,
        scores: {
          goal: 0.9,
          constraints: 0.6,
        },
        milestone: "progress",
      }),
    ]);
  });

  it("drops legacy nested approval payload once canonical V2 merges run", () => {
    const merged = mergeDeepInterviewState(
      {
        interviewId: "di-1",
        active: true,
        phase: "handoff",
        state: {
          rounds: [],
          establishedFacts: [],
          ontologySnapshots: [],
        },
        approvalHandoff: {
          decisionKey: "approve-option-c",
          summary: "Implement Option C after approval",
          status: "pending",
          requestedAt: "2026-07-05T00:00:00.000Z",
        },
        routingApproval: ROUTING_APPROVAL_PAYLOAD,
      },
      {
        interviewId: "di-1",
        active: true,
        phase: "interviewing",
        pendingQuestion: {
          roundKey: "di-1::rid:closure",
          question: "Do these constraints capture the real boundary?",
          askedAt: "2026-07-05T00:02:00.000Z",
          meta: {
            ...META,
            round: 1,
            roundId: "closure",
            questionId: "q-closure",
            stage: "closure",
            ambiguity: 0.2,
          },
        },
        state: {
          rounds: [],
          establishedFacts: [],
          ontologySnapshots: [],
          currentAmbiguity: 0.2,
        },
      }
    );

    expect(merged.approvalHandoff).toBeUndefined();
    expect(merged.routingApproval).toBeUndefined();
  });

  it("renders threshold, topology, milestone, spec receipt, and approvalFlow resume details", () => {
    const deepInterview: DeepInterviewState = {
      version: 2,
      interviewId: "di-1",
      active: true,
      phase: "complete",
      threshold: 0.35,
      thresholdSource: "session",
      spec: {
        path: "docs/specs/2026-07-06-workflow-optimization-design.md",
        sha256: "abc123",
        persistedAt: "2026-07-05T00:04:00.000Z",
        stage: "final",
      },
      state: {
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
            lifecycle: "scored",
            askedAt: "2026-07-05T00:00:00.000Z",
            answeredAt: "2026-07-05T00:01:00.000Z",
            selected: "Session cookie",
            answerHash: "ahash-topology",
            topologySummary: "Runtime routing + approval flow boundary",
            milestone: "ready",
          },
        ],
        establishedFacts: [{ summary: "Approval ownership must leave deepInterview." }],
        ontologySnapshots: [
          {
            id: "ontology-2",
            summary: "approval flow, sanctioned completion path",
            capturedAt: "2026-07-05T00:03:00.000Z",
          },
        ],
        topology: {
          confirmed: true,
          summary: "Runtime routing + approval flow boundary",
          nodes: [{ id: "runtime-routing", label: "Runtime routing" }],
        },
        currentAmbiguity: 0.15,
        milestone: "ready",
        nextTarget: {
          componentId: "approval-flow",
          dimension: "criteria",
          rationale: "Lock the post-spec transition options.",
        },
      },
      lastUpdatedAt: "2026-07-05T00:04:00.000Z",
    };
    const approvalFlow: ApprovalFlowState = {
      version: 1,
      active: true,
      kind: "spec-handoff",
      source: "brainstorming",
      decisionKey: "approve-workflow-optimization-spec-v1",
      summary: "Approve workflow optimization + gajae-style deep-interview redesign direction for spec/plan drafting",
      status: "pending",
      requestedAt: "2026-07-05T00:04:00.000Z",
      resumedFrom: {
        interviewId: "di-1",
        specPath: "docs/specs/2026-07-06-workflow-optimization-design.md",
      },
      pendingQuestion: {
        question: "지금까지의 수렴 결과로 spec/plan 초안 작성 단계로 넘어갈까요?",
        askedAt: "2026-07-05T00:04:00.000Z",
        recommended: 0,
      },
      routingApproval: ROUTING_APPROVAL_PAYLOAD,
    };

    const prompt = buildDeepInterviewContractPrompt(deepInterview, approvalFlow);

    expect(prompt).toContain("threshold: 0.35 (source: session)");
    expect(prompt).toContain("milestone band: ready");
    expect(prompt).toContain("weakest unresolved target: approval-flow / criteria");
    expect(prompt).toContain("topology confirmed: yes");
    expect(prompt).toContain("topology nodes: 1");
    expect(prompt).toContain("spec persistence: final persisted to docs/specs/2026-07-06-workflow-optimization-design.md");
    expect(prompt).toContain("approval handoff state: pending (brainstorming / spec-handoff)");
    expect(prompt).toContain("approval flow: spec-handoff");
    expect(prompt).toContain("Approval progress: 1/3 roles approved");
  });

  it("counts only approved routing approvals in approval progress", () => {
    const approvalFlow: ApprovalFlowState = {
      version: 1,
      active: true,
      kind: "routing-bucket",
      source: "status",
      decisionKey: "approve-runtime-routing",
      summary: "Approve runtime routing buckets",
      status: "pending",
      requestedAt: "2026-07-05T00:04:00.000Z",
      routingApproval: {
        sessionProviderFamily: "openai-codex",
        recommendedByRole: buildRecommendedByRole(),
        buckets: [
          {
            bucketKey: "openai-codex/gpt-5.5:high",
            recommendedSelector: "openai-codex/gpt-5.5:high",
            roles: ["executor", "planner", "writer"],
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
          planner: {
            role: "planner",
            bucketKey: "openai-codex/gpt-5.5:high",
            status: "rejected",
            recommendedSelector: "openai-codex/gpt-5.5:high",
            selectedSelector: "openai-codex/gpt-5.5:high",
          },
          writer: {
            role: "writer",
            bucketKey: "openai-codex/gpt-5.5:high",
            status: "cancelled",
            recommendedSelector: "openai-codex/gpt-5.5:high",
            selectedSelector: "openai-codex/gpt-5.5:high",
          },
        } as unknown as NonNullable<ApprovalFlowState["routingApproval"]>["approvals"],
      },
    };

    const prompt = buildDeepInterviewContractPrompt(undefined, approvalFlow);

    expect(prompt).toContain("Approval progress: 1/3 roles approved");
  });
});
