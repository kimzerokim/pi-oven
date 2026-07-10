import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { DEFAULT_PROFILE, ROLES, type Role } from "../../../scripts/pi-oven-setup/profiles";
import {
  createDeepInterviewRuntime,
  type DeepInterviewRuntime,
} from "../../../.omp/extensions/pi-oven-runtime/deep-interview-runtime";
import type {
  ApprovalFlowAskMetadata,
  ApprovalFlowState,
  DeepInterviewAskMetadata,
  DeepInterviewState,
} from "../../../.omp/extensions/pi-oven-runtime/deep-interview-state";
import type { RuntimeTraceSnapshot } from "../../../.omp/extensions/pi-oven-runtime/trace-primitives";
type DeepInterviewCompletionRuntime = DeepInterviewRuntime & {
  persistFinalSpecAndSeedApprovalFlow(input: {
    specPath: string;
    content: string;
    decisionKey: string;
    summary: string;
    question?: string;
    recommended?: number;
  }): Promise<{ deepInterview: DeepInterviewState; approvalFlow: ApprovalFlowState }>;
};


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
};

const APPROVAL_FLOW: ApprovalFlowAskMetadata = {
  kind: "spec-handoff",
  source: "manual",
  decisionKey: "approve-option-c",
  summary: "Implement Option C after approval",
  resumedFrom: {
    interviewId: "di-1",
  },
};

const APPROVAL_ONLY_FLOW: ApprovalFlowAskMetadata = {
  kind: "spec-handoff",
  source: "manual",
  decisionKey: "approve-runtime-cutover",
  summary: "Approve the runtime cutover after root approvalFlow persistence.",
  resumedFrom: {
    interviewId: "di-approval-root",
    specPath: "docs/specs/2026-07-06-workflow-optimization-design.md",
  },
};

