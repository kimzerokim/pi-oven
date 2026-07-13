---
name: pov:subagent-driven-development
version: 0.1.0
description: "Read this skill when executing a written plan by dispatching fresh subagents per task. Orchestrates fresh subagents per task with two-stage review and plan-checkbox tracking."
---

# subagent-driven-development

## When to use

Invoke when all three conditions hold:

- A `writing-plans` output exists at `docs/plans/`
- Tasks are mostly independent (no tight sequential coupling)
- Execution happens in the current session (same context, no worktree handoff)

If tasks are tightly coupled or the plan has fewer than 2 tasks, use inline sequential execution instead.

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
| `NEEDS_CONTEXT` | Provide missing context; dispatch a fresh `pov:executor` process with the prior report and added context |
| `BLOCKED` | Diagnose: change the context or scope, then dispatch a fresh same-role process with the prior report; otherwise break the task down or surface it to the user |

Never claim to reuse a subagent process. Every retry is a fresh process of the same role with the prior verdict/report and changed context re-injected.

## Review loop on FAIL

When a reviewer returns FAIL:

1. A fresh `pov:executor` process receives the prior implementation context and reviewer verdict, then fixes the reported issues
2. A fresh process of the same reviewer role receives the prior verdict and updated diff, then re-reviews (never skip re-review)
3. Loop until approved

Do not swap reviewers mid-loop. Do not accept "close enough".

## Role selection

| Task type | Role/process shape |
|---|---|
| Mechanical (1–2 files, clear spec, isolated) | fresh `pov:executor` with a narrow assignment |
| Integration (multi-file, pattern matching, debugging) | fresh `pov:executor`, or `pov:debugger` when root cause is unknown |
| Architecture, design, or review | `pov:architect`, `pov:planner`, or the fixed reviewer role |

Runtime `task.agentModelOverrides` owns model choice; authored guidance selects roles and scopes assignments.

## Continuous execution

Execute all plan tasks without stopping between them. Do not ask "should I continue?" or emit progress summaries mid-execution. The only valid stops are: `BLOCKED` status that cannot be resolved, genuine ambiguity that prevents progress, or all tasks complete.

## Integration with pi-oven disciplines

This skill is the **orchestration layer only**. It dispatches and sequences subagents. The inner contracts belong to their respective skills:

- `code-quality-discipline` / `tdd-strict` / `fresh-verifier` — run **inside** subagents, not in the controller
- `large-task-delegation` — routing trigger when a single plan task is itself large (3+ files, 200+ LoC)
- `pre-commit-gate` — runs at the commit boundary after the implementer self-review, before Stage 1 review

---

Dispatch prompt templates: skill://pov:subagent-driven-development/references/prompts.md

## Agent Dispatch (omp)

A single-session implementation flow chains dedicated agents:

- Decomposition into atomic tasks: dispatch `pov:planner`.
- Per-task code implementation: dispatch `pov:executor`.
- Evidence-based verification per task: dispatch `pov:verifier`.
- Severity-rated review after implementation: dispatch `pov:code-reviewer`.

The main agent orchestrates ONLY: it MUST NOT implement inline. Any multi-file change, 3+ file reads, or 200+ LoC MUST go to a subagent — main may not absorb the work itself, and may not self-evaluate completion.

**Right-agent routing (role-fit is first-class):** match the agent to the work — one FRESH `pov:executor` per task; two-stage review via `pov:verifier` then `pov:code-reviewer`.
