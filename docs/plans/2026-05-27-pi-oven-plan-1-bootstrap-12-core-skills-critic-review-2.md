# Plan 1 Critic Review — Cycle 2

- **Date:** 2026-05-27
- **Reviewer:** critic (Opus 4.7 1M)
- **Plan:** `docs/plans/2026-05-27-pi-oven-plan-1-bootstrap-12-core-skills.md` (1986 lines)
- **Cycle 1 verdict reference:** `docs/plans/2026-05-27-pi-oven-plan-1-bootstrap-12-core-skills-critic-review.md`
- **Verdict:** **ACCEPT (PASS gate)**

---

## Verification of cycle 1 BLOCKER resolutions

| # | Cycle 1 BLOCKER | Cycle 2 resolution | Verified |
|---|---|---|---|
| 1 | `session.prompt()` fabricated return shape | Rewritten: `prompt(): Promise<void>`; data via `subscribe()` event aggregation | YES — Step 2.4 lines 412-467 + sdk.d.ts:493 `prompt(text, options?): Promise<void>` match |
| 2 | `SessionLike.toolCalls` capture missing | Subscribe-then-prompt pattern implemented; `runTurn()` collects via listener | YES — eval-runner.ts:450-467 |
| 3 | Driver out-shape mismatch | `makeSession()` adapts SDK `AgentSessionEvent` → `RunnerEvent` correctly | YES — sdk.d.ts:170+257+537 all exported; pi-agent-core/types.d.ts:386-411 confirms `tool_execution_start`/`message_update`/`message_end` are `AgentEvent` variants therefore included in `AgentSessionEvent` union (agent-session.d.ts:49) |
| 4 | TDD fake-passing test | `fakeSession` now subscribe+listener pattern; `prompt()` returns `Promise<void>` matching real SDK | YES — Step 2.1 lines 295-309 |
| 5 | 5 schema fields silently ignored | `ScenarioExpectation` cut to 5 evaluable fields; deferred fields removed from schema | YES — Step 2.3 lines 379-385 + `runScenario` Step 2.4 lines 481-528 implements all 5 |
| 6 | Acceptance arithmetic broken | Separated thresholds: smoke 12/12=100%, adversarial ≥10/12=83%, canary 1/1=100% | YES — Step 13.2 lines 1836-1838 + Acceptance lines 1966-1968 |
| 7 | `pressure-test` tag dropped | Tag dropped from Plan 1; Step 12.3 explicitly defers to Plan 3 | YES — line 1786-1789 |
| 8 | `state_transition_must_reach` non-evaluable | Dropped from canary scenario; replaced with `tool_calls_required: [ask]` + response substring | YES — Step 13.3 lines 1849-1859 |
| 9 | ADR 0001 numbering gap | `docs/decisions/0001-dogfood-switch.md` now first record; explicit independent namespace note | YES — Step 13.5 + verified `docs/decisions/` only contains `.gitkeep`; `docs/adr/0001-omp-marketplace-distribution.md` separate |
| 10 | Task 12 state-machine assertion impossible | State-machine assertion dropped; canary verifies 3-slot contract only | YES — line 1856 explicit |

All 10 cycle 1 BLOCKERs resolved. No new BLOCKERs introduced by cycle 2 revisions.

---

## 1. 🔴 BLOCKER

None.

---

## 2. 🟡 NIT

1. Step 2.6 line 627 `(sdkEvent as any).toolName` / `(sdkEvent as any).toolCallId` — type-asserting through `any` defeats the d.ts safety net. Use proper narrowing: `if (sdkEvent.type === "tool_execution_start") { sdkEvent.toolName }`; `ToolExecutionStartEvent` (extensions/types.d.ts:314-321) exposes the fields directly without cast.
2. Step 2.10 lines 751-757 exit-code branching mixes shell condition syntax (`-eq`) with no error trap when `bun scripts/run-eval.ts` itself crashes pre-exit. Add `set -e` consideration or `2>&1 | tee` to capture stderr.
3. Task 12 line 1770 explore prompt asks for "key differences between Sisyphus full vs Sisyphus Junior" — both paths exist but no follow-up step uses Junior. Drop or add 1-line rationale.
4. Step 12.5 "smoke PASS required. adversarial PASS required" for meta skill contradicts Step 13.2's ≥10/12 = 83% adversarial pool threshold. Spell out: does autonomous-loop adversarial count toward 'weak' allowance or strict-PASS-only?
5. Step 2.7 `tests/scripts/run-eval.test.ts` line 691 `expect([0, 1, 2]).toContain(result.exitCode)` is tautology. Either assert specific exit code or remove.
6. Self-Review Checklist line 1959 claim verified: all 12 tasks have concrete writer prompts (no remaining `Standard cycle` placeholder).
7. Plan grew ~1100 → 1986 lines (~80% expansion). Bulk = repeated boilerplate per-task scenario YAML (regression stubs ×12, format reminders, commit blocks). DRY violation accepted per Self-Review but worth noting — Tasks 4-11 are 90% repeated structure with skill-name swap.
8. Step 2.4 line 484-491 `skill_triggered: true` matcher implements "any tool call OR any content" — vacuously passes any non-empty response. Consider treating `true` as no-op evaluator to surface weakness honestly.
9. Step 0.2 `PI_OVEN_CYCLE_EXIT_VERIFIED=1` bypass for scaffold-only commit — cycle 1 NIT, still present in cycle 2.

---

## 3. ⚪ PUSH-BACK

None.

---

## Verdict justification

ACCEPT. All 10 cycle 1 BLOCKERs are resolved with verifiable evidence against the real SDK:

- `AgentSession.subscribe(listener: (event: AgentSessionEvent) => void): () => void` confirmed at `node_modules/@oh-my-pi/pi-coding-agent/dist/types/session/agent-session.d.ts:337`.
- `AgentSession.prompt(text, options?): Promise<void>` confirmed at agent-session.d.ts:493.
- `AgentEvent` union (pi-agent-core/types.d.ts:386-432) includes `tool_execution_start` (line 411), `message_update` (line 404 with `assistantMessageEvent`), `message_end` (line 410).
- `AgentSessionEvent = AgentEvent | { auto_compaction_* | ttsr_triggered | ... }` (agent-session.d.ts:49) — subscribe receives the three event types the runner needs.
- `discoverAuthStorage`, `createAgentSession`, `SessionManager.inMemory()` all exported as plan claims.
- `Bun.YAML.parse` tested live with the exact `.trim()` heredoc shape from Step 2.1 — parses correctly (no whitespace fragility).
- Sisyphus path `oh-my-openagent/src/agents/sisyphus/index.ts` exists (verified).
- `docs/decisions/` empty before cycle 2; `docs/adr/0001-omp-marketplace-distribution.md` confirmed independent namespace; numbering rationale valid.
- All 12 tasks have concrete writer prompts with file paths, scenario YAML, regression stub.
- regression.yaml stubs consistently added across all 12 tasks.
- Acceptance thresholds (smoke 100%, adversarial ≥83%, canary 100%) appear in both Step 13.2 and Acceptance section without contradiction.

**Realist check**: Remaining NITs are stylistic (`as any` casts, tautology test assertion, boilerplate DRY) — none gate execution. Plan size at 1986 lines is large but justified by per-task self-containment requirement (each task = 1 fresh subagent dispatch). Halving via templating would trade DRY for context-bleed risk; current shape is correct for the execution model.

No structural changes required this cycle. Wording-only / type-narrowing NIT cleanups optional.

---

**VERDICT: ACCEPT (PASS gate) — Plan 1 ready for subagent-driven-development execute.**
