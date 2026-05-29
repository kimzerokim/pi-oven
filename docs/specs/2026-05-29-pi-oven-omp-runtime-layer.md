# Spec F: pi-oven omp-native runtime / discipline layer (Plan 3 reconciliation)

**Status**: DRAFT v1 — codex review **CONTINUE** (6 BLOCKERs, 2026-05-29). Verdict: `docs/research/codex-reviews/2026-05-29-pi-oven-omp-runtime-layer-critic-review.md`. v2 revision (§8) + §5 user-decisions required before implementation. Central architecture validated sound + honestly scoped by both reviewers.
**Supersedes/Reconciles**: `docs/specs/2026-05-27-pi-oven-foundation-design.md` §Plan 3 (defined as "Workflow orchestration TS extension: single autonomous loop + multi-agent team mode + gate state machine + per-agent disallowedTools"). This spec corrects what is literally feasible against omp's real ExtensionAPI.
**Inputs (evidence)**: discovery `wf_74c81aad-c7b` omp-capability survey (harvest `docs/harness/surveys/2026-05-29-discovery-harvest.jsonl`, `.canEnforce`/`.evidence`); `docs/decisions/0001-dogfood-switch.md:79`; `.omp/extensions/pi-oven.ts`.
**Absorbs (imports)**: omo `rules-injector` + multi-hook coordination; ECC compaction/memory-persistence hooks; pre-execution-gate pattern (discovery Track 2 P0).

---

## §1 Goal

Reduce the autonomous workflow's reliance on each (heterogeneous, non-Anthropic) model *remembering* to follow discipline, by moving enforcement from prose instructions to a TS runtime that hard-blocks at the only deterministic lever omp exposes. The user's thesis: pure LLM-driven flow is too sensitive to per-model instruction-following; tool-boundary enforcement is model-independent.

**Non-goal**: a true hard FSM the model cannot violate at every step. Survey proves this is impossible in omp today (see §2).

---

## §2 omp capability facts (LOCKED — survey evidence, file:line)

| Capability | Verdict | Evidence |
|---|---|---|
| Gate state machine (block tool actions) | ✅ YES via `tool_call` hook | `shared-events.ts:265-270` `ToolCallEventResult={block?,reason?}`; `wrapper.ts:145-165` fires before EVERY tool incl. `task` |
| per-agent `disallowedTools` | ❌ absent in omp | grep `disallowedTools` = 0; only positive allowlist `agent.tools` (`executor.ts:621-633`) |
| Block "until verifier dispatched" | ❌ `agent_start/end`,`turn_*` observe-only | `shared-events.ts:174-197` (no result type). Workaround: `sendMessage(deliverAs:nextTurn, triggerTurn:true)` |
| per-call model/thinkingLevel override | ❌ no dispatch hook | `task/index.ts:647-658` static precedence (`agentModelOverrides>frontmatter>parent`); confirms ADR 0001:79. `setModel/setThinkingLevel` session-global only |
| subagent-dispatch interception | ⚠️ observe+block only, cannot rewrite | `task` tool fires `tool_call` (can `{block}`); `emitToolCall` (`runner.ts:614-647`) honors only `block`, cannot mutate args/model |
| `tool_call` handler timeout | **NONE** — `emitToolCall` (`extensions/runner.ts:614-647`) awaits the handler directly, the ONLY emit path not wrapped by `#runHandlerWithTimeout`. A *thrown* error fail-closes (`{block:true}`, `runner.ts:641`); a *hung* handler deadlocks the agent forever. (30s `EXTENSION_HANDLER_TIMEOUT_MS` `extensions/runner.ts:63` applies to session/turn/agent/context emits only.) → Layer 1 MUST self-impose an internal deadline. [corrected v1→v2, B1] |

---

## §3 Design — 4-layer hybrid "soft-deterministic" runtime

### Layer 1 — Gate state machine (HARD, the real win)
Extension owns a persisted FSM in `.pi-oven/state/autonomous.json` (phase, gate cache, dispatch log), updated by observing `tool_result`/`turn_end` + file writes (`pi.appendEntry`). Enforced at the `tool_call` hook — the only hard lever:
- On `Bash` matching `git commit` → `{block:true}` until Gate 0-5 cache says PASS (mirrors pi-oven `pre-commit-gate` skill, now machine-enforced).
- On forbidden commands (e.g. `git push` without consent flag, `rm -rf`, prod-access patterns) → `{block, reason}`.
- On the `task` tool → inspect `input.agent`; block dispatch of an agent disallowed in the current phase.
The LLM physically cannot skip a gated tool because the tool refuses to run. **Caveat**: 30s handler budget — gate cache must be precomputed/fast; never run the full suite inside the hook.

### Layer 2 — Per-dispatch model/agent control
- **Default (ship now)**: static — `task.agentModelOverrides[pi-oven:<role>]` (settings) + agent frontmatter `model:` (Spec E mechanism, already built). No new code.
- **Phase 2 (optional, OPEN QUESTION §5)**: register `pi-oven_dispatch` via `pi.registerTool` that drives subagents through the omp SDK with an extension-chosen model+thinkingLevel per call — the ONLY path to genuine per-call selection. Cost: reimplements dispatch/worktree/merge the built-in `task` tool already provides. **Recommend deferring** unless per-call model selection proves necessary.

