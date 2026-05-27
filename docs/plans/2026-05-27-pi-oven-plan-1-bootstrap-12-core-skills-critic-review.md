# Plan 1 Critic Review — Cycle 1

- **Date:** 2026-05-27
- **Reviewer:** critic (Opus 4.7 1M)
- **Plan:** `docs/plans/2026-05-27-pi-oven-plan-1-bootstrap-12-core-skills.md`
- **Spec:** `docs/specs/2026-05-27-pi-oven-foundation-design.md`
- **Verdict:** **REJECT** — eval runner's session contract is fabricated; runner cannot work as written.

---

## 1. 🔴 BLOCKER

1. **Task 2 / Step 2.4 / Step 2.6 — `session.prompt()` return shape is fabricated.** Plan code wraps `const out = await session.prompt(message); return { content: out?.content ?? "", toolCalls: out?.toolCalls ?? [] }`. Verified: `agent-session.ts:3934` signature is `async prompt(text, options?): Promise<void>` (returns nothing). Whole `runScenario` reading `lastResponse.content` / `lastResponse.toolCalls` always empty → every `agent_response_must_contain` + `tool_calls_required` assertion forced-FAIL or forced-PASS-by-vacuity. The eval runner does not eval. (Step 2.4 lines 378-398; Step 2.6 lines 485-488.)
2. **Task 2 / Step 2.4 — `SessionLike.toolCalls` capture path doesn't exist.** SDK emits tool activity via `session.subscribe(listener)` events (`tool_execution_start`, `message_update.tool_use`) per sdk.md §"Event subscription model" + agent-session.ts:7386 `tool_use/tool_result ordering`. Plan never subscribes. Must rewrite `makeSession()` to install subscriber that aggregates assistant text + tool_call events into a per-prompt buffer, then expose buffer at `prompt` resolution.
3. **Task 2 / Step 2.7 / Step 2.6 — `spawnSync` import wrong shape + `Bun.argv.slice(2)` wrong.** Step 2.7 `import { spawnSync } from "bun"` — verified works. But `await session.prompt(text)` in Step 2.6 then probing `out?.toolCalls` (BLOCKER #1) will compile because of `?.` chain (silent undefined) → no TDD failure, scenario forever vacuously passes assertion-less paths. TDD "Green" in Step 2.5 is fake.
4. **Task 2 / Step 2.1 unit test — `runScenario` test expectation impossible.** `fakeSession.prompt()` returns `{ content, toolCalls }`. Real `session.prompt()` returns `void`. Test PASSES against fake but driver in Step 2.6 returns `{ content: "", toolCalls: [] }` permanently → integration broken silently. TDD test does not catch the real contract.
5. **Task 2 / Step 2.4 — `tool_calls_forbidden_first` / `agent_response_must_not_contain` / `agent_must_resist_pressure` / `skill_must_force_grep_first` / `agent_response_must_explain` declared in schema (lines 320-326) but `runScenario` (lines 384-398) only implements `tool_calls_required` + `agent_response_must_contain`. Five expectation fields are silently ignored. Scenarios in Task 1 + Task 3 + Task 12 use these fields → all those adversarial scenarios non-evaluable.
6. **Task 13 / Step 13.2 — Acceptance arithmetic broken.** Threshold `smoke ≥ 95%` over 12 smoke + 12 adversarial = 23/24 pass required, BUT spec/plan also says `adversarial ≥ 80%` separately. Plan text "smoke pass rate ≥ 95%" then "(≥ 23/24 since 12 smoke + 12 adversarial)" conflates the two suites. 23/24 across BOTH = 95.8% — but pure-smoke threshold over 12 smoke = 95% needs 11.4 → 12/12 required. Acceptance gate non-deterministic.
7. **Task 12 / Step 12.3 — `pressure-test` tag listed but `runScenario` only handles `smoke|adversarial|regression|pressure-test|canary` at the SCHEMA level — there is NO runner branch that does multi-turn LLM-as-judge. Step 12.3 says "LLM-as-judge fallback OK" but Step 2.4 runner code has zero LLM-as-judge logic. `pressure-test` scenarios will execute as plain multi-turn → meaningless verdict.
8. **Task 13 / Step 13.3 — `dogfood` scenario uses `expected.state_transition_must_reach`** but this field is NOT in `ScenarioExpectation` interface (Step 2.3 lines 317-326) and NOT in `runScenario` matcher. Canary scenario non-evaluable.
9. **Task 13 / Step 13.5 — `docs/decisions/0002-dogfood-switch.md` numbered 0002 but `docs/decisions/` directory empty (verified `ls` returns no 0001\*). No ADR 0001 exists → numbering gap.
10. **Task 12 dependency chain — `autonomous-loop` SKILL.md is written by writer subagent but plan claims it INVOKES the other 11 skills.** Without TS extension state-machine code (Plan 3 scope per Q4 LOCKED), the SKILL.md is just a markdown directive — `state_transition_must_reach: CYCLE_COMPLETE` (Step 13.3) has no state machine to transition. Canary dogfood test cannot pass at Plan 1 maturity.

---

## 2. 🟡 NIT

1. Task 0 Step 0.2 `PI_OVEN_CYCLE_EXIT_VERIFIED=1 git push` for empty `.gitkeep` scaffolding bypasses verifier needlessly.
2. Task 2 line 357 `// @ts-expect-error Bun.YAML is at runtime` — Bun.YAML IS typed via bun-types (verified `typeof Bun.YAML === 'object'`); directive will produce TS error "unused @ts-expect-error".
3. Task 2 Step 2.5 "Expected: PASS, 3 of 3 tests passing" — Step 2.1 declares 2 `describe parseScenario` tests + 1 `describe runScenario` test = 3 total. Math holds but assertion is on broken contract (see BLOCKER #4).
4. Tasks 5/8/11 "Step N.2-N.5: Standard cycle" with no concrete writer prompt — under-specified for fresh subagent.
5. Plan never names the 12 skills in summary form against Section 1-ter Plan 1 preview (spec line 121). Hand-count required to confirm coverage.
6. Task 12 source line 820 references `omo Sisyphus pattern` but no explicit source SKILL.md path — verified `oh-my-openagent/` has no `skills/sisyphus/`. Vague.
7. Task 2 Step 2.10 `Note: actual session uses real LLM; if no key configured, exit code 2 (catch and proceed manually)` — eval result accepted without LLM call defeats the eval.
8. Task 7 Step 7.1 "cross-vendor critic via omp multi-provider (Codex + Zen 동시 task fan-out, no external codex CLI shell-out)" — spec Section 1-ter Phase 3 says "smoke + cross-vendor benchmark (Zen 다양)"; plan changes the contract to also-Codex without note.
9. Plan code blocks indent YAML inside scenario files with leading whitespace from `.trim()` heredocs (Step 2.1 line 252) — runtime `Bun.YAML.parse` is whitespace-sensitive at column 0; tests may fail on parse before assertion.
10. Spec line 81 says `evals/<skill>/scenarios/*.yaml`; Plan creates `regression.yaml` stub (line 43) but no Task creates the stub file content — only `smoke.yaml` + `adversarial.yaml` per task.
11. Task 13 Step 13.2 `--out /tmp/plan1-smoke.jsonl` then Step 13.4 `cp /tmp/...` to docs — `/tmp` is gitignored on macOS reboot, but Step 13.4 runs same cycle so survives. OK.

---

## 3. ⚪ PUSH-BACK

1. None applicable — plan respects all LOCKED priors (omp-only, 12 first, distributed SoT, subagent-driven-development execute, codename "pi-oven" preserved, install id `pi-oven@pi-oven`).

---

## Ralplan summary row

- **Principle/Option Consistency**: FAIL — runner-real-impl axiom (Task 2 = TDD-tested working runner) violated by fabricated `session.prompt` return shape.
- **Alternatives Depth**: N/A (plan, not ralplan).
- **Risk/Verification Rigor**: FAIL — TDD Green claim in Step 2.5 is fake-passing because fake session returns shape real session doesn't. Failure-modes table addresses scenario-bug but not contract-bug.
- **Deliberate Additions**: N/A.

---

## Verdict justification

REJECT. The eval runner — the whole reason Task 2 exists — is built on a non-existent `session.prompt()` return contract. Five of nine expectation fields are silently ignored. `pressure-test` and `canary` scenarios reference matcher fields that don't exist. Acceptance threshold math is internally inconsistent. Task 12 promises state-machine assertions for a skill whose TS extension implementation is explicitly deferred to Plan 3. Self-review checklist (line 988) is sycophantic — none of these contract bugs surfaced.

To upgrade to ACCEPT: (a) rewrite Step 2.4-2.6 to use `session.subscribe()` event aggregator pattern with documented `tool_execution_start` + `message_update` capture; (b) implement all schema fields in `runScenario` or remove them from schema; (c) fix acceptance math (separate smoke / adversarial / regression thresholds with explicit pass counts); (d) drop or feature-flag `state_transition_must_reach` until Plan 3 state machine lands; (e) rename ADR 0001 first or justify the gap.

Realist check: BLOCKERS #1-#5 stay CRITICAL — broken eval is the entire Plan 1 stop-condition. Cannot downgrade.
