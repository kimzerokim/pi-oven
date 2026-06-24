import { describe, it, expect } from "bun:test";
import * as zod from "zod";
import {
  OTHER_VALUE,
  buildSelectItems,
  clampRecommended,
  formatAskResult,
  foldLabel,
  registerPiOvenAsk,
} from "../../../.omp/extensions/pi-oven-runtime/pi-oven-ask";

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

  it("execute uses the four-argument ctx.ui.custom extension contract", async () => {
    const tool = capturePiOvenAskTool();
    const theme = makeTheme();

    const result = await tool.execute(
      "tool-call",
      {
        question: "Choose auth",
        options: [{ label: "JWT" }, { label: "Session cookie" }],
        recommended: 1,
      },
      undefined,
      undefined,
      {
        hasUI: true,
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
    });
    expect(() => tool.renderResult(result, {}, theme)).not.toThrow();
  });
});
