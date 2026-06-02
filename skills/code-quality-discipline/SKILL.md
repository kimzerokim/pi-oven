---
name: code-quality-discipline
version: 0.1.0
description: DRY / YAGNI / KISS + Deletion test + Depth-before-width + Immutability principles — enforced by default on ALL code work: any code change, bug fix, refactor, or TDD cycle
trigger: "tool_call.toolName in (Edit, Write, MultiEdit, NotebookEdit, ast_grep_replace) OR 코드 변경, 코드 수정, 버그 수정, 버그 잡기, bug fix, 리팩토링, refactor, TDD, 테스트 주도 개발, 코드 품질 점검, DRY 체크, YAGNI 체크"
alwaysApply: true
---

# code-quality-discipline

## When to use

Fires on every code-write tool call — `Edit`, `Write`, `MultiEdit`, `ast_grep_replace` — regardless of change size. No N-file threshold. A 2-line fix carries the same obligation as a 200-line feature. The three self-questions take seconds; skipping them costs hours.

## Dispatch discipline (main orchestrates, subagents do the work)

Main does NOT do this skill's substantive work inline. Main's direct-action budget is narrow: 1–2 file simple edits ≤ 30 LoC, or operational commands (`git status`, `ls`, install). ANY multi-file change, 3+ file reads, 200+ LoC, or multi-step investigation/implementation MUST be dispatched to a subagent — main only dispatches, synthesizes, and reviews, never implements inline (see `large-task-delegation` + `subagent-driven-development`). Route by model-fit + role-fit (use these exact names): cleanup/refactor → `pi-oven:code-simplifier`; correctness/quality review → `pi-oven:code-reviewer`.

## Core principles

- **DRY** — identical logic must not exist in two places. Find it before writing it.
- **YAGNI** — implement only what the current request requires. Future needs get future code.
- **KISS** — the simplest expression that satisfies the requirement is the correct one.
- **Deletion test** — a new module is justified only when N ≥ 2 distinct callers already exist. Fewer callers = hypothetical seam = do not create.
- **Immutability** — always return a new object; never mutate in place. Prevents hidden side effects, enables safe concurrency. (ECC coding-style.md §Immutability)

## 3 self-questions before writing code

Before writing code, answer the following 3 questions explicitly:

1. **DRY**: Does the same code already exist in the codebase? Verify with `grep -rn` + CRG `semantic_search_nodes`.
2. **YAGNI**: Is this truly needed right now? Derive the minimum from the user's request.
3. **KISS**: Is this the simplest expression? Is a shorter equivalent possible?

Answer all three out loud in the working notes before the first Edit or Write call. A silent answer does not count.

## Deletion test (new module gate)

Before creating a new file / module / helper:

- Confirm the existing sister-module interface (`grep` + body read) cannot absorb the logic.
- If it can be added to an existing module, add it there (default path).
- A new module is approved **only** when:
  > "If complexity reappears across N callers after deletion, the module justified its existence through depth." (harness-share.md §32)
- **N ≥ 2 callers, file paths cited** → OK to create.
- **N < 2** → "hypothetical seam" → do not create. Fold into the nearest existing module.

## Post-write checklist (7 items)

Run before commit or handoff:

- [ ] No duplicated responsibility (DRY)
- [ ] Nothing added beyond the user's request (YAGNI)
- [ ] Shortest expression reviewed (KISS)
- [ ] New module passes Deletion test (N ≥ 2 callers cited)
- [ ] Depth = interface properties validated (no shallow 1:1 wrappers)
- [ ] External lib via Context7 / internal pattern cited
- [ ] Deepened module: obsolete shallow unit tests deleted

## Trade-offs

**Refactor vs YAGNI** — refactoring existing duplication is not a YAGNI violation. YAGNI blocks adding speculative abstractions, not removing confirmed duplication.

**Design It Twice** — applies only to large structural changes (3+ interface candidates). Small helpers use one design. Running Design It Twice on every helper is itself a YAGNI violation.

**File size** — 200–400 lines typical, 800 lines max (ECC coding-style.md §File Organization). A file approaching 800 lines is a signal to extract, not an excuse to keep growing.

---

Deep rationale + examples: skill://pi-oven/code-quality-discipline/references/principles.md

## Agent Dispatch (omp)

In an omp session, push quality checks to specialised agents:

- Severity-rated code review (SOLID, regression surface): dispatch `pi-oven:code-reviewer`.
- Deletion-first simplification (behavior-preserving): dispatch `pi-oven:code-simplifier`.
- Security audit when sensitive surfaces are touched (OWASP, supply chain): dispatch `pi-oven:security-reviewer`.
- Quantitative metrics analysis when needed: dispatch `pi-oven:analyst`.

Outside omp the main agent runs the same checklist inline.