### Layer 3 — Per-agent tool restriction
Native allowlist `tools:` in each agent .md (`executor.ts:621-633`, enforced at spawn). No deny semantics — express restrictions as a narrower allowlist. (plan-mode precedent: `index.ts:637`.)

### Layer 4 — Reminder/steering (SOFT)
`before_agent_start.systemPrompt` + `context.messages` replacement + `sendMessage(nextTurn)` inject the current FSM phase + discipline rules every turn — the substitute for the impossible "block loop end until verifier ran". **This is where the omo `rules-injector` pattern is absorbed**: a session-cached rule store + transcript hydration + post-compaction re-injection so discipline rules survive compaction without redundant re-application.

---

## §4 Absorbed import mechanisms (Track 2 P0)
- **rules-injector** (omo `src/hooks/rules-injector`) → Layer 4 rule store + hydration. New `.omp/hooks/` or extension module.
- **multi-hook coordination** → extension grows from 2 hooks (validate + session_start) to the coordinated set: `tool_call`, `tool_result`, `before_agent_start`, `context`, `session_*`.
- **compaction/memory-persistence** (ECC) → `session.compacting`/`session_before_compact` to persist + rehydrate FSM state and hot rules across compaction (relevant for long heterogeneous-model sessions).

---

## §5 Open questions (codex review + user)
1. **Phase 2 custom `pi-oven_dispatch` tool** — build the registerTool orchestration path for true per-call model selection, or stay static (recommend static; revisit if needed)?
2. **Scope of gated tools** — commit + push + forbidden-commands only (minimal), or also gate `task` dispatch by phase (fuller)? Minimal first recommended.
3. **Relationship to `/pi-oven:autonomous`** — does this runtime replace the LLM-driven prompt template, or augment it (extension enforces, prompt still drives)? Recommend augment.
4. **State dir** — `.pi-oven/state/` (gitignored) confirmed as FSM home.

---

## §6 Acceptance Criteria (draft)
- **AC1** `tool_call` hook blocks `git commit` when `.pi-oven/state/autonomous.json` gate cache ≠ PASS; allows when PASS. Test via extension unit + a simulated tool_call event.
- **AC2** Gate cache computed outside the hook (≤ a few ms lookup); hook never exceeds 30s (no full suite inside).
- **AC3** Rule-injection: discipline rules present in system prompt after a simulated compaction (rehydration works; no duplicate injection).
- **AC4** No regression: `bun run check/test/lint:agents/lint:skills/build` green; extension still does `validateAgentRegistry` + parent-model capture.
- **AC5** Forbidden-command guard blocks `git push` unless an explicit consent flag/env is set (honors push-confirm policy at the runtime level).
- **AC6** Foundation-design Plan 3 reconciled: ADR records the hybrid runtime as the realized Plan 3; "per-agent disallowedTools" + "hard FSM" marked infeasible-as-specced with the allowlist + tool_call-gate substitute documented.

---

## §7 Out of scope
- per-call model override Phase 2 (deferred — §5.1).
- Replacing omp's built-in `task` tool wholesale.
- omp upstream changes (runtime works on stock omp).
- PROFILE_B (deferred separately).

---

## §8 v2 work list (from codex+critic review — gate CONTINUE)

Full verdict: `docs/research/codex-reviews/2026-05-29-pi-oven-omp-runtime-layer-critic-review.md`. Architecture is sound (pushbacks P1/P4/P5 — keep the thesis + the "impossible" honesty + Layer-4-SOFT). Fix before implementation:

1. **B1** (partly done above) — §3 Layer 1 caveat + AC2: `tool_call` is un-timed; Layer 1 self-imposes an internal `Promise.race` deadline (pick a number, e.g. 200ms–2s) and throws-to-block on overrun. AC2 asserts the self-deadline, not a platform 30s.
2. **B2** — per-tool failure policy for corrupt/missing/partial `autonomous.json` (commit/push = fail-closed + env escape hatch); atomic write (temp+rename); ACs for each failure case.
3. **B3** — canonical git-command normalization (tokenize; resolve `git -C`/subshell/`&&`) OR document best-effort + residual bypass; adversarial ACs.
4. **B4** — atomic/single-writer FSM updates + stale-cache invalidation; parallel + nested-subagent `tool_call` ACs.
5. **B5** — set v1 scope = **minimal (commit/push/forbidden only)**; move task-phase-gating to a labeled Phase 2; note native static primitives (`#blockedAgent`/`disabledAgents`) are not phase-aware.
6. **B6** — AC2 numeric budget; AC3 concrete compaction fixture (inject → `session.compacting` `preserveData` → `before_agent_start` `branchEntries` re-inject w/ named dedup key).
7. NITs N1–N7 (line-ref disambiguation, integration AC, push-consent schema, Layer-4-is-extension-not-hook, baseline = 1 hook + 1 load-time call).

**Implementation gate**: this spec is NOT ready to build until v2 lands AND the user resolves §5 (recommend: defer Phase-2 dispatch tool; minimal gate scope; augment-not-replace `/pi-oven:autonomous`).
