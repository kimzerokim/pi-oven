import { describe, it, expect } from "bun:test";
import {
  OTHER_VALUE,
  buildSelectItems,
  clampRecommended,
  formatAskResult,
  formatBatchResult,
  foldLabel,
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

describe("formatBatchResult", () => {
  it("surfaces a single selected answer in the visible text", () => {
    const res = formatBatchResult({
      language: { selected: "English" },
    });
    expect(res.content[0]).toEqual({ type: "text", text: "User selected: English" });
    expect(res.details).toEqual({
      mode: "batch",
      answers: {
        language: { selected: "English" },
      },
    });
  });

  it("surfaces a single custom answer in the visible text", () => {
    const res = formatBatchResult({
      language: { customInput: "Español" },
    });
    expect(res.content[0]).toEqual({
      type: "text",
      text: "User provided custom input: Español",
    });
    expect(res.details).toEqual({
      mode: "batch",
      answers: {
        language: { customInput: "Español" },
      },
    });
  });

  it("returns batch mode details keyed by id", () => {
    const res = formatBatchResult({
      q1: { selected: "A" },
      q2: { selectedMany: ["X", "Y"], customInput: "note" },
    });
    expect(res.content[0]).toEqual({
      type: "text",
      text: "User answered 2 questions: q1: User selected: A; q2: selectedMany=X, Y | customInput=note",
    });
    expect(res.details).toEqual({
      mode: "batch",
      answers: {
        q1: { selected: "A" },
        q2: { selectedMany: ["X", "Y"], customInput: "note" },
      },
    });
  });

  it("returns cancelled text when answers are empty", () => {
    const res = formatBatchResult({});
    expect(res.content[0]).toEqual({ type: "text", text: "User cancelled the selection" });
    expect(res.details).toEqual({ mode: "batch", answers: {} });
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
