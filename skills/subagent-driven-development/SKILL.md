---
name: subagent-driven-development
version: 0.1.0
description: Execute an implementation plan by dispatching a fresh subagent per task with sequential two-stage review (spec compliance then code quality) and continuous plan-checkbox tracking
trigger: "plan exists + execution begins; user 'execute plan' OR 'implement plan' keyword"
alwaysApply: false
---

# subagent-driven-development

## When to use

Invoke when all three conditions hold:

- A `writing-plans` output exists at `docs/plans/`
- Tasks are mostly independent (no tight sequential coupling)
- Execution happens in the current session (same context, no worktree handoff)

If tasks are tightly coupled or the plan has fewer than 2 tasks, use `executing-plans` inline instead.

## Per-task fresh subagent

Each task gets its own fresh subagent with zero inherited session state.

Controller responsibilities before dispatch:
- Extract the full task text from the plan (paste into the prompt — never tell the subagent to read the plan file)
- Curate architectural context: which modules are relevant, what was completed in prior tasks
- Specify the working directory

The subagent receives only what the controller provides. It must not read the plan file directly.

## Two-stage review order

After implementation, reviews run **sequentially in this fixed order**:

1. **Stage 1 — spec compliance review**: Did the implementer build exactly what was requested, nothing more, nothing less?
2. **Stage 2 — code quality review**: Is the implementation clean, tested, and maintainable?

**Hard rule: code quality review before spec compliance is approved = wrong order.**

Never dispatch Stage 2 before Stage 1 returns approval. The sequence is not configurable.

## Plan-checkbox tracking

The controller — not any subagent — owns checkbox state in the plan file.

- Mark `- [ ]` → `- [x]` only after **both** Stage 1 and Stage 2 reviewers approve.
- Never mark complete while any review has open issues.
- Checkbox state is the single source of truth for progress.

## Implementer status handling

| Status | Controller action |
|---|---|
| `DONE` | Proceed to Stage 1 spec compliance review |
| `DONE_WITH_CONCERNS` | Read concerns; address correctness/scope issues before review; note observations and proceed |
| `NEEDS_CONTEXT` | Provide missing context; re-dispatch same implementer |
| `BLOCKED` | Diagnose: provide context and re-dispatch, escalate to more capable model, break into smaller pieces, or surface to user |

Never force the same model to retry a `BLOCKED` task without changing something.

## Review loop on FAIL

When a reviewer returns FAIL:

1. Same implementer subagent fixes the reported issues
2. Same reviewer re-reviews (never skip re-review)
3. Loop until approved

Do not swap reviewers mid-loop. Do not accept "close enough".

## Model selection

| Task type | Model |
|---|---|
| Mechanical (1–2 files, clear spec, isolated) | cheap |
| Integration (multi-file, pattern matching, debugging) | standard |
| Architecture, design, or review | most capable |

When in doubt, upgrade the model rather than retry the cheaper one.

## Continuous execution

Execute all plan tasks without stopping between them. Do not ask "should I continue?" or emit progress summaries mid-execution. The only valid stops are: `BLOCKED` status that cannot be resolved, genuine ambiguity that prevents progress, or all tasks complete.

## Integration with pi-oven disciplines

This skill is the **orchestration layer only**. It dispatches and sequences subagents. The inner contracts belong to their respective skills:

- `code-quality-discipline` / `tdd-strict` / `fresh-verifier` — run **inside** subagents, not in the controller
- `large-task-delegation` — routing trigger when a single plan task is itself large (3+ files, 200+ LoC)
- `pre-commit-gate` — runs at the commit boundary after the implementer self-review, before Stage 1 review

---

Dispatch prompt templates: skill://pi-oven/subagent-driven-development/references/prompts.md

## Agent Dispatch (omp)

A single-session implementation flow chains dedicated agents:

- Decomposition into atomic tasks: dispatch `pi-oven:planner`.
- Per-task code implementation: dispatch `pi-oven:executor`.
- Evidence-based verification per task: dispatch `pi-oven:verifier`.
- Severity-rated review after implementation: dispatch `pi-oven:code-reviewer`.

The main agent orchestrates only; it does not write code or evaluate completion itself.
