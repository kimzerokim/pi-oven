/**
 * pi-oven_ask — plugin-registered single-select ask tool with per-option descriptions.
 *
 * Why this exists: omp's built-in `ask` schema only carries `{label}` per option
 * and feeds the picker `string[]` via `ui.select`, so option rationales cannot be
 * shown. pi-oven_ask registers its OWN tool that renders the description-capable
 * pi-tui `SelectList`, so each option's one-line rationale shows beside the label
 * in the live picker. We do NOT modify omp core.
 *
 * Scope (v1): single question, single-select, optional per-option `description`,
 * optional `recommended` index, and an auto-appended "Other (type your own)"
 * free-text entry. Multi-select / multi-question / timeout-auto-select stay on the
 * built-in `ask` (documented out of scope below).
 *
 * Version-drift safety:
 *   - registerPiOvenAsk() returns early if pi.registerTool is unavailable.
 *   - execute() falls back to ctx.ui.select(question, options.map(foldLabel)) when
 *     ctx.ui.custom is unavailable, and returns a cancelled result if there is no UI.
 */

import {
  Container,
  Markdown,
  Text,
  type Component,
  type SelectItem,
  SelectList,
} from "@oh-my-pi/pi-tui";
// `@oh-my-pi/*` is externalized at build time (package.json `build` --external) and
// resolved at runtime from omp's node_modules — the same way every omp extension
// (e.g. swarm-extension) consumes these packages. So the value helpers come from the
// package barrel, which is guaranteed runtime-resolvable; externalizing also avoids
// bundling pi-coding-agent's top-level-await mupdf dependency.
import { getMarkdownTheme, getSelectListTheme } from "@oh-my-pi/pi-coding-agent";
import type {
  AgentToolResult,
  ExtensionAPI,
  ExtensionContext,
  Theme,
  ToolRenderResultOptions,
} from "@oh-my-pi/pi-coding-agent";

// ---------------------------------------------------------------------------
// Public types + constants (pure)
// ---------------------------------------------------------------------------

/** Sentinel value carried by the auto-appended free-text entry. */
export const OTHER_VALUE = "__pi-oven_other__";

/** Display label for the auto-appended free-text entry. */
const OTHER_LABEL = "Other (type your own)";

/** A single answer option. `description` (when present) shows beside the label. */
export interface PiOvenAskOption {
  label: string;
  description?: string;
}

/** Structured details persisted on the tool result. */
export interface PiOvenAskDetails {
  question: string;
  selected?: string;
  customInput?: string;
}

// ---------------------------------------------------------------------------
// Pure helpers (unit-tested)
// ---------------------------------------------------------------------------

/**
 * Map options to SelectItems (value = label) and append the "Other" entry.
 * Labels are assumed unique; if a duplicate value would result, the index is
 * suffixed to keep `value` unique while leaving the visible `label` intact.
 */
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

/**
 * Validate `recommended` as an in-range option index. Returns undefined for
 * undefined / non-integer / negative / out-of-range inputs.
 */
export function clampRecommended(
  recommended: number | undefined,
  len: number
): number | undefined {
  if (recommended === undefined) return undefined;
  if (!Number.isInteger(recommended)) return undefined;
  if (recommended < 0 || recommended >= len) return undefined;
  return recommended;
}

/**
 * Build the AgentToolResult text + details from the picker outcome.
 *   - selected defined    → "User selected: X"
 *   - customInput defined → "User provided custom input: Y"
 *   - both undefined      → "User cancelled the selection"
 */
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

  const details: PiOvenAskDetails = { question };
  if (selected !== undefined) details.selected = selected;
  if (customInput !== undefined) details.customInput = customInput;

  return {
    content: [{ type: "text" as const, text }],
    details,
  };
}

/**
 * Degraded-fallback label folding: when the rich picker is unavailable we feed
 * the built-in `ui.select` a plain `string[]`, so the rationale is appended
 * inline ("label — description").
 */
export function foldLabel(opt: PiOvenAskOption): string {
  return opt.description ? `${opt.label} — ${opt.description}` : opt.label;
}

// ---------------------------------------------------------------------------
// Live picker container — forwards keyboard input to the SelectList
// ---------------------------------------------------------------------------

