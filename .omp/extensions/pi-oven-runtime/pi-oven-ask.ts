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
import { createDeepInterviewRuntime } from "./deep-interview-runtime";
import { RECOMMENDED_SUFFIX, formatRecommendedLabel } from "./deep-interview-render";
import type { ApprovalFlowAskMetadata, DeepInterviewAskMetadata } from "./deep-interview-state";
import type { RuntimeTraceSnapshot } from "./trace-primitives";

export const ASK_ABOUT_CHOICES_VALUE = "__pi-oven_ask_about_choices__";
export const OTHER_VALUE = "__pi-oven_other__";
const ASK_ABOUT_CHOICES_LABEL = "Ask about these choices";
const OTHER_LABEL = "Other (type your own)";
const ASK_ABOUT_CHOICES_DESCRIPTION =
  "Pause the decision and request more explanation about the listed choices.";
const OTHER_DESCRIPTION = "Provide a custom answer that is not listed above.";
const OTHER_DETAIL_MARKDOWN = "Select this row and press Enter to type a custom answer directly.";
const OTHER_HINT = "Press Enter to type";

export type PiOvenAskAction = "selected" | "other" | "ask_about_choices" | "deferred" | "cancelled";

export interface PiOvenAskContextHeader {
  title: string;
  value?: string;
  tone?: "info" | "accent" | "warning" | "success";
}

export interface PiOvenAskContextSection {
  title: string;
  bodyMarkdown?: string;
  bullets?: string[];
}

export interface PiOvenAskAffordances {
  other?: boolean;
  askAboutChoices?: boolean;
}

export interface PiOvenAskOption {
  label: string;
  description?: string;
  detailMarkdown?: string;
}

export interface PiOvenAskSingleDetails {
  mode: "single";
  question: string;
  action: PiOvenAskAction;
  selected?: string;
  customInput?: string;
  deferred?: boolean;
  recommended?: number;
  deepInterview?: DeepInterviewAskMetadata;
  approval?: ApprovalFlowAskMetadata;
  contextHeaders?: PiOvenAskContextHeader[];
  contextSections?: PiOvenAskContextSection[];
  affordances?: PiOvenAskAffordances;
  options?: PiOvenAskOption[];
}

export type PiOvenAskDetails = PiOvenAskSingleDetails;

export interface PiOvenAskRegistrationOptions {
  onRuntimeTrace?: (trace: RuntimeTraceSnapshot) => void;
}

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
interface PiOvenAskRow {
  value: string;
  label: string;
  description?: string;
  detailMarkdown?: string;
  hint?: string;
  action: "selected" | "other" | "ask_about_choices";
  selected?: string;
}

interface PiOvenAskOutcome {
  action: PiOvenAskAction;
  selected?: string;
  customInput?: string;
}

interface PiOvenAskResultMeta {
  recommended?: number;
  deepInterview?: DeepInterviewAskMetadata;
  approval?: ApprovalFlowAskMetadata;
  contextHeaders?: PiOvenAskContextHeader[];
  contextSections?: PiOvenAskContextSection[];
  affordances?: PiOvenAskAffordances;
  options?: PiOvenAskOption[];
}
const QUESTION_PADDING_Y = 1;
const QUESTION_LINE_GAP = 1;
const OPTION_BLOCK_SPACER_LINES = 2;
const DETAIL_BLOCK_SPACER_LINES = 2;

function buildContextSectionBodyMarkdown(section: PiOvenAskContextSection): string {
  const blocks: string[] = [];
  if (section.bodyMarkdown && section.bodyMarkdown.trim().length > 0) {
    blocks.push(section.bodyMarkdown);
  }
  if (section.bullets && section.bullets.length > 0) {
    blocks.push(section.bullets.map((bullet) => `- ${bullet}`).join("\n"));
  }
  return blocks.join("\n\n");
}

function appendContextSection(
  container: Container,
  section: PiOvenAskContextSection,
  mdTheme: MarkdownTheme
): void {
  container.addChild(new Markdown(`### ${section.title}`, 1, 0, mdTheme));
  const bodyMarkdown = buildContextSectionBodyMarkdown(section);
  if (bodyMarkdown.length === 0) {
    return;
  }
  container.addChild(new Markdown(bodyMarkdown, 1, 1, mdTheme));
}

function appendBlankLines(lines: string[], count: number): void {
  for (let i = 0; i < count; i++) {
    lines.push("");
  }
}

function appendVisibleSpacerLines(lines: string[], count: number): void {
  for (let i = 0; i < count; i++) {
    lines.push(" ");
  }
}

