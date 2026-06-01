# Plan — pi-oven_ask: plugin-registered ask tool with per-option descriptions

> Branch: `feature/simplify` (continuing, per user). Commit-only, no PR.
> Why: omp's built-in `ask` schema has only `{label}` (no description), and its picker is fed `string[]`
> via `ui.select` — so option explanations can't show. The user wants descriptions shown. We do NOT modify
> omp core; instead the pi-oven plugin registers its OWN tool that renders the description-capable `SelectList`.
> Feasibility verified end-to-end against installed `@oh-my-pi/pi-coding-agent@15.5.3` (adversarially reviewed).

## Verified API contract (installed .d.ts — build against THESE)
- `ExtensionAPI.registerTool<TParams extends TSchema, TDetails>(tool: ToolDefinition): void` — extensions/extensions/types.d.ts:571.
- Schema lib = **zod**, injected: `const { z } = pi.zod;` (precedent `examples/extensions/hello.ts`). `parameters: z.object({...})`.
- `ToolDefinition.execute(toolCallId: string, params: Static<TParams>, signal: AbortSignal | undefined, onUpdate, ctx: ExtensionContext): Promise<AgentToolResult<TDetails>>` (types.d.ts:237+). Arg order is `(toolCallId, params, signal, onUpdate, ctx)` — tsc enforces; trust the compiler.
- `ToolDefinition.renderCall?(args: Static<TParams>, options: ToolRenderResultOptions, theme: Theme): Component`.
- `ToolDefinition.renderResult?(result, options, theme, args?): Component`.
- `ExtensionContext`: `{ ui: ExtensionUIContext, hasUI: boolean, abort(): void, cwd, ... }`.
- `ExtensionUIContext.custom<T>(factory: (tui: TUI, theme: Theme, keybindings: KeybindingsManager, done: (result: T) => void) => ExtensionUiComponent | Promise<ExtensionUiComponent>, options?: { overlay?: boolean }): Promise<T>` — **4-arg factory**; the picker resolves when `done(result)` is called (types.d.ts:96).
- `ExtensionUIContext.editor(title, prefill?, dialogOptions?, editorOptions?: { promptStyle?: boolean }): Promise<string | undefined>` — for the "Other" free-text path.
- `AgentToolResult<TDetails> = { content: (TextContent|ImageContent)[], details?: TDetails, isError?: boolean }`.
- pi-tui `SelectList` (root-exported): `new SelectList(items: ReadonlyArray<SelectItem>, maxVisible: number, theme: SelectListTheme, layout?: SelectListLayoutOptions)`; settable props `onSelect?: (item: SelectItem) => void`, `onCancel?: () => void`; methods `setSelectedIndex(i)`, `getSelectedItem()`, `handleInput(key)`, `render(width)`. Implements `Component`.
- `SelectItem = { value: string; label: string; description?: string; hint?: string }`. Description renders beside the label when `width > 40` and remaining width `> 10`.
- `SelectListLayoutOptions = { minPrimaryColumnWidth?, maxPrimaryColumnWidth?, truncatePrimary? }`.
- `getSelectListTheme(): SelectListTheme` — root-exported from `@oh-my-pi/pi-coding-agent` (index re-exports modes/theme/theme).
- `Container`, `Text`, `Markdown` — importable from `@oh-my-pi/pi-tui` (also re-exported by pi-coding-agent).
- Precedent to mirror for live-picker wiring: `packages/coding-agent/src/modes/components/thinking-selector.ts` (Container + SelectList child + onSelect/onCancel).

## Scope (v1)
Single question, **single-select**, with optional per-option `description` + optional `recommended` + an auto-appended "Other (type your own)" free-text entry. Multi-select / multi-question stay on the built-in `ask` (documented). This covers brainstorming's A/B/C convergence questions and deep-dive's confirmations.

## New module: `.omp/extensions/pi-oven-runtime/pi-oven-ask.ts`
Export **pure, unit-testable** helpers + the registrar:
- `const OTHER_VALUE = "__pi-oven_other__";`
- `buildSelectItems(options: {label:string;description?:string}[]): SelectItem[]` — maps each to `{value: label, label, description}`, then appends `{value: OTHER_VALUE, label: "Other (type your own)"}`. (value = label; labels assumed unique — if dupes, suffix index to keep value unique.)
- `clampRecommended(recommended: number | undefined, len: number): number | undefined` — valid-index guard.
- `formatAskResult(question, selected: string | undefined, customInput: string | undefined): AgentToolResult` — text `User selected: X` / `User provided custom input: Y` / `User cancelled the selection`; `details: { question, selected, customInput }`.
- `foldLabel(opt)` → `opt.description ? \`${opt.label} — ${opt.description}\` : opt.label` (degraded fallback only).
- `registerPiOvenAsk(pi: ExtensionAPI): void` — see below.

### `registerPiOvenAsk(pi)`
- Guard: `if (typeof pi.registerTool !== "function") { pi.logger?.debug("pi-oven_ask: registerTool unavailable"); return; }` (version-drift fail-open).
- `const { z } = pi.zod;`
- `pi.registerTool({ name: "pi-oven_ask", label: "Ask (pi-oven)", description: <LLM guidance: single-select question where each option benefits from a one-line rationale; options carry {label, description}; an 'Other' free-text entry is appended automatically; prefer this over the built-in ask for option questions with explanations>, parameters: z.object({ question: z.string(), options: z.array(z.object({ label: z.string(), description: z.string().optional() })).min(1), recommended: z.number().optional() }), execute, renderCall, renderResult })`.

