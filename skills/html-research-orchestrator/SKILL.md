---
name: html-research-orchestrator
version: 0.1.0
description: "Read this skill to produce a research-backed HTML report, citation-backed HTML deliverable, or synthesized HTML output written to a temp directory. Orchestrates document-specialist research + writer synthesis and forbids repo commits of generated artifacts."
---

# html-research-orchestrator

Produce a deterministic, research-backed HTML deliverable by routing work through two dispatch stages. This skill is orchestration-only: no inline deep research and no direct final writing in the main lane.

## Dispatch discipline (main orchestrates, subagents do the work)

ENFORCEMENT: never do this skill's substantive work in the main context. Main's direct-action budget is narrow — 1-2 file simple edits (≤30 LoC) or operational commands (`git status`, `ls`, install). ANY multi-file change, 3+ file reads, 200+ LoC, or multi-step investigation/implementation MUST be dispatched to a subagent. Main only dispatches, synthesizes, and reviews — never implements inline. (See `large-task-delegation` + `subagent-driven-development`.)

RIGHT-AGENT ROUTING (model-fit + role-fit is first-class): external research → `pi-oven:document-specialist`; synthesis + writing → `pi-oven:writer`; visual inspection → `pi-oven:multimodal-looker`.

## Contract

1. External research dispatch with citations.
2. Synthesis dispatch producing a self-contained HTML file in OS temp dir.
3. Strict no-commit rule for generated HTML.
4. Deterministic report sections and recommendation format.

## Stage 1 — External research dispatch (evidence collection)

Dispatch `pi-oven:document-specialist` (or `pi-oven:librarian` when source-code-level references are needed) with explicit citation requirements. The dispatched agent MUST use `web_search` for every external/library/API/framework/doc question — source is truth, training data is history. Never let an agent answer from memory on a factual claim that can be verified against a live source.

- Every claim must cite a source URL obtained via `web_search` or direct source read; claims with no verifiable source are excluded.
- Prefer primary sources (official docs, standards, vendor docs, papers) before secondary commentary.
- Capture publication/update date when available.
- Flag contradictions and confidence per claim (`high|medium|low`).

Required research output shape:

- `Findings[]`: `topic`, `claim`, `evidence`, `source_url`, `source_type`, `updated_at?`, `confidence`.
- `Gaps[]`: unresolved questions or missing primary evidence.
- `Bibliography[]`: deduplicated URLs with short labels.

If citations are missing for a claim, that claim is excluded from synthesis.

## Stage 2 — Synthesis dispatch (self-contained HTML)

Dispatch `pi-oven:architect` (or `pi-oven:writer` for prose-heavy outputs) to generate a single-file, self-contained HTML report from Stage 1 findings.

Output constraints:

- Write to OS temp dir only:
  - prefer `$TMPDIR`
  - fallback `/tmp` (Unix) or `%TEMP%` (Windows)
- Filename format: `research-report-<timestamp>.html`.
- Return absolute path.
- Never write under repository paths.

HTML constraints:

- One standalone `.html` file (no external JS/CSS fetch requirement for core readability).
- Include inline CSS for structure and readability.
- Include deterministic section order exactly as defined in `references/report-sections.md`.
- Include recommendation blocks exactly as defined in `references/recommendation-format.md`.

## Deterministic report structure

The final HTML MUST contain these top-level sections in this exact order:

1. Executive Summary
2. Scope and Method
3. Key Findings
4. Evidence Matrix
5. Risks and Unknowns
6. Recommendations
7. Source Bibliography
8. Appendix (optional, only if non-empty)

No section reordering. No renamed headings.

## No-commit boundary (strict)

Generated HTML is an artifact, not source.

- MUST NOT add generated HTML to git.
- MUST NOT move generated HTML from temp dir into the repository.
- MUST explicitly state: `Generated HTML remains outside repo and is not committed.`

If user asks to version the artifact, provide a separate transformation path (extract reusable data/spec into repo files) but keep raw generated HTML out of commits.

## Recommendation block format

Each recommendation in section 6 must follow this normalized structure:

- `Recommendation ID` (e.g., `REC-01`)
- `Priority` (`High|Medium|Low`)
- `Action`
- `Rationale`
- `Supporting evidence` (citation list)
- `Trade-offs`
- `Next validation step`

Do not emit free-form recommendation prose without this structure.

## Anti-patterns

- Research without source URLs.
- Synthesis from uncited claims.
- Writing output into the repo.
- Committing or proposing commit of generated HTML artifact.
- Non-deterministic section order or ad-hoc heading names.
- Recommendation paragraphs without normalized fields.

## Dispatch defaults

- Research collection: `pi-oven:document-specialist`.
- Source-code provenance or API-surface verification: `pi-oven:librarian`.
- HTML synthesis and visual structuring: `pi-oven:architect`.
- Editorial polish only (no architecture diagrams needed): `pi-oven:writer`.

Main agent orchestrates, validates structure/citations, and returns the temp-path handoff.
