# Codex review — skill:// namespace routing design (cycle 2)

> Reviewer: codex-cli 0.136.0 (high, read-only, ephemeral)
> Target: `docs/plans/2026-06-08-skill-namespace-routing-design.md` (cycle-2 revision)
> Cycle: 2 · Previous: `skill-namespace-routing-critic-review.md` · BLOCKERs resolved since cycle 1: 3 (B1, B2, B3-as-stated)
> Gate decision: **PASS** (after the cycle-3 descope/NIT folds below — 0 remaining BLOCKER)

## Synthesis

### Cycle-1 resolutions confirmed
- §3.2 robust parse — **resolved**. Covers all 4 forms; double-namespace/percent-encode are
  out-of-contract (runtime never emits them). Keep null-on-empty after stripping (`skill://pi-oven:`).
- §3.6 — skill-body set complete (10 SKILL.md; none in references/commands/README). lint-skills.ts +
  lint-skills.test.ts already in scope. One extra non-live teaching ref: `docs/specs/2026-05-27-pi-oven-foundation-design.md:63` → fold into §3.6.

### 🔴 cycle-2 BLOCKER → resolved by descope (⚪ evidence-backed push-back)
- **§3.7 eval harness.** Codex: normalize-by-stripping in `eval-runner.ts` is insufficient because
  `run-eval.ts:168-170` records only the tool NAME (`b.name` = "read") on `tool_execution_start`, not
  `args.path`; proper fix forwards `args.path`.
  **Verification (run-eval.ts:168-170 + eval-runner.ts:195):** live `run-eval` sessions forward
  `toolName:"read"` with NO path, so `lastBuf.toolCalls.some(n => n.includes("skill://..."))` already
  never matches a URI in real sessions — the URI-based skill_read detection is a **pre-existing latent
  gap, NOT regressed by namespacing**. The unit tests (`eval-runner.test.ts`) assert a combined-string
  MOCK model and stay green because `eval-runner.ts` is left untouched.
  **Decision:** DESCOPE §3.7 from this change; track the proper fix (forward `tool_execution_start.args.path`
  through run-eval → eval-runner + update tests) as a separate follow-up in `docs/harness/user-queue.md`.
  This eliminates the only cycle-2 BLOCKER (no regression to fix here).

### 🟡 cycle-2 NITs → folded (cycle 3)
- §3.4: `--suppress-sibling-skills` scope is GLOBAL-only; define behavior under `--scope project`
  (reject/no-op; never touch project `.omp/settings.json`). `--reset` clears global globs only.
- §3.4: `PI_OVEN_MOCK_SPAWN` + setup CLI array-key handling must learn `skills.ignoredSkills` is an
  array key (like `disabledProviders`) so mock-backed CLI tests exercise union-merge.
- §3.5: test plan must add assertion updates in `skill-keyword-loader.test.ts`, `wiring.test.ts`,
  `rules-injector.test.ts` (+ already-listed gate-handler + lint-skills tests).

## Gate
Cycle-3 changes = §3.7 descope (push-back) + NIT folds + 1 historical-doc line — no NEW structural
addition. Per kzk-spec-and-review Gate (PASS = 0 BLOCKER + NIT/push-back-only changes) → **PASS**.
No cycle-3 codex round required. Proceed to writing-plans → TDD implementation.
