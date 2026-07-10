---
name: pov:spec-and-review
version: 0.1.0
description: "Read this skill when drafting a new spec, plan, or architectural design document, or when a design needs current-session critic pressure before lock-in. Runs one fresh same-provider-family critic by default and widens to same-family multi-lane review only when risk justifies it."
---

# spec-and-review

## When to use

Invoke when any of the following is true:

- User requests a new spec, plan, or architectural design document.
- User writes: "spec 잡자", "plan draft", "plan 만들어", "brainstorm".
- A design decision requires critic pressure before locking in.
- `writing-plans` or `large-task-delegation` explicitly hands off to this skill.

Do not invoke for doc-only edits, changelog entries, or minor README updates. Those do not need a critic loop.

## Dispatch discipline (main orchestrates, subagents do the work)

Do NOT do this skill's substantive work in the main context. Main's direct-action budget is narrow: 1–2 simple file edits (≤30 LoC) or operational commands (git status / ls / install). ANY multi-file change, 3+ file reads, 200+ LoC, or multi-step investigation/implementation MUST be dispatched to a subagent — main only dispatches, synthesizes, and reviews, never implements inline (see `large-task-delegation` + `subagent-driven-development`). Match the agent to the work (model-fit + role-fit is first-class): critic review → `pi-oven:critic`; design pressure-test → `pi-oven:architect`; plan synthesis → `pi-oven:planner`.

## Step 0 — codebase-survey precondition

Before writing any draft, confirm a valid survey exists via 3-tier lookup (in order):

1. **In-session cited**: a survey report was already referenced in this session.
2. **On-disk match**: a file at `docs/harness/surveys/<topic>-survey.md` is dated ≤7 days ago.
3. **Web-loop cycle-N**: the current run is cycle N of an active web-loop and a survey ran in cycle 1.

If none of the three tiers match, dispatch `codebase-survey` first and wait for its report before proceeding. Survey and draft are **never parallelized**. Step 0 MUST use `ast_grep` to analyze existing patterns before drafting.

For remediation-wave survey/research inputs, the accepted artifact standard is validator-backed rather than reviewer taste: surveys need `## Scope`, an implementation-facing evidence section (for example `## Findings`), explicit unknowns, exact implementation-file anchors plus at least one `tests/` anchor; research memos need `## Scope`, `## Executive summary`, a `## Local evidence` or equivalent local change-surface section, explicit unknowns, exact local `file:line` anchors, and official-source links whenever external guidance is cited.

## Step -1 — brainstorming default ON

Brainstorming runs before the first draft unless one of two skip conditions holds:

- **(A)** User explicitly writes "브레인스토밍 스킵" as a standalone command.
- **(B)** ALL THREE of the following are simultaneously true: the task is trivial, a complete spec is already written and pre-specified, and no new capability is introduced.

When skipped under condition (B), record the skip evidence in the critic verdict file before proceeding:

```
Brainstorming skip: condition B
Evidence: [trivial=true | pre-specified=<path> | no-new-capability=true]
```

Ambiguous cases default to brainstorming ON.

## Pattern loop

Repeat until Gate decides PASS or HALT:

```
Draft → Critic → Synthesize → Gate
```

- **Draft** (Cycle 1): dispatch `pi-oven:planner` or `pi-oven:executor` via omp `task`. ENFORCEMENT: Main dispatches a subagent for the draft research and authoring. Main MUST NOT research or draft the spec inline. Exception: ≤5 LoC changes may be drafted inline by main.
- **Critic**: dispatch one fresh `pi-oven:critic` from the current session provider family by default. Widen to same-family parallel critics only when the review is high-risk and an independent disagreement check is justified (see Current-session provider-family critic).
- **Synthesize**: merge critic outputs; categorize findings as 🔴 / 🟡 / ⚪.
- **Gate**: evaluate cycle outcome (see Gate decision).

## Gate decision

| Outcome | Condition |
|---|---|
| **PASS** | BLOCKER count = 0 AND no structural change introduced in this cycle |
| **CONTINUE** | BLOCKER count ≥ 1 OR structural change present |
| **HALT** | Cycle ≥ 5 AND BLOCKERs remain unresolved |

