import { describe, it, expect } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import * as zod from "zod";
import {
  OTHER_VALUE,
  buildSelectItems,
  clampRecommended,
  formatAskResult,
  foldLabel,
  registerPiOvenAsk,
} from "../../../.omp/extensions/pi-oven-runtime/pi-oven-ask";
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
  approvalHandoff: {
    decisionKey: "approve-option-c",
    summary: "Implement Option C after approval",
  },
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
function buildRecommendedByRole(): Record<Role, string> {
  return Object.fromEntries(
    ROLES.map((role) => {
      const entry = PROFILE_B[role];
      return [role, `${entry.primary}:${entry.thinkingLevel}`];
    })
  ) as Record<Role, string>;
}

const ROUTING_APPROVAL_PAYLOAD = {
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

  it("appends the Other entry carrying OTHER_VALUE", () => {
    const items = buildSelectItems([{ label: "A" }]);
    expect(items).toHaveLength(2);
    const other = items[items.length - 1]!;
    expect(other.value).toBe(OTHER_VALUE);
    expect(other.label).toBe("Other (type your own)");
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
  it("selected → 'User selected: X' + details.selected", () => {
    const res = formatAskResult("Q?", "Option A", undefined);
    expect(res.content[0]).toEqual({ type: "text", text: "User selected: Option A" });
    expect(res.details).toEqual({ mode: "single", question: "Q?", selected: "Option A" });
    expect(res.details).not.toHaveProperty("customInput");
  });

  it("customInput → 'User provided custom input: Y' + details.customInput", () => {
    const res = formatAskResult("Q?", undefined, "my answer");
    expect(res.content[0]).toEqual({ type: "text", text: "User provided custom input: my answer" });
    expect(res.details).toEqual({ mode: "single", question: "Q?", customInput: "my answer" });
    expect(res.details).not.toHaveProperty("selected");
  });

  it("multiline customInput is indented in the text", () => {
    const res = formatAskResult("Q?", undefined, "line1\nline2");
    const txt = res.content[0]!;
    expect(txt.type).toBe("text");
    expect(txt.type === "text" && txt.text).toBe("User provided custom input:\n  line1\n  line2");
  });

  it("both undefined → 'User cancelled the selection'", () => {
    const res = formatAskResult("Q?", undefined, undefined);
    expect(res.content[0]).toEqual({ type: "text", text: "User cancelled the selection" });
    expect(res.details).toEqual({ mode: "single", question: "Q?" });
  });

  it("carries deep-interview metadata, recommendation, and approval handoff in details", () => {
    const res = formatAskResult("Q?", "Option A", undefined, {
      recommended: 0,
      deepInterview: DEEP_INTERVIEW_META,
    });
    expect(res.details).toEqual({
      mode: "single",
      question: "Q?",
      selected: "Option A",
      recommended: 0,
      deepInterview: DEEP_INTERVIEW_META,
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

function capturePiOvenAskTool() {
  let captured: any;
  registerPiOvenAsk({
    zod,
    registerTool(tool: unknown) {
      captured = tool;
    },
    logger: {},
  } as any);
  return captured;
}

describe("registerPiOvenAsk", () => {
  it("renderCall uses the provided theme instead of the coding-agent global theme singleton", () => {
    const tool = capturePiOvenAskTool();
    const theme = makeTheme();

    const component = tool.renderCall(
      { question: "Q?", options: [{ label: "JWT", description: "stateless" }] },
      {},
      theme
    );

    expect(component.render(80).join("\n")).toContain("Q?");
  });

  it("accepts routing approval payloads in deepInterview metadata without stripping resume state", () => {
    const tool = capturePiOvenAskTool();
    const parsed = tool.parameters.parse({
      question: "Approve the codex routing bucket",
      options: [{ label: "Approve" }, { label: "Override per role" }],
      recommended: 0,
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
      deepInterview?: { routingApproval?: unknown };
    };

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
  it("routes headless approval questions through workflowGate instead of persisting a synthetic cancel", async () => {
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
          deepInterview: expect.objectContaining({
            stage: "approval",
            roundId: "approval",
          }),
        }),
      ]);
      expect(result.details).toEqual({
        mode: "single",
        question: "Approve the implementation handoff.",
        selected: "Proceed",
        recommended: 0,
        deepInterview: APPROVAL_META,
      });
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("does not emit remediation trace updates for plain approval handoff answers", async () => {
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

      expect(result.details).toEqual({
        mode: "single",
        question: "Approve the implementation handoff.",
        selected: "Proceed",
        recommended: 0,
        deepInterview: APPROVAL_META,
      });
      expect(traces).toEqual([]);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("does not emit a material runtime trace for deferred headless approval prompts", async () => {
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

      expect(result.details).toEqual({
        mode: "single",
        question: "Approve the implementation handoff.",
        deferred: true,
        recommended: 0,
        deepInterview: APPROVAL_META,
      });
      expect(traces).toEqual([]);
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
            async custom(factory: any) {
              let resolved: string | undefined;
              const component = await factory({}, theme, {}, (value: string | undefined) => {
                resolved = value;
              });
              const list = component.children?.[1];
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

      expect(result.details).toEqual({
        mode: "single",
        question: "Choose auth",
        selected: "Session cookie",
        recommended: 1,
        deepInterview: DEEP_INTERVIEW_META,
      });
      expect(existsSync(join(tempDir, ".pi-oven", "state", "autonomous.json"))).toBe(true);
      expect(() => tool.renderResult(result, {}, theme)).not.toThrow();
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
