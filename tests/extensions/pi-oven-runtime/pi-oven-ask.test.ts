import { describe, it, expect } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import * as zod from "zod";
import {
  ASK_ABOUT_CHOICES_VALUE,
  OTHER_VALUE,
  buildSelectItems,
  clampRecommended,
  formatAskResult,
  foldLabel,
  registerPiOvenAsk,
} from "../../../.omp/extensions/pi-oven-runtime/pi-oven-ask";
import { createDeepInterviewRuntime } from "../../../.omp/extensions/pi-oven-runtime/deep-interview-runtime";
import type { ApprovalFlowAskMetadata, DeepInterviewAskMetadata } from "../../../.omp/extensions/pi-oven-runtime/deep-interview-state";
import { PROFILE_B, ROLES, type Role } from "../../../scripts/pi-oven-setup/profiles";

const DEEP_INTERVIEW_META = {
  interviewId: "di-1",
  round: 0,
  roundId: "topology",
  questionId: "q-topology",
  stage: "topology" as const,
  component: "runtime-routing",
  dimension: "scope",
  ambiguity: 1,
};
const APPROVAL_META = {
  ...DEEP_INTERVIEW_META,
  round: 1,
  roundId: "approval",
  questionId: "q-approval",
  stage: "approval" as const,
  dimension: "approval",
  ambiguity: 0.25,
};
const APPROVAL_FLOW_META: ApprovalFlowAskMetadata = {
  kind: "spec-handoff",
  source: "manual",
  decisionKey: "approve-option-c",
  summary: "Implement Option C after approval",
  resumedFrom: {
    interviewId: "di-approval-only",
    specPath: "docs/specs/2026-07-06-workflow-optimization-design.md",
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
  sessionProviderFamily: "openai-codex",
  recommendedByRole: buildRecommendedByRole(),
  buckets: [
    {
      bucketKey: "openai-codex/gpt-5.5:high",
      recommendedSelector: "openai-codex/gpt-5.5:high",
      roles: ["executor", "test-engineer", "metis"],
    },
    {
      bucketKey: "openai-codex/gpt-5.5:xhigh",
      recommendedSelector: "openai-codex/gpt-5.5:xhigh",
      roles: ["planner"],
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

const ROUTING_APPROVAL_FLOW_META: ApprovalFlowAskMetadata = {
  kind: "routing-bucket",
  source: "setup",
  decisionKey: "approve-routing-bucket",
  summary: "Approve the current routing bucket recommendations before resuming execution.",
  routingApproval: ROUTING_APPROVAL_PAYLOAD,
  resumedFrom: {
    interviewId: "di-1",
  },
};


describe("buildSelectItems", () => {
  it("maps each option to {value: label, label, description?}", () => {
    const items = buildSelectItems([
      { label: "JWT", description: "stateless, scalable" },
      { label: "Session cookie" },
    ]);
    expect(items[0]).toEqual({ value: "JWT", label: "JWT", description: "stateless, scalable" });
    expect(items[1]).toEqual({ value: "Session cookie", label: "Session cookie" });
    expect(items[1]).not.toHaveProperty("description");
  });

  it("appends the Other entry by default for legacy callers", () => {
    const items = buildSelectItems([{ label: "A" }]);
    expect(items).toHaveLength(2);
    const other = items[items.length - 1]!;
    expect(other.value).toBe(OTHER_VALUE);
    expect(other.label).toBe("Other (type your own)");
  });

  it("respects explicit affordances for Other and Ask about these choices", () => {
    const items = buildSelectItems([{ label: "A" }], undefined, {
      other: false,
      askAboutChoices: true,
    });
    expect(items).toEqual([
      { value: "A", label: "A" },
      expect.objectContaining({
        value: ASK_ABOUT_CHOICES_VALUE,
        label: "Ask about these choices",
      }),
    ]);
  });

  it("keeps values unique even when labels are duplicated", () => {
    const items = buildSelectItems([{ label: "Dup" }, { label: "Dup" }]);
    const values = items.map((i) => i.value);
    expect(new Set(values).size).toBe(values.length);
    expect(items[0]!.label).toBe("Dup");
    expect(items[1]!.label).toBe("Dup");
  });

  it("marks the recommended option in the display label without changing the selected value", () => {
    const items = buildSelectItems([{ label: "JWT" }, { label: "Session cookie" }], 1);
    expect(items[0]).toEqual({ value: "JWT", label: "JWT" });
    expect(items[1]).toEqual({
      value: "Session cookie",
      label: "Session cookie (Recommended)",
    });
  });
});

describe("clampRecommended", () => {
  it("passes an in-range index through", () => {
    expect(clampRecommended(0, 3)).toBe(0);
    expect(clampRecommended(2, 3)).toBe(2);
  });

  it("returns undefined for undefined / negative / out-of-range / non-integer", () => {
    expect(clampRecommended(undefined, 3)).toBeUndefined();
    expect(clampRecommended(-1, 3)).toBeUndefined();
    expect(clampRecommended(3, 3)).toBeUndefined();
    expect(clampRecommended(5, 3)).toBeUndefined();
    expect(clampRecommended(1.5, 3)).toBeUndefined();
  });

  it("returns undefined when len is 0", () => {
    expect(clampRecommended(0, 0)).toBeUndefined();
  });
});

describe("formatAskResult", () => {
  it("selected → 'User selected: X' + details.action=selected", () => {
    const res = formatAskResult("Q?", { action: "selected", selected: "Option A" });
    expect(res.content[0]).toEqual({ type: "text", text: "User selected: Option A" });
    expect(res.details).toEqual({
      mode: "single",
      question: "Q?",
      action: "selected",
      selected: "Option A",
    });
    expect(res.details).not.toHaveProperty("customInput");
  });

  it("other → custom input is preserved with action=other", () => {
    const res = formatAskResult("Q?", { action: "other", customInput: "my answer" });
    expect(res.content[0]).toEqual({ type: "text", text: "User provided custom input: my answer" });
    expect(res.details).toEqual({
      mode: "single",
      question: "Q?",
      action: "other",
      customInput: "my answer",
    });
    expect(res.details).not.toHaveProperty("selected");
  });

  it("multiline customInput is indented in the text", () => {
    const res = formatAskResult("Q?", { action: "other", customInput: "line1\nline2" });
    const txt = res.content[0]!;
    expect(txt.type).toBe("text");
    expect(txt.type === "text" && txt.text).toBe("User provided custom input:\n  line1\n  line2");
  });

  it("ask_about_choices emits a distinct explanatory action", () => {
    const res = formatAskResult("Q?", { action: "ask_about_choices" });
    expect(res.content[0]).toEqual({ type: "text", text: "User asked about these choices" });
    expect(res.details).toEqual({
      mode: "single",
      question: "Q?",
      action: "ask_about_choices",
    });
  });

  it("deferred and cancelled remain distinguishable", () => {
    const deferred = formatAskResult("Q?", { action: "deferred" });
    expect(deferred.content[0]).toEqual({ type: "text", text: "Workflow gate deferred approval." });
    expect(deferred.details).toEqual({
      mode: "single",
      question: "Q?",
      action: "deferred",
      deferred: true,
    });

    const cancelled = formatAskResult("Q?", { action: "cancelled" });
    expect(cancelled.content[0]).toEqual({ type: "text", text: "User cancelled the selection" });
    expect(cancelled.details).toEqual({
      mode: "single",
      question: "Q?",
      action: "cancelled",
    });
  });

  it("carries context, affordances, recommendation, and approval metadata in details", () => {
    const res = formatAskResult(
      "Q?",
      { action: "selected", selected: "Option A" },
      {
        recommended: 0,
        deepInterview: DEEP_INTERVIEW_META,
        contextHeaders: [{ title: "Stage", value: "approval", tone: "accent" }],
        contextSections: [{ title: "Why now", bodyMarkdown: "Need approval." }],
        affordances: { other: false, askAboutChoices: true },
      }
    );
    expect(res.details).toEqual({
      mode: "single",
      question: "Q?",
      action: "selected",
      selected: "Option A",
      recommended: 0,
      deepInterview: DEEP_INTERVIEW_META,
      contextHeaders: [{ title: "Stage", value: "approval", tone: "accent" }],
      contextSections: [{ title: "Why now", bodyMarkdown: "Need approval." }],
      affordances: { other: false, askAboutChoices: true },
    });
  });
});

describe("foldLabel", () => {
  it("appends the description when present", () => {
    expect(foldLabel({ label: "JWT", description: "stateless" })).toBe("JWT — stateless");
  });

  it("returns the bare label when no description", () => {
    expect(foldLabel({ label: "Session cookie" })).toBe("Session cookie");
  });
});

function makeTheme() {
  return {
    fg: (_key: string, text: string) => text,
    bold: (text: string) => text,
    italic: (text: string) => text,
    underline: (text: string) => text,
    strikethrough: (text: string) => text,
    styledSymbol: (_key: string, color: string) => color,
    getSymbolPreset: () => "unicode",
    getSpinnerFrames: () => ["."],
    nav: { cursor: ">", selected: ">", expand: "+", collapse: "-", back: "<" },
    tree: { branch: "├", last: "└", vertical: "│", horizontal: "─", hook: "┬" },
    boxRound: {
      topLeft: "╭",
      topRight: "╮",
      bottomLeft: "╰",
      bottomRight: "╯",
      horizontal: "─",
      vertical: "│",
    },
    boxSharp: {
      topLeft: "┌",
      topRight: "┐",
      bottomLeft: "└",
      bottomRight: "┘",
      horizontal: "─",
      vertical: "│",
      cross: "┼",
      teeDown: "┬",
      teeUp: "┴",
      teeRight: "├",
      teeLeft: "┤",
    },
    md: { quoteBorder: "│", hrChar: "─", bullet: "•" },
    checkbox: { unchecked: "□", checked: "■" },
  } as const;
}

interface PiOvenAskTestComponent {
  render(width: number): string[];
  children?: unknown[];
}

interface PiOvenAskTestTool {
  parameters: {
    parse(input: unknown): unknown;
  };
  renderCall(args: unknown, options: unknown, theme: unknown): PiOvenAskTestComponent;
  renderResult(result: unknown, options: unknown, theme: unknown): unknown;
  execute(
    toolCallId: string,
    params: unknown,
    signal: AbortSignal | undefined,
    onUpdate: unknown,
    ctx: unknown
  ): Promise<{ details?: unknown } & Record<string, unknown>>;
}

interface SelectListLike {
  getSelectedItem?: () => { value?: string } | undefined;
  onSelect?: (item: { value?: string } | undefined) => void;
}

function capturePiOvenAskTool(): PiOvenAskTestTool {
  let captured: unknown;
  registerPiOvenAsk({
    zod,
    registerTool(tool: unknown) {
      captured = tool;
    },
    logger: {},
  } as unknown as Parameters<typeof registerPiOvenAsk>[0]);
  return captured as PiOvenAskTestTool;
}

describe("registerPiOvenAsk", () => {
  it("renderCall emits the image-style hierarchy with headers, markdown context, and explicit affordances", () => {
    const tool = capturePiOvenAskTool();
    const theme = makeTheme();

    const component = tool.renderCall(
      {
        question: "Approve the implementation handoff.",
        contextHeaders: [
          { title: "Stage", value: "approval" },
          { title: "Recommended", value: "Proceed" },
        ],
        contextSections: [
          {
            title: "Why now",
            bodyMarkdown: "Need **approval** before moving forward.",
            bullets: ["Keep resume state intact."],
          },
        ],
        options: [
          { label: "Proceed", description: "Continue with the current handoff.", detailMarkdown: "Use the current spec." },
        ],
        affordances: { other: false, askAboutChoices: true },
      },
      {},
      theme
    );

    const rendered = component.render(80).join("\n");
    expect(rendered).toContain("Approve the implementation handoff.");
    expect(rendered).toContain("Stage: approval");
    expect(rendered).toContain("Why now");
    expect(rendered).toContain("Ask about these choices");
    expect(rendered).not.toContain("Other (type your own)");
  });

  it("renderResult keeps the title → headers → context → options → outcome hierarchy", () => {
    const tool = capturePiOvenAskTool();
    const theme = makeTheme();
    const component = tool.renderResult(
      formatAskResult(
        "Approve the implementation handoff.",
        { action: "selected", selected: "Proceed" },
        {
          recommended: 0,
          contextHeaders: [{ title: "Stage", value: "approval", tone: "accent" }],
          contextSections: [{ title: "Why now", bodyMarkdown: "Need **approval** before moving forward." }],
          options: [
            { label: "Proceed", description: "Continue with the current handoff." },
            { label: "Refine further", description: "Stop and revisit the plan." },
          ],
          affordances: { other: false, askAboutChoices: true },
        }
      ),
      {},
      theme
    ) as PiOvenAskTestComponent;

    const rendered = component.render(80).join("\n");
    const titleIndex = rendered.indexOf("Ask (pi-oven)");
    const headerIndex = rendered.indexOf("Stage: approval");
    const questionIndex = rendered.indexOf("Approve the implementation handoff.");
    const contextIndex = rendered.indexOf("Why now");
    const optionsIndex = rendered.indexOf("Refine further");
    const outcomeIndex = rendered.indexOf("■ Proceed");

    expect(titleIndex).toBeGreaterThanOrEqual(0);
    expect(headerIndex).toBeGreaterThan(titleIndex);
    expect(questionIndex).toBeGreaterThan(headerIndex);
    expect(contextIndex).toBeGreaterThan(questionIndex);
    expect(optionsIndex).toBeGreaterThan(contextIndex);
    expect(outcomeIndex).toBeGreaterThan(optionsIndex);
    expect(rendered).toContain("Ask about these choices");
  });

  it("accepts mixed structured+markdown ask fields without stripping routing approval resume state", () => {
    const tool = capturePiOvenAskTool();
    const parsed = tool.parameters.parse({
      question: "Approve the codex routing bucket",
      contextHeaders: [{ title: "Provider family", value: "openai-codex", tone: "accent" }],
      contextSections: [
        {
          title: "Roles",
          bodyMarkdown: "Review the shared selector bucket.",
          bullets: ["executor", "test-engineer", "metis"],
        },
      ],
      options: [
        { label: "Approve", detailMarkdown: "Use the recommended selector for all roles." },
        { label: "Override per role" },
      ],
      recommended: 0,
      affordances: { other: false, askAboutChoices: true },
      deepInterview: {
        ...DEEP_INTERVIEW_META,
        round: 1,
        roundId: "approval-bucket-gpt-5-5-high",
        questionId: "q-approval-bucket-gpt-5-5-high",
        stage: "approval",
        dimension: "routing-approval",
        routingApproval: ROUTING_APPROVAL_PAYLOAD,
      },
    }) as unknown as {
      contextHeaders?: unknown;
      contextSections?: unknown;
      affordances?: unknown;
      options?: Array<{ detailMarkdown?: string }>;
      deepInterview?: { routingApproval?: unknown };
    };

    expect(parsed.contextHeaders).toEqual([{ title: "Provider family", value: "openai-codex", tone: "accent" }]);
    expect(parsed.contextSections).toEqual([
      {
        title: "Roles",
        bodyMarkdown: "Review the shared selector bucket.",
        bullets: ["executor", "test-engineer", "metis"],
      },
    ]);
    expect(parsed.affordances).toEqual({ other: false, askAboutChoices: true });
    expect(parsed.options?.[0]?.detailMarkdown).toBe("Use the recommended selector for all roles.");
    expect(parsed.deepInterview?.routingApproval).toEqual(
      expect.objectContaining({
        approvals: expect.objectContaining({
          executor: expect.objectContaining({
            status: "approved",
            selectedSelector: "openai-codex/gpt-5.5:high",
          }),
        }),
        buckets: expect.arrayContaining([
          expect.objectContaining({
            bucketKey: "openai-codex/gpt-5.5:high",
            roles: expect.arrayContaining(["executor", "test-engineer", "metis"]),
          }),
        ]),
      })
    );
  });
  it("routes headless approval questions through workflowGate with canonical approval affordances", async () => {
    const tool = capturePiOvenAskTool();
    const tempDir = mkdtempSync(join(tmpdir(), "pi-oven-ask-headless-"));
    const gateCalls: unknown[] = [];

    try {
      const result = await tool.execute(
        "tool-call",
        {
          question: "Approve the implementation handoff.",
          options: [{ label: "Proceed" }, { label: "Refine further" }],
          recommended: 0,
          deepInterview: APPROVAL_META,
          approval: APPROVAL_FLOW_META,
        },
        undefined,
        undefined,
        {
          hasUI: false,
          cwd: tempDir,
          workflowGate: {
            async emitGate(question: unknown) {
              gateCalls.push(question);
              return { selectedOptions: ["Proceed"] };
            },
          },
          ui: {},
        }
      );

      expect(gateCalls).toEqual([
        expect.objectContaining({
          question: "Approve the implementation handoff.",
          recommended: 0,
          affordances: { other: false, askAboutChoices: true },
          contextHeaders: expect.arrayContaining([
            expect.objectContaining({ title: "Deep interview" }),
            expect.objectContaining({ title: "Recommended", value: "Proceed" }),
          ]),
          deepInterview: expect.objectContaining({
            stage: "approval",
            roundId: "approval",
          }),
        }),
      ]);
      expect(result.details).toEqual(
        expect.objectContaining({
          mode: "single",
          question: "Approve the implementation handoff.",
          action: "selected",
          selected: "Proceed",
          recommended: 0,
          deepInterview: APPROVAL_META,
          approval: APPROVAL_FLOW_META,
          affordances: { other: false, askAboutChoices: true },
        })
      );
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("defers invalid headless custom-input approval results when Other is disabled", async () => {
    const tool = capturePiOvenAskTool();
    const tempDir = mkdtempSync(join(tmpdir(), "pi-oven-ask-headless-other-disabled-"));

    try {
      const result = await tool.execute(
        "tool-call",
        {
          question: "Approve the implementation handoff.",
          options: [{ label: "Proceed" }, { label: "Refine further" }],
          recommended: 0,
          affordances: { other: false, askAboutChoices: true },
          deepInterview: APPROVAL_META,
          approval: APPROVAL_FLOW_META,
        },
        undefined,
        undefined,
        {
          hasUI: false,
          cwd: tempDir,
          workflowGate: {
            async emitGate() {
              return {
                selectedOptions: ["Other (type your own)"],
                customInput: "Need more metrics before approval.",
              };
            },
          },
          ui: {},
        }
      );

      expect(result.details).toEqual(
        expect.objectContaining({
          mode: "single",
          question: "Approve the implementation handoff.",
          action: "deferred",
          deferred: true,
          deepInterview: APPROVAL_META,
          affordances: { other: false, askAboutChoices: true },
        })
      );

      const approvalFlow = await createDeepInterviewRuntime(tempDir).readApprovalFlow();
      expect(approvalFlow).toEqual(
        expect.objectContaining({
          active: true,
          status: "pending",
        })
      );
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("defers invalid headless clarification approval results when Ask about these choices is disabled", async () => {
    const tool = capturePiOvenAskTool();
    const tempDir = mkdtempSync(join(tmpdir(), "pi-oven-ask-headless-clarify-disabled-"));

    try {
      const result = await tool.execute(
        "tool-call",
        {
          question: "Approve the implementation handoff.",
          options: [{ label: "Proceed" }, { label: "Refine further" }],
          recommended: 0,
          affordances: { other: false, askAboutChoices: false },
          deepInterview: APPROVAL_META,
          approval: APPROVAL_FLOW_META,
        },
        undefined,
        undefined,
        {
          hasUI: false,
          cwd: tempDir,
          workflowGate: {
            async emitGate() {
              return { selectedOptions: ["Ask about these choices"] };
            },
          },
          ui: {},
        }
      );

      expect(result.details).toEqual(
        expect.objectContaining({
          mode: "single",
          question: "Approve the implementation handoff.",
          action: "deferred",
          deferred: true,
          deepInterview: APPROVAL_META,
          affordances: { other: false, askAboutChoices: false },
        })
      );

      const approvalFlow = await createDeepInterviewRuntime(tempDir).readApprovalFlow();
      expect(approvalFlow).toEqual(
        expect.objectContaining({
          active: true,
          status: "pending",
        })
      );
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("persists approval-only asks through root approvalFlow without requiring nested deepInterview metadata", async () => {
    const tool = capturePiOvenAskTool();
    const tempDir = mkdtempSync(join(tmpdir(), "pi-oven-ask-approval-flow-"));
    const gateCalls: unknown[] = [];

    try {
      const result = await tool.execute(
        "tool-call",
        {
          question: "Approve the implementation handoff.",
          options: [{ label: "Proceed" }, { label: "Refine further" }],
          recommended: 0,
          approval: APPROVAL_FLOW_META,
        },
        undefined,
        undefined,
        {
          hasUI: false,
          cwd: tempDir,
          workflowGate: {
            async emitGate(question: unknown) {
              gateCalls.push(question);
              return { selectedOptions: ["Proceed"] };
            },
          },
          ui: {},
        }
      );

      expect(gateCalls).toEqual([
        expect.objectContaining({
          approval: APPROVAL_FLOW_META,
          affordances: { other: false, askAboutChoices: true },
          deepInterview: expect.objectContaining({
            stage: "approval",
            roundId: "approval-approve-option-c",
          }),
        }),
      ]);
      const emittedApprovalGate = gateCalls[0] as { deepInterview?: Record<string, unknown> };
      expect(emittedApprovalGate.deepInterview).not.toHaveProperty("approvalHandoff");
      expect(emittedApprovalGate.deepInterview).not.toHaveProperty("routingApproval");
      expect(result.details).toEqual(
        expect.objectContaining({
          mode: "single",
          question: "Approve the implementation handoff.",
          action: "selected",
          selected: "Proceed",
          recommended: 0,
          approval: APPROVAL_FLOW_META,
          affordances: { other: false, askAboutChoices: true },
        })
      );

      const approvalFlow = await createDeepInterviewRuntime(tempDir).readApprovalFlow();
      expect(approvalFlow).toEqual(
        expect.objectContaining({
          kind: "spec-handoff",
          source: "manual",
          decisionKey: "approve-option-c",
          summary: "Implement Option C after approval",
          status: "approved",
          resumedFrom: {
            interviewId: "di-approval-only",
            specPath: "docs/specs/2026-07-06-workflow-optimization-design.md",
          },
          resolved: {
            selected: "Proceed",
            customInput: null,
          },
        })
      );
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
  it("keeps approvalFlow pending when headless approval asks about the listed choices", async () => {
    const tool = capturePiOvenAskTool();
    const tempDir = mkdtempSync(join(tmpdir(), "pi-oven-ask-approval-clarify-"));

    try {
      const result = await tool.execute(
        "tool-call",
        {
          question: "Approve the implementation handoff.",
          options: [{ label: "Proceed" }, { label: "Refine further" }],
          recommended: 0,
          deepInterview: APPROVAL_META,
          approval: APPROVAL_FLOW_META,
        },
        undefined,
        undefined,
        {
          hasUI: false,
          cwd: tempDir,
          workflowGate: {
            async emitGate() {
              return { selectedOptions: ["Ask about these choices"] };
            },
          },
          ui: {},
        }
      );

      expect(result.details).toEqual(
        expect.objectContaining({
          mode: "single",
          question: "Approve the implementation handoff.",
          action: "ask_about_choices",
          deepInterview: APPROVAL_META,
          affordances: { other: false, askAboutChoices: true },
        })
      );

      const approvalFlow = await createDeepInterviewRuntime(tempDir).readApprovalFlow();
      expect(approvalFlow).toEqual(
        expect.objectContaining({
          active: true,
          status: "pending",
          resolved: {
            selected: "Ask about these choices",
            customInput: null,
          },
        })
      );
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("emits approvalFlow trace updates for plain approval handoff answers", async () => {
    type CapturedPiOvenAskTool = {
      execute(
        toolCallId: string,
        params: unknown,
        signal: AbortSignal | undefined,
        onUpdate: unknown,
        ctx: unknown
      ): Promise<{ details?: unknown }>;
    };

    let captured: CapturedPiOvenAskTool | undefined;
    const traces: unknown[] = [];
    registerPiOvenAsk(
      {
        zod,
        registerTool(tool: unknown) {
          captured = tool as CapturedPiOvenAskTool;
        },
        logger: {},
      } as unknown as Parameters<typeof registerPiOvenAsk>[0],
      {
        onRuntimeTrace: (trace) => {
          traces.push(trace);
        },
      }
    );
    expect(captured).toBeDefined();
    const tool = captured!;
    const tempDir = mkdtempSync(join(tmpdir(), "pi-oven-ask-headless-approval-"));

    try {
      const result = await tool.execute(
        "tool-call",
        {
          question: "Approve the implementation handoff.",
          options: [{ label: "Proceed" }, { label: "Refine further" }],
          recommended: 0,
          deepInterview: APPROVAL_META,
          approval: APPROVAL_FLOW_META,
        },
        undefined,
        undefined,
        {
          hasUI: false,
          cwd: tempDir,
          workflowGate: {
            async emitGate() {
              return { selectedOptions: ["Proceed"] };
            },
          },
          ui: {},
        }
      );

      expect(result.details).toEqual(
        expect.objectContaining({
          mode: "single",
          question: "Approve the implementation handoff.",
          action: "selected",
          selected: "Proceed",
          recommended: 0,
          deepInterview: APPROVAL_META,
          approval: APPROVAL_FLOW_META,
          affordances: { other: false, askAboutChoices: true },
        })
      );
      expect(traces).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            stateChanges: expect.arrayContaining([
              expect.objectContaining({
                key: "approvalFlow.status",
                after: "pending",
              }),
            ]),
          }),
          expect.objectContaining({
            stateChanges: expect.arrayContaining([
              expect.objectContaining({
                key: "approvalFlow.status",
                before: "pending",
                after: "approved",
              }),
            ]),
          }),
        ])
      );
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("emits the seed-time approvalFlow trace even when a headless approval prompt is deferred", async () => {
    type CapturedPiOvenAskTool = {
      execute(
        toolCallId: string,
        params: unknown,
        signal: AbortSignal | undefined,
        onUpdate: unknown,
        ctx: unknown
      ): Promise<{ details?: unknown }>;
    };

    let captured: CapturedPiOvenAskTool | undefined;
    const traces: unknown[] = [];
    registerPiOvenAsk(
      {
        zod,
        registerTool(tool: unknown) {
          captured = tool as CapturedPiOvenAskTool;
        },
        logger: {},
      } as unknown as Parameters<typeof registerPiOvenAsk>[0],
      {
        onRuntimeTrace: (trace) => {
          traces.push(trace);
        },
      }
    );
    expect(captured).toBeDefined();
    const tool = captured!;
    const tempDir = mkdtempSync(join(tmpdir(), "pi-oven-ask-headless-deferred-"));

    try {
      const result = await tool.execute(
        "tool-call",
        {
          question: "Approve the implementation handoff.",
          options: [{ label: "Proceed" }, { label: "Refine further" }],
          recommended: 0,
          deepInterview: APPROVAL_META,
          approval: APPROVAL_FLOW_META,
        },
        undefined,
        undefined,
        {
          hasUI: false,
          cwd: tempDir,
          workflowGate: {
            async emitGate() {
              return undefined;
            },
          },
          ui: {},
        }
      );

      expect(result.details).toEqual(
        expect.objectContaining({
          mode: "single",
          question: "Approve the implementation handoff.",
          action: "deferred",
          deferred: true,
          recommended: 0,
          deepInterview: APPROVAL_META,
          approval: APPROVAL_FLOW_META,
          affordances: { other: false, askAboutChoices: true },
        })
      );
      expect(traces).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            stateChanges: expect.arrayContaining([
              expect.objectContaining({
                key: "approvalFlow.status",
                after: "pending",
              }),
            ]),
          }),
        ])
      );
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
  it("execute uses the four-argument ctx.ui.custom extension contract and persists under the provided cwd", async () => {
    const tool = capturePiOvenAskTool();
    const theme = makeTheme();
    const tempDir = mkdtempSync(join(tmpdir(), "pi-oven-ask-"));

    try {
      const result = await tool.execute(
        "tool-call",
        {
          question: "Choose auth",
          options: [{ label: "JWT" }, { label: "Session cookie" }],
          recommended: 1,
          deepInterview: DEEP_INTERVIEW_META,
        },
        undefined,
        undefined,
        {
          hasUI: true,
          cwd: tempDir,
          ui: {
            async custom(
              factory: (
                tui: unknown,
                renderTheme: unknown,
                keybindings: unknown,
                done: (value: string | undefined) => void
              ) => Promise<PiOvenAskTestComponent> | PiOvenAskTestComponent
            ) {
              let resolved: string | undefined;
              const component = await factory({}, theme, {}, (value: string | undefined) => {
                resolved = value;
              });
              const list = Array.isArray(component.children)
                ? (component.children.find(
                    (child) =>
                      typeof child === "object" &&
                      child !== null &&
                      "getSelectedItem" in child &&
                      "onSelect" in child
                  ) as SelectListLike | undefined)
                : undefined;
              const selected = list?.getSelectedItem?.();
              expect(selected?.value).toBe("Session cookie");
              list?.onSelect?.(selected);
              return resolved;
            },
            async editor() {
              throw new Error("editor should not be used for direct option selection");
            },
          },
        }
      );

      expect(result.details).toEqual(
        expect.objectContaining({
          mode: "single",
          question: "Choose auth",
          action: "selected",
          selected: "Session cookie",
          recommended: 1,
          deepInterview: DEEP_INTERVIEW_META,
          affordances: { other: true, askAboutChoices: false },
        })
      );
      expect(existsSync(join(tempDir, ".pi-oven", "state", "autonomous.json"))).toBe(true);
      expect(() => tool.renderResult(result, {}, theme)).not.toThrow();
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
