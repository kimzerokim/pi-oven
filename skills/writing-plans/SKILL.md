---
name: writing-plans
version: 0.1.0
description: Transform an approved spec into a bite-sized, placeholder-free implementation plan ready for subagent dispatch
trigger: "post-brainstorming spec approved OR explicit keyword: plan it / write plan / plan만들어 / 계획 세워줘 / 구현 계획"
alwaysApply: false
---

# writing-plans

## When to use

Two conditions independently trigger this skill:

- `brainstorming` reaches its terminal state and the user approves the spec — `brainstorming` hands off directly to `writing-plans`
- User writes any of: "plan it", "write plan", "write a plan", "plan만들어", "plan 만들어"

Do not invoke this skill without an approved spec in `docs/specs/`. If no spec exists, redirect to `brainstorming` first.

## Dispatch discipline (main orchestrates, subagents do the work)

Do NOT do this skill's substantive work in the main context. Main's direct-action budget is narrow: 1–2 simple file edits ≤ 30 LoC, or operational commands (`git status`, `ls`, install). ANY multi-file change, 3+ file reads, 200+ LoC, or multi-step investigation/implementation MUST be dispatched to a subagent — main only dispatches, synthesizes, and reviews; it never implements inline. (See `large-task-delegation` + `subagent-driven-development`.)

Route to the RIGHT agent (model-fit + role-fit is first-class; use these exact `pi-oven:<role>` names): plan authoring from survey evidence → `pi-oven:planner`; architecture trade-offs → `pi-oven:architect`.

## Plan document header

Every plan file opens with this exact header block:

```markdown
## Goal

<one sentence stating what the feature does and why it matters>

## Architecture

<prose or bullet list: key modules, data flow, boundaries — no implementation code yet>

## Tech Stack

<language, runtime, frameworks, libraries in scope for this plan>
```

No plan is valid without all three sections populated with concrete content.

## Bite-sized step granularity

Each step = one action a developer can complete in 2–5 minutes. Steps are never compound.

Canonical examples of correctly-sized steps:
- "Write the failing test for `parseConfig` in `src/config.test.ts`"
- "Run `bun test src/config.test.ts` and confirm it exits non-zero"
- "Implement `parseConfig` in `src/config.ts` — minimum code to pass the test"
- "Run `bun test src/config.test.ts` and confirm it exits zero"
- "Commit with message `feat: add parseConfig`"

Compound steps ("Write the test and implement the function") are forbidden. Split them.

## No-placeholder forbidden patterns

The following strings are banned in any plan file:

| Pattern | Why |
|---|---|
| `TBD` | Defers decisions the planner must make now |
| `TODO` (in step body) | A step that is not yet specified is not a step |
| "implement later" | Undefined scope leaks into the executor |
| "fill in details" | Forces the executor to invent requirements |
| "Add appropriate error handling" | "Appropriate" is undefined; name the errors explicitly |
| "Similar to Task N" without repeating the code | The executor must not hunt for context |
| References to types not defined in the plan or codebase | Executor cannot compile against a phantom type |

If a decision is genuinely open, resolve it in the plan or add an explicit `brainstorming` Q entry before writing the plan.

## Task structure

Each task in the plan follows this exact shape:

```markdown
### Task N — <verb phrase describing the outcome>

**Files**
- Create: `<exact/path/from/repo/root.ext>`
- Modify: `<exact/path/from/repo/root.ext>`
- Test: `<exact/path/from/repo/root.test.ext>`

**Steps**

- [ ] <step 1 — one action, 2–5 min>
- [ ] <step 2>
- [ ] ...

**Code** (complete — no ellipsis, no stubs)

\```typescript
// full implementation here — every function, every import
\```

**Expected output**

\```
$ <exact command>
<exact expected stdout/stderr>
\```
```

Rules:
- Code blocks contain the full implementation. Never use `// ... rest of code` or `// unchanged`.
- Expected output blocks show the exact command and expected terminal output.
- Paths are repo-root-relative and exact — no globs, no placeholders.

## Self-Review checklist (3 items)

Before writing the plan file, verify all three:

- [ ] **Spec coverage** — every Goal in the spec maps to at least one task in the plan
- [ ] **Placeholder scan** — zero occurrences of TBD, TODO (in step bodies), "fill in", "implement later", "similar to Task N", "appropriate error handling"
- [ ] **Type consistency** — every type referenced in code blocks is either imported from an existing module or defined earlier in the same plan

A plan that fails any check must be revised before it is written to disk.

## Execution Handoff

After writing the plan file, present both options to the user:

**Option 1 — subagent-driven-development (recommended)**
Dispatch a `task` omp primitive for each independent task group. Each subagent receives the plan file path, its assigned task range, and the repo root. Subagents run in parallel where task dependencies allow.

**Option 2 — executing-plans (inline)**
The current agent works through the plan sequentially, checking off each step. Use when subagent dispatch overhead exceeds the task size (single-task plans, < 50 LoC total).

Default to Option 1 unless the plan contains only one task.

## Plan path

```
docs/plans/YYYY-MM-DD-<feature>.md
```

Example: `docs/plans/2026-05-27-note-taking-app.md`

This path is the pi-oven project override. Do not use `docs/superpowers/plans/` or any other prefix.

---

Header + task template: skill://pi-oven/writing-plans/references/template.md

## Agent Dispatch (omp)

When authoring an implementation plan inside omp:

- Requirements gathering and ambiguity resolution: dispatch `pi-oven:metis` **once** for one-shot pre-analysis only — intent classification plus a few impact-ordered seed questions feeding the plan (it may in turn spawn `pi-oven:explorer` / `pi-oven:librarian` / `pi-oven:document-specialist`). The interactive multi-round convergence interview, when one is needed, is `brainstorming` run inline by the main agent — never delegated to `pi-oven:metis`.
- Codebase context confirmation: dispatch `pi-oven:explorer`.
- Atomic-task decomposition: dispatch `pi-oven:planner`.
- Architectural risk and migration impact review: dispatch `pi-oven:architect`.
