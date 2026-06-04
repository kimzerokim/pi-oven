/**
 * pi-oven_ask — plugin-registered ask tool with per-option descriptions.
 */

import {
  Container,
  Markdown,
  Text,
  type Component,
  type SelectItem,
  SelectList,
  wrapTextWithAnsi,
} from "@oh-my-pi/pi-tui";
import { getMarkdownTheme, getSelectListTheme } from "@oh-my-pi/pi-coding-agent";
import type {
  AgentToolResult,
  ExtensionAPI,
  ExtensionContext,
  Theme,
  ToolRenderResultOptions,
} from "@oh-my-pi/pi-coding-agent";

export const OTHER_VALUE = "__pi-oven_other__";
const OTHER_LABEL = "Other (type your own)";
const DONE_VALUE = "__pi-oven_done__";
const DONE_LABEL = "Done";

export interface PiOvenAskOption {
  label: string;
  description?: string;
}

export interface PiOvenAskQuestion {
  id: string;
  question: string;
  options: PiOvenAskOption[];
  recommended?: number;
  multi?: boolean;
}

export interface PiOvenAskSingleDetails {
  mode: "single";
  question: string;
  selected?: string;
  customInput?: string;
}

export interface PiOvenAskBatchAnswer {
  selected?: string;
  selectedMany?: string[];
  customInput?: string;
}

export interface PiOvenAskBatchDetails {
  mode: "batch";
  answers: Record<string, PiOvenAskBatchAnswer>;
}

export type PiOvenAskDetails = PiOvenAskSingleDetails | PiOvenAskBatchDetails;

export function buildSelectItems(options: PiOvenAskOption[]): SelectItem[] {
  const seen = new Set<string>();
  const items: SelectItem[] = options.map((opt, i) => {
    let value = opt.label;
    if (seen.has(value)) {
      value = `${opt.label}#${i}`;
    }
    seen.add(value);
    const item: SelectItem = { value, label: opt.label };
    if (opt.description !== undefined) {
      item.description = opt.description;
    }
    return item;
  });
  items.push({ value: OTHER_VALUE, label: OTHER_LABEL });
  return items;
}

export function clampRecommended(
  recommended: number | undefined,
  len: number
): number | undefined {
  if (recommended === undefined) return undefined;
  if (!Number.isInteger(recommended)) return undefined;
  if (recommended < 0 || recommended >= len) return undefined;
  return recommended;
}

export function formatAskResult(
  question: string,
  selected: string | undefined,
  customInput: string | undefined
): AgentToolResult<PiOvenAskDetails> {
  let text: string;
  if (selected !== undefined) {
    text = `User selected: ${selected}`;
  } else if (customInput !== undefined) {
    text = customInput.includes("\n")
      ? `User provided custom input:\n${customInput
          .split("\n")
          .map((line) => `  ${line}`)
          .join("\n")}`
      : `User provided custom input: ${customInput}`;
  } else {
    text = "User cancelled the selection";
  }

  const details: PiOvenAskSingleDetails = { mode: "single", question };
  if (selected !== undefined) details.selected = selected;
  if (customInput !== undefined) details.customInput = customInput;

  return {
    content: [{ type: "text" as const, text }],
    details,
  };
}

function summarizeBatchAnswer(answer: PiOvenAskBatchAnswer): string {
  if (
    answer.selected !== undefined &&
    answer.customInput === undefined &&
    (answer.selectedMany === undefined || answer.selectedMany.length === 0)
  ) {
    return `User selected: ${answer.selected}`;
  }
  if (
    answer.customInput !== undefined &&
    answer.selected === undefined &&
    (answer.selectedMany === undefined || answer.selectedMany.length === 0)
  ) {
    const custom = answer.customInput.includes("\n")
      ? answer.customInput.replaceAll("\n", " / ")
      : answer.customInput;
    return `User provided custom input: ${custom}`;
  }

  const parts: string[] = [];
  if (answer.selected !== undefined) parts.push(`selected=${answer.selected}`);
  if (answer.selectedMany !== undefined && answer.selectedMany.length > 0) {
    parts.push(`selectedMany=${answer.selectedMany.join(", ")}`);
  }
  if (answer.customInput !== undefined) {
    const custom = answer.customInput.includes("\n")
      ? answer.customInput.replaceAll("\n", " / ")
      : answer.customInput;
    parts.push(`customInput=${custom}`);
  }
  return parts.join(" | ");
}

