# Dispatch Anatomy — large-task-delegation

Source: pi-oven/harness-share.md §4, large-task-delegation SKILL.md

---

## Full dispatch prompt template

Use this template for every executor and planner dispatch. Planner/critic/verifier: 60-150 lines. Executors: 100-220 lines; stay within the current session provider family unless the parent skill explicitly allows same-family widening for high-risk work.

```
Task: <one sentence — outcome, not process>

Required reading:
- docs/harness/surveys/<YYYY-MM-DD>-<topic>-survey.md  (Step 0 report — mandatory)
- docs/plans/<plan-file>.md  (frozen plan — mandatory for executor)
- <any additional spec or CLAUDE.md sections>

Scope:
- Files to edit: <explicit paths>
- Line ranges (if mid-file): <anchor line or stable nearby symbol>
- DO NOT MODIFY: <explicit exclusion paths>
- Branch: verify `git branch --show-current` = <branch-name> before any edit

Task body:
<inline ≤120 lines>
- Exact function/component signatures with all parameter and return types
- Imports list: which symbol from which module
- Edge cases as a bullet list with expected behavior per case
- Test names + assertion shapes (one bullet per test; not "write tests for X")
- Lint rules that apply (e.g. "no `any`, narrow with `unknown` + `instanceof Error`")
- "DO NOT" deltas: what changes are NOT permitted in this task
- AGENTS.md row text for any new file (Gate 0 will demand it)

Rules:

[ANTI-SELF-VERIFICATION RULE — test-coverage §Anti-pattern]
TDD red phase (writing failing test) entry:
- Allowed reads: spec / acceptance criteria / user prompt / public API signatures / hook·install infra code
- Forbidden reads: body of the function being written, sibling function bodies in the same file, existing test files
- Self-check: "Is this test derived from the spec? Not inferred from the current shape of the implementation?"
Return task BLOCKED + request plan revision on violation.

[PRODUCTION-CODE-FIRST RULE — production-access §Production state changes (rev3)]
If this task involves production state mutation (DB schema / IAM policy / S3 lifecycle / IaC-managed Lambda env / CloudFront, etc.):
- Default: do not execute it directly. Without latest-turn explicit external execution consent, author script (migration / IaC) → user review → user/CI execution
- With matching active consent, that one direct external command is a parent-session-only exception and must be executed by the parent session itself; delegated workers may assist only with read-only investigation, script authoring, or planning
- Inline secret literals remain forbidden even with consent
- Idempotency mandatory: IF NOT EXISTS / ON CONFLICT DO NOTHING / --if-not-exists
- On drift: forward-only migration (no production state rollback; code commit git revert is OK)
Return task BLOCKED + request plan revision on violation.

[CODE-QUALITY-DISCIPLINE — DRY/YAGNI/KISS]
- Delete code before adding: if the new implementation makes existing code unreachable, delete it in the same commit.
- No YAGNI: do not add abstractions or params not required by the current task body.
- Obsolete tests: if the task deletes behavior, delete the matching test in the same commit.
- Depth limit: no helper that is only ever called by one caller — inline it.

TDD strict (autonomous mode — non-negotiable):
- Red: write one failing test from spec. No implementation reads during red.
- Green: write minimum code to pass. No refactor during green.
- Refactor: clean up only. No behavior change. Re-run tests.
- Commit only on green + refactor complete.

Plan scope discipline:
- Do not expand scope beyond the task body above.
- If a needed change falls outside scope, append Q-SCOPE-EXPAND to docs/harness/user-queue.md and return BLOCKED.

Halt conditions:
- Spec ambiguity not resolvable from the task body → BLOCKED + Q-SPEC-AMBIG
- Build fails after 2 fix attempts → BLOCKED + Q-BUILD-FAIL
- Test fails after 2 fix attempts → BLOCKED + Q-TEST-FAIL
- Scope expansion discovered → BLOCKED + Q-SCOPE-EXPAND

Context7 mandate: before implementing any external library call, call resolve-library-id + get-library-docs. Do not rely on training-data memory for library APIs.

Pre-commit gate: run Gate 0 (AGENTS.md sync) → Gate 1 (build) → Gate 2 (tests) → Gate 3 (lint) → Gate 4 (Playwright, if UI change) → Gate 5 (fresh-agent verifier). One FAIL blocks the commit.

Race-condition awareness: this subagent owns the files listed in Scope above. Do not read or write files owned by parallel sibling subagents in this wave.

[REGRESSION RECALL — inject verbatim if main context received this reminder, 200-char cap]
<paste [REGRESSION RECALL] content here, truncate at 200 chars, append "[truncated: N more hits]" if cut>

CRG refresh: at the start of this task and before each plan continuation, run `code-review-graph build` or `update` if CRG is configured.

Commit convention: English conventional commits (feat/fix/refactor/test/docs/chore). No Co-Authored-By trailer.

Output contract (≤100 words):
On success: final message = "DONE: <one sentence summary>. Files changed: <list>. Tests: <pass count>/<total>."
On BLOCKED: final message = "BLOCKED: <reason>. Queue entry: <Q-code>." Do not commit partial work.
```

---

## Parallel dispatch wave shape

```typescript
// Wave 1 — file-scope-disjoint tasks fire simultaneously
task({
  prompt: "<executor prompt for module A>",
  // omit model — executor routing stays inside the current session provider family
  run_in_background: true,
});
task({
  prompt: "<executor prompt for module B>",
  // omit model — executor routing stays inside the current session provider family
  run_in_background: true,
});
// Launch the whole dependency-ready wave. 8-12 disjoint tasks is the
// default planning target; actual simultaneous workers may be lower until the
// pi-oven native runtime path owns the configured ceiling. Same file region =
// do NOT parallelize.

// Wave 2 — only after Wave 1 subagents return
task({
  prompt: "<critic/verifier prompt referencing Wave 1 output>",
  // omit model — review inherits current-session routing; high-risk verification may widen only within that same provider family
  run_in_background: true,
});
```

Rules:
- Fire all wave-N tasks in a single response turn.
- `run_in_background: true` on every dispatch — main gets notified on completion.
- Same file region = sequential ownership; do not split one file across parallel agents.
- After each wave: `git log` + `git diff` inspection before launching wave N+1.

---

## 5 anti-patterns

**Anti-pattern 1 — Main does 6+ Edits directly**
Main calls edit/write on 6 files in one turn. This is a meta-gap: context saturation degrades the edit quality, and no verifier reviews the work. Fix: dispatch `pi-oven:executor` with all 6 files in scope; main reviews the diff while keeping routing inside the current session provider family.

**Anti-pattern 2 — Main reads 7+ files for preparation**
Main calls read on 7+ files before writing a plan. Fix: dispatch `pi-oven:explorer` to read and summarise; main receives a ≤200-word evidence summary and the survey report path.

**Anti-pattern 3 — Raw file contents flow into main context**
Main receives full file dumps from a subagent via return value. Fix: subagent writes findings to `docs/harness/surveys/` and returns only the report path + evidence summary. Main reads the summary, not the raw files.

**Anti-pattern 4 — Large refactor without dispatch**
User says "refactor the auth module" (5 files, ~300 LoC). Main starts editing inline. Fix: scope estimation first (`[scope] est. 5 files / ~300 LoC → pi-oven:executor`), then dispatch with frozen plan inside the current session provider family.

**Anti-pattern 5 — named-model workflow pinning in dispatch**
Dispatch hardcodes a named model or provider-specific tier for routine routing. This drifts from the parent session and bakes workflow policy into the prompt. Fix: omit `model` by default, inherit the current-session provider family, and widen only for high-risk review/verification inside that same provider family.
