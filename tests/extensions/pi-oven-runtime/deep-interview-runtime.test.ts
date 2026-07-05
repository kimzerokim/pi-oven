import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, readFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { PROFILE_B, ROLES, type Role } from "../../../scripts/pi-oven-setup/profiles";
import {
  createDeepInterviewRuntime,
  type DeepInterviewRuntime,
} from "../../../.omp/extensions/pi-oven-runtime/deep-interview-runtime";
import type { DeepInterviewAskMetadata } from "../../../.omp/extensions/pi-oven-runtime/deep-interview-state";
import type { RuntimeTraceSnapshot } from "../../../.omp/extensions/pi-oven-runtime/trace-primitives";

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

const ROUTING_APPROVAL_META: DeepInterviewAskMetadata = {
  ...APPROVAL_META,
  roundId: "approval-bucket-gpt-5-5-high",
  questionId: "q-approval-bucket-gpt-5-5-high",
  dimension: "routing-approval",
  routingApproval: ROUTING_APPROVAL_PAYLOAD,
};

const MULTI_BUCKET_ROUTING_APPROVAL_PAYLOAD: NonNullable<DeepInterviewAskMetadata["routingApproval"]> = {
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

const MULTI_BUCKET_ROUTING_APPROVAL_META: DeepInterviewAskMetadata = {
  ...APPROVAL_META,
  roundId: "approval-bucket-gpt-5-5-high",
  questionId: "q-approval-bucket-gpt-5-5-high",
  dimension: "routing-approval",
  routingApproval: MULTI_BUCKET_ROUTING_APPROVAL_PAYLOAD,
};

const SECOND_BUCKET_ROUTING_APPROVAL_META: DeepInterviewAskMetadata = {
  ...APPROVAL_META,
  round: 2,
  roundId: "approval-bucket-gpt-5-4-medium",
  questionId: "q-approval-bucket-gpt-5-4-medium",
  dimension: "routing-approval",
  routingApproval: MULTI_BUCKET_ROUTING_APPROVAL_PAYLOAD,
};

const EXPLICIT_OVERRIDE_ROUTING_APPROVAL_PAYLOAD: NonNullable<DeepInterviewAskMetadata["routingApproval"]> = {
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
      status: "overridden",
      recommendedSelector: "openai-codex/gpt-5.5:high",
      selectedSelector: "openai-codex/gpt-5.4:high",
    },
    "test-engineer": {
      role: "test-engineer",
      bucketKey: "openai-codex/gpt-5.5:high",
      status: "overridden",
      recommendedSelector: "openai-codex/gpt-5.5:high",
      selectedSelector: "openai-codex/gpt-5.4:high",
    },
    metis: {
      role: "metis",
      bucketKey: "openai-codex/gpt-5.5:high",
      status: "overridden",
      recommendedSelector: "openai-codex/gpt-5.5:high",
      selectedSelector: "openai-codex/gpt-5.4:high",
    },
  },
};

