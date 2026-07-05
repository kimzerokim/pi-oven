import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, readFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  createDeepInterviewRuntime,
  type DeepInterviewRuntime,
} from "../../../.omp/extensions/pi-oven-runtime/deep-interview-runtime";
import type { DeepInterviewAskMetadata } from "../../../.omp/extensions/pi-oven-runtime/deep-interview-state";

const META: DeepInterviewAskMetadata = {
  interviewId: "di-1",
  round: 0,
  roundId: "topology",
  questionId: "q-topology",
  stage: "topology",
  component: "runtime-routing",
  dimension: "scope",
  ambiguity: 1,
};

const APPROVAL_META: DeepInterviewAskMetadata = {
  interviewId: "di-1",
  round: 1,
  roundId: "approval",
  questionId: "q-approval",
  stage: "approval",
  component: "runtime-routing",
  dimension: "approval",
  ambiguity: 0.25,
  approvalHandoff: {
    decisionKey: "approve-option-c",
    summary: "Implement Option C after approval",
  },
};

describe("deep-interview-runtime", () => {
  let projectRoot = "";
  let runtime: DeepInterviewRuntime;

  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), "pi-oven-deep-interview-"));
    runtime = createDeepInterviewRuntime(projectRoot, {
      now: () => "2026-07-05T00:00:00.000Z",
    });
  });

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true });
  });

  it("seeds pending question state with stable round identity", async () => {
    const state = await runtime.seedQuestion({
      question: "Confirm the topology.",
      recommended: 0,
      deepInterview: META,
    });

    expect(state.pendingQuestion).toEqual(
      expect.objectContaining({
        roundKey: "di-1::rid:topology",
        question: "Confirm the topology.",
        recommended: 0,
        meta: META,
      })
    );
    expect(state.rounds).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          roundKey: "di-1::rid:topology",
          lifecycle: "pending",
          stage: "topology",
        }),
      ])
    );
    const persisted = JSON.parse(
      readFileSync(join(projectRoot, ".pi-oven", "state", "autonomous.json"), "utf-8")
    ) as { deepInterview?: unknown };
    expect(persisted.deepInterview).toBeDefined();
  });

  it("records an answer, clears pending state, and reloads from the persisted store", async () => {
    await runtime.seedQuestion({
      question: "Confirm the topology.",
      recommended: 0,
      deepInterview: META,
    });

    const answered = await runtime.recordAnswer({
      question: "Confirm the topology.",
      selected: "Option C",
      recommended: 0,
      deepInterview: META,
    });
    const resumed = await createDeepInterviewRuntime(projectRoot).readState();

    expect(answered.pendingQuestion).toBeUndefined();
    expect(answered.rounds).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          roundKey: "di-1::rid:topology",
          selected: "Option C",
          lifecycle: "answered",
        }),
      ])
    );
    expect(resumed).toEqual(
      expect.objectContaining({
        interviewId: "di-1",
        rounds: expect.arrayContaining([
          expect.objectContaining({
            roundKey: "di-1::rid:topology",
            selected: "Option C",
          }),
        ]),
      })
    );
    expect(resumed?.pendingQuestion).toBeUndefined();
  });

  it("closes approval answers directly into ready_to_resume without a second runtime hop", async () => {
    await runtime.seedQuestion({
      question: "Approve the implementation handoff.",
      recommended: 0,
      deepInterview: APPROVAL_META,
    });

    const approved = await runtime.recordAnswer({
      question: "Approve the implementation handoff.",
      selected: "Proceed",
      recommended: 0,
      deepInterview: APPROVAL_META,
    });

    expect(approved.phase).toBe("ready_to_resume");
    expect(approved.approvalHandoff).toEqual(
      expect.objectContaining({
        decisionKey: "approve-option-c",
        status: "approved",
      })
    );
  });

  it("persists cancellation by clearing pendingQuestion and recording a cancelled lifecycle", async () => {
    await runtime.seedQuestion({
      question: "Approve the implementation handoff.",
      recommended: 0,
      deepInterview: APPROVAL_META,
    });

    const cancelled = await runtime.recordAnswer({
      question: "Approve the implementation handoff.",
      recommended: 0,
      deepInterview: APPROVAL_META,
    });

    expect(cancelled.phase).toBe("interviewing");
    expect(cancelled.pendingQuestion).toBeUndefined();
    expect(cancelled.approvalHandoff).toBeUndefined();
    expect(cancelled.rounds).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          roundKey: "di-1::rid:approval",
          lifecycle: "cancelled",
        }),
      ])
    );
  });
});