On HALT, surface all unresolved BLOCKERs to the user and stop. Do not continue iterating silently.

## Current-session provider-family critic

pi-oven uses internal omp `task` fan-out for critic passes. Do not treat this as an external CLI shell-out workflow.

Default path: dispatch one fresh critic pass from the current-session provider family and synthesize that verdict.

High-risk exception: widen to two independent critic passes from the same provider family only when the change needs an explicit disagreement check. Both critics receive the identical prompt. Collect every configured same-family critic response before synthesizing. If one of the widened critics fails, retry that lane once before collapsing back to the single-critic path.

## Verdict file convention

| Cycle | Path |
|---|---|
| 1 | `docs/plans/<name>-critic-review.md` |
| N ≥ 2 | `docs/plans/<name>-critic-review-N.md` |

Cycle N ≥ 2 header must include:

```
Cycle: N
Previous: docs/plans/<name>-critic-review-<N-1>.md
BLOCKERs resolved since N-1: <count>
```

## Synthesize categorization

| Symbol | Meaning |
|---|---|
| 🔴 BLOCKER | Must be resolved before Gate can pass. Structural flaw, missing contract, security gap. |
| 🟡 NIT | Should be fixed but does not block Gate. Naming, clarity, minor consistency. |
| ⚪ PUSH-BACK | Reviewer opinion that conflicts with a locked prior decision. Log but do not act. |

Every finding from every critic response must be assigned one of these three categories. Unclassified findings are treated as 🔴 BLOCKER.

---

Pattern loop detail: skill://pov:spec-and-review/references/pattern-loop.md

## Agent Dispatch (omp)

When running spec-and-review inside omp:

**Memory (Hindsight).** At flow entry, before any agent dispatch: `recall({query: "prior specs decisions <topic>"})` to surface relevant prior decisions, past spec outcomes, and rejected alternatives. After Gate PASS (plan approved): `retain({items: [{content: "<spec-name> approved — key decisions: <summary>", context: "spec-and-review"}]})`. If `memory.backend` is not configured, skip gracefully without error.

- Step 0 (codebase survey precondition): dispatch `pi-oven:explorer`, and `pi-oven:librarian` when external research is needed.
- Step 0b (novel domain / SOTA research): dispatch `pi-oven:deep-researcher` for academic papers, external library research, or SOTA landscape — runs alongside librarian, not as a replacement.
- Step 1 (draft authoring): dispatch `pi-oven:planner` or `pi-oven:executor` for draft authoring; main scopes and reviews the loop, and consults `pi-oven:architect` for system-design decisions. If the draft will reference external SDK/framework APIs, dispatch `pi-oven:document-specialist` BEFORE writing the API-surface section to verify signatures and version compatibility — do not draft external API surfaces from memory.
- Step 2 (same-provider-family critic review): dispatch one fresh `pi-oven:critic` by default, and widen to same-family parallel critics only for high-risk disagreement checks.

**irc coordination at critic fan-out.** When dispatching the optional parallel critic review inside the current session provider family, each critic subagent must: (1) call `irc(op:"list")` to discover sibling peer ids; (2) broadcast confirmed P0/P1 findings via `irc(op:"send", to:"all", message:"P0 finding confirmed in <file>: <summary>", awaitReply:false)` so the other critics and the orchestrator are immediately notified. The orchestrator awaits all critic replies before synthesizing — do not poll; await the task results directly.

- Step 3 (synthesis and acceptance loop): the main agent owns synthesis.
- Experiment-style verification (falsifiability) when relevant: dispatch `pi-oven:analyst`.
- Empirical metric / performance spec validation: dispatch `pi-oven:data-runner` to confirm numeric claims before locking the spec.

**External-research trigger heuristic.** Dispatch `pi-oven:librarian` (Step 0) or `pi-oven:document-specialist` (Step 1) when the survey or draft involves an external API, SDK, third-party service, open-source library, or external data source whose behavior is not adequately documented in the codebase. When the codebase already pins the behavior (existing wrappers, recorded contracts, in-repo docs), no external research is needed.
