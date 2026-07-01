---
name: large-task-delegation
version: 0.1.0
description: "Read this skill when the task is large enough to require dispatch-first orchestration: multi-file edits, 200+ LoC, 5+ file reads, or a multi-stage workflow. Governs the dispatch-only main role: scope → subagent → review → commit gate."
---

# large-task-delegation

## When to use

Any one of these conditions triggers mandatory dispatch:

- 3+ files edited simultaneously (refactor, migration, component rewrite)
- Single commit expected to change 200+ LoC
- 5+ files needing full reads for verification, audit, or spec authoring
- Multi-stage workflow: build + test + Playwright + code-reviewer in sequence
- Single Plan (any of A-N in `docs/plans/*.md`) covering its full scope

## Main = dispatch + review only

Main MUST NOT implement inline. Multi-file work, 3+ file reads, and 200+ LoC MUST go to a subagent — no exceptions.
Main MUST NOT edit files, read 5+ files inline, or execute multi-stage workflows directly.
Main's role is exactly: **scope estimation → dispatch → three-stage review → commit gate**.
All reads, writes, and test execution happen inside subagents.

**Match the agent to the work (model-fit + role-fit is first-class):** implementation → `pi-oven:executor`; review lane → `pi-oven:code-reviewer` / `pi-oven:critic` / `pi-oven:verifier`.

If mid-execution main reads 5+ files → halt immediately, re-route via `pi-oven:explorer` subagent.
If mid-execution scope expands to 3+ files → halt, restart with `pi-oven:executor` dispatch.

User override accepted with one line ("just do it from main" / "just proceed"). Hard rules survive the override:
mid-execution 5+ file reads → halt + re-route regardless of prior override.

## Routing table

| Phase | Subagent type | Model |
|---|---|---|
| Deep read / file search | `pi-oven:explorer` | `model="sonnet"` (deep) / `model="haiku"` (targeted) |
| Plan authoring | `pi-oven:planner` | omit model (inherits parent version) |
| Critic / code review | `pi-oven:critic` | omit model (inherits parent version) |
| Semantic verification | `pi-oven:verifier` | omit model (inherits parent version) |
| Implementation (substantive) | `pi-oven:executor` | `model="sonnet"` |
| Implementation (mechanical) | `pi-oven:executor` | `model="haiku"` |
| Documentation | `pi-oven:writer` | `model="sonnet"` |
| External / SOTA research | `pi-oven:deep-researcher` | omit model (inherits parent version) |
| REPL data execution / empirical validation | `pi-oven:data-runner` | omit model (inherits parent version) |

`model="opus"` MUST NOT be specified in any dispatch. Omit model for critic/verifier/planner/deep-researcher/data-runner — this inherits the parent version and avoids version mismatch.

## Sub-flow routing for specialized work types

Within a large task, route by work type before dispatching `pi-oven:executor` directly:

- Investigation reveals a root-cause bug → route via `systematic-debugging` (tracer/debugger) before fixing.
- Scope is refactoring or architecture → route via `improve-codebase-architecture` (survey/candidates) before implementing.
- Otherwise → dispatch `pi-oven:executor` directly.

## Parallel dispatch

Fire file-scope-disjoint tasks simultaneously: batch the widest clean wave you can describe instead of dribbling out independent tasks one at a time.

- Default packing target: 8-12 parallel subagents per wave when scopes are disjoint and prompts are self-contained
- If omp/runtime/provider admits fewer concurrently, that smaller ceiling wins — queue the next dependency-ready wave immediately instead of pretending pi-oven can force more workers
- Same file region, shared generated artifact, or review dependency = sequential
- Git push race → subagent handles with `git fetch && rebase && push`

**irc coordination (parallel executor waves):** When two or more `pi-oven:executor` subagents are running in the same wave, use irc to coordinate before they write. At wave start, each executor calls `irc({op:"list"})` to see which files siblings have claimed. Before touching a file, an executor sends `irc({op:"send", to:"<sibling-name>", message:"claiming <file-path> — confirm no overlap"})` and awaits the reply. If a collision is detected, the later executor halts and reports back to main for re-sequencing. irc is auto-injected — do not add it to tools: frontmatter.

## Memory — recall before dispatch, retain after

Before dispatching any subagent on a task meeting the trigger threshold, call `recall(query="prior delegation outcomes and lessons for tasks of this type")` to surface past delegation results, known failure modes, and scope-expansion patterns. Seed the dispatch prompt's **Task body** with any relevant recall findings so subagents benefit from prior cycle learning.

After the delegation wave completes and the review stage produces a verdict, call `retain(items=[{content:"<delegation outcome + key lessons>", context:"large-task-delegation"}])` to persist the result for future cycles. Retain on both PASS and BLOCK verdicts — blocked outcomes carry the most useful lessons.

## Dispatch prompt anatomy

Every dispatch prompt must include all of the following sections (60-150 lines for planner/critic/verifier; 100-220 lines for executor). Terse prompts produce shallow work.

1. **Task** — one sentence describing the outcome
2. **Required reading** — explicit file paths; survey report path when Step 0 ran
3. **Scope** — file paths, line ranges, DO-NOT-MODIFY paths
4. **Branch contract verify** — `git branch --show-current` must match session branch contract
5. **Task body** — inlined ≤120 lines; exact signatures, edge cases, test names + assertion shapes for sonnet
6. **Rules block** — literal copy mandatory (reference alone is not sufficient — fresh agents do not auto-read SKILL.md):
   - Anti-self-verification boilerplate
   - Production-code-first boilerplate
   - Code-quality-discipline boilerplate
   - TDD strict (red-green-refactor, failing test before impl)
   - Plan scope discipline (no scope expansion without halt)
   - Halt conditions → user-queue entry
   - Context7 mandate (library docs before implementing)
   - Pre-commit gate sequence (Gate 0–5)
   - Race-condition awareness (parallel sibling file scopes)
   - Regression recall inject (verbatim, 200-char cap)
   - CRG refresh between plans
   - Commit convention (English conventional commits, no Co-Authored-By)
7. **Output contract** — ≤100 words; expected return format on success and on BLOCKED

## Step 0b = deep-researcher and data-runner augmentation

When the task involves unfamiliar external libraries, SOTA techniques, or academic patterns, dispatch `pi-oven:deep-researcher` before the executor wave. Feed its synthesis (citations + key findings) into the executor dispatch prompt's **Task body**. This runs in parallel with Step 0 survey when the domain is known; runs first when the domain is novel.

When the task involves empirical metrics, performance baselines, or numeric validation, dispatch `pi-oven:data-runner` after the executor wave completes but before the review stage. `pi-oven:data-runner` runs REPL-based validation and returns numeric evidence that the review lane can evaluate against spec claims.

## Step 0 = codebase-survey precondition

Before dispatching any executor or planner on a task ≥3 files / ≥200 LoC / 5+ file reads:

1. Check if a `codebase-survey` report is already in the dispatch context.
2. If absent → dispatch `codebase-survey` first; halt this skill pending survey completion.
3. After survey saves report → proceed with report path in `Required reading:`.

Halt entry if survey skipped: `Q-SURVEY-MISSING`.

## Override handling

User override ("just do it from main", "proceed with haiku", "write the spec first") accepted immediately.
Hard rules that survive any override:
- Mid-execution 5+ file reads → halt + re-route
- Mid-execution scope expands to 3+ files → halt + re-route
- Re-estimate after every halt; do not silently widen scope under main

---

Anti-patterns + dispatch template: skill://pi-oven:large-task-delegation/references/dispatch-anatomy.md