export function formatBatchResult(
  answers: Record<string, PiOvenAskBatchAnswer>
): AgentToolResult<PiOvenAskDetails> {
  const keys = Object.keys(answers);
  let text: string;
  if (keys.length === 0) {
    text = "User cancelled the selection";
  } else if (keys.length === 1) {
    text = summarizeBatchAnswer(answers[keys[0]!]!) || "User answered 1 question";
  } else {
    const summary = keys
      .map((key) => `${key}: ${summarizeBatchAnswer(answers[key]!) || "no response"}`)
      .join("; ");
    text = `User answered ${keys.length} questions: ${summary}`;
  }
  return {
    content: [{ type: "text" as const, text }],
    details: { mode: "batch", answers },
  };
}

export function foldLabel(opt: PiOvenAskOption): string {
  return opt.description ? `${opt.label} — ${opt.description}` : opt.label;
}

class PiOvenAskContainer extends Container {
  readonly #list: SelectList;
  readonly #dim: (s: string) => string;
  constructor(question: string, list: SelectList, dim: (s: string) => string = (s) => s) {
    super();
    this.#list = list;
    this.#dim = dim;
    this.addChild(new Markdown(question, 1, 0, getMarkdownTheme()));
    this.addChild(list);
  }
  handleInput(data: string): void {
    this.#list.handleInput(data);
  }
  // The SelectList renders only a single truncated description line per option. To
  // show the FULL rationale, render the focused option's description — wrapped to the
  // available width, multi-line — in a detail panel below the list. Recomputed each
  // frame from the live selection, so it follows the cursor. Append-only: the base
  // question + list render is preserved verbatim.
  render(width: number): string[] {
    const lines = super.render(width);
    const desc = this.#list.getSelectedItem()?.description;
    if (desc && desc.trim().length > 0) {
      const wrapWidth = Math.max(20, width - 4);
      lines.push("");
      for (const line of wrapTextWithAnsi(desc, wrapWidth)) {
        lines.push(this.#dim(`  ${line}`));
      }
    }
    return lines;
  }
}

function renderCall(
  args: {
    question?: string;
    options?: PiOvenAskOption[];
    recommended?: number;
    questions?: PiOvenAskQuestion[];
  },
  _options: ToolRenderResultOptions,
  theme: Theme
): Component {
  const container = new Container();
  container.addChild(new Text(theme.fg("toolTitle", "Ask (pi-oven)"), 0, 0));

  if (args.questions && args.questions.length > 0) {
    container.addChild(new Text(theme.fg("dim", `Batch: ${args.questions.length} question(s)`), 0, 0));
    for (const q of args.questions) {
      container.addChild(new Text(` ${theme.fg("dim", theme.tree.branch)} ${q.id}: ${q.question}`, 0, 0));
    }
    return container;
  }

  container.addChild(new Markdown(args.question ?? "", 1, 0, getMarkdownTheme()));
  const opts = args.options ?? [];
  for (let i = 0; i < opts.length; i++) {
    const opt = opts[i]!;
    const isLast = i === opts.length - 1;
    const branch = isLast ? theme.tree.last : theme.tree.branch;
    container.addChild(
      new Text(
        ` ${theme.fg("dim", branch)} ${theme.fg("dim", theme.checkbox.unchecked)} ${opt.label}`,
        0,
        0
      )
    );
    if (opt.description) {
      const cont = isLast ? "   " : ` ${theme.fg("dim", theme.tree.vertical)} `;
      container.addChild(new Text(`${cont}  ${theme.fg("dim", opt.description)}`, 0, 0));
    }
  }
  return container;
}

function renderResult(
  result: AgentToolResult<PiOvenAskDetails>,
  _options: ToolRenderResultOptions,
  theme: Theme
): Component {
  const details = result.details;
  const container = new Container();
  container.addChild(new Text(theme.fg("toolTitle", "Ask (pi-oven)"), 0, 0));

  if (!details) {
    const first = result.content[0];
    const fallback = first && first.type === "text" ? first.text : "";
    container.addChild(new Text(theme.fg("dim", fallback), 0, 0));
    return container;
  }

  if (details.mode === "batch") {
    const ids = Object.keys(details.answers);
    container.addChild(new Text(theme.fg("dim", `Batch answers: ${ids.length}`), 0, 0));
    for (const id of ids) {
      const answer = details.answers[id]!;
      let value = "Cancelled";
      if (answer.selectedMany && answer.selectedMany.length > 0) value = answer.selectedMany.join(", ");
      else if (answer.selected !== undefined) value = answer.selected;
      else if (answer.customInput !== undefined) value = answer.customInput;
      container.addChild(new Text(` ${theme.fg("dim", theme.tree.branch)} ${id}: ${theme.fg("toolOutput", value)}`, 0, 0));
    }
    return container;
  }

  container.addChild(new Markdown(details.question, 1, 0, getMarkdownTheme()));

  if (details.selected !== undefined) {
    container.addChild(
      new Text(
        ` ${theme.fg("dim", theme.tree.last)} ${theme.fg("success", theme.checkbox.checked)} ${theme.fg("toolOutput", details.selected)}`,
        0,
        0
      )
    );
  } else if (details.customInput !== undefined) {
    const lines = details.customInput.split("\n");
    container.addChild(
      new Text(
        ` ${theme.fg("dim", theme.tree.last)} ${theme.styledSymbol("status.success", "success")} ${theme.fg("toolOutput", lines[0] ?? "")}`,
        0,
        0
      )
    );
    for (let i = 1; i < lines.length; i++) {
      container.addChild(new Text(`     ${theme.fg("toolOutput", lines[i]!)}`, 0, 0));
    }
  } else {
    container.addChild(
      new Text(
        ` ${theme.fg("dim", theme.tree.last)} ${theme.styledSymbol("status.warning", "warning")} ${theme.fg("warning", "Cancelled")}`,
        0,
        0
      )
    );
  }
  return container;
}

const DESCRIPTION = [
  "Ask the user questions with one-line rationales.",
  "Supports single-question mode (backward compatible) and optional batched mode via questions[].",
  "Each option carries { label, description? }; an 'Other (type your own)' free-text entry is appended automatically.",
  "Use recommended (option index) to preselect a default; set multi=true per batch question for multi-select.",
].join(" ");

type PiOvenAskParams = {
  question?: string;
  options?: PiOvenAskOption[];
  recommended?: number;
  questions?: PiOvenAskQuestion[];
};

async function askSingle(
  ctx: ExtensionContext,
  params: { question: string; options: PiOvenAskOption[]; recommended?: number }
): Promise<AgentToolResult<PiOvenAskDetails>> {
  const { question, options } = params;

  if (!ctx.hasUI || typeof ctx.ui?.custom !== "function") {
    if (typeof ctx.ui?.select === "function") {
      const folded = options.map(foldLabel);
      const chosen = await ctx.ui.select(question, folded);
      if (chosen === undefined) {
        return formatAskResult(question, undefined, undefined);
      }
      const idx = folded.indexOf(chosen);
      const selected = idx >= 0 ? options[idx]!.label : chosen;
      return formatAskResult(question, selected, undefined);
    }
    return formatAskResult(question, undefined, undefined);
  }

  const items = buildSelectItems(options);
  const rec = clampRecommended(params.recommended, options.length);

  const choice = await ctx.ui.custom<string | undefined>((_tui, theme, _keybindings, done) => {
    const list = new SelectList(items, items.length, getSelectListTheme(), {
      minPrimaryColumnWidth: 24,
      maxPrimaryColumnWidth: 48,
    });
    if (rec !== undefined) list.setSelectedIndex(rec);
    list.onSelect = (item) => done(item.value);
    list.onCancel = () => done(undefined);
    return new PiOvenAskContainer(question, list, (s) => theme.fg("dim", s));
  });

  if (choice === undefined) return formatAskResult(question, undefined, undefined);
  if (choice === OTHER_VALUE) {
    const custom = await ctx.ui.editor("Enter your response:", undefined, undefined, {
      promptStyle: true,
    });
    return formatAskResult(question, undefined, custom ?? undefined);
  }
  return formatAskResult(question, choice, undefined);
}

async function askOneLabel(
  ctx: ExtensionContext,
  question: string,
  options: PiOvenAskOption[],
  recommended?: number,
  extraDone?: boolean
): Promise<string | undefined> {
  const folded = options.map(foldLabel);
  if (extraDone) folded.push(DONE_LABEL);
  const rec = clampRecommended(recommended, options.length);

  if (!ctx.hasUI || typeof ctx.ui?.custom !== "function") {
    if (typeof ctx.ui?.select !== "function") return undefined;
    return ctx.ui.select(question, folded);
  }

  const items = buildSelectItems(options);
  if (extraDone) items.push({ value: DONE_VALUE, label: DONE_LABEL });
  return ctx.ui.custom<string | undefined>((_tui, theme, _keybindings, done) => {
    const list = new SelectList(items, items.length, getSelectListTheme(), {
      minPrimaryColumnWidth: 24,
      maxPrimaryColumnWidth: 48,
    });
    if (rec !== undefined) list.setSelectedIndex(rec);
    list.onSelect = (item) => done(item.value);
    list.onCancel = () => done(undefined);
    return new PiOvenAskContainer(question, list, (s) => theme.fg("dim", s));
  });
}

async function askBatch(
  ctx: ExtensionContext,
  questions: PiOvenAskQuestion[]
): Promise<AgentToolResult<PiOvenAskDetails>> {
  const answers: Record<string, PiOvenAskBatchAnswer> = {};

  for (const q of questions) {
    if (!q.multi) {
      const one = await askSingle(ctx, {
        question: q.question,
        options: q.options,
        recommended: q.recommended,
      });
      const det = one.details;
      if (det && det.mode === "single") {
        answers[q.id] = {};
        if (det.selected !== undefined) answers[q.id]!.selected = det.selected;
        if (det.customInput !== undefined) answers[q.id]!.customInput = det.customInput;
      }
      continue;
    }

    const selectedMany: string[] = [];
    let customInput: string | undefined;

    while (true) {
      const choice = await askOneLabel(
        ctx,
        `${q.question}\n(Select one at a time, choose Done when finished)`,
        q.options,
        q.recommended,
        true
      );

      if (choice === undefined || choice === DONE_VALUE || choice === DONE_LABEL) {
        break;
      }
      if (choice === OTHER_VALUE) {
        const custom = await ctx.ui.editor("Enter your response:", undefined, undefined, {
          promptStyle: true,
        });
        if (custom !== undefined) customInput = custom;
        continue;
      }

      const idx = q.options.findIndex((o) => o.label === choice);
      const resolved = idx >= 0 ? q.options[idx]!.label : choice;
      if (!selectedMany.includes(resolved)) selectedMany.push(resolved);
    }

    const answer: PiOvenAskBatchAnswer = {};
    if (selectedMany.length > 0) answer.selectedMany = selectedMany;
    if (customInput !== undefined) answer.customInput = customInput;
    answers[q.id] = answer;
  }

  return formatBatchResult(answers);
}

export function registerPiOvenAsk(pi: ExtensionAPI): void {
  if (typeof pi.registerTool !== "function") {
    pi.logger?.debug?.("pi-oven_ask: registerTool unavailable; skipping registration");
    return;
  }

  const { z } = pi.zod;

  const optionSchema = z.object({
    label: z.string(),
    description: z.string().optional(),
  });

  const questionSchema = z.object({
    id: z.string(),
    question: z.string(),
    options: z.array(optionSchema).min(1),
    recommended: z.number().optional(),
    multi: z.boolean().optional(),
  });

  const parameters = z
    .object({
      question: z.string().optional(),
      options: z.array(optionSchema).min(1).optional(),
      recommended: z.number().optional(),
      questions: z.array(questionSchema).min(1).optional(),
    })
    .superRefine((value, refinement) => {
      if (value.questions && value.questions.length > 0) return;
      if (value.question && value.options && value.options.length > 0) return;
      refinement.addIssue({
        code: "custom",
        message: "Provide either (question + options) for single mode, or questions[] for batch mode.",
      });
    });

  pi.registerTool({
    name: "pi-oven_ask",
    label: "Ask (pi-oven)",
    description: DESCRIPTION,
    parameters,
    renderCall: renderCall as never,
    renderResult: renderResult as never,
    async execute(
      _toolCallId: string,
      params: PiOvenAskParams,
      _signal: AbortSignal | undefined,
      _onUpdate: unknown,
      ctx: ExtensionContext
    ): Promise<AgentToolResult<PiOvenAskDetails>> {
      if (params.questions && params.questions.length > 0) {
        return askBatch(ctx, params.questions);
      }
      return askSingle(ctx, {
        question: params.question ?? "",
        options: params.options ?? [],
        recommended: params.recommended,
      });
    },
  });
}