const EXPLICIT_OVERRIDE_ROUTING_APPROVAL_META: DeepInterviewAskMetadata = {
  ...APPROVAL_META,
  roundId: "approval-bucket-gpt-5-5-high",
  questionId: "q-approval-bucket-gpt-5-5-high",
  dimension: "routing-approval",
  routingApproval: EXPLICIT_OVERRIDE_ROUTING_APPROVAL_PAYLOAD,
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
  it("marks seeded approval questions as approval_pending before the answer arrives", async () => {
    const seeded = await runtime.seedQuestion({
      question: "Approve the codex routing bucket.",
      recommended: 0,
      deepInterview: ROUTING_APPROVAL_META,
    });

    expect(seeded.phase).toBe("approval_pending");
    expect(seeded.approvalHandoff).toEqual(
      expect.objectContaining({
        decisionKey: "approve-option-c",
        status: "pending",
      })
    );
    expect(seeded.pendingQuestion).toEqual(
      expect.objectContaining({
        question: "Approve the codex routing bucket.",
        meta: expect.objectContaining({
          stage: "approval",
          roundId: "approval-bucket-gpt-5-5-high",
        }),
      })
    );
  });
  it("persists routing approval payloads across seed → approve → resume", async () => {
    await runtime.seedQuestion({
      question: "Approve the codex routing bucket.",
      recommended: 0,
      deepInterview: ROUTING_APPROVAL_META,
    });

    const approved = (await runtime.recordAnswer({
      question: "Approve the codex routing bucket.",
      selected: "Approve",
      recommended: 0,
      deepInterview: ROUTING_APPROVAL_META,
    })) as unknown as {
      phase: string;
      routingApproval?: {
        approvals?: {
          executor?: { status?: string; selectedSelector?: string };
        };
      };
      rounds: Array<{
        roundKey: string;
        routingApproval?: {
          buckets?: Array<{ bucketKey?: string }>;
        };
      }>;
    };
    const resumed = (await createDeepInterviewRuntime(projectRoot).readState()) as unknown as
      | undefined
      | {
          routingApproval?: {
            approvals?: {
              executor?: { status?: string; selectedSelector?: string };
            };
          };
        };

    expect(approved.phase).toBe("ready_to_resume");
    expect(approved.routingApproval?.approvals?.executor).toEqual(
      expect.objectContaining({
        status: "approved",
        selectedSelector: "openai-codex/gpt-5.5:high",
      })
    );
    expect(approved.rounds).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          roundKey: "di-1::rid:approval-bucket-gpt-5-5-high",
          routingApproval: expect.objectContaining({
            buckets: expect.arrayContaining([
              expect.objectContaining({
                bucketKey: "openai-codex/gpt-5.5:high",
              }),
            ]),
          }),
        }),
      ])
    );
    expect(resumed?.routingApproval?.approvals?.executor).toEqual(
      expect.objectContaining({
        status: "approved",
        selectedSelector: "openai-codex/gpt-5.5:high",
      })
    );
  });

  it("emits routing approval state deltas into runtime traces", async () => {
    let trace: RuntimeTraceSnapshot | undefined;
    runtime = createDeepInterviewRuntime(projectRoot, {
      now: () => "2026-07-05T00:00:00.000Z",
      onRuntimeTrace: (nextTrace) => {
        trace = nextTrace;
      },
    });
    const pendingMeta: DeepInterviewAskMetadata = {
      ...ROUTING_APPROVAL_META,
      routingApproval: {
        ...ROUTING_APPROVAL_PAYLOAD,
        approvals: {},
      },
    };

    await runtime.seedQuestion({
      question: "Approve the codex routing bucket.",
      recommended: 0,
      deepInterview: pendingMeta,
    });
    await runtime.recordAnswer({
      question: "Approve the codex routing bucket.",
      selected: "Approve",
      recommended: 0,
      deepInterview: pendingMeta,
    });

    expect(trace?.mutationScope).toBe("runtime_contract");
    expect(trace?.touchedPaths).toContain(".omp/extensions/pi-oven-runtime/deep-interview-runtime.ts");
    expect(trace?.stateChanges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "deepInterview.approvalHandoff.status",
          before: "pending",
          after: "approved",
        }),
        expect.objectContaining({
          key: "deepInterview.routingApproval.approvals.executor.selectedSelector",
          before: undefined,
          after: "openai-codex/gpt-5.5:high",
        }),
      ])
    );
  });

  it("keeps routing approval pending until every selector bucket is resolved", async () => {
    await runtime.seedQuestion({
      question: "Approve the first codex routing bucket.",
      recommended: 0,
      deepInterview: MULTI_BUCKET_ROUTING_APPROVAL_META,
    });

    const firstApproved = (await runtime.recordAnswer({
      question: "Approve the first codex routing bucket.",
      selected: "Approve",
      recommended: 0,
      deepInterview: MULTI_BUCKET_ROUTING_APPROVAL_META,
    })) as unknown as {
      phase: string;
      approvalHandoff?: { status?: string };
      routingApproval?: {
        approvals?: {
          executor?: { status?: string };
          writer?: { status?: string };
        };
      };
    };

    expect(firstApproved.phase).toBe("approval_pending");
    expect(firstApproved.approvalHandoff).toEqual(
      expect.objectContaining({
        status: "pending",
      })
    );
    expect(firstApproved.routingApproval?.approvals?.executor).toEqual(
      expect.objectContaining({
        status: "approved",
      })
    );
    expect(firstApproved.routingApproval?.approvals?.writer).toBeUndefined();

    await runtime.seedQuestion({
      question: "Approve the second codex routing bucket.",
      recommended: 0,
      deepInterview: SECOND_BUCKET_ROUTING_APPROVAL_META,
    });

    const fullyApproved = (await runtime.recordAnswer({
      question: "Approve the second codex routing bucket.",
      selected: "Approve",
      recommended: 0,
      deepInterview: SECOND_BUCKET_ROUTING_APPROVAL_META,
    })) as unknown as {
      phase: string;
      approvalHandoff?: { status?: string };
      routingApproval?: {
        approvals?: {
          writer?: { status?: string; selectedSelector?: string };
        };
      };
    };

    expect(fullyApproved.phase).toBe("ready_to_resume");
    expect(fullyApproved.approvalHandoff).toEqual(
      expect.objectContaining({
        status: "approved",
      })
    );
    expect(fullyApproved.routingApproval?.approvals?.writer).toEqual(
      expect.objectContaining({
        status: "approved",
        selectedSelector: "openai-codex/gpt-5.4:medium",
      })
    );
  });

  it("keeps override-per-role pending until explicit per-role selectors are stored", async () => {
    const pendingOverrideMeta: DeepInterviewAskMetadata = {
      ...ROUTING_APPROVAL_META,
      routingApproval: {
        ...ROUTING_APPROVAL_PAYLOAD,
        approvals: {},
      },
    };

    await runtime.seedQuestion({
      question: "Approve the codex routing bucket.",
      recommended: 0,
      deepInterview: pendingOverrideMeta,
    });

    const unresolved = (await runtime.recordAnswer({
      question: "Approve the codex routing bucket.",
      selected: "Override per role",
      recommended: 1,
      deepInterview: pendingOverrideMeta,
    })) as unknown as {
      phase: string;
      routingApproval?: {
        approvals?: {
          executor?: { status?: string; selectedSelector?: string };
        };
      };
    };

    expect(unresolved.phase).toBe("approval_pending");
    expect(unresolved.routingApproval?.approvals?.executor).toBeUndefined();

    await runtime.seedQuestion({
      question: "Approve the codex routing bucket.",
      recommended: 1,
      deepInterview: EXPLICIT_OVERRIDE_ROUTING_APPROVAL_META,
    });

    const resolved = (await runtime.recordAnswer({
      question: "Approve the codex routing bucket.",
      selected: "Override per role",
      recommended: 1,
      deepInterview: EXPLICIT_OVERRIDE_ROUTING_APPROVAL_META,
    })) as unknown as {
      phase: string;
      routingApproval?: {
        approvals?: {
          executor?: { status?: string; selectedSelector?: string };
        };
      };
    };
    const resumed = (await createDeepInterviewRuntime(projectRoot).readState()) as unknown as
      | undefined
      | {
          routingApproval?: {
            approvals?: {
              executor?: { status?: string; selectedSelector?: string };
            };
          };
        };

    expect(resolved.phase).toBe("ready_to_resume");
    expect(resolved.routingApproval?.approvals?.executor).toEqual(
      expect.objectContaining({
        status: "overridden",
        selectedSelector: "openai-codex/gpt-5.4:high",
      })
    );
    expect(resumed?.routingApproval?.approvals?.executor).toEqual(
      expect.objectContaining({
        status: "overridden",
        selectedSelector: "openai-codex/gpt-5.4:high",
      })
    );
  });

  it("keeps approval pending when a follow-up routing bucket is cancelled with buckets still unresolved", async () => {
    await runtime.seedQuestion({
      question: "Approve the first codex routing bucket.",
      recommended: 0,
      deepInterview: MULTI_BUCKET_ROUTING_APPROVAL_META,
    });
    await runtime.recordAnswer({
      question: "Approve the first codex routing bucket.",
      selected: "Approve",
      recommended: 0,
      deepInterview: MULTI_BUCKET_ROUTING_APPROVAL_META,
    });

    await runtime.seedQuestion({
      question: "Approve the second codex routing bucket.",
      recommended: 0,
      deepInterview: SECOND_BUCKET_ROUTING_APPROVAL_META,
    });

    const cancelled = (await runtime.recordAnswer({
      question: "Approve the second codex routing bucket.",
      recommended: 0,
      deepInterview: SECOND_BUCKET_ROUTING_APPROVAL_META,
    })) as unknown as {
      phase: string;
      approvalHandoff?: { status?: string };
      routingApproval?: {
        approvals?: {
          executor?: { status?: string };
          writer?: { status?: string };
        };
      };
    };
    const resumed = (await createDeepInterviewRuntime(projectRoot).readState()) as unknown as
      | undefined
      | {
          phase?: string;
          approvalHandoff?: { status?: string };
          routingApproval?: {
            approvals?: {
              executor?: { status?: string };
              writer?: { status?: string };
            };
          };
        };

    expect(cancelled.phase).toBe("approval_pending");
    expect(cancelled.approvalHandoff).toEqual(
      expect.objectContaining({
        status: "pending",
      })
    );
    expect(cancelled.routingApproval?.approvals?.executor).toEqual(
      expect.objectContaining({
        status: "approved",
      })
    );
    expect(cancelled.routingApproval?.approvals?.writer).toBeUndefined();
    expect(resumed?.phase).toBe("approval_pending");
    expect(resumed?.approvalHandoff).toEqual(
      expect.objectContaining({
        status: "pending",
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
