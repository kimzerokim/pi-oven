---
name: pov:html-spec-decision-maker
version: 0.1.0
description: "Use when implementation direction is not frozen and the user needs a decision worksheet in HTML — especially for option comparison, unresolved trade-offs, clarification cards, or pre-decision review before writing the spec/plan."
---

# html-spec-decision-maker

Create one self-contained pre-decision HTML worksheet that helps a human lock direction before implementation.

## Dispatch discipline (main orchestrates, subagents do the work)

Do NOT do this skill's substantive work in the main context. Main's direct-action budget is narrow: 1–2 file simple edits ≤ 30 LoC, or operational commands. Any multi-step grounding, evidence collection, or HTML assembly should be delegated. Route by role-fit: codebase grounding → `pi-oven:explorer`; external/library grounding → `pi-oven:document-specialist` or `pi-oven:librarian`; HTML assembly/polish → `pi-oven:writer` or `pi-oven:designer`.

## When to use

Use this skill when:
- the implementation direction is not frozen yet
- the user needs options, trade-offs, or open questions structured into a shareable HTML worksheet
- there are unresolved user-facing decisions that should be answered before the spec or implementation plan is finalized
- the user explicitly asks for a decision HTML, worksheet, option comparison, or pre-decision artifact

Do not use this skill when:
- the request is a research report or citation-backed external findings digest — use `html-research-orchestrator`
- there are no unresolved user-facing questions left
- the spec is already frozen and the task has moved into implementation
- the request is only a plain text summary with no decision capture need

## Relationship to brainstorming

`brainstorming` owns the question loop, design convergence, and approval gate.

This skill does NOT replace `brainstorming`.

Use this skill only as the worksheet layer inside that broader flow:
- if unresolved user-facing questions exist, create the worksheet
- if no unresolved user-facing questions remain, do NOT create HTML
- after the user answers the worksheet, the authority moves back to the written spec / plan, not the worksheet itself

## Output contract

- Write exactly one `.html` file.
- Default path: `docs/pre-decisions/YYYY-MM-DD-semantic-name-v1.html`.
- Create `v2+` only if the user explicitly asks for another revision.
- Keep CSS and JavaScript inline.
- Make the file readable on its own without external assets.
- If no unresolved user-facing questions remain, stop without creating HTML.

## Canonical example requirement

- Use `examples/2026-06-19-reference-style-decision-plan-v1.html` as the canonical visual template.
- Preserve that example's flat memo layout, sticky TOC, section spacing, amber `.dp-section`, option-card grid, evidence callouts, `대안제시`, and bottom copy generator.
- Change the content, IDs, options, evidence, and summary text for the current topic; do not redesign the interaction pattern unless the user explicitly asks.

## Grounding modes

### 1. Codebase-present mode

Use this when the decision depends on current code.

Requirements:
- inspect the relevant code before drafting the worksheet
- show concrete code evidence in the worksheet
- explain file or symbol impact for each important direction
- include trade-offs for extension vs refactor vs replacement where relevant

### 2. No-codebase fallback

Use this when there is no usable codebase yet.

Requirements:
- ground the worksheet in the user request, constraints, examples, and success criteria
- turn unknown implementation details into explicit clarification cards
- prefer clarification over premature recommendation strength when intent is still ambiguous

## Workflow

1. Resolve topic and filename.
2. Decide whether unresolved user-facing questions exist.
3. If none exist, do not create HTML.
4. If questions exist, start from `examples/2026-06-19-reference-style-decision-plan-v1.html` and keep its structure/style.
5. Gather grounding evidence.
6. Convert unresolved questions into decision cards.
7. Run `references/html-generation-checklist.md`.
8. Save the final HTML under `docs/pre-decisions/`.

## Decision card rules

- The worksheet must contain **1–30** cards inclusive.
- Count cards, not options, notes, or sub-bullets.
- If there is only one high-leverage unresolved question, one card is valid.
- Never add filler questions.
- Do not hide overflow questions in appendices, nested sections, or footnotes.

A valid card is one where answering it reduces ambiguity or changes implementation direction.

## Decision card contract

Every decision card must include:
- `Q-XX` ID
- question title
- why this matters
- grounding evidence
- 2–5 options
- pros and cons per option
- short implementation-direction summary per option
- one recommended option when justified
- single-choice control
- `대안제시`

If no option is clearly best, leave the card unselected and say why.
If the evidence is still weak, mark that explicitly instead of pretending a recommendation exists.

## Required sections

Follow `references/worksheet-sections.md`.

## Summary generator

Follow `references/decision-summary-format.md`.

The bottom area must:
- generate deterministic text in card order
- include all selections
- include `대안제시`
- include unresolved follow-ups
- be easy to copy into the CLI

## Visual contract

Follow `references/visual-theme.md`.

The worksheet should feel like a long-form decision memo, not an app dashboard.

## Completion gate

Before you finish, run the full checklist in `references/html-generation-checklist.md`.

## Portability rules

- Use generic role names if you delegate.
- Do not hard-code vendor-specific namespaces.
- Do not hard-code local absolute paths.
- Prefer relative paths and repo-local artifacts.

## References

- `references/worksheet-sections.md`
- `references/decision-summary-format.md`
- `references/visual-theme.md`
- `references/html-generation-checklist.md`
- `examples/2026-06-19-reference-style-decision-plan-v1.html`
