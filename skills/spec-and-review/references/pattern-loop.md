# spec-and-review — Pattern Loop Detail

Source: spec-and-review (harness-share.md §22 + §22.5), ported to pi-oven omp primitives.

---

## Per-cycle dispatch table

| Cycle | Draft agent | Critic dispatch | Synthesize | Gate |
|---|---|---|---|---|
| 1 | `task(...)` — full draft by a fresh draft subagent | Default: one fresh same-provider-family critic; high-risk exception: widen to same-family critics in parallel | Merge + categorize | PASS / CONTINUE / HALT |
| 2 | `task(...)` — revise with cycle-1 verdict | Default: one fresh same-provider-family critic; high-risk exception: widen to same-family critics in parallel | Merge + categorize | PASS / CONTINUE / HALT |
| N ≥ 2 | Same as cycle 2; include cycle N-1 verdict in prompt | Default: one fresh same-provider-family critic; high-risk exception: widen to same-family critics in parallel | Merge + categorize | PASS / CONTINUE / HALT |
| ≥ 5 | Same | Same | Same | HALT if BLOCKERs remain |

Main agent role in all cycles: dispatch and collect only. Main does not write draft content inline beyond ≤5 LoC exceptions.

---

## Cycle 1 — Draft dispatch

<!-- pi-oven-contract:task-example -->
```ts
task({
  agent: "pov:planner",
  tasks: [{
    id: "draft-spec",
    description: "Draft the cycle-1 specification",
    assignment: "Draft a spec for <topic>. Use survey report <path>. Write to docs/plans/<name>.md.",
  }],
});
```

After the draft subagent completes, main reads `docs/plans/<name>.md` before dispatching critics.

---

## Cycle ≥ 2 — Revise dispatch

The revise prompt must include three elements:

1. **Cycle N-1 verdict path**: the full path to the previous critic review file.
2. **Categorized edit list**: each 🔴 BLOCKER listed by ID with the required resolution.
3. **Survey path**: the original survey report path (unchanged from cycle 1).

<!-- pi-oven-contract:task-example -->
```ts
task({
  agent: "pov:planner",
  tasks: [{
    id: "revise-spec",
    description: "Revise the specification for cycle N",
    assignment: `Revise docs/plans/<name>.md for cycle N.
Use verdict docs/plans/<name>-critic-review-<N-1>.md and survey docs/harness/surveys/<date>-<topic>-survey.md.
Resolve B-1: <description> → <required resolution>.
Resolve B-2: <description> → <required resolution>.
Write the revised spec in place without changing its filename.`,
  }],
});
```

Do not pass the full cycle N-1 document verbatim into the prompt — pass the path and the extracted BLOCKER list only. This keeps the context window predictable.

---

## Critic prompt skeleton

Send this prompt to the fresh critic dispatched by default, or to each critic in the widened same-provider-family lane. Substitute `<...>` fields. Do not truncate the IMPORTANT directive.

```
IMPORTANT: You are a brutally honest design critic. Your job is to find
flaws, not to validate. If the design is good, say so briefly and move on.
Do not soften findings to be polite. Do not invent praise.

---

CONTEXT
Project: pi-oven
Spec: docs/plans/<name>.md
Cycle: <N>
Survey: docs/harness/surveys/<date>-<topic>-survey.md (attached below)

LOCKED PRIOR DECISIONS
These decisions are final and must not be re-litigated. Push-back on these
items is recorded as ⚪ PUSH-BACK and does not block Gate.
<list each locked decision as a numbered item>

DESIGN UNDER REVIEW
<full text of docs/plans/<name>.md>

---

Output a numbered list. For each finding:
  1. Category: BLOCKER | NIT | PUSH-BACK
  2. Section: the heading or line reference in the design
  3. Finding: one sentence describing the flaw or concern
  4. Resolution: one sentence describing what must change (BLOCKER/NIT) or why you disagree (PUSH-BACK)

If you find no issues, output: "No findings. Design is structurally sound."
Do not add a summary paragraph. Do not add a preamble. Start with item 1.
```

---

## omp task fan-out routing diagram

```
                    ┌─────────────────────────────┐
                    │         main agent           │
                    │  (orchestrate, never draft)  │
                    └────────────┬────────────────┘
                                 │
              ┌──────────────────▼──────────────────┐
              │         draft subagent               │
              │        task(...) — cycle 1           │
              │   writes docs/plans/<name>.md        │
              └──────────────────┬──────────────────┘
                                 │  draft complete
              ┌──────────────────▼──────────────────┐
              │       same-family critic lane        │
              │                                      │
              │   default: critic A                 │
              │   high-risk widen: critic A + B     │
              │                                      │
              │      findings from required lane(s) │
              └──────────────────┬──────────────────┘
                                 │  required lane(s) complete
              ┌──────────────────▼──────────────────┐
              │            synthesize                │
              │  merge findings → 🔴 / 🟡 / ⚪      │
              │  write docs/plans/<name>-critic-    │
              │  review[-N].md                      │
              └──────────────────┬──────────────────┘
                                 │
              ┌──────────────────▼──────────────────┐
              │               gate                   │
              │  BLOCKER=0 + no structural → PASS    │
              │  BLOCKER≥1 OR structural → CONTINUE  │
              │  cycle≥5 + BLOCKERs → HALT          │
              └─────────────────────────────────────┘
```

---

## Optional widened-lane fallback rule

If a high-risk widened critic route is requested and the second critic task fails after one retry, or the current session provider family cannot supply a second independent critic:

- Collapse back to the same-family single-critic path and synthesize the surviving verdict.
- Mark the verdict file header: `Critic route: same-family single critic (fallback from widened route)`.
- Log the failure reason in the verdict file under `## Critic route failures`.

---

## Verdict file header format

Cycle 1:
```markdown
# Critic Review — <name>

Cycle: 1
Date: <YYYY-MM-DD>
Critic route: same-family single critic
BLOCKERs resolved since N-1: n/a
```

Cycle N ≥ 2:
```markdown
# Critic Review — <name>

Cycle: N
Date: <YYYY-MM-DD>
Critic route: same-family single critic
Previous: docs/plans/<name>-critic-review-<N-1>.md
BLOCKERs resolved since N-1: <count>
```

When the high-risk widened route is used, replace the route line with `Critic route: same-family parallel critics (high-risk disagreement check)` or the fallback variant above.

---

## Anti-patterns

| # | Pattern | Why it fails |
|---|---|---|
| 1 | **Mandatory parallel fan-out** | The approved contract defaults to one fresh same-family critic. Widen only when the review is high-risk and needs an explicit disagreement check. |
| 2 | **Main drafts inline** | Main conflates orchestration and authorship. Subagent isolation keeps context clean. |
| 3 | **Soft critic prompt** | "Please review and suggest improvements" produces validation, not critique. Use the brutally honest skeleton verbatim. |
| 4 | **PUSH-BACK re-litigation** | Acting on ⚪ PUSH-BACK overrides locked decisions. Log it, do not resolve it. |
| 5 | **Parallel survey + draft** | Survey must complete before draft starts. Parallelizing them produces drafts built on incomplete evidence. |
| 6 | **Self-PASS by main** | Main cannot declare Gate PASS. Gate is decided by the synthesized categorized finding list — zero 🔴 items is the condition, not main's judgment. |