class VerticalSpacer implements Component {
  readonly #lines: number;

  constructor(lines: number) {
    this.#lines = lines;
  }

  render(): string[] {
    return Array.from({ length: this.#lines }, () => " ");
  }

  invalidate(): void {}
}

class LineGapComponent implements Component {
  readonly #inner: Component;
  readonly #gapLines: number;

  constructor(inner: Component, gapLines: number) {
    this.#inner = inner;
    this.#gapLines = gapLines;
  }

  get wantsKeyRelease(): boolean | undefined {
    return this.#inner.wantsKeyRelease;
  }

  render(width: number): string[] {
    const lines = this.#inner.render(width);
    if (this.#gapLines <= 0 || lines.length < 2) {
      return lines;
    }
    const spaced: string[] = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      const next = lines[i + 1];
      spaced.push(line);
      if (
        next !== undefined &&
        line.trim().length > 0 &&
        next.trim().length > 0
      ) {
        appendVisibleSpacerLines(spaced, this.#gapLines);
      }
    }
    return spaced;
  }

  handleInput(data: string): void {
    this.#inner.handleInput?.(data);
  }

  invalidate(): void {
    this.#inner.invalidate();
  }
}

function buildAskRows(
  options: PiOvenAskOption[],
  recommended?: number,
  affordances: Required<PiOvenAskAffordances> = { other: true, askAboutChoices: false }
): PiOvenAskRow[] {
  const seen = new Set<string>();
  const rows: PiOvenAskRow[] = options.map((opt, i) => {
    let value = opt.label;
    if (seen.has(value)) {
      value = `${opt.label}#${i}`;
    }
    seen.add(value);
    return {
      value,
      label: formatRecommendedLabel(opt.label, recommended === i),
      description: opt.description,
      detailMarkdown: opt.detailMarkdown,
      action: "selected",
      selected: opt.label,
    };
  });
  if (affordances.askAboutChoices) {
    rows.push({
      value: ASK_ABOUT_CHOICES_VALUE,
      label: ASK_ABOUT_CHOICES_LABEL,
      description: ASK_ABOUT_CHOICES_DESCRIPTION,
      action: "ask_about_choices",
    });
  }
  if (affordances.other) {
    rows.push({
      value: OTHER_VALUE,
      label: OTHER_LABEL,
      description: OTHER_DESCRIPTION,
      detailMarkdown: OTHER_DETAIL_MARKDOWN,
      hint: OTHER_HINT,
      action: "other",
    });
  }
  return rows;
}

export function buildSelectItems(
  options: PiOvenAskOption[],
  recommended?: number,
  affordances: Required<PiOvenAskAffordances> = { other: true, askAboutChoices: false }
): SelectItem[] {
  return buildAskRows(options, recommended, affordances).map((row) => ({
    value: row.value,
    label: row.label,
    ...(row.description !== undefined ? { description: row.description } : {}),
    ...(row.hint !== undefined ? { hint: row.hint } : {}),
  }));
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
  outcome: PiOvenAskOutcome,
  meta: PiOvenAskResultMeta = {}
): AgentToolResult<PiOvenAskDetails> {
  let text: string;
  if (outcome.action === "selected" && outcome.selected !== undefined) {
    text = `User selected: ${outcome.selected}`;
  } else if (outcome.action === "other" && outcome.customInput !== undefined) {
    text = outcome.customInput.includes("\n")
      ? `User provided custom input:\n${outcome.customInput
          .split("\n")
          .map((line) => `  ${line}`)
          .join("\n")}`
      : `User provided custom input: ${outcome.customInput}`;
  } else if (outcome.action === "ask_about_choices") {
    text = "User asked about these choices";
  } else if (outcome.action === "deferred") {
    text = "Workflow gate deferred approval.";
  } else if (outcome.action === "other") {
    text = "User selected Other";
  } else {
    text = "User cancelled the selection";
  }

  const details: PiOvenAskSingleDetails = {
    mode: "single",
    question,
    action: outcome.action,
  };
  if (outcome.selected !== undefined) details.selected = outcome.selected;
  if (outcome.customInput !== undefined) details.customInput = outcome.customInput;
  if (outcome.action === "deferred") details.deferred = true;
  if (meta.recommended !== undefined) details.recommended = meta.recommended;
  if (meta.deepInterview !== undefined) details.deepInterview = meta.deepInterview;
  if (meta.approval !== undefined) details.approval = meta.approval;
  if (meta.contextHeaders !== undefined) details.contextHeaders = meta.contextHeaders;
  if (meta.contextSections !== undefined) details.contextSections = meta.contextSections;
  if (meta.affordances !== undefined) details.affordances = meta.affordances;
  if (meta.options !== undefined) details.options = meta.options;

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
  readonly #rowByValue: Map<string, PiOvenAskRow>;

  constructor(
    payload: {
      question: string;
      contextHeaders: PiOvenAskContextHeader[];
      contextSections: PiOvenAskContextSection[];
    },
    list: SelectList,
    mdTheme: MarkdownTheme,
    rowByValue: Map<string, PiOvenAskRow>,
    dim: (s: string) => string = (s) => s
  ) {
    super();
    this.#list = list;
    this.#dim = dim;
    this.#rowByValue = rowByValue;
    if (payload.contextHeaders.length > 0) {
      this.addChild(
        new Text(
          payload.contextHeaders
            .map((header) => `[${header.title}${header.value ? `: ${header.value}` : ""}]`)
            .join(" "),
          0,
          0
        )
      );
    }
    this.addChild(
      new LineGapComponent(new Markdown(payload.question, 1, QUESTION_PADDING_Y, mdTheme), QUESTION_LINE_GAP)
    );
    for (const section of payload.contextSections) {
      appendContextSection(this, section, mdTheme);
    }
    this.addChild(list);
  }

  handleInput(data: string): void {
    this.#list.handleInput(data);
  }

  render(width: number): string[] {
    const lines = super.render(width);
    const listLines = this.#list.render(width);
    const linesBeforeList = Math.max(0, lines.length - listLines.length);
    const spacedLines = lines.slice(0, linesBeforeList);
    for (let i = 0; i < listLines.length; i++) {
      const line = listLines[i]!;
      const next = listLines[i + 1];
      spacedLines.push(line);
      if (
        next !== undefined &&
        line.trim().length > 0 &&
        next.trim().length > 0
      ) {
        appendVisibleSpacerLines(spacedLines, OPTION_BLOCK_SPACER_LINES);
      }
    }

    const selected = this.#list.getSelectedItem();
    const row = selected ? this.#rowByValue.get(selected.value) : undefined;
    const detailBlocks = [row?.description, row?.detailMarkdown].filter(
      (value): value is string => typeof value === "string" && value.trim().length > 0
    );
    if (detailBlocks.length === 0) {
      return spacedLines;
    }

    const wrapWidth = Math.max(20, width - 4);
    appendBlankLines(spacedLines, DETAIL_BLOCK_SPACER_LINES);
    for (let i = 0; i < detailBlocks.length; i++) {
      const block = detailBlocks[i]!;
      for (const rawLine of block.split("\n")) {
        for (const wrapped of wrapTextWithAnsi(rawLine, wrapWidth)) {
          spacedLines.push(this.#dim(`  ${wrapped}`));
        }
      }
      if (i < detailBlocks.length - 1) {
        appendBlankLines(spacedLines, DETAIL_BLOCK_SPACER_LINES);
      }
    }
    return spacedLines;
  }
}

function appendOptionRows(container: Container, rows: PiOvenAskRow[], theme: Theme): void {
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    const isLast = i === rows.length - 1;
    const branch = isLast ? theme.tree.last : theme.tree.branch;
    container.addChild(
      new Text(
        ` ${theme.fg("dim", branch)} ${theme.fg("dim", theme.checkbox.unchecked)} ${row.label}`,
        0,
        0
      )
    );
    if (row.description) {
      const cont = isLast ? "   " : ` ${theme.fg("dim", theme.tree.vertical)} `;
      container.addChild(new Text(`${cont}  ${theme.fg("dim", row.description)}`, 0, 0));
    }
    if (row.detailMarkdown) {
      for (const line of wrapTextWithAnsi(row.detailMarkdown, 72)) {
        const cont = isLast ? "   " : ` ${theme.fg("dim", theme.tree.vertical)} `;
        container.addChild(new Text(`${cont}  ${theme.fg("dim", line)}`, 0, 0));
      }
    }
    if (!isLast) {
      container.addChild(new VerticalSpacer(OPTION_BLOCK_SPACER_LINES));
    }
  }
}

function renderCall(
  args: PiOvenAskParams,
  _options: ToolRenderResultOptions,
  theme: Theme
): Component {
  const resolved = resolveAskPayload(args);
  const rows = buildAskRows(resolved.options, resolved.recommended, resolved.affordances);
  const container = new Container();
  const mdTheme = getMarkdownThemeFor(theme);
  container.addChild(new Text(theme.fg("toolTitle", "Ask (pi-oven)"), 0, 0));

  if (resolved.contextHeaders.length > 0) {
    container.addChild(
      new Text(
        resolved.contextHeaders
          .map((header) => `[${header.title}${header.value ? `: ${header.value}` : ""}]`)
          .join(" "),
        0,
        0
      )
    );
  }
  container.addChild(
    new LineGapComponent(new Markdown(resolved.question, 1, QUESTION_PADDING_Y, mdTheme), QUESTION_LINE_GAP)
  );
  for (const section of resolved.contextSections) {
    appendContextSection(container, section, mdTheme);
  }

  appendOptionRows(container, rows, theme);
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

  const resolved = resolveAskPayload({
    question: details.question,
    options: details.options ?? [],
    recommended: details.recommended,
    deepInterview: details.deepInterview,
    approval: details.approval,
    contextHeaders: details.contextHeaders,
    contextSections: details.contextSections,
    affordances: details.affordances,
  });
  const rows = buildAskRows(resolved.options, resolved.recommended, resolved.affordances);
  if (resolved.contextHeaders.length > 0) {
    container.addChild(
      new Text(
        resolved.contextHeaders
          .map((header) => `[${header.title}${header.value ? `: ${header.value}` : ""}]`)
          .join(" "),
        0,
        0
      )
    );
  }
  container.addChild(
    new LineGapComponent(new Markdown(details.question, 1, QUESTION_PADDING_Y, mdTheme), QUESTION_LINE_GAP)
  );
  for (const section of resolved.contextSections) {
    appendContextSection(container, section, mdTheme);
  }
  appendOptionRows(container, rows, theme);

  if (details.action === "selected" && details.selected !== undefined) {
    container.addChild(
      new Text(
        ` ${theme.fg("dim", theme.tree.last)} ${theme.fg("success", theme.checkbox.checked)} ${theme.fg("toolOutput", details.selected)}`,
        0,
        0
      )
    );
  } else if (details.action === "other" && details.customInput !== undefined) {
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
  } else if (details.action === "ask_about_choices") {
    container.addChild(
      new Text(
        ` ${theme.fg("dim", theme.tree.last)} ${theme.styledSymbol("status.info", "accent")} ${theme.fg("dim", ASK_ABOUT_CHOICES_LABEL)}`,
        0,
        0
      )
    );
  } else if (details.action === "deferred") {
    container.addChild(
      new Text(
        ` ${theme.fg("dim", theme.tree.last)} ${theme.styledSymbol("status.info", "accent")} ${theme.fg("dim", "Deferred")}`,
        0,
        0
      )
    );
  } else if (details.action === "other") {
    container.addChild(
      new Text(
        ` ${theme.fg("dim", theme.tree.last)} ${theme.styledSymbol("status.info", "accent")} ${theme.fg("dim", OTHER_LABEL)}`,
        0,
        0
      )
    );
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
  "Ask the user ONE single-select question with structured context headers, markdown context sections, and one-line rationales per option.",
  "Each option carries { label, description?, detailMarkdown? } and affordances control the explicit `Other (type your own)` / `Ask about these choices` rows.",
  "Use recommended (option index) to preselect a default.",
].join(" ");

type PiOvenAskParams = {
  question: string;
  contextHeaders?: PiOvenAskContextHeader[];
  contextSections?: PiOvenAskContextSection[];
  options: PiOvenAskOption[];
  recommended?: number;
  affordances?: PiOvenAskAffordances;
  deepInterview?: DeepInterviewAskMetadata;
  approval?: ApprovalFlowAskMetadata;
};
function slugifyApprovalToken(value: string): string {
  const slug = value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return slug.length > 0 ? slug : "approval";
}

function resolveRuntimeDeepInterview(
  deepInterview: DeepInterviewAskMetadata | undefined,
  approval: ApprovalFlowAskMetadata | undefined
): DeepInterviewAskMetadata | undefined {
  if (!approval) {
    if (!deepInterview) return undefined;
    const { approvalHandoff: _ignoredApprovalHandoff, routingApproval: _ignoredRoutingApproval, ...canonicalMeta } =
      deepInterview;
    return canonicalMeta;
  }
  const approvalToken = slugifyApprovalToken(approval.decisionKey);
  const fallbackRoundId =
    approval.kind === "routing-bucket"
      ? `approval-bucket-${approvalToken}`
      : approval.kind === "routing-role"
        ? `approval-role-${approvalToken}`
        : `approval-${approvalToken}`;
  const dimension = approval.kind === "spec-handoff" ? "approval" : "routing-approval";
  if (deepInterview) {
    const { approvalHandoff: _ignoredApprovalHandoff, routingApproval: _ignoredRoutingApproval, ...canonicalMeta } =
      deepInterview;
    const roundId = canonicalMeta.roundId ?? fallbackRoundId;
    return {
      ...canonicalMeta,
      ...(approval.resumedFrom?.interviewId && !canonicalMeta.interviewId
        ? { interviewId: approval.resumedFrom.interviewId }
        : {}),
      roundId,
      questionId: canonicalMeta.questionId ?? `q-${roundId}`,
      stage: "approval",
      dimension: canonicalMeta.dimension ?? dimension,
    };
  }
  const roundId = fallbackRoundId;
  return {
    ...(approval.resumedFrom?.interviewId ? { interviewId: approval.resumedFrom.interviewId } : {}),
    round: 0,
    roundId,
    questionId: `q-${roundId}`,
    stage: "approval",
    component: "approval-flow",
    dimension,
  };
}

function resolveAskPayload(params: PiOvenAskParams): PiOvenAskParams & {
  contextHeaders: PiOvenAskContextHeader[];
  contextSections: PiOvenAskContextSection[];
  affordances: Required<PiOvenAskAffordances>;
} {
  const isApproval = params.deepInterview?.stage === "approval" || params.approval !== undefined;
  const affordances = {
    other: params.affordances?.other ?? (!isApproval || params.deepInterview?.component !== "approval-flow"),
    askAboutChoices: params.affordances?.askAboutChoices ?? isApproval,
  };
  const routingApproval = params.approval?.routingApproval;
  const contextHeaders =
    params.contextHeaders && params.contextHeaders.length > 0
      ? params.contextHeaders
      : [
          ...(params.deepInterview
            ? [
                {
                  title: "Deep interview",
                  value: `round ${params.deepInterview.round} · ${params.deepInterview.stage}`,
                  tone: "accent" as const,
                },
              ]
            : []),
          ...(params.approval
            ? [
                {
                  title: "Approval flow",
                  value: `${params.approval.kind} · ${params.approval.decisionKey}`,
                  tone: "warning" as const,
                },
              ]
            : []),
          ...(params.recommended !== undefined && params.options[params.recommended]
            ? [
                {
                  title: "Recommended",
                  value: params.options[params.recommended]!.label,
                  tone: "success" as const,
                },
              ]
            : []),
          ...(routingApproval
            ? [
                {
                  title: "Routing approval",
                  value: `${Object.keys(routingApproval.approvals).length}/${routingApproval.buckets.reduce(
                    (sum, bucket) => sum + bucket.roles.length,
                    0
                  )} roles decided`,
                  tone: "info" as const,
                },
              ]
            : []),
        ];
  const contextSections =
    params.contextSections && params.contextSections.length > 0
      ? params.contextSections
      : [
          ...(params.approval?.summary
            ? [
                {
                  title: "Approval summary",
                  bodyMarkdown: params.approval.summary,
                },
              ]
            : []),
          ...(params.approval?.resumedFrom?.specPath
            ? [
                {
                  title: "Resume context",
                  bullets: [`Spec: ${params.approval.resumedFrom.specPath}`],
                },
              ]
            : []),
          ...(routingApproval
            ? [
                {
                  title: "Routing approval details",
                  bullets: [
                    ...routingApproval.buckets.map(
                      (bucket) => `${bucket.recommendedSelector}: ${bucket.roles.join(", ")}`
                    ),
                    ...Object.values(routingApproval.approvals)
                      .filter((approval): approval is NonNullable<typeof approval> => approval !== undefined)
                      .map(
                        (approval) =>
                          `${approval.role}: ${approval.selectedSelector} (${approval.status})`
                      ),
                  ],
                },
              ]
            : []),
          ...(params.deepInterview?.topologySummary || params.deepInterview?.ontologySummary
            ? [
                {
                  title: "Interview context",
                  bullets: [
                    ...(params.deepInterview.topologySummary
                      ? [`Topology: ${params.deepInterview.topologySummary}`]
                      : []),
                    ...(params.deepInterview.ontologySummary
                      ? [`Ontology: ${params.deepInterview.ontologySummary}`]
                      : []),
                  ],
                },
              ]
            : []),
        ];
  return {
    ...params,
    contextHeaders,
    contextSections,
    affordances,
  };
}

async function askSingle(
  ctx: ExtensionContext,
  params: PiOvenAskParams,
  debugLog?: (message: string) => void,
  registration: PiOvenAskRegistrationOptions = {}
): Promise<AgentToolResult<PiOvenAskDetails>> {
  const { question, options, deepInterview, approval } = params;
  const recommended = clampRecommended(params.recommended, options.length);
  const runtimeDeepInterview = resolveRuntimeDeepInterview(deepInterview, approval);
  const resolvedPayload = resolveAskPayload({
    ...params,
    recommended,
    ...(runtimeDeepInterview ? { deepInterview: runtimeDeepInterview } : {}),
  });
  const rows = buildAskRows(options, recommended, resolvedPayload.affordances);
  const rowByValue = new Map(rows.map((row) => [row.value, row] as const));
  const resultMeta: PiOvenAskResultMeta = {
    ...(recommended !== undefined ? { recommended } : {}),
    ...(runtimeDeepInterview !== undefined
      ? { deepInterview: runtimeDeepInterview }
      : deepInterview !== undefined
        ? { deepInterview }
        : {}),
    ...(approval !== undefined ? { approval } : {}),
    contextHeaders: resolvedPayload.contextHeaders,
    contextSections: resolvedPayload.contextSections,
    affordances: resolvedPayload.affordances,
    options: resolvedPayload.options,
  };
  const contextState = ctx as unknown as {
    cwd?: unknown;
    workflowGate?: {
      emitGate?: (question: unknown) => Promise<{ selectedOptions?: string[]; customInput?: string } | undefined>;
    };
  };
  const projectRoot =
    typeof contextState.cwd === "string" && contextState.cwd.trim().length > 0
      ? contextState.cwd
      : process.cwd();
  const runtime = runtimeDeepInterview
    ? createDeepInterviewRuntime(projectRoot, { onRuntimeTrace: registration.onRuntimeTrace })
    : undefined;
  if (runtime && runtimeDeepInterview) {
    try {
      await runtime.seedQuestion({
        question,
        recommended,
        deepInterview: runtimeDeepInterview,
        ...(approval !== undefined ? { approval } : {}),
      });
    } catch (err) {
      debugLog?.(`pi-oven_ask: deep-interview seed skipped: ${err}`);
    }
  }

  const outcomeFor = (
    row: PiOvenAskRow | undefined,
    fallbackChoice: string | undefined,
    customInput: string | undefined
  ): PiOvenAskOutcome => {
    if (row?.action === "ask_about_choices") {
      return { action: "ask_about_choices" };
    }
    if (row?.action === "other") {
      return customInput !== undefined ? { action: "other", customInput } : { action: "other" };
    }
    if (row?.selected !== undefined) {
      return { action: "selected", selected: row.selected };
    }
    if (fallbackChoice === ASK_ABOUT_CHOICES_LABEL) {
      return resolvedPayload.affordances.askAboutChoices ? { action: "ask_about_choices" } : { action: "deferred" };
    }
    if (fallbackChoice === OTHER_LABEL) {
      if (!resolvedPayload.affordances.other) {
        return { action: "deferred" };
      }
      return customInput !== undefined ? { action: "other", customInput } : { action: "other" };
    }
    if (customInput !== undefined) {
      return resolvedPayload.affordances.other ? { action: "other", customInput } : { action: "deferred" };
    }
    if (fallbackChoice !== undefined) {
      return { action: "selected", selected: fallbackChoice.replace(RECOMMENDED_SUFFIX, "") };
    }
    return { action: "cancelled" };
  };

  const persistOutcome = async (outcome: PiOvenAskOutcome): Promise<void> => {
    if (!runtime || !runtimeDeepInterview || outcome.action === "deferred") return;
    let selected: string | undefined;
    let customInput: string | undefined;
    if (outcome.action === "selected") {
      selected = outcome.selected;
    } else if (outcome.action === "ask_about_choices") {
      selected = ASK_ABOUT_CHOICES_LABEL;
    } else if (outcome.action === "other") {
      customInput = outcome.customInput;
      if (customInput === undefined) {
        selected = OTHER_LABEL;
      }
    }
    try {
      await runtime.recordAnswer({
        question,
        selected,
        customInput,
        recommended,
        deepInterview: runtimeDeepInterview,
        ...(approval !== undefined ? { approval } : {}),
      });
    } catch (err) {
      debugLog?.(`pi-oven_ask: deep-interview answer persist skipped: ${err}`);
    }
  };

  if (!ctx.hasUI || typeof ctx.ui?.custom !== "function") {
    if (
      (runtimeDeepInterview?.stage === "approval" || approval !== undefined) &&
      typeof contextState.workflowGate?.emitGate === "function"
    ) {
      const gateResult = await contextState.workflowGate.emitGate({
        question,
        options,
        recommended,
        contextHeaders: resolvedPayload.contextHeaders,
        contextSections: resolvedPayload.contextSections,
        affordances: resolvedPayload.affordances,
        ...(runtimeDeepInterview ? { deepInterview: runtimeDeepInterview } : {}),
        ...(approval !== undefined ? { approval } : {}),
      });
      if (!gateResult || (!Array.isArray(gateResult.selectedOptions) && gateResult.customInput === undefined)) {
        return formatAskResult(question, { action: "deferred" }, resultMeta);
      }
      const gateChoice =
        Array.isArray(gateResult.selectedOptions) && typeof gateResult.selectedOptions[0] === "string"
          ? gateResult.selectedOptions[0]
          : undefined;
      const row =
        rows.find((entry) => entry.label === gateChoice || entry.selected === gateChoice) ??
        (gateChoice === ASK_ABOUT_CHOICES_LABEL
          ? rows.find((entry) => entry.action === "ask_about_choices")
          : gateChoice === OTHER_LABEL
            ? rows.find((entry) => entry.action === "other")
            : undefined);
      const outcome = outcomeFor(
        row,
        gateChoice,
        typeof gateResult.customInput === "string" ? gateResult.customInput : undefined
      );
      await persistOutcome(outcome);
      return formatAskResult(question, outcome, resultMeta);
    }
    if (typeof ctx.ui?.select === "function") {
      const foldedRows = rows.map((row) => ({ label: row.label, description: row.description }));
      const foldedLabels = foldedRows.map(foldLabel);
      const chosen = await ctx.ui.select(question, foldedLabels);
      if (chosen === undefined) {
        const outcome = { action: "cancelled" as const };
        await persistOutcome(outcome);
        return formatAskResult(question, outcome, resultMeta);
      }
      const rowIndex = foldedLabels.indexOf(chosen);
      const row = rowIndex >= 0 ? rows[rowIndex] : rows.find((entry) => entry.label === chosen);
      if (row?.action === "other" && typeof ctx.ui.editor === "function") {
        const custom = await ctx.ui.editor("Enter your response:", undefined, undefined, {
          promptStyle: true,
        });
        if (custom === undefined) {
          const outcome = { action: "cancelled" as const };
          await persistOutcome(outcome);
          return formatAskResult(question, outcome, resultMeta);
        }
        const outcome = { action: "other" as const, customInput: custom };
        await persistOutcome(outcome);
        return formatAskResult(question, outcome, resultMeta);
      }
      const outcome = outcomeFor(row, chosen, undefined);
      await persistOutcome(outcome);
      return formatAskResult(question, outcome, resultMeta);
    }
    const outcome = { action: "cancelled" as const };
    await persistOutcome(outcome);
    return formatAskResult(question, outcome, resultMeta);
  }

  const items = buildSelectItems(options, recommended, resolvedPayload.affordances);
  const choice = await ctx.ui.custom<string | undefined>((_tui, theme, _keybindings, done) => {
    const mdTheme = getMarkdownThemeFor(theme);
    const list = new SelectList(items, items.length, getSelectListThemeFor(theme), {
      minPrimaryColumnWidth: 24,
      maxPrimaryColumnWidth: 48,
    });
    if (recommended !== undefined) list.setSelectedIndex(recommended);
    list.onSelect = (item) => done(item.value);
    list.onCancel = () => done(undefined);
    return new PiOvenAskContainer(
      {
        question,
        contextHeaders: resolvedPayload.contextHeaders,
        contextSections: resolvedPayload.contextSections,
      },
      list,
      mdTheme,
      rowByValue,
      (text) => theme.fg("dim", text)
    );
  });

  if (choice === undefined) {
    const outcome = { action: "cancelled" as const };
    await persistOutcome(outcome);
    return formatAskResult(question, outcome, resultMeta);
  }
  if (choice === OTHER_VALUE) {
    const custom = await ctx.ui.editor("Enter your response:", undefined, undefined, {
      promptStyle: true,
    });
    if (custom === undefined) {
      const outcome = { action: "cancelled" as const };
      await persistOutcome(outcome);
      return formatAskResult(question, outcome, resultMeta);
    }
    const outcome = { action: "other" as const, customInput: custom };
    await persistOutcome(outcome);
    return formatAskResult(question, outcome, resultMeta);
  }
  const row = rowByValue.get(choice);
  const outcome = outcomeFor(row, choice, undefined);
  await persistOutcome(outcome);
  return formatAskResult(question, outcome, resultMeta);
}

export function registerPiOvenAsk(pi: ExtensionAPI, options: PiOvenAskRegistrationOptions = {}): void {
  if (typeof pi.registerTool !== "function") {
    pi.logger?.debug?.("pi-oven_ask: registerTool unavailable; skipping registration");
    return;
  }

  const { z } = pi.zod;

  const optionSchema = z.object({
    label: z.string(),
    description: z.string().optional(),
    detailMarkdown: z.string().optional(),
  });

  const contextHeaderSchema = z.object({
    title: z.string().min(1),
    value: z.string().optional(),
    tone: z.enum(["info", "accent", "warning", "success"]).optional(),
  });

  const contextSectionSchema = z.object({
    title: z.string().min(1),
    bodyMarkdown: z.string().optional(),
    bullets: z.array(z.string()).optional(),
  });

  const affordancesSchema = z.object({
    other: z.boolean().optional(),
    askAboutChoices: z.boolean().optional(),
  });

  const deepInterviewSchema = z.object({
    interviewId: z.string().optional(),
    round: z.number().int().nonnegative(),
    roundId: z.string().optional(),
    questionId: z.string().optional(),
    stage: z.enum(["topology", "round", "closure", "approval"]),
    component: z.string().optional(),
    dimension: z.string().optional(),
    ambiguity: z.number().min(0).max(1).optional(),
    ambiguityAtAsk: z.number().min(0).max(1).optional(),
    approvalHandoff: z
      .object({
        decisionKey: z.string().min(1),
        summary: z.string().min(1),
      })
      .optional(),
    routingApproval: z.unknown().optional(),
    threshold: z.number().min(0).max(1).optional(),
    thresholdSource: z.enum(["session", "project", "user", "default"]).optional(),
    scores: z.record(z.string(), z.number()).optional(),
    triggers: z.array(z.string()).optional(),
    topologySummary: z.string().optional(),
    ontologySummary: z.string().optional(),
    milestone: z.enum(["initial", "progress", "refined", "ready"]).optional(),
    nextTarget: z
      .object({
        componentId: z.string().min(1),
        dimension: z.enum(["goal", "constraints", "criteria", "context"]),
        rationale: z.string().min(1),
      })
      .optional(),
    establishedFacts: z
      .array(
        z.object({
          summary: z.string().min(1),
          sourceRoundKey: z.string().optional(),
          componentId: z.string().optional(),
          dimension: z.enum(["goal", "constraints", "criteria", "context"]).optional(),
        })
      )
      .optional(),
    topology: z
      .object({
        confirmed: z.boolean().optional(),
        summary: z.string().optional(),
        nodes: z.array(
          z.object({
            id: z.string().min(1),
            label: z.string().min(1),
            kind: z.string().optional(),
          })
        ),
        edges: z
          .array(
            z.object({
              from: z.string().min(1),
              to: z.string().min(1),
              label: z.string().optional(),
            })
          )
          .optional(),
      })
      .optional(),
    ontologySnapshot: z
      .object({
        id: z.string().optional(),
        summary: z.string().min(1),
        capturedAt: z.string().optional(),
        stable: z.boolean().optional(),
      })
      .optional(),
    currentAmbiguity: z.number().min(0).max(1).optional(),
    initialIdea: z.string().optional(),
    spec: z
      .object({
        path: z.string().min(1),
        sha256: z.string().min(1),
        persistedAt: z.string().min(1),
        stage: z.enum(["draft", "final"]),
      })
      .optional(),
  });

  const approvalSchema = z.object({
    kind: z.enum(["spec-handoff", "routing-bucket", "routing-role"]),
    source: z.enum(["brainstorming", "setup", "status", "manual"]),
    decisionKey: z.string().min(1),
    summary: z.string().min(1),
    routingApproval: z.unknown().optional(),
    resumedFrom: z
      .object({
        interviewId: z.string().optional(),
        specPath: z.string().optional(),
      })
      .optional(),
    status: z.enum(["pending", "approved", "rejected", "cancelled"]).optional(),
  });

  const parameters = z.object({
    question: z.string().min(1),
    contextHeaders: z.array(contextHeaderSchema).optional(),
    contextSections: z.array(contextSectionSchema).optional(),
    options: z.array(optionSchema).min(1),
    recommended: z.number().optional(),
    affordances: affordancesSchema.optional(),
    deepInterview: deepInterviewSchema.optional(),
    approval: approvalSchema.optional(),
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
      return askSingle(
        ctx,
        {
          question: params.question,
          contextHeaders: params.contextHeaders,
          contextSections: params.contextSections,
          options: params.options,
          recommended: params.recommended,
          affordances: params.affordances,
          deepInterview: params.deepInterview,
          approval: params.approval,
        },
        (message) => pi.logger?.debug?.(message),
        options
      );
    },
  });
}
