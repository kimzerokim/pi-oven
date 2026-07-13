> Historical; do not copy runtime syntax examples from this document.

# Session findings fixes — Implementation Plan

> Execute on `feature/skill-chain-enforcement`, direct commits, no PR.
> Source spec: `docs/plans/2026-06-04-session-findings-fixes-design.md`.
> Survey: `docs/plans/2026-06-04-open-problems-survey.md`.

**Goal:** Resolve the four open problems found this session (model failover
config, dead `blocked_tools`, dead code/slop, helper test gaps) with focused,
test-backed changes.

**Tech:** TypeScript, bun test. Setup wizard modules + runtime extension + CI lints.

---

## Task 1 — P1 model failover config (setup wizard)

**Files**
- Modify: `scripts/pi-oven-setup/profiles.ts` — add `retryFallbackChains` to each
  profile (keyed by modelRole name), derived from the zen equivalents of
  `modelRoles`.
  - PROFILE_A: `{ default: ["opencode-zen/gpt-5.4"], title: ["opencode-zen/gpt-5.4-mini"] }`
  - PROFILE_B: mirror with its own modelRoles' zen equivalents (keep DEFERRED
    profile internally consistent; do not change its model ids).
- Modify: `scripts/pi-oven-setup/config-yml.ts` — add `setRetryFallbackChains(chains: Record<string,string[]>)`
  mirroring `setModelRoles` (`:300-319`); writes `retry.fallbackChains` via the
  same `omp config set` path.
- Modify: `scripts/pi-oven-setup/apply.ts` — in `runApply` (`:63-80`) call
  `setRetryFallbackChains(profile.retryFallbackChains)` right after
  `setModelRoles`.
- Test: `tests/scripts/pi-oven-setup/config-yml.test.ts` (create or extend) —
  `setRetryFallbackChains` round-trips the record.
- Test: `tests/scripts/pi-oven-setup-cli.test.ts` — after `--apply`, the written
  config contains `retry.fallbackChains.default` with the zen selector.

**Steps**
1. Write failing test: apply writes `retry.fallbackChains`.
2. Add `retryFallbackChains` to PROFILE_A/PROFILE_B.
3. Add `setRetryFallbackChains` writer.
4. Wire it into `runApply`.
5. Run targeted tests → green.

**Acceptance:** `--apply` produces `retry.fallbackChains: { default:
["opencode-zen/gpt-5.4"], title: ["opencode-zen/gpt-5.4-mini"] }` in the config
writer; selectors parse per `provider/id`.

---

## Task 2 — P2 blocked_tools lint invariant + docs

**Files**
- Modify: `scripts/lint-agents.ts` — near existing tool checks (`:156-188`,
  `:98-114`) add:
  1. FAIL if a role has `tools` containing `"*"` AND `blocked_tools` non-empty.
  2. FAIL if `tools ∩ blocked_tools ≠ ∅`.
  - Apply to the effective parsed frontmatter of every `agents/pi-oven-*.md`.
- Modify: `docs/specs/2026-05-28-pi-oven-agent-registry.md` — add a note that
  `tools:` is the only enforced boundary; `blocked_tools` is advisory and lint
  keeps it consistent (no `*`+block contradiction, no overlap).
- Test: `tests/scripts/lint-agents.test.ts` — add pass case (constrained role
  allowlist) and two fail cases (`*`+block; overlap).

**Steps**
1. Write failing tests for the two invariants.
2. Implement the checks.
3. Run lint + targeted tests → green; confirm all 24 current agents still pass
   `bun run lint:agents`.

**Acceptance:** A constructed agent with `tools:["*"]` + `blocked_tools:["edit"]`
fails lint; an agent with `tools:["read","edit"]` + `blocked_tools:["edit"]`
fails lint; current registry passes.

---

## Task 3 — P3 remove dead code + AI-slop

**Files**
- Modify: `.omp/extensions/pi-oven.ts` — delete `syncPiOvenAgentMirrors` function
  + its `export` + the `AgentMirrorSyncResult` type if now unused; remove the
  stream-of-consciousness comments at `captureSessionModel` (`:274-279`) and the
  mirror-removal note, leaving one concise comment.
- Modify: `tests/extensions/pi-oven.test.ts` — remove the syncPiOvenAgentMirrors
  describe/it block(s) (`:208-275`) and any now-unused imports.

**Steps**
1. Confirm no remaining caller (grep `syncPiOvenAgentMirrors`).
2. Delete function + export + type + tests.
3. Clean the comments.
4. Run targeted tests + `bun run check` → green.

**Acceptance:** `grep syncPiOvenAgentMirrors` returns nothing; `bun run check`
clean; `tests/extensions/pi-oven.test.ts` green without the removed block.

---

## Task 4 — P4 gate-handler helper unit tests

**Files**
- Modify: `.omp/extensions/pi-oven-runtime/gate-handler.ts` — export the pure
  helpers (`isCodeWriteTool`, `getTargetPath`, `getSkillReadName`,
  `toGateFsmView`) if not already exported.
- Test: `tests/extensions/pi-oven-runtime/gate-handler.test.ts` — add direct
  unit tests:
  - `isCodeWriteTool`: write/edit/ast_edit → true; read/bash → false.
  - `getTargetPath`: returns `input.path` when string, else null.
  - `getSkillReadName`: `skill://autonomous-loop` → `autonomous-loop`;
    non-skill / non-read → null.
  - `toGateFsmView`: OK/CORRUPT/ABSENT mapping.

**Steps**
1. Export helpers.
2. Write unit tests.
3. Run targeted test → green.

**Acceptance:** New unit tests pass; no regression in existing gate-handler tests.

---

## Final verification + commits
- `bun run check && bun run lint:agents && bun run lint:skills && bun test` →
  all green (full suite).
- Fresh `pi-oven:verifier` PASS before final commit boundary.
- Commit per task (semantic subjects, no PR, no push):
  1. `feat(setup): write retry.fallbackChains so codex roles fail over to opencode-zen`
  2. `fix(lint): enforce blocked_tools/tools consistency as the real boundary`
  3. `refactor(runtime): remove dead agent-mirror sync and slop comments`
  4. `test(runtime): cover gate-handler helper functions`
- `bun run build` to refresh local dist (untracked).
