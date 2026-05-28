---
name: pi-oven-autonomous
description: Enter autonomous mode — ASK-FIRST 3-slot branch contract + execution mode selection + polite-stop ban + fresh-verifier exit gate
argument-hint: <task description, or omit for interactive entry>
---

# /pi-oven:autonomous

You are entering the pi-oven autonomous loop. The actual orchestration runs through the `autonomous-loop` skill (`skills/autonomous-loop/SKILL.md`), which you (the LLM) drive directly — there is no separate runtime. Use this prompt as the conversational entry point.

## What to do

1. **Confirm ASK-FIRST 3-slot branch contract.** Before dispatching any tool, collect three answers in a single message:

   | Slot | Question | Suggested default |
   |---|---|---|
   | Destination | New branch or current branch? | New branch |
   | Branch name | Name? | `feature/<topic-slug>` |
   | PR mode | PR required, or direct commits without PR? | PR required |

   Do NOT silently default any slot — ask explicitly. Do NOT end the turn after receiving answers; dispatch the first tool call in the SAME turn.

2. **Select execution mode.** Ask the user which mode fits:

   | Mode | Pattern | When to use |
   |---|---|---|
   | `ultrawork` | Parallel waves via `run_in_background: true`; multiple pi-oven-prefixed agents fan out per turn | High-throughput task list; tasks are file-scope disjoint |
   | `ralph` | Self-referential reviewer loop with PRD persistence; verifier signs off each story | PRD-driven work; each story needs explicit verifier sign-off |
   | `autopilot` | Phase 0 (architect) → Phase 1+ (exec); idea-to-working-code automation | Greenfield; specs/plans still emerging from idea |

   If the user is uncertain, default to **ralph** (PRD-driven is safest for sustained work).

3. **Per-cycle work.** For each cycle in the autonomous loop:

   - Survey: dispatch `pi-oven:explorer` for codebase context.
   - Spec: if a new capability is introduced, run the `spec-and-review` skill (Pattern loop with `pi-oven:critic` cross-vendor fan-out).
   - Plan: produce or update a plan under `docs/plans/`.
   - Execute: dispatch `pi-oven:executor` (or `pi-oven:debugger` for fix work). Honor the `large-task-delegation` boundary (3+ files / 200+ LoC ⇒ delegate, do not implement in main).
   - TDD: enforce Red → Green → Refactor when code changes touch source files.
   - Gate: after each commit boundary, run `pre-commit-gate` checks.
   - Verify: before claiming the cycle done, dispatch a fresh `pi-oven:verifier` (no self-verification rule — main agent cannot verify its own work).

4. **Polite-stop ban.** You MUST continue in the same turn — never end a turn for any of these reasons:

   1. AskUserQuestion was answered → continue and dispatch the next stage now.
   2. A tool returned a result → use the result, do not summarize and stop.
   3. Plan A finished → auto-dispatch Plan B; do NOT ask "should I proceed?"
   4. Reviewer returned 1× FAIL → continue (halt threshold is 2 consecutive FAILs).
   5. Build failed 1–2× → continue (threshold is 3 consecutive build failures).
   6. Subagent dispatch returned → use the output; do not say "done, awaiting next instruction".
   7. `/compact` completed → restate remaining tasks and resume in the same turn.
   8. Edit / Write failed 1× → retry (threshold is 2 consecutive failures on the same file).
   9. Cost / extra-usage / overage signal arrived → cost is the user's concern, not a halt condition.

5. **Resilience.** On rate-limit (HTTP 429 from provider): call `ScheduleWakeup(600)` with a restate prompt. On context ≥50%: run `/compact "Remaining: <list>. In progress: <X>. Next: <Y>."` and resume. Subagent stuck ≥5 min → kill, diagnose, redispatch with added context. Bash stuck ≥3 min → kill, redispatch.

6. **Exit gate.** Before declaring any cycle complete, dispatch `pi-oven:verifier` (fresh, no shared memory). The verifier runs 4 mandatory sub-checks:

   - Production build smoke (`bun run build` or equivalent).
   - Stub sweep (no `TODO` / `FIXME` / placeholder stubs in touched files).
   - SoT alignment (plan checkboxes match actual file state).
   - Spec-freeze re-check (no locked decisions silently overridden).

   The verifier returns `VERDICT: PASS` (exit allowed) or `VERDICT: BLOCK` (with evidence + remediation). Main cannot self-declare PASS.

7. **Halt conditions** (surface to user, do not retry):

   - `Q-VERIFIER-FAIL` — 2 consecutive fresh-verifier failures.
   - `Q-MIGRATION-HALT` — destructive operation requires explicit user authorization.
   - User explicit stop — user sends `그만` / `stop` / `halt` / `cancel`.
   - `spec-and-review` cycle ≥ 5 with BLOCKERs remaining.

## Important rules

- The autonomous loop is **LLM-driven, file-based**. There is no TypeScript state machine runtime — you drive every transition through tool dispatch.
- All subagent dispatch goes through the `task` tool with a `pi-oven-*` agent file name (e.g. `pi-oven:executor`, `pi-oven:critic`). External namespaces like `oh-my-claudecode:*` and `omo:*` are NOT supported — they get passed as model strings and fail with 401.
- Push policy: do NOT `git push` without explicit user confirmation. `PI_OVEN_CYCLE_EXIT_VERIFIED=1` is for the cycle-exit hook only and does NOT replace user push consent.
- Per-spec semantic commits — bundle related changes into one commit per spec or one commit per logical unit. Avoid one-commit-per-task.

## Related skills

- `autonomous-loop` (`skills/autonomous-loop/SKILL.md`) — primary skill body with full execution-mode + polite-stop reference.
- `subagent-driven-development` — fresh subagent per task + two-stage review.
- `large-task-delegation` — 3+ files / 200+ LoC dispatch boundary.
- `fresh-verifier` — pre-completion gate + 4 sub-check.
- `spec-and-review` — Pattern loop with cross-vendor critic.
- `pre-commit-gate` — sequential gates 0–4.5.

## Quick reference

```
User: 자율 실행으로 X 추가해줘

You:
  1. Ask the 3-slot contract (destination / branch / PR mode).
  2. After answers, ask execution mode (ralph default).
  3. Dispatch first tool call (pi-oven:explorer survey) in the same turn.
  4. Continue without polite stops until exit gate or halt condition.
```
