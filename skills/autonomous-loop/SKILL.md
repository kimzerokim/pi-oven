---
name: autonomous-loop
version: 0.1.0
description: Meta orchestrator for multi-cycle autonomous execution — ASK-FIRST 3-slot branch contract, polite-stop ban, fresh-agent verifier exit gate, rate-limit/compact resilience
trigger: "user explicit autonomous keyword (`/pi-oven:autonomous`, '자율 실행', '끝까지 끝내줘', '자는 동안 진행해', 'ralph로 돌려'); OR multi-cycle large-task delegation"
alwaysApply: false
---

# autonomous-loop

## When to use

Invoke when ANY of these conditions hold:

- User sends an explicit autonomous keyword: `/pi-oven:autonomous`, `자율 실행`, `끝까지 끝내줘`, `자는 동안 진행해`, `ralph로 돌려`
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

## Per-cycle work

Invoke skills in this order each cycle:

1. `freshness-guard` — stale meta-doc check before any reads
2. `codebase-survey` — mandatory pre-planning deep read (via `oh-my-claudecode:explore`)
3. `spec-and-review` — if the cycle introduces a new capability or design change
4. `writing-plans` — produce/update `docs/plans/` checkpoint
5. `subagent-driven-development` — dispatch fresh subagent per task with two-stage review
6. `large-task-delegation` routing — if any single task is 3+ files or 200+ LoC
7. `tdd-strict` — enforced inside executor subagents (Red→Green→Refactor), not in main
8. `pre-commit-gate` — run after each commit boundary (Gates 0–4.5)
9. `fresh-verifier` — mandatory before exit (see Exit gate section)

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
- Critic dispatch fail: main runs critic directly OR dispatches `critic opus` subagent

### Auto /compact
- Trigger at ≥50% context usage
- Always pass remaining-tasks summary as the `/compact` arg — never call with empty arg
- Multi-compact is allowed; resume from restate after each compact

### Stuck thresholds — kill + diagnose + retry
- Subagent stuck ≥ 5 min → kill, diagnose, re-dispatch with added context
- Bash command stuck ≥ 3 min → kill, diagnose, retry or reformulate
- Codex no first token within 60s → kill, retry once, then fallback

---

## Exit gate

Before declaring any cycle or loop complete:

1. Dispatch `oh-my-claudecode:verifier` with `model="opus"`
2. Verifier runs 4 mandatory checks:
   - Prod-build smoke (build passes with zero errors)
   - Stub sweep (no `TODO`, `FIXME`, placeholder stubs in touched files)
   - SoT alignment (plan checkboxes match actual file state)
   - Spec-freeze re-check (no locked decisions overridden)
3. **PASS required** — partial pass is not accepted
4. On FAIL: re-execute the failing check's fix, then re-run verifier
5. 2 consecutive verifier FAILs → append `Q-VERIFIER-FAIL` to `docs/harness/user-queue.md` and halt to user

Main cannot self-declare PASS. Only verifier opus output counts.

---

## Halt conditions

Stop and surface to user only on:

| Code | Condition |
|---|---|
| `Q-VERIFIER-FAIL` | 2 consecutive fresh-verifier failures |
| `Q-MIGRATION-HALT` | Migration destructive-op requires explicit user authorization |
| User explicit stop | User sends `그만`, `stop`, `halt`, `cancel` |
| 5 spec cycles with BLOCKERs | `spec-and-review` cycle ≥ 5 and BLOCKERs remain |

**NOT halt conditions:** cost-overage signal, extra-usage tier, single reviewer FAIL, single build failure.

---

## References

- State machine: `references/state-machine.md`
