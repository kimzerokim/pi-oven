/**
 * pi-oven_ask — plugin-registered ask tool with per-option descriptions.
 */

import {
  Container,
  Markdown,
  Text,
  type Component,
  type MarkdownTheme,
  type SelectItem,
  type SelectListTheme,
  SelectList,
  type SymbolTheme,
  wrapTextWithAnsi,
} from "@oh-my-pi/pi-tui";
import type {
  AgentToolResult,
  ExtensionAPI,
  ExtensionContext,
  Theme,
  ToolRenderResultOptions,
} from "@oh-my-pi/pi-coding-agent";

export const OTHER_VALUE = "__pi-oven_other__";
const OTHER_LABEL = "Other (type your own)";

export interface PiOvenAskOption {
  label: string;
  description?: string;
}

export interface PiOvenAskSingleDetails {
  mode: "single";
  question: string;
  selected?: string;
  customInput?: string;
}

export type PiOvenAskDetails = PiOvenAskSingleDetails;

const markdownThemes = new WeakMap<Theme, MarkdownTheme>();
const selectListThemes = new WeakMap<Theme, SelectListTheme>();

function getSymbolThemeFor(theme: Theme): SymbolTheme {
  const preset = theme.getSymbolPreset();
  return {
    cursor: theme.nav.cursor,
    inputCursor: preset === "ascii" ? "|" : "▏",
    boxRound: theme.boxRound,
    boxSharp: theme.boxSharp,
    table: theme.boxSharp,
    quoteBorder: theme.md.quoteBorder,
    hrChar: theme.md.hrChar,
    colorSwatch: theme.md.colorSwatch,
    spinnerFrames: theme.getSpinnerFrames("activity"),
  };
}


function getMarkdownThemeFor(theme: Theme): MarkdownTheme {
  const cached = markdownThemes.get(theme);
  if (cached !== undefined) return cached;

  const symbolTheme = getSymbolThemeFor(theme);
  const markdownTheme: MarkdownTheme = {
    heading: (text: string) => theme.fg("mdHeading", text),
    link: (text: string) => theme.fg("mdLink", text),
    linkUrl: (text: string) => theme.fg("mdLinkUrl", text),
    code: (text: string) => theme.fg("mdCode", text),
    codeBlock: (text: string) => theme.fg("mdCodeBlock", text),
    codeBlockBorder: (text: string) => theme.fg("mdCodeBlockBorder", text),
    quote: (text: string) => theme.fg("mdQuote", text),
    quoteBorder: (text: string) => theme.fg("mdQuoteBorder", text),
    hr: (text: string) => theme.fg("mdHr", text),
    listBullet: (text: string) => theme.fg("mdListBullet", text),
    bold: (text: string) => theme.bold(text),
    italic: (text: string) => theme.italic(text),
    underline: (text: string) => theme.underline(text),
    strikethrough: (text: string) => theme.strikethrough(text),
    symbols: symbolTheme,
  };
  markdownThemes.set(theme, markdownTheme);
  return markdownTheme;
}

function getSelectListThemeFor(theme: Theme): SelectListTheme {
  const cached = selectListThemes.get(theme);
  if (cached !== undefined) return cached;

  const selectListTheme: SelectListTheme = {
    selectedPrefix: (text: string) => theme.fg("accent", text),
    selectedText: (text: string) => theme.fg("accent", text),
    description: (text: string) => theme.fg("muted", text),
    scrollInfo: (text: string) => theme.fg("muted", text),
    noMatch: (text: string) => theme.fg("muted", text),
    symbols: getSymbolThemeFor(theme),
  };
  selectListThemes.set(theme, selectListTheme);
  return selectListTheme;
}

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

export function foldLabel(opt: PiOvenAskOption): string {
  return opt.description ? `${opt.label} — ${opt.description}` : opt.label;
}

class PiOvenAskContainer extends Container {
  readonly #list: SelectList;
  readonly #dim: (s: string) => string;
  constructor(
    question: string,
    list: SelectList,
    mdTheme: MarkdownTheme,
    dim: (s: string) => string = (s) => s
  ) {
    super();
    this.#list = list;
    this.#dim = dim;
    this.addChild(new Markdown(question, 1, 0, mdTheme));
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
  },
  _options: ToolRenderResultOptions,
  theme: Theme
): Component {
  const container = new Container();
  const mdTheme = getMarkdownThemeFor(theme);
  container.addChild(new Text(theme.fg("toolTitle", "Ask (pi-oven)"), 0, 0));

  container.addChild(new Markdown(args.question ?? "", 1, 0, mdTheme));
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
  const mdTheme = getMarkdownThemeFor(theme);
  const container = new Container();
  container.addChild(new Text(theme.fg("toolTitle", "Ask (pi-oven)"), 0, 0));

  if (!details) {
    const first = result.content[0];
    const fallback = first && first.type === "text" ? first.text : "";
    container.addChild(new Text(theme.fg("dim", fallback), 0, 0));
    return container;
  }

  container.addChild(new Markdown(details.question, 1, 0, mdTheme));

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
  "Ask the user ONE single-select question with a one-line rationale per option.",
  "Each option carries { label, description? }; an 'Other (type your own)' free-text entry is appended automatically.",
  "Use recommended (option index) to preselect a default.",
].join(" ");

type PiOvenAskParams = {
  question: string;
  options: PiOvenAskOption[];
  recommended?: number;
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
    const mdTheme = getMarkdownThemeFor(theme);
    const list = new SelectList(items, items.length, getSelectListThemeFor(theme), {
      minPrimaryColumnWidth: 24,
      maxPrimaryColumnWidth: 48,
    });
    if (rec !== undefined) list.setSelectedIndex(rec);
    list.onSelect = (item) => done(item.value);
    list.onCancel = () => done(undefined);
    return new PiOvenAskContainer(question, list, mdTheme, (s) => theme.fg("dim", s));
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

  const parameters = z.object({
    question: z.string().min(1),
    options: z.array(optionSchema).min(1),
    recommended: z.number().optional(),
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
      return askSingle(ctx, {
        question: params.question,
        options: params.options,
        recommended: params.recommended,
      });
    },
  });
}
