import { describe, it, expect } from "bun:test";
import {
  deriveRoundKey,
  mergeDeepInterviewState,
  normalizeDeepInterviewState,
  type DeepInterviewAskMetadata,
} from "../../../.omp/extensions/pi-oven-runtime/deep-interview-state";

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
});
