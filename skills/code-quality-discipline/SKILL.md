---
name: pov:code-quality-discipline
version: 0.1.0
description: "Read this skill before writing or modifying code, and on any bug fix, refactor, or TDD cycle. Enforces DRY / YAGNI / KISS / Deletion test / Immutability before every code write."
---

# code-quality-discipline

## When to use

Fires on every code-write tool call — `edit`, `write`, `ast_grep_replace` — regardless of change size. No N-file threshold. A 2-line fix carries the same obligation as a 200-line feature. The three self-questions take seconds; skipping them costs hours.

## Dispatch discipline (main orchestrates, subagents do the work)

Main does NOT do this skill's substantive work inline. Main's direct-action budget is narrow: 1–2 file simple edits ≤ 30 LoC, or operational commands (`git status`, `ls`, install). ANY multi-file change, 3+ file reads, 200+ LoC, or multi-step investigation/implementation MUST be dispatched to a subagent — main only dispatches, synthesizes, and reviews, never implements inline (see `large-task-delegation` + `subagent-driven-development`). Route by model-fit + role-fit (use these exact names): cleanup/refactor → `pov:code-simplifier`; correctness/quality review → `pov:code-reviewer`.

## Core principles

- **DRY** — identical logic must not exist in two places. Find it before writing it.
- **YAGNI** — implement only what the current request requires. Future needs get future code.
- **KISS** — the simplest expression that satisfies the requirement is the correct one.
- **Deletion test** — a new module is justified only when N ≥ 2 distinct callers already exist. Fewer callers = hypothetical seam = do not create.
- **Immutability** — always return a new object; never mutate in place. Prevents hidden side effects, enables safe concurrency. (ECC coding-style.md §Immutability)

## 3 self-questions before writing code

Before writing code, answer the following 3 questions explicitly:

1. **DRY**: Does the same code already exist in the codebase? Verify with `search` + `lsp references` + CRG `semantic_search_nodes`.
2. **YAGNI**: Is this truly needed right now? Derive the minimum from the user's request.
3. **KISS**: Is this the simplest expression? Is a shorter equivalent possible?

Answer all three out loud in the working notes before the first `edit` or `write` call. A silent answer does not count.

## Deletion test (new module gate)

Before creating a new file / module / helper:

- Confirm the existing sister-module interface (`search` + `lsp references` + body read) cannot absorb the logic.
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

Deep rationale + examples: skill://pov:code-quality-discipline/references/principles.md

## Agent Dispatch (omp)

In an omp session, push quality checks to specialised agents:

- Severity-rated code review (SOLID, regression surface): dispatch `pov:code-reviewer`.
- Deletion-first simplification (behavior-preserving): dispatch `pov:code-simplifier`.
- Security audit when sensitive surfaces are touched (OWASP, supply chain): dispatch `pov:security-reviewer`.
- Quantitative metrics analysis when needed: dispatch `pov:analyst`.

Outside omp the main agent runs the same checklist inline.

**Refactor-type routing.** DRY/YAGNI/KISS cleanup (duplication removal, local simplification) → `pov:code-simplifier`. Architectural refactors (shallow→deep deepening, seam consolidation, coupling reduction) → the `improve-codebase-architecture` skill; its Step 0 classifies the intent and routes.
