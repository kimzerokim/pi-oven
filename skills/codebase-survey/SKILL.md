---
name: codebase-survey
version: 0.1.0
description: Mandatory pre-planning 8-step deep codebase read via explore subagent before any spec, plan, or fix-start flow
trigger: "5+ file reads required OR spec/plan draft OR fix-start phrases OR 코드서베이, 전수조사, 코드베이스 조사, 호출부 전수 확인"
alwaysApply: false
---

# codebase-survey

## Dispatch discipline (main orchestrates, subagents do the work)

ENFORCEMENT: Main does NOT do this skill's substantive work inline. Main's direct-action budget is narrow — 1–2 simple file edits (≤30 LoC) or operational commands (`git status`, `ls`, install). ANY multi-file change, 3+ file reads, 200+ LoC, or multi-step investigation MUST be dispatched. Main only dispatches, synthesizes, and reviews — it never reads 5+ files or implements inline. (See `large-task-delegation` + `subagent-driven-development`.)

RIGHT-AGENT ROUTING (model-fit + role-fit is first-class; use these exact names): read-heavy survey → `pi-oven:explorer`; causal trace → `pi-oven:tracer`; structural analysis → `pi-oven:analyst`.

## When to use

Trigger this skill when any of the following is true:

- The task requires reading 5 or more files to understand context (main agent reads are expensive; dispatch instead).
- The user requests a new spec, plan, or architectural design.
- The user uses a fix-start phrase: "fix 시작", "버그 수정", "callsite 전수", "상세하게 봐줘", "상세히 봐줘".
- `large-task-delegation` Step 0 invokes this skill explicitly.

Do not skip the survey and jump directly to planning. A plan written without evidence is a guess.

## 8-step checklist

Run all steps in order inside the `explore` subagent. Do not skip steps.

1. **Step 0.5 — Tool & index availability**: Confirm which MCP tools are live (`ast_grep`, `lsp_workspace_symbols`, Context7). Record what is available before choosing a search strategy.
2. **Step 1 — Scope expansion**: Use CRG (`query_graph`, `semantic_search_nodes`, `get_impact_radius`) when configured; otherwise `ast_grep` + `lsp_workspace_symbols` + grep. Map all files touched by the target symbol or module.
3. **Step 2 — Deep read + history**: Read each in-scope file in parallel. Run `git log --oneline -20 -- <file>` on files with recent churn.
4. **Step 3 — Library detection**: Scan imports and `package.json` / `pyproject.toml`. List every external dependency in the scope.
5. **Step 4 — Library knowledge**: For each external dependency, query Context7 first → matching pi-oven-* skill → WebSearch fallback. Record the source used.
6. **Step 5 — Pattern extraction**: Identify naming, error-handling, async, and state-management patterns in the scope. Cite file + line for each.
7. **Step 6 — Type contracts**: List all exported TypeScript types and interfaces. Run `lsp_find_references` on each to map reverse dependencies.
8. **Step 7 — Env vars**: Grep for `process.env` and `import.meta.env`. Cross-reference against `.env.example`. Flag any used-but-undocumented vars.
9. **Step 8 — Report**: Write a structured markdown report to `docs/harness/surveys/<YYYY-MM-DD>-<topic>-survey.md`. Include a verbatim `code-review-graph status` block if CRG is configured.

## Delegate to explore subagent

Main agent role: dispatch only. Do not perform the 8 steps inline.

Dispatch pattern (omp `task` tool, model `sonnet`):

```
task(
  prompt: "Run codebase-survey 8-step checklist for <topic>. Write report to docs/harness/surveys/<date>-<topic>-survey.md.",
  model: "sonnet"
)
```

The subagent returns a 200-word evidence summary in its final message. Main agent reads that summary and the report file before proceeding to planning.

## CRG / grep

- **CRG configured**: use `query_graph` + `semantic_search_nodes` + `get_impact_radius`. Never silently fall back to grep when CRG is configured but returns empty — an empty CRG result is data, not an error.
- **CRG absent**: use `ast_grep_search` → `lsp_workspace_symbols` → grep in that order.
- pi-oven maps CRG roles as follows: `query_graph` → `ast_grep_search`, `semantic_search_nodes` → `lsp_workspace_symbols`, `get_impact_radius` → recursive grep.

## Report path

```
docs/harness/surveys/<YYYY-MM-DD>-<topic>-survey.md
```

Example: `docs/harness/surveys/2026-05-27-auth-session-survey.md`

## Anti-patterns

- **Stale report reuse**: do not reuse a survey older than 7 days without re-running Steps 1–3.
- **Skip survey, plan directly**: planning without a survey produces plans that miss callsites and import chains.
- **Silent grep degradation**: when CRG MCP is configured, falling back to grep without logging the fallback reason corrupts the audit trail.

---

Per-step detail: skill://pi-oven/codebase-survey/references/8-step-checklist.md

## Agent Dispatch (omp)

When running inside omp, push read-only investigation to specialised agents instead of doing it in the main session:

- File/pattern/symbol search: dispatch `pi-oven:explorer`.
- Causal call-graph or execution trace: dispatch `pi-oven:tracer`.
- External SDK or library reference: dispatch `pi-oven:document-specialist`.
- Web/citation research: dispatch `pi-oven:librarian`.

The main agent synthesises results; agents return findings, not edits.
