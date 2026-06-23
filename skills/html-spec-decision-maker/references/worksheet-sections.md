# Worksheet Sections

Use these top-level sections in this exact order.

1. Document Header
2. Decision Snapshot
3. Grounding Evidence
4. Decision Questions
5. Cross-Cutting Risks and Open Items
6. Decision Summary Generator

## 1. Document Header

Include:
- title
- date
- semantic topic slug
- version
- one-sentence purpose
- current status (`Needs decision`, `Review ready`, etc.)

## 2. Decision Snapshot

Include:
- 2-7 bullets summarizing what is being decided now
- explicit scope boundary
- what is already fixed vs still open
- why this must be decided before implementation

## 3. Grounding Evidence

### Codebase-present mode
- relevant files or symbols
- current structure summary
- constraints or coupling points
- short code snippets only when they help a decision
- path/line anchors when practical

### No-codebase fallback
- request facts
- user constraints
- success criteria
- non-goals
- assumptions and undefined terms
- optional verified external references
- if the request is still ambiguous, promote that ambiguity into explicit clarification cards

## 4. Decision Questions

- total: **1-30 cards inclusive**
- count cards, not options, notes, or sub-bullets
- if there are fewer natural decisions, do not add filler
- if the user's intent is still unclear, spend more of the budget on clarification cards before forcing strong recommendations
- do not hide overflow questions in appendices, nested sections, or footnotes

Each card must contain:
- `Q-XX`
- question
- why this matters
- grounding evidence
- 2-5 options
- pros and cons per option
- short implementation-direction summary per option
- recommended option when justified
- single-choice control
- `대안제시`

## 5. Cross-Cutting Risks and Open Items

Include:
- risks spanning multiple cards
- missing evidence
- follow-up research needs
- blockers to freezing the spec
- `v2` candidate questions only if the user later asks for another revision

## 6. Decision Summary Generator

Include:
- generate button
- copy button
- visible output area
- deterministic output matching `decision-summary-format.md`

## Ordering rules

- Do not rename the six top-level headings.
- Do not move the summary generator above the decision cards.
- Keep decision capture controls inside section 4 or section 6.
