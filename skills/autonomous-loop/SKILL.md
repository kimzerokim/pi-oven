---
name: autonomous-loop
version: 0.1.0
description: "Read this skill for multi-cycle autonomous or unattended execution. Meta orchestrator: delegation-first loop, ASK-FIRST 3-slot branch contract, three modes (ultrawork/ralph/autopilot), exhaustive sweep before self-improvement plans, fresh-agent verifier exit gate."
---

# autonomous-loop

## When to use

Invoke when ANY of these conditions hold:

- User sends an explicit autonomous keyword: `/pi-oven:autonomous`, `자율 실행`, `자율실행`, `자율로 돌려`, `끝까지 끝내줘`, `자는 동안 진행해`, `계속 진행해`, `멈추지 말고 진행해`, `ralph로 돌려`, `autopilot`, `ralph`, `ultrawork`
- A large-task delegation spans multiple cycles (3+ files, 200+ LoC, multi-stage)
- Harness self-improvement cycle is triggered (plan A→N continuation)

Do NOT invoke for single-shot tasks that complete in one tool call.

**Precedence guard (brainstorming first):**
- If the user also requests brainstorming/design-first (`브레인스토밍`, `아이디어 정리`, `같이 설계`, `설계부터`) and no approved spec exists, run `brainstorming` first and block autonomous execution until that skill reaches explicit approval.

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

**Memory at loop entry:**
Before the first tool call of the loop, call `recall({query: "prior cycle failures, blockers, and incomplete tasks for this project"})`. If the backend is not available (memory.backend = "off"), skip gracefully — do not fail. If prior failures are found, surface them to the planner before spec/plan dispatch.

**External knowledge:** If the task requires external knowledge, SOTA research, papers, or unfamiliar domains — dispatch `pi-oven:deep-researcher` as a sibling alongside the initial planner/architect call (before committing to the implementation plan). Do not invoke for routine coding tasks.

---

## Execution modes

Three autonomous execution modes. Select the mode based on user trigger or task characteristics:

| Mode | Trigger | Pattern | When to use |
|---|---|---|---|
| `ultrawork` | "ulw", "parallel agents", "fast" | Parallel execution engine — fire all independent tasks at once, dependency-aware waves | Multiple independent tasks; no persistence needed |
| `ralph` | "ralph", "don't stop", "must complete" | PRD-driven persistence loop — story-by-story until all acceptance criteria verified by reviewer | Task requires guaranteed completion with reviewer sign-off |
| `autopilot` | "autopilot", "autonomous", "full auto", "끝까지 끝내줘" | Full lifecycle pipeline — Expansion → Planning → Execution → QA → Validation | Idea-to-working-code; multi-phase project |

Default when user says `자율 실행`, `자율실행`, `끝까지 끝내줘`, or `/pi-oven:autonomous`: **ralph** mode (long-haul persistence baseline). Use `autopilot` only when the user explicitly wants idea-to-code phase orchestration.

---

## Ultrawork pattern

Fire all independent task calls simultaneously — never serialize independent work or peel off "safe pairs" when the tasks are actually disjoint. Start with the widest clean wave you can describe.

```
Wave 1 (parallel): every dependency-free task you can launch together (default target 8-12 siblings)
Wave 2 (parallel): every task whose only blockers cleared in Wave 1
Wave N: repeat with the widest dependency-ready batch until all tasks complete
```
This 8-12 figure is pi-oven's batching target, not a guaranteed concurrent-worker count. Before the native runtime path is active, omp/runtime/provider capacity can force fewer live workers; after cutover, `nativeWorkers.maxWorkers` is the pi-oven-owned ceiling without overriding runtime availability.

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
| -1 — Broad exploration | Before scoping any first improvement/spec, dispatch parallel discovery over the target surface: `pi-oven:explorer` (file/call graph), `pi-oven:tracer` (cross-call causal paths), `pi-oven:analyst` (risk/impact clustering). Require evidence from at least 3 adjacent subsystems and at least 2 alternative improvement directions; do not lock spec scope until this evidence is collected. | `pi-oven:explorer`, `pi-oven:tracer`, `pi-oven:analyst` |
| 0 — Expansion | If input is vague: dispatch `pi-oven:planner` to extract requirements + `pi-oven:architect` to create technical spec from Broad exploration evidence. For novel domains or external SOTA research, dispatch `pi-oven:deep-researcher` alongside planner. If a spec already exists in `docs/specs/`, still run delta expansion against newly discovered subsystems before skipping. | `pi-oven:planner`, `pi-oven:architect`, `pi-oven:deep-researcher` |
| 1 — Planning | Create implementation plan from the expanded scope. If `writing-plans` output exists in `docs/plans/`, refresh it with new discoveries instead of blind reuse. | `pi-oven:planner` (direct, no interview) |
| 2 — Execution | Implement the plan using ultrawork pattern (parallel waves). Main never edits; executor/debugger subagents own code changes. | `pi-oven:executor`, `pi-oven:debugger` |
| 3 — QA | Build, lint, test, fix failures. Repeat up to 5 cycles. Stop early if the same error repeats 3 times — that is a fundamental issue requiring user input, not another retry. When the cycle touches metrics or performance, dispatch `pi-oven:data-runner` after `pi-oven:test-engineer` for REPL-based empirical validation. | `pi-oven:executor`, `pi-oven:debugger`, `pi-oven:test-engineer`, `pi-oven:data-runner` |
| 4 — Validation | Multi-perspective review in parallel: functional + security + quality, plus UX/visual checks when UI is touched. All must approve; fix and re-validate on rejection, up to 3 re-validation rounds. | `pi-oven:verifier`, `pi-oven:security-reviewer`, `pi-oven:code-reviewer`, `pi-oven:designer`, `pi-oven:multimodal-looker` |