### execute(toolCallId, params, signal, onUpdate, ctx)
1. `if (!ctx.hasUI || typeof ctx.ui?.custom !== "function")` → degraded fallback: if `typeof ctx.ui?.select === "function"`, call `ctx.ui.select(params.question, params.options.map(foldLabel))` and map the chosen string back; else return `formatAskResult(question, undefined, undefined)` (cancelled). (Keeps the tool safe if omp drifts.)
2. Normal path: `const items = buildSelectItems(params.options);` `const rec = clampRecommended(params.recommended, params.options.length);`
3. `const choice = await ctx.ui.custom<string | undefined>((tui, theme, keybindings, done) => { const list = new SelectList(items, items.length, getSelectListTheme(), { minPrimaryColumnWidth: 24, maxPrimaryColumnWidth: 48 }); if (rec !== undefined) list.setSelectedIndex(rec); list.onSelect = (item) => done(item.value); list.onCancel = () => done(undefined); const c = new Container(); c.addChild(new Markdown(params.question, 1, 0)); c.addChild(list); /* delegate keys to the list */ (c as any).handleInput = (k: string) => list.handleInput(k); return c; });`
   - NOTE: the host `setFocus`es the returned component, then routes keys to its `handleInput`. Returning a Container that forwards `handleInput` to the SelectList guarantees navigation works regardless of Container's default. Mirror thinking-selector if cleaner (a small named class `extends Container` overriding `handleInput`). Whichever compiles + routes keys.
4. `if (choice === undefined) return formatAskResult(params.question, undefined, undefined);`
5. `if (choice === OTHER_VALUE) { const custom = await ctx.ui.editor("Enter your response:", undefined, undefined, { promptStyle: true }); return formatAskResult(params.question, undefined, custom ?? undefined); }`
6. `return formatAskResult(params.question, choice, undefined);`
   - Do NOT call ctx.abort() on cancel (avoid killing the turn) — returning a "cancelled" text result is enough.

### renderCall(args, options, theme) / renderResult(result, options, theme, args)
- renderCall: a `Container` with `new Markdown(args.question)` then one tree line per option: `<branch> <unchecked> label`, and when `opt.description` present a dimmed second line beneath it. Mirror the visual style of the built-in `askToolRenderer.renderCall` (tree glyphs via `theme.tree`, dim via `theme.fg("dim", ...)`). Keep it simple; the transcript is secondary.
- renderResult: header + question + the selected option (✓) or the custom input, dimmed. If both undefined → "Cancelled".
- These must compile against the real `Theme`/`Component` types; keep to `Container`/`Text`/`Markdown` + `theme.fg(...)`. If a glyph/api is uncertain, prefer plain `Text` lines over guessing theme internals.

## Wire into `.omp/extensions/pi-oven.ts`
In the `piOvenPi(pi)` entrypoint, after the existing setup, add (fail-open):
```
try { registerPiOvenAsk(pi); } catch (err) { pi.logger.debug(`pi-oven: pi-oven_ask registration skipped: ${err}`); }
```
Import `registerPiOvenAsk` from `./pi-oven-runtime/pi-oven-ask`.

## Skill updates (English-only)
- `skills/brainstorming/SKILL.md` (Q&A convergence loop) + `references/checklist.md`: when presenting multiple-choice options, prefer the **`pi-oven_ask`** tool with each option as `{label, description}` (the recommended-answer rationale goes in `description`, shown beside the option in the live picker) instead of the built-in `ask`. Built-in `ask` remains for multi-select / free-form. One-question-at-a-time + convergence gate unchanged.
- `skills/deep-dive/SKILL.md`: Phase 2 lane confirmation + Phase 4 bounded clarification single-select questions → use `pi-oven_ask` with descriptions. (deep-dive stays autonomous; this only enriches the few questions it does ask.)

## Tests: `tests/extensions/pi-oven-runtime/pi-oven-ask.test.ts`
Unit-test the PURE helpers (no UI):
- `buildSelectItems`: maps label/description; appends Other; values unique; Other has OTHER_VALUE.
- `clampRecommended`: in-range passes; out-of-range / negative / undefined → undefined.
- `formatAskResult`: selected → "User selected: X" + details.selected; customInput → "User provided custom input: Y"; both undefined → "User cancelled the selection".
- `foldLabel`: with/without description.
- schema: a constructed `z.object(...)` (via a local zod import or a tiny shape check) parses valid input and rejects empty options. (If importing zod standalone in tests is awkward, assert the helper-level invariants instead.)
Do NOT attempt to test `ctx.ui.custom`/SelectList rendering — covered by build + manual QA.

## Verification
1. `bun run build` (bundles .omp/extensions/pi-oven.ts → dist) succeeds — this is the binding-correctness gate against installed @oh-my-pi types.
2. `bun run check` clean; `bun test` all pass (existing 336 + new pi-oven-ask tests).
3. `bun run lint:agents` + `bun run lint:skills` clean. Skill bodies English-only; no pi-oven:scientist reintroduced.
4. Coherence: pi-oven_ask registered fail-open; execute has the custom-missing fallback; descriptions reach SelectItem.description; skills steer option questions to pi-oven_ask.

## Out of scope (note in code/docs)
Multi-select, multi-question back/forward navigation, and the ask timeout/auto-select feature are NOT ported (built-in `ask` keeps those). Revisit if needed.