const APPROVAL_ONLY_META: DeepInterviewAskMetadata = {
  interviewId: "di-approval-root",
  round: 1,
  roundId: "approval-root",
  questionId: "q-approval-root",
  stage: "approval",
  component: "runtime-routing",
  dimension: "approval",
  ambiguity: 0.2,
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

const ROUTING_APPROVAL_META: DeepInterviewAskMetadata = {
  ...APPROVAL_META,
  roundId: "approval-bucket-gpt-5-5-high",
  questionId: "q-approval-bucket-gpt-5-5-high",
  dimension: "routing-approval",
};

const ROUTING_APPROVAL_FLOW: ApprovalFlowAskMetadata = {
  kind: "routing-bucket",
  source: "setup",
  decisionKey: "approve-routing-bucket",
  summary: "Approve the current routing bucket recommendations before resuming execution.",
  routingApproval: ROUTING_APPROVAL_PAYLOAD,
  resumedFrom: {
    interviewId: "di-1",
  },
};

const MULTI_BUCKET_ROUTING_APPROVAL_PAYLOAD: NonNullable<DeepInterviewAskMetadata["routingApproval"]> = {
  sessionProviderFamily: "openai-codex",
  recommendedByRole: buildRecommendedByRole(),
  buckets: [
    {
      bucketKey: "openai-codex/gpt-5.5:high",
      recommendedSelector: "openai-codex/gpt-5.5:high",
      roles: ["executor", "test-engineer", "metis"],
    },
    {
      bucketKey: "openai-codex/gpt-5.4:medium",
      recommendedSelector: "openai-codex/gpt-5.4:medium",
      roles: ["explorer", "writer", "multimodal-looker"],
    },
  ],
  approvals: {},
};

const FIRST_BUCKET_META: DeepInterviewAskMetadata = {
  ...APPROVAL_META,
  roundId: "approval-bucket-gpt-5-5-high",
  questionId: "q-approval-bucket-gpt-5-5-high",
  dimension: "routing-approval",
  routingApproval: MULTI_BUCKET_ROUTING_APPROVAL_PAYLOAD,
};

const SECOND_BUCKET_META: DeepInterviewAskMetadata = {
  ...APPROVAL_META,
  round: 2,
  roundId: "approval-bucket-gpt-5-4-medium",
  questionId: "q-approval-bucket-gpt-5-4-medium",
  dimension: "routing-approval",
};

const MULTI_BUCKET_ROUTING_APPROVAL_FLOW: ApprovalFlowAskMetadata = {
  kind: "routing-bucket",
  source: "setup",
  decisionKey: "approve-routing-bucket",
  summary: "Approve the current routing bucket recommendations before resuming execution.",
  routingApproval: MULTI_BUCKET_ROUTING_APPROVAL_PAYLOAD,
  resumedFrom: {
    interviewId: "di-1",
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
  it("keeps final spec persistence off the public runtime interface", () => {
    const publicSurfaceHidden: "persistFinalSpecAndSeedApprovalFlow" extends keyof DeepInterviewRuntime ? false : true =
      true;

    expect(publicSurfaceHidden).toBe(true);
  });

  it("seeds pending question state into the V2 nested envelope with stable round identity", async () => {
    const state = await runtime.seedQuestion({
      question: "Confirm the topology.",
      recommended: 0,
      deepInterview: META,
    });

    expect(state.phase).toBe("interviewing");
    expect(state.pendingQuestion).toEqual(
      expect.objectContaining({
        roundKey: "di-1::rid:topology",
        question: "Confirm the topology.",
        recommended: 0,
        meta: META,
      })
    );
    expect(state.state.rounds).toEqual(
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

  it("records answers inside state.rounds and reloads from the persisted store", async () => {
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
    const resumed = (await createDeepInterviewRuntime(projectRoot).readState()) as DeepInterviewState | undefined;

    expect(answered.pendingQuestion).toBeUndefined();
    expect(answered.state.rounds).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          roundKey: "di-1::rid:topology",
          selected: "Option C",
          lifecycle: "answered",
        }),
      ])
    );
    expect(resumed?.state.rounds).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          roundKey: "di-1::rid:topology",
          selected: "Option C",
        }),
      ])
    );
    expect(resumed?.pendingQuestion).toBeUndefined();
  });

  it("cuts approval ownership over to root approvalFlow while leaving deepInterview in handoff", async () => {
    const seeded = await runtime.seedQuestion({
      question: "Approve the implementation handoff.",
      recommended: 0,
      deepInterview: APPROVAL_META,
      approval: APPROVAL_FLOW,
    });
    const pending = (await runtime.readApprovalFlow()) as ApprovalFlowState | undefined;

    expect(seeded.phase).toBe("handoff");
    expect(seeded.approvalHandoff).toBeUndefined();
    expect(seeded.pendingQuestion?.meta.approvalHandoff).toBeUndefined();
    expect(seeded.pendingQuestion?.meta.routingApproval).toBeUndefined();
    expect(pending).toEqual(
      expect.objectContaining({
        kind: "spec-handoff",
        status: "pending",
        decisionKey: "approve-option-c",
        pendingQuestion: expect.objectContaining({
          question: "Approve the implementation handoff.",
          recommended: 0,
        }),
      })
    );

    const answered = await runtime.recordAnswer({
      question: "Approve the implementation handoff.",
      selected: "계속",
      recommended: 0,
      deepInterview: APPROVAL_META,
      approval: APPROVAL_FLOW,
    });
    const approval = (await runtime.readApprovalFlow()) as ApprovalFlowState | undefined;
    const resumed = (await createDeepInterviewRuntime(projectRoot).readState()) as DeepInterviewState | undefined;

    expect(answered.phase).toBe("handoff");
    expect(answered.state.rounds.at(-1)).toEqual(
      expect.objectContaining({
        selected: "proceed",
        approvalHandoff: expect.objectContaining({
          decisionKey: "approve-option-c",
          status: "approved",
        }),
      })
    );
    expect(approval).toEqual(
      expect.objectContaining({
        active: false,
        status: "approved",
        decisionKey: "approve-option-c",
        resolved: {
          selected: "proceed",
          displayLabel: "계속",
          customInput: null,
        },
      })
    );
    expect(resumed?.state.rounds.at(-1)?.approvalHandoff).toEqual(
      expect.objectContaining({
        decisionKey: "approve-option-c",
        status: "approved",
      })
    );
    expect(resumed?.approvalHandoff).toBeUndefined();
    expect(resumed?.routingApproval).toBeUndefined();
  });

  it("persists cancelled approval answers without falling back to a pending compatibility mirror", async () => {
    await runtime.seedQuestion({
      question: "Approve the implementation handoff.",
      recommended: 0,
      deepInterview: APPROVAL_META,
      approval: APPROVAL_FLOW,
    });

    const answered = await runtime.recordAnswer({
      question: "Approve the implementation handoff.",
      recommended: 0,
      deepInterview: APPROVAL_META,
      approval: APPROVAL_FLOW,
    });
    const approval = (await runtime.readApprovalFlow()) as ApprovalFlowState | undefined;
    const resumed = (await createDeepInterviewRuntime(projectRoot).readState()) as DeepInterviewState | undefined;

    expect(answered.state.rounds.at(-1)?.approvalHandoff).toEqual(
      expect.objectContaining({
        decisionKey: "approve-option-c",
        status: "cancelled",
      })
    );
    expect(approval).toEqual(
      expect.objectContaining({
        active: false,
        status: "cancelled",
        decisionKey: "approve-option-c",
      })
    );
    expect(approval?.pendingQuestion).toBeUndefined();
    expect(resumed?.state.rounds.at(-1)?.approvalHandoff).toEqual(
      expect.objectContaining({
        decisionKey: "approve-option-c",
        status: "cancelled",
      })
    );
    expect(resumed?.approvalHandoff).toBeUndefined();
    expect(resumed?.routingApproval).toBeUndefined();
  });

  it("keeps approvalFlow pending when the user asks about the listed choices", async () => {
    await runtime.seedQuestion({
      question: "Approve the implementation handoff.",
      recommended: 0,
      deepInterview: APPROVAL_META,
      approval: APPROVAL_FLOW,
    });

    const answered = await runtime.recordAnswer({
      question: "Approve the implementation handoff.",
      selected: "Ask about these choices",
      recommended: 0,
      deepInterview: APPROVAL_META,
      approval: APPROVAL_FLOW,
    });
    const approval = (await runtime.readApprovalFlow()) as ApprovalFlowState | undefined;
    const resumed = (await createDeepInterviewRuntime(projectRoot).readApprovalFlow()) as ApprovalFlowState | undefined;

    expect(answered.state.rounds.at(-1)).toEqual(
      expect.objectContaining({
        selected: "ask about these choices",
        approvalHandoff: expect.objectContaining({
          decisionKey: "approve-option-c",
          status: "pending",
        }),
      })
    );
    expect(approval).toEqual(
      expect.objectContaining({
        active: true,
        status: "pending",
        resolved: {
          selected: "ask about these choices",
          displayLabel: "Ask about these choices",
          customInput: null,
        },
      })
    );
    expect(resumed).toEqual(
      expect.objectContaining({
        active: true,
        status: "pending",
        resolved: {
          selected: "ask about these choices",
          displayLabel: "Ask about these choices",
          customInput: null,
        },
      })
    );
  });

  it("marks explicit refinement choices as rejected while preserving the resolved selection", async () => {
    await runtime.seedQuestion({
      question: "Approve the implementation handoff.",
      recommended: 0,
      deepInterview: APPROVAL_META,
      approval: APPROVAL_FLOW,
    });

    await runtime.recordAnswer({
      question: "Approve the implementation handoff.",
      selected: "Refine further",
      recommended: 0,
      deepInterview: APPROVAL_META,
      approval: APPROVAL_FLOW,
    });
    const approval = (await runtime.readApprovalFlow()) as ApprovalFlowState | undefined;

    expect(approval).toEqual(
      expect.objectContaining({
        active: false,
        status: "rejected",
        resolved: {
          selected: "Refine further",
          displayLabel: "Refine further",
          customInput: null,
        },
      })
    );
  });

  it("honors canonical root approval metadata without requiring nested approvalHandoff fields", async () => {
    const seeded = await runtime.seedQuestion({
      question: "Approve the runtime cutover.",
      recommended: 0,
      deepInterview: APPROVAL_ONLY_META,
      approval: APPROVAL_ONLY_FLOW,
    });
    const pending = (await runtime.readApprovalFlow()) as ApprovalFlowState | undefined;

    expect(seeded.phase).toBe("handoff");
    expect(pending).toEqual(
      expect.objectContaining({
        kind: "spec-handoff",
        source: "manual",
        decisionKey: "approve-runtime-cutover",
        summary: "Approve the runtime cutover after root approvalFlow persistence.",
        status: "pending",
        pendingQuestion: expect.objectContaining({
          question: "Approve the runtime cutover.",
          recommended: 0,
        }),
        resumedFrom: {
          interviewId: "di-approval-root",
          specPath: "docs/specs/2026-07-06-workflow-optimization-design.md",
        },
      })
    );

    await runtime.recordAnswer({
      question: "Approve the runtime cutover.",
      selected: "승인, plan으로 진행",
      recommended: 0,
      deepInterview: APPROVAL_ONLY_META,
      approval: APPROVAL_ONLY_FLOW,
    });
    const resumedApproval = (await createDeepInterviewRuntime(projectRoot).readApprovalFlow()) as
      | ApprovalFlowState
      | undefined;
    const persisted = JSON.parse(
      readFileSync(join(projectRoot, ".pi-oven", "state", "autonomous.json"), "utf-8")
    ) as {
      approvalFlow?: {
        resolved?: { selected?: string; displayLabel?: string | null; customInput?: string | null };
      };
    };

    expect(persisted.approvalFlow?.resolved).toEqual({
      selected: "proceed",
      displayLabel: "승인, plan으로 진행",
      customInput: null,
    });
    expect(resumedApproval).toEqual(
      expect.objectContaining({
        kind: "spec-handoff",
        source: "manual",
        decisionKey: "approve-runtime-cutover",
        status: "approved",
        resumedFrom: {
          interviewId: "di-approval-root",
          specPath: "docs/specs/2026-07-06-workflow-optimization-design.md",
        },
        resolved: {
          selected: "proceed",
          displayLabel: "승인, plan으로 진행",
          customInput: null,
        },
      })
    );
  });
  it("normalizes stale localized affirmative approval states back to approved on resume", async () => {
    const specPath = "docs/specs/2026-07-06-workflow-optimization-design.md";
    mkdirSync(join(projectRoot, ".pi-oven", "state"), { recursive: true });
    writeFileSync(
      join(projectRoot, ".pi-oven", "state", "autonomous.json"),
      JSON.stringify({
        active: false,
        gateCache: { commit: "FAIL", regression: "FAIL" },
        deepInterview: {
          version: 2,
          interviewId: "di-approval-root",
          active: false,
          phase: "complete",
          spec: {
            path: specPath,
            sha256: "abc123",
            persistedAt: "2026-07-06T00:04:00.000Z",
            stage: "final",
          },
          state: {
            rounds: [
              {
                roundKey: "di-approval-root::rid:approval-root",
                interviewId: "di-approval-root",
                round: 1,
                roundId: "approval-root",
                questionId: "q-approval-root",
                stage: "approval",
                question: "Approve the runtime cutover.",
                questionHash: "qhash-approval-root",
                lifecycle: "answered",
                askedAt: "2026-07-06T00:04:00.000Z",
                answeredAt: "2026-07-06T00:05:00.000Z",
                selected: "이대로 진행",
                answerHash: "ahash-approval-root",
              },
            ],
            establishedFacts: [],
            ontologySnapshots: [],
            milestone: "ready",
          },
        },
        approvalFlow: {
          version: 1,
          active: false,
          kind: "spec-handoff",
          source: "manual",
          decisionKey: "approve-runtime-cutover",
          summary: "Approve the runtime cutover after root approvalFlow persistence.",
          status: "rejected",
          requestedAt: "2026-07-06T00:04:00.000Z",
          resolvedAt: "2026-07-06T00:05:00.000Z",
          resumedFrom: {
            interviewId: "di-approval-root",
            specPath,
          },
          resolved: {
            selected: "이대로 진행",
            customInput: null,
          },
        },
      })
    );

    const resumedApproval = (await createDeepInterviewRuntime(projectRoot).readApprovalFlow()) as
      | ApprovalFlowState
      | undefined;

    expect(resumedApproval).toEqual(
      expect.objectContaining({
        active: false,
        status: "approved",
        decisionKey: "approve-runtime-cutover",
        resumedFrom: {
          interviewId: "di-approval-root",
          specPath,
        },
        resolved: {
          selected: "proceed",
          displayLabel: "이대로 진행",
          customInput: null,
        },
      })
    );
  });

  it("persists routing approval payloads under root approvalFlow across seed → approve → resume", async () => {
    await runtime.seedQuestion({
      question: "Approve the codex routing bucket.",
      recommended: 0,
      deepInterview: ROUTING_APPROVAL_META,
      approval: ROUTING_APPROVAL_FLOW,
    });

    const approved = await runtime.recordAnswer({
      question: "Approve the codex routing bucket.",
      selected: "Approve",
      recommended: 0,
      deepInterview: ROUTING_APPROVAL_META,
      approval: ROUTING_APPROVAL_FLOW,
    });
    const resumedApproval = (await createDeepInterviewRuntime(projectRoot).readApprovalFlow()) as
      | ApprovalFlowState
      | undefined;
    const resumedState = (await createDeepInterviewRuntime(projectRoot).readState()) as DeepInterviewState | undefined;

    expect(approved.phase).toBe("handoff");
    expect(approved.routingApproval).toBeUndefined();
    expect(resumedState?.routingApproval).toBeUndefined();
    expect(resumedState?.pendingQuestion).toBeUndefined();
    expect(resumedApproval?.routingApproval?.approvals.executor).toEqual(
      expect.objectContaining({
        status: "approved",
        selectedSelector: "openai-codex/gpt-5.5:high",
      })
    );
    expect(resumedApproval).toEqual(
      expect.objectContaining({
        kind: "routing-bucket",
        status: "approved",
      })
    );
  });

  it("keeps approvalFlow pending until every routing bucket is resolved", async () => {
    await runtime.seedQuestion({
      question: "Approve the first codex routing bucket.",
      recommended: 0,
      deepInterview: FIRST_BUCKET_META,
      approval: MULTI_BUCKET_ROUTING_APPROVAL_FLOW,
    });

    await runtime.recordAnswer({
      question: "Approve the first codex routing bucket.",
      selected: "Approve",
      recommended: 0,
      deepInterview: FIRST_BUCKET_META,
      approval: MULTI_BUCKET_ROUTING_APPROVAL_FLOW,
    });

    let approval = (await runtime.readApprovalFlow()) as ApprovalFlowState | undefined;
    expect(approval).toEqual(
      expect.objectContaining({
        status: "pending",
        routingApproval: expect.objectContaining({
          approvals: expect.objectContaining({
            executor: expect.objectContaining({ status: "approved" }),
          }),
        }),
      })
    );

    await runtime.seedQuestion({
      question: "Approve the second codex routing bucket.",
      recommended: 0,
      deepInterview: SECOND_BUCKET_META,
      approval: MULTI_BUCKET_ROUTING_APPROVAL_FLOW,
    });
    await runtime.recordAnswer({
      question: "Approve the second codex routing bucket.",
      selected: "Approve",
      recommended: 0,
      deepInterview: SECOND_BUCKET_META,
      approval: MULTI_BUCKET_ROUTING_APPROVAL_FLOW,
    });

    approval = (await runtime.readApprovalFlow()) as ApprovalFlowState | undefined;
    expect(approval).toEqual(
      expect.objectContaining({
        status: "approved",
        routingApproval: expect.objectContaining({
          approvals: expect.objectContaining({
            writer: expect.objectContaining({
              status: "approved",
              selectedSelector: "openai-codex/gpt-5.4:medium",
            }),
          }),
        }),
      })
    );
  });

  it("writes the final docs/specs artifact and seeds approvalFlow via the sanctioned completion path", async () => {
    await runtime.seedQuestion({
      question: "Confirm the topology.",
      recommended: 0,
      deepInterview: META,
    });
    await runtime.recordAnswer({
      question: "Confirm the topology.",
      selected: "Session cookie",
      recommended: 0,
      deepInterview: META,
    });

    const completed = await (runtime as DeepInterviewCompletionRuntime).persistFinalSpecAndSeedApprovalFlow({
      specPath: "docs/specs/drafts/../2026-07-06-workflow-optimization-design.md",
      content: "# Workflow optimization\n\nFinalized.",
      decisionKey: "approve-workflow-optimization-spec-v1",
      summary: "Approve workflow optimization + gajae-style deep-interview redesign direction for spec/plan drafting",
      question: "지금까지의 수렴 결과로 spec/plan 초안 작성 단계로 넘어갈까요?",
      recommended: 0,
    });

    expect(readFileSync(join(projectRoot, "docs/specs/2026-07-06-workflow-optimization-design.md"), "utf-8")).toContain(
      "Finalized."
    );
    expect(completed.deepInterview).toEqual(
      expect.objectContaining({
        phase: "complete",
        active: false,
        spec: expect.objectContaining({
          path: "docs/specs/2026-07-06-workflow-optimization-design.md",
          stage: "final",
        }),
      })
    );
    expect(completed.approvalFlow).toEqual(
      expect.objectContaining({
        active: true,
        kind: "spec-handoff",
        status: "pending",
        decisionKey: "approve-workflow-optimization-spec-v1",
        resumedFrom: {
          interviewId: "di-1",
          specPath: "docs/specs/2026-07-06-workflow-optimization-design.md",
        },
      })
    );
  });
  it("rejects final spec persistence paths that escape docs/specs after canonicalization", async () => {
    let thrown: unknown;
    try {
      await (runtime as DeepInterviewCompletionRuntime).persistFinalSpecAndSeedApprovalFlow({
        specPath: "docs/specs/../../outside.md",
        content: "# Workflow optimization\n\nFinalized.",
        decisionKey: "approve-workflow-optimization-spec-v1",
        summary: "Approve workflow optimization + gajae-style deep-interview redesign direction for spec/plan drafting",
        question: "지금까지의 수렴 결과로 spec/plan 초안 작성 단계로 넘어갈까요?",
        recommended: 0,
      });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toContain("Final spec persistence path must stay under docs/specs/");
    expect(existsSync(join(projectRoot, "outside.md"))).toBe(false);
    expect(existsSync(join(projectRoot, ".pi-oven", "state", "autonomous.json"))).toBe(false);
  });
  it("rejects final spec persistence paths that traverse symlinks under docs/specs", async () => {
    mkdirSync(join(projectRoot, "external"), { recursive: true });
    mkdirSync(join(projectRoot, "docs/specs"), { recursive: true });
    symlinkSync(join(projectRoot, "external"), join(projectRoot, "docs/specs/link"), "dir");
    let thrown: unknown;
    try {
      await (runtime as DeepInterviewCompletionRuntime).persistFinalSpecAndSeedApprovalFlow({
        specPath: "docs/specs/link/escaped.md",
        content: "# Workflow optimization\n\nFinalized.",
        decisionKey: "approve-workflow-optimization-spec-v1",
        summary: "Approve workflow optimization + gajae-style deep-interview redesign direction for spec/plan drafting",
        question: "지금까지의 수렴 결과로 spec/plan 초안 작성 단계로 넘어갈까요?",
        recommended: 0,
      });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toContain("must not traverse symlinks");
    expect(existsSync(join(projectRoot, "external", "escaped.md"))).toBe(false);
    expect(existsSync(join(projectRoot, ".pi-oven", "state", "autonomous.json"))).toBe(false);
  });

  it("emits approvalFlow and spec receipt deltas into runtime traces", async () => {
    let traces: RuntimeTraceSnapshot[] = [];
    runtime = createDeepInterviewRuntime(projectRoot, {
      now: () => "2026-07-05T00:00:00.000Z",
      onRuntimeTrace: (trace) => {
        traces = [...traces, trace];
      },
    });

    await runtime.seedQuestion({
      question: "Approve the codex routing bucket.",
      recommended: 0,
      deepInterview: ROUTING_APPROVAL_META,
      approval: {
        ...ROUTING_APPROVAL_FLOW,
        routingApproval: {
          ...ROUTING_APPROVAL_PAYLOAD,
          approvals: {},
        },
      },
    });
    await runtime.recordAnswer({
      question: "Approve the codex routing bucket.",
      selected: "Approve",
      recommended: 0,
      deepInterview: ROUTING_APPROVAL_META,
      approval: {
        ...ROUTING_APPROVAL_FLOW,
        routingApproval: {
          ...ROUTING_APPROVAL_PAYLOAD,
          approvals: {},
        },
      },
    });
    await (runtime as DeepInterviewCompletionRuntime).persistFinalSpecAndSeedApprovalFlow({
      specPath: "docs/specs/2026-07-06-workflow-optimization-design.md",
      content: "# Workflow optimization\n\nFinalized.",
      decisionKey: "approve-workflow-optimization-spec-v1",
      summary: "Approve workflow optimization + gajae-style deep-interview redesign direction for spec/plan drafting",
      question: "지금까지의 수렴 결과로 spec/plan 초안 작성 단계로 넘어갈까요?",
      recommended: 0,
    });

    expect(traces.some((trace) => trace.stateChanges.some((change) => change.key === "approvalFlow.status"))).toBe(true);
    expect(
      traces.some((trace) =>
        trace.stateChanges.some(
          (change) =>
            change.key === "approvalFlow.routingApproval.approvals.executor.selectedSelector" &&
            change.after === "openai-codex/gpt-5.5:high"
        )
      )
    ).toBe(true);
    expect(
      traces.some((trace) =>
        trace.stateChanges.some(
          (change) =>
            change.key === "deepInterview.spec.path" &&
            change.after === "docs/specs/2026-07-06-workflow-optimization-design.md"
        )
      )
    ).toBe(true);
  });
});
