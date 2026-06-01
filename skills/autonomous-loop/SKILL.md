---
name: autonomous-loop
version: 0.1.0
description: Meta orchestrator for multi-cycle autonomous execution — ASK-FIRST 3-slot branch contract, three execution modes (ultrawork / ralph / autopilot), polite-stop ban, fresh-agent verifier exit gate, rate-limit/compact resilience
trigger: "/pi-oven:autonomous, 자율 실행, 자율실행, 끝까지 끝내줘, 자는 동안 진행해, ralph로 돌려, autopilot, ralph, ultrawork, ulw, full auto, don't stop, must complete"
alwaysApply: false
---

# autonomous-loop

## When to use

Invoke when ANY of these conditions hold:

- User sends an explicit autonomous keyword: `/pi-oven:autonomous`, `자율 실행`, `자율실행`, `끝까지 끝내줘`, `자는 동안 진행해`, `ralph로 돌려`, `autopilot`, `ralph`, `ultrawork`
- A large-task delegation spans multiple cycles (3+ files, 200+ LoC, multi-stage)
- Harness self-improvement cycle is triggered (plan A→N continuation)

Do NOT invoke for single-shot tasks that complete in one tool call.

---

## Entry contract (ASK-FIRST, 3 slots)

Before dispatching ANY tool call, collect all three slots in a single question turn:

| Slot | Question | Example default |
|---|---|---|
| 1. Destination | New branch or current branch? | New branch |
| 2. Branch name | Propose a default | `feature/<topic>` |
| 3. PR mode | PR required or direct commits? | PR required |

**Rules:**
- Do NOT silently default any slot — ask explicitly.
- Do NOT end the turn after receiving answers. After user confirms all 3 slots, dispatch the first tool call in the SAME turn.
- Violation = silently branching, or ending turn with "understood, I'll begin now" without dispatching.

---

## Execution modes

Three autonomous execution modes. Select the mode based on user trigger or task characteristics:

| Mode | Trigger | Pattern | When to use |
|---|---|---|---|
| `ultrawork` | "ulw", "parallel agents", "fast" | Parallel execution engine — fire all independent tasks at once, dependency-aware waves | Multiple independent tasks; no persistence needed |
| `ralph` | "ralph", "don't stop", "must complete" | PRD-driven persistence loop — story-by-story until all acceptance criteria verified by reviewer | Task requires guaranteed completion with reviewer sign-off |
| `autopilot` | "autopilot", "autonomous", "full auto", "끝까지 끝내줘" | Full lifecycle pipeline — Expansion → Planning → Execution → QA → Validation | Idea-to-working-code; multi-phase project |

Default when user says `자율 실행`, `자율실행`, `끝까지 끝내줘`, or `/pi-oven:autonomous`: **autopilot** mode.

---

## Ultrawork pattern

Fire all independent task calls simultaneously — never serialize independent work. Use a dependency matrix to identify parallel waves:

```
Wave 1 (parallel): tasks with no dependencies
Wave 2 (parallel): tasks whose only blockers are in Wave 1
Wave N: repeat until all tasks complete
```

Tier routing:
- Simple lookups / 1-file isolated changes: `pi-oven:executor` (cheap model)
- Standard implementation: `pi-oven:executor` (standard model)
- Complex analysis / architecture: `pi-oven:planner` or `pi-oven:architect` (most capable model)

Use `run_in_background: true` for operations over ~30 seconds (package installs, builds, test suites). Run quick commands (git status, file reads, simple checks) in the foreground.

---

## Ralph (PRD persistence loop) pattern

When `ralph` mode is active:

1. Create a task list with concrete, verifiable acceptance criteria per story. Generic criteria ("implementation is complete") MUST be replaced with task-specific criteria before proceeding.
2. Work story-by-story: implement → verify all acceptance criteria with fresh evidence → mark complete → next story.
3. After all stories complete: dispatch `pi-oven:verifier` as the reviewer (not main agent self-verification). The verifier evaluates against the specific acceptance criteria, not vague "is it done?".
4. On approval: run `pi-oven:code-simplifier` on the changed files (deslop pass). Then re-run tests to confirm no regression. Only exit after the post-deslop regression run passes.
5. On rejection: fix the specific issues, re-dispatch the same verifier, loop back.

Ralph requires reviewer sign-off. "Looks done" is not sign-off. Fresh `pi-oven:verifier` `VERDICT: PASS` is sign-off.

---

## Autopilot lifecycle pipeline

Phase sequence — each phase must complete before the next begins:

| Phase | Action | Agents |
|---|---|---|
| 0 — Expansion | If input is vague: dispatch `pi-oven:planner` to extract requirements + `pi-oven:architect` to create technical spec. If a spec already exists in `docs/specs/`: skip. | `pi-oven:planner`, `pi-oven:architect` |
| 1 — Planning | Create implementation plan. If `writing-plans` output exists in `docs/plans/`: skip. | `pi-oven:planner` (direct, no interview) |
| 2 — Execution | Implement the plan using ultrawork pattern (parallel waves). | `pi-oven:executor` (tier-routed) |
| 3 — QA | Build, lint, test, fix failures. Repeat up to 5 cycles. Stop early if the same error repeats 3 times — that is a fundamental issue requiring user input, not another retry. | `pi-oven:executor`, `pi-oven:debugger` |
| 4 — Validation | Multi-perspective review in parallel: functional + security + quality. All must approve; fix and re-validate on rejection, up to 3 re-validation rounds. | `pi-oven:verifier`, `pi-oven:security-reviewer`, `pi-oven:code-reviewer` |