/**
 * Container holding a question Markdown + the SelectList. The host setFocus()es
 * the returned component and routes keys to its handleInput; Container has no
 * default handleInput, so we forward keys to the child SelectList (mirrors
 * packages/coding-agent/src/modes/components/thinking-selector.ts).
 */
class PiOvenAskContainer extends Container {
  readonly #list: SelectList;
  constructor(question: string, list: SelectList) {
    super();
    this.#list = list;
    this.addChild(new Markdown(question, 1, 0, getMarkdownTheme()));
    this.addChild(list);
  }
  handleInput(data: string): void {
    this.#list.handleInput(data);
  }
}

// ---------------------------------------------------------------------------
// Transcript rendering (renderCall / renderResult)
// ---------------------------------------------------------------------------

function renderCall(
  args: { question: string; options: PiOvenAskOption[]; recommended?: number },
  _options: ToolRenderResultOptions,
  theme: Theme
): Component {
  const container = new Container();
  container.addChild(new Text(theme.fg("toolTitle", "Ask (pi-oven)"), 0, 0));
  container.addChild(new Markdown(args.question, 1, 0, getMarkdownTheme()));

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
      container.addChild(
        new Text(`${cont}  ${theme.fg("dim", opt.description)}`, 0, 0)
      );
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

// ---------------------------------------------------------------------------
// Registrar
// ---------------------------------------------------------------------------

const DESCRIPTION = [
  "Ask the user a single-select question where each option benefits from a one-line rationale.",
  "Each option carries { label, description? }; the description shows beside the option in the live picker,",
  "so the user can see WHY each choice matters. An 'Other (type your own)' free-text entry is appended",
  "automatically. Use `recommended` (option index) to preselect a default.",
  "Prefer this over the built-in `ask` for option questions that benefit from per-option explanations.",
  "The built-in `ask` remains for multi-select and free-form questions.",
].join(" ");

export function registerPiOvenAsk(pi: ExtensionAPI): void {
  // Version-drift fail-open: skip registration if the host lacks registerTool.
  if (typeof pi.registerTool !== "function") {
    pi.logger?.debug?.("pi-oven_ask: registerTool unavailable; skipping registration");
    return;
  }

  const { z } = pi.zod;

  const parameters = z.object({
    question: z.string(),
    options: z
      .array(
        z.object({
          label: z.string(),
          description: z.string().optional(),
        })
      )
      .min(1),
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
      params: { question: string; options: PiOvenAskOption[]; recommended?: number },
      _signal: AbortSignal | undefined,
      _onUpdate: unknown,
      ctx: ExtensionContext
    ): Promise<AgentToolResult<PiOvenAskDetails>> {
      const { question, options } = params;

      // Degraded fallback: no rich custom UI available.
      if (!ctx.hasUI || typeof ctx.ui?.custom !== "function") {
        if (typeof ctx.ui?.select === "function") {
          const folded = options.map(foldLabel);
          const chosen = await ctx.ui.select(question, folded);
          if (chosen === undefined) {
            return formatAskResult(question, undefined, undefined);
          }
          // Map the chosen folded string back to the original label.
          const idx = folded.indexOf(chosen);
          const selected = idx >= 0 ? options[idx]!.label : chosen;
          return formatAskResult(question, selected, undefined);
        }
        // No UI at all — cancelled.
        return formatAskResult(question, undefined, undefined);
      }

      // Normal path: rich SelectList picker with per-option descriptions.
      const items = buildSelectItems(options);
      const rec = clampRecommended(params.recommended, options.length);

      const choice = await ctx.ui.custom<string | undefined>((_tui, _theme, _keybindings, done) => {
        const list = new SelectList(items, items.length, getSelectListTheme(), {
          minPrimaryColumnWidth: 24,
          maxPrimaryColumnWidth: 48,
        });
        if (rec !== undefined) list.setSelectedIndex(rec);
        list.onSelect = (item) => done(item.value);
        list.onCancel = () => done(undefined);
        return new PiOvenAskContainer(question, list);
      });

      if (choice === undefined) {
        return formatAskResult(question, undefined, undefined);
      }
      if (choice === OTHER_VALUE) {
        const custom = await ctx.ui.editor("Enter your response:", undefined, undefined, {
          promptStyle: true,
        });
        return formatAskResult(question, undefined, custom ?? undefined);
      }
      return formatAskResult(question, choice, undefined);
    },
  });
}
