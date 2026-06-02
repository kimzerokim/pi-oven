---
name: spec-and-review
version: 0.1.0
description: Spec/plan authoring with cross-vendor critic loop via omp internal multi-provider task fan-out (Codex + Zen GLM/Qwen simultaneously)
trigger: "new spec/plan draft OR spec 잡자 / 스펙 잡자 / 기획안 작성 / plan draft / codex review keyword"
alwaysApply: false
---

# spec-and-review

## When to use

Invoke when any of the following is true:

- User requests a new spec, plan, or architectural design document.
- User writes: "spec 잡자", "plan draft", "plan 만들어", "codex review", "brainstorm".
- A design decision requires cross-vendor critique before locking in.
- `writing-plans` or `large-task-delegation` explicitly hands off to this skill.

Do not invoke for doc-only edits, changelog entries, or minor README updates. Those do not need a critic loop.

## Dispatch discipline (main orchestrates, subagents do the work)

Do NOT do this skill's substantive work in the main context. Main's direct-action budget is narrow: 1–2 simple file edits (≤30 LoC) or operational commands (git status / ls / install). ANY multi-file change, 3+ file reads, 200+ LoC, or multi-step investigation/implementation MUST be dispatched to a subagent — main only dispatches, synthesizes, and reviews, never implements inline (see `large-task-delegation` + `subagent-driven-development`). Match the agent to the work (model-fit + role-fit is first-class): cross-vendor critique → `pi-oven:critic`; design pressure-test → `pi-oven:architect`; plan synthesis → `pi-oven:planner`.

## Step 0 — codebase-survey precondition

Before writing any draft, confirm a valid survey exists via 3-tier lookup (in order):

1. **In-session cited**: a survey report was already referenced in this session.
2. **On-disk match**: a file at `docs/harness/surveys/<topic>-survey.md` is dated ≤7 days ago.
3. **Web-loop cycle-N**: the current run is cycle N of an active web-loop and a survey ran in cycle 1.

If none of the three tiers match, dispatch `codebase-survey` first and wait for its report before proceeding. Survey and draft are **never parallelized**.

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
Draft → Critic (multi-provider fan-out) → Synthesize → Gate
```

- **Draft** (Cycle 1): dispatch executor `sonnet` via omp `task`. Exception: ≤5 LoC changes may be drafted inline by main.
- **Critic**: fan out to Codex + Zen GLM/Qwen simultaneously (see Cross-vendor critic).
- **Synthesize**: merge critic outputs; categorize findings as 🔴 / 🟡 / ⚪.
- **Gate**: evaluate cycle outcome (see Gate decision).

## Gate decision

| Outcome | Condition |
|---|---|
| **PASS** | BLOCKER count = 0 AND no structural change introduced in this cycle |
| **CONTINUE** | BLOCKER count ≥ 1 OR structural change present |
| **HALT** | Cycle ≥ 5 AND BLOCKERs remain unresolved |

On HALT, surface all unresolved BLOCKERs to the user and stop. Do not continue iterating silently.

## Cross-vendor critic

pi-oven uses omp internal multi-provider `task` fan-out — not the external codex CLI shell-out used by pi-oven.

Dispatch both critics in parallel:

```
task(prompt: <critic prompt>, model: "codex")
task(prompt: <critic prompt>, model: "zen")   # GLM/Qwen backend
```

Both tasks receive the identical prompt. Collect both responses before synthesizing. A single-provider result is not sufficient for Gate evaluation — if one provider fails, retry once before falling back to a single-provider CONTINUE verdict (not PASS).

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

Every finding from every critic provider must be assigned one of these three categories. Unclassified findings are treated as 🔴 BLOCKER.

---

Pattern loop detail: skill://pi-oven/spec-and-review/references/pattern-loop.md

## Agent Dispatch (omp)

When running spec-and-review inside omp:

- Step 0 (codebase survey precondition): dispatch `pi-oven:explorer`, and `pi-oven:librarian` when external research is needed.
- Step 1 (draft authoring): the main agent leads; consult `pi-oven:architect` for system-design decisions and `pi-oven:document-specialist` for SDK accuracy.
- Step 2 (cross-vendor review): dispatch `pi-oven:critic` as the BLOCKER/NIT quality gate.
- Step 3 (synthesis and acceptance loop): the main agent owns synthesis.
- Experiment-style verification (falsifiability) when relevant: dispatch `pi-oven:analyst`.