---

## Per-cycle work order

Regardless of mode, invoke skills in this order each cycle:

1. `freshness-guard` — stale meta-doc check before any reads (all modes)
2. `codebase-survey` — mandatory pre-planning deep read via `pi-oven:explorer` (all modes, unless survey result exists)
3. `spec-and-review` — if the cycle introduces a new capability or design change (autopilot Phase 0/1)
4. `writing-plans` — produce/update `docs/plans/` checkpoint (autopilot Phase 1)
5. Execution phase — mode-specific: ultrawork waves / ralph loop / autopilot lifecycle
6. `large-task-delegation` routing — if any single task is 3+ files or 200+ LoC
7. `tdd-strict` — enforced inside executor subagents (Red→Green→Refactor), not in main
8. `pre-commit-gate` — run after each commit boundary (Gates 0–4.5, all modes)
9. `fresh-verifier` — mandatory before exit (all modes, see Exit gate section)

Main agent role: dispatch and sequence only. Main does not implement inline.

---

## Polite-stop ban (9 canonical examples)

Never stop in any of these situations — continue in the same turn:

1. `AskUserQuestion` answered → ended turn without dispatching next stage
2. Tool result received → summarized findings and ended turn
3. Plan A complete → asked "Should I proceed to Plan B?" instead of auto-dispatching
4. Reviewer returned 1x FAIL → halted (threshold is 2 consecutive FAILs)
5. Build failed 1–2x → halted (threshold is 3 consecutive failures)
6. Subagent dispatch returned → responded "Done, awaiting next instruction"
7. `/compact` completed → ended turn instead of restating remaining tasks and resuming
8. Edit/Write failed 1x → halted on same file (threshold is 2 consecutive failures)
9. Cost/extra-usage/overage signal received → halted (cost-overage is NOT a halt condition)

---

## Resilience

### Rate-limit (provider 429 / dispatch fail)
- On rate-limit: call `ScheduleWakeup(600)` + restate remaining tasks in the wakeup prompt
- Do not end the turn empty — always embed the restate arg
- Provider fallback chain: Codex → Zen → Anthropic opt-in
- Critic dispatch fail: main runs critic directly OR dispatches `pi-oven:critic` subagent

### Auto /compact
- Trigger at ≥50% context usage
- Always pass remaining-tasks summary as the `/compact` arg — never call with empty arg
- Multi-compact is allowed; resume from restate after each compact

### Stuck thresholds — kill + diagnose + retry
- Subagent stuck ≥ 5 min → kill, diagnose, re-dispatch with added context
- Bash command stuck ≥ 3 min → kill, diagnose, retry or reformulate
- Codex no first token within 60s → kill, retry once, then fallback

### Oracle escalation
After two consecutive fix attempts on the same surface have failed, dispatch `pi-oven:oracle` before attempting a third fix. The oracle consultation is a strategic re-think — it returns either a different angle of attack or a hard halt recommendation. Two consecutive failed fixes is the trigger; do not invoke oracle on a single failure (cheaper retry first).

---

## Exit gate

Before declaring any cycle or loop complete:

1. Dispatch `pi-oven:verifier` with `model="opus"`
2. Verifier runs 4 mandatory checks:
   - Prod-build smoke (build passes with zero errors)
   - Stub sweep (no `TODO`, `FIXME`, placeholder stubs in touched files)
   - SoT alignment (plan checkboxes match actual file state)
   - Spec-freeze re-check (no locked decisions overridden)
3. **PASS required** — partial pass is not accepted
4. On FAIL: re-execute the failing check's fix, then re-run verifier
5. 2 consecutive verifier FAILs → append `Q-VERIFIER-FAIL` to `docs/harness/user-queue.md` and halt to user

Main cannot self-declare PASS. Only `pi-oven:verifier` `VERDICT: PASS` output counts.

---

## Halt conditions

Stop and surface to user only on:

| Code | Condition |
|---|---|
| `Q-VERIFIER-FAIL` | 2 consecutive fresh-verifier failures |
| `Q-MIGRATION-HALT` | Migration destructive-op requires explicit user authorization |
| User explicit stop | User sends `그만`, `stop`, `halt`, `cancel` |
| 5 spec cycles with BLOCKERs | `spec-and-review` cycle ≥ 5 and BLOCKERs remain |
| Same QA error × 3 | Autopilot Phase 3: same failure repeats 3 cycles → fundamental issue, halt to user |

**NOT halt conditions:** cost-overage signal, extra-usage tier, single reviewer FAIL, single build failure.

---

## References

- State machine: `references/state-machine.md`
- Agent registry: `docs/specs/2026-05-28-pi-oven-agent-registry.md`