---

## Per-cycle work order

Regardless of mode, invoke skills in this order each cycle:

1. Freshness check — stale meta-doc check before any reads (all modes); inline, same detection as pre-commit Gate 0.5 (no separate skill)
2. `codebase-survey` — mandatory pre-planning deep read via `pi-oven:explorer` (all modes, unless survey result exists)
3. Self-improvement sweep — if the cycle scope is self-improvement / plugin-surface (improving this harness itself), BEFORE spec/plan dispatch `pi-oven:explorer` (parallelizable across surfaces) to exhaustively sweep `skills/<skill>/SKILL.md` (cross-references + name consistency), `agents/pi-oven-<role>.md` (dispatch refs), `commands/`, and `evals/<skill>/scenarios/` (coverage gaps). Synthesize a "sweep findings" summary that MUST be passed into the planner/spec input — no partial-read plans.
4. Broad exploration gate — if this is the first improvement scope in the run, dispatch `pi-oven:explorer` + `pi-oven:tracer` + `pi-oven:analyst` in parallel and record cross-subsystem evidence before scoping spec/plan
5. `spec-and-review` — if the cycle introduces a new capability or design change (autopilot Phase 0/1)
6. `writing-plans` — produce/update `docs/plans/` checkpoint (autopilot Phase 1)
7. Execution phase — dispatch `subagent-driven-development` as the per-task execution orchestrator: one fresh subagent per plan task with two-stage review (spec-compliance pass, then code-quality pass). Group independent plan tasks into the widest dependency-safe waves you can justify; do not serialize disjoint work just because the list is long. Route a single task to `large-task-delegation` if it exceeds 3+ files or 200+ LoC. Mode shapes the cadence: ultrawork waves / ralph loop / autopilot lifecycle.
8. `tdd-strict` — enforced inside executor subagents (Red→Green→Refactor), not in main
8.5. `pi-oven:data-runner` — conditional: if the cycle touches metrics, benchmarks, or performance, dispatch `pi-oven:data-runner` via `task` after `pi-oven:test-engineer` to validate claims empirically via REPL. Skip for cycles with no metric/perf scope.
9. `pre-commit-gate` — run after each commit boundary (Gates 0–4.5, all modes)
10. `fresh-verifier` — mandatory before exit (all modes, see Exit gate section)

**Milestone retain:** At each confirmed MILESTONE (story acceptance criteria verified, phase complete, or spec approved), call `retain({items:[{content:"<milestone description and outcome>", context:"autonomous-loop cycle <N>"}]})`. If the backend is not available, skip gracefully.

Main agent role: orchestrator only — dispatch, sequence, synthesize evidence, and queue next subagent work in the same turn. Main MUST NOT implement inline code, inline tests, or inline refactors during autonomous-loop execution. Any work touching multiple files, requiring 3+ reads, or exceeding 200 LoC MUST be dispatched to a subagent — main doing it inline is a hard violation, not a shortcut. After each result lands, main should queue the next full dependency-ready wave immediately instead of drip-feeding independent tasks one-by-one.

Route to the RIGHT agent — match model-fit and role-fit to the work (first-class concern): explore (`pi-oven:explorer` / `pi-oven:tracer` / `pi-oven:analyst`) → plan (`pi-oven:planner`) → implement (`pi-oven:executor` / `pi-oven:debugger`) → verify (`pi-oven:verifier` / `pi-oven:security-reviewer` / `pi-oven:code-reviewer`). Main never implements inline.

### Conditional sub-flow routing

Before generic execution, detect the work TYPE and dispatch the specialized flow:

- Bug / test-failure / unknown root cause → `systematic-debugging` (root-cause-first; `pi-oven:tracer` / `pi-oven:debugger` / `pi-oven:test-engineer` reproduce and locate the cause before any fix). Escalate to `deep-dive` when causal tracing is deep or spans multiple origins.
- Refactor / architecture improvement / shallow-module deepening → `improve-codebase-architecture` (survey → candidates → grilling → interface design → verify) BEFORE writing any code.
- New capability / design change → `spec-and-review` (see work-order step 5).

---

## Polite-stop ban (10 canonical examples)

Never stop in any of these situations — continue in the same turn:

1. `AskUserQuestion` answered → ended turn without dispatching next stage
2. Tool result received → summarized findings and ended turn
3. Plan A complete → asked "Should I proceed to Plan B?" instead of auto-dispatching
4. Reviewer returned 1x FAIL → halted (threshold is 2 consecutive FAILs)
5. Build failed 1–2x → halted (threshold is 3 consecutive failures)
6. Subagent dispatch returned → responded "Done, awaiting next instruction"
7. `/compact` completed → ended turn instead of restating remaining tasks and resuming
8. edit/write failed 1x → halted on same file (threshold is 2 consecutive failures)
9. Cost/extra-usage/overage signal received → halted (cost-overage is NOT a halt condition)
10. User says "계속 진행해줘" / "자율 실행해줘" after a checkpoint → treated as a new confirmation gate instead of immediate continuation

---

## Resilience

### Rate-limit (provider 429 / dispatch fail)
- On rate-limit: call `ScheduleWakeup(600)` + restate remaining tasks in the wakeup prompt
- Do not end the turn empty — always embed the restate arg
- Provider retry path: current-session provider family only; retry once, then use a same-family alternate if configured
- Critic dispatch fail: main runs critic directly OR dispatches `pi-oven:critic` subagent

### Auto /compact
- Trigger at ≥50% context usage
- Always pass remaining-tasks summary as the `/compact` arg — never call with empty arg
- Multi-compact is allowed; resume from restate after each compact

### Stuck thresholds — kill + diagnose + retry
- Subagent stuck ≥ 5 min → kill, diagnose, re-dispatch with added context
- Bash command stuck ≥ 3 min → kill, diagnose, retry or reformulate
- Primary dispatch no first token within 60s → kill, retry once, then use a same-family alternate if configured

### Oracle escalation
After two consecutive fix attempts on the same surface have failed, dispatch `pi-oven:oracle` before attempting a third fix. The oracle consultation is a strategic re-think — it returns either a different angle of attack or a hard halt recommendation. Two consecutive failed fixes is the trigger; do not invoke oracle on a single failure (cheaper retry first).

---

## Exit gate

Before declaring any cycle or loop complete:

1. Dispatch `pi-oven:verifier` on the heavy path within the current session provider family
2. If the first verifier route is unavailable after retry, widen only within that same provider family; cycle exit is still always heavy
3. Heavy-path checks are the 4 sub-checks:
   - Prod-build smoke (build passes with zero errors)
   - Stub sweep (no `TODO`, `FIXME`, placeholder stubs in touched files)
   - SoT alignment (plan checkboxes match actual file state)
   - Spec-freeze re-check (no locked decisions overridden)
4. **PASS required** — partial pass is not accepted
5. On FAIL: re-execute the failing check's fix, then re-run verifier
6. 2 consecutive verifier FAILs → append `Q-VERIFIER-FAIL` to `docs/harness/user-queue.md` and halt to user

Main cannot self-declare PASS. Only `pi-oven:verifier` `VERDICT: PASS` output counts.

**Memory at loop exit:** After `pi-oven:verifier` issues `VERDICT: PASS`, call `reflect({query: "what was learned and accomplished this loop"})` to consolidate what was learned this loop. If the backend is not available, skip gracefully.

---

## IRC coordination — parallel executor dispatch

When `large-task-delegation` fans out executor agents in a single `task({agent, tasks:[...]})` call (isolated worktrees), each executor discovers sibling peer ids via `irc(op:"list")`. Broadcast on completion or blocker using plain prose messages only (no JSON payloads):

- On completion: `irc(op:"send", to:"all", message:"executor done: <task-summary>")`
- On blocker: `irc(op:"send", to:"all", message:"blocker: <description>, pausing")`

Executors use `irc(op:"list")` to check for cancellation signals from siblings. The orchestrator waits for all tasks to complete (not a poll loop) before collecting results. `irc` is auto-injected into every subagent — it need not appear in agent `tools:` frontmatter. Only `op:"send"` and `op:"list"` exist; there is no channel create/open op. This coordination only works for sibling subagents co-spawned in a single `task` call at recursion depth ≤ 2.

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
