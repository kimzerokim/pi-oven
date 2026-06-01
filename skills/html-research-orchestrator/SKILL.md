---
name: html-research-orchestrator
version: 0.1.0
description: Reusable orchestrator for research-backed, self-contained HTML deliverables. Dispatches external research with citations, synthesizes deterministic report sections, writes HTML to OS temp dir, and forbids repo commits of generated artifacts. Triggers — html report, research html, synthesize html output, citation-backed report, temp-dir html deliverable, "HTML 리포트", "조사 보고서 HTML".
trigger: "request for research-backed HTML deliverable or reusable HTML report generation flow"
alwaysApply: false
---

# html-research-orchestrator

Produce a deterministic, research-backed HTML deliverable by routing work through two dispatch stages. This skill is orchestration-only: no inline deep research and no direct final writing in the main lane.

## Contract

1. External research dispatch with citations.
2. Synthesis dispatch producing a self-contained HTML file in OS temp dir.
3. Strict no-commit rule for generated HTML.
4. Deterministic report sections and recommendation format.

## Stage 1 — External research dispatch (evidence collection)

Dispatch `pi-oven:document-specialist` (or `pi-oven:librarian` when source-code-level references are needed) with explicit citation requirements:

- Every claim must cite a source URL.
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
