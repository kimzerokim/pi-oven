---
name: large-task-delegation
version: 0.1.0
description: Large task delegation for 3+ file edits, 200+ LoC, 5+ file reads, or multi-stage workflows — main dispatches and reviews only
trigger: "3+ files OR 200+ LoC OR 5+ file reads OR multi-stage workflow OR 큰 작업, 대규모 수정, 여러 파일 변경"
alwaysApply: false
---

# large-task-delegation

## When to use

Any one of these conditions triggers mandatory dispatch:

- 3+ files edited simultaneously (refactor, migration, component rewrite)
- Single commit expected to change 200+ LoC
- 5+ files needing full reads for verification, audit, or spec authoring
- Multi-stage workflow: build + test + Playwright + code-reviewer in sequence
- Single Plan (any of A-N in `docs/plans/*.md`) covering its full scope

Keyword triggers: "큰 작업", "버그 전수조사", "마무리 해줘", "사이클 자율", "plan 쪼개", "Stage 3", "ralph로 돌려", "끝까지 끝내줘".

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

`model="opus"` MUST NOT be specified in any dispatch. Omit model for critic/verifier/planner — this inherits the parent version and avoids version mismatch.

## Parallel dispatch

Fire file-scope-disjoint tasks simultaneously: multiple `task` calls in one response, each with `run_in_background: true`. Main continues and gets notified on completion.

- Max 5 parallel subagents per wave
- Same file region = sequential (one subagent owns it)
- Git push race → subagent handles with `git fetch && rebase && push`

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

Anti-patterns + dispatch template: skill://pi-oven/large-task-delegation/references/dispatch-anatomy.md
