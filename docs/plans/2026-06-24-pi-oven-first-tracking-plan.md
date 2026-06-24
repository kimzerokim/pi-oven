# Pi-oven-first tracking implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `pi-oven:executor` task-by-task under TDD-strict. Steps use checkbox syntax for tracking.

**Goal:** In pi-oven sessions, automatic routing and tracing must resolve to pi-oven-owned agents and skills first, while user-explicit foreign namespaces remain allowed and observable.

**Architecture:** Split ownership into two explicit paths: agent canonicalization and skill canonicalization. Agent ownership is enforced at dispatch-time and gate-time; skill ownership is enforced at runtime-match, gate-credit, and state-persistence time. Setup/status surfaces must explain the policy truthfully without turning clean-room isolation into the default.

**Tech Stack:** TypeScript, Bun, omp extension runtime, setup CLI, existing plugin/eval test harness.

## Global Constraints

- Branch contract: `feature/pi-oven-first-tracking`, direct commits only.
- Policy is **pi-oven-first**, not pi-oven-only.
- User-explicit foreign namespace use remains allowed; automatic foreign namespace drift must not.
- Clean-room isolation remains opt-in and niche; sibling suppression is the preferred conflict-control surface.
- No unrelated registry rewrite, no broad refactor, no removal of `kzk:*` assets from the repo.
- TDD strict applies to all source changes.
- Keep scope tight to the minimum safe edit set identified in `docs/harness/surveys/2026-06-24-pi-oven-first-tracking-survey.md`.

## Acceptance Criteria

1. A pi-oven-owned automatic task dispatch can only succeed when its final agent target is `pi-oven:<role>`.
2. A user-explicit foreign task dispatch remains allowed and traceable as explicit foreign intent.
3. A pi-oven-owned automatic skill load cannot be silently satisfied by a foreign bare/global skill.
4. If pi-oven-owned skill ownership cannot be proven, the flow fail-closes with a diagnostic reason instead of falling through.
5. Ownership tracing records `origin`, `kind`, `requested`, `canonical`, `resolved`, `status`, and `reason` for automatic resolution paths.
6. Setup/status/truth-surface output describes pi-oven-first default, sibling suppression, and clean-room isolation without claiming the wrong precedence.
7. Existing mixed-registry tests and new ownership tests pass without changing user-explicit foreign behavior.

## Dependencies

- Task 1 establishes the ownership state/shape used by Task 2 and Task 3.
- Task 2 (agent canonicalization) and Task 3 (skill ownership) both depend on Task 1, but are otherwise parallel-safe after the shared state contract is frozen.
- Task 4 (setup/status/truth surface) depends on Task 2 and Task 3 because it must describe actual runtime behavior, not aspirational wording.
- Task 5 (integration/evals/docs parity) depends on all earlier tasks.

## Execution Waves

- Wave 1: Task 1
- Wave 2: Task 2, Task 3
- Wave 3: Task 4
- Wave 4: Task 5

## Frozen

This plan is frozen against `docs/plans/2026-06-24-pi-oven-first-tracking-design.md` and `docs/harness/surveys/2026-06-24-pi-oven-first-tracking-survey.md`.

---

### Task 1: Freeze ownership state contract

**Files:**
- Modify: `.omp/extensions/pi-oven-runtime/gate-state.ts:20-29,76-100`
- Modify: `.omp/extensions/pi-oven.ts:525-550,737-748`
- Test: `tests/extensions/pi-oven-runtime/wiring.test.ts`
- Test: `tests/extensions/pi-oven-runtime/gate-handler.test.ts`

**Interfaces:**
- Consumes: current gate state fields `requiredSkills`, `skillReads`, `requiredSkillsMessageId`, existing dispatch log support.
- Produces: explicit ownership-resolution state shape for downstream runtime and gate logic. Freeze these concrete additions in Task 1 so later tasks do not guess: `ownershipTrace` entries carrying `origin`, `kind`, `requested`, `canonical`, `resolved`, `status`, `reason`; `explicitForeignAgents` carrying exact user-explicit foreign agent names allowed for the current turn; and `ownedSkillReadTargets` carrying the exact plugin-owned SKILL.md read targets that count for pi-oven skill credit.

- [ ] **Step 1: Write failing tests for ownership-state persistence**
  - Add a wiring test asserting pi-oven-owned automatic state persists canonical vs resolved values instead of only raw strings.
  - Add a state-level test asserting `explicitForeignAgents` is persisted from latest-user-message analysis and survives the gate read/write cycle.
  - Add a gate-handler/state-level test asserting ownership trace entries and `ownedSkillReadTargets` are preserved across mutate/read cycles.

- [ ] **Step 2: Run targeted tests and confirm Red**
  - Run: `bun test tests/extensions/pi-oven-runtime/wiring.test.ts`
  - Run: `bun test tests/extensions/pi-oven-runtime/gate-handler.test.ts`
  - Expected: failures on missing ownership-state fields or missing persisted trace.

- [ ] **Step 3: Implement the minimum shared state contract**
  - Add typed ownership-resolution state support in `gate-state.ts`.
  - Add a runtime-owned allowlist field for exact user-explicit foreign dispatches (for example `explicitForeignAgents`) so Task 2 can distinguish explicit `kzk:<role>` from automatic drift without guessing from raw task input.
  - Add a runtime-owned proof list for pi-oven skill credit (for example `ownedSkillReadTargets`) so Task 3 can measure ownership from exact plugin-owned read targets instead of the untrusted requested path alone.
  - Update the runtime wiring in `pi-oven.ts` so required-skill / ownership state writes can carry the new trace metadata and explicit-user allowlist data.

- [ ] **Step 4: Re-run targeted tests to Green**
  - Same commands as Step 2.
  - Expected: new persistence assertions pass.

- [ ] **Step 5: Commit**
  - Commit message: `feat(runtime): add ownership resolution state contract`

---

### Task 2: Enforce pi-oven-first agent canonicalization

**Files:**
- Modify: `.omp/extensions/pi-oven-runtime/gate-handler.ts:83-92,188-196`
- Modify: `.omp/extensions/pi-oven-runtime/rules-injector.ts:210-225`
- Modify: `.omp/extensions/pi-oven.ts:217-338,457`
- Test: `tests/extensions/pi-oven-runtime/gate-handler.test.ts:371-398`
- Test: `tests/extensions/pi-oven-runtime/rules-injector.test.ts:190-228`
- Test: `tests/extensions/pi-oven.test.ts:78-220`

**Interfaces:**
- Consumes: Task 1 ownership trace contract.
- Produces: deterministic agent-resolution behavior for `pi-oven-auto` vs `user-explicit` dispatch paths.

- [ ] **Step 1: Write failing tests for agent origin/canonicalization**
  - Case A: pi-oven auto bare role -> canonical `pi-oven:<role>`.
  - Case B: pi-oven auto foreign namespace -> blocked or rewritten with diagnostic trace.
  - Case C: user-explicit `kzk:<role>` -> preserved as explicit foreign intent.

- [ ] **Step 2: Run agent-resolution tests to Red**
  - Run: `bun test tests/extensions/pi-oven-runtime/gate-handler.test.ts`
  - Run: `bun test tests/extensions/pi-oven-runtime/rules-injector.test.ts`
  - Run: `bun test tests/extensions/pi-oven.test.ts`
  - Expected: current behavior fails at least one origin/canonicalization case.

- [ ] **Step 3: Implement minimum agent resolver changes**
  - Introduce or tighten explicit origin classification for task dispatch events.
  - Ensure pi-oven-owned automatic flows canonicalize to `pi-oven:<role>` before registry validation.
  - Preserve explicit foreign user choice.
  - Emit ownership trace for resolved, rewritten, and blocked cases.
  - Keep prompt guidance (`rules-injector.ts`) and hard gate logic (`gate-handler.ts`) aligned.

- [ ] **Step 4: Re-run agent-resolution tests to Green**
  - Same commands as Step 2.

- [ ] **Step 5: Commit**
  - Commit message: `feat(runtime): enforce pi-oven-first agent dispatch ownership`

---

### Task 3: Enforce pi-oven-owned skill canonicalization and fail-closed gating

**Files:**
- Modify: `.omp/extensions/pi-oven-runtime/skill-keyword-loader.ts:9-220,313-428`
- Modify: `.omp/extensions/pi-oven-runtime/gate.ts:87-90,168-173`
- Modify: `.omp/extensions/pi-oven-runtime/gate-handler.ts:83-149`
- Modify: `.omp/extensions/pi-oven.ts:525-550,607-616,737-748`
- Modify: `scripts/pi-oven-setup/shipped-skill-registry.ts`
- Optional only if required by implementation: `.claude-plugin/plugin.json`
- Test: `tests/extensions/pi-oven-runtime/skill-keyword-loader.test.ts:45-160`
- Test: `tests/extensions/pi-oven-runtime/gate.test.ts:244-272`
- Test: `tests/extensions/pi-oven-runtime/gate-handler.test.ts:255-283`
- Test: `tests/extensions/pi-oven-runtime/wiring.test.ts:398-448`
- Test: `tests/plugin/skill-discoverability.test.ts:21-50`
- Test: `tests/plugin/skill-count.test.ts:43-52`

**Interfaces:**
- Consumes: Task 1 ownership state contract, including `ownedSkillReadTargets`.
- Produces: canonical pi-oven-owned skill proof that does not silently pass through to foreign bare/global skills. Freeze the proof path here: pi-oven automatic skill ownership is proven by exact reads of plugin-owned SKILL.md paths derived from `shipped-skill-registry.ts`, not by trusting foreign bare `skill://<name>` resolution.

- [ ] **Step 1: Write failing tests for skill ownership**
  - Case A: pi-oven automatic skill match cannot be satisfied by foreign bare skill.
  - Case B: unresolved plugin-owned skill proof path -> blocked with diagnostic reason.
  - Case C: required-skill credit is only granted for an exact target path listed in `ownedSkillReadTargets`.
  - Case D: shipped skill registry parity still holds after adding ownership metadata/helper logic.

- [ ] **Step 2: Run skill/gate tests to Red**
  - Run: `bun test tests/extensions/pi-oven-runtime/skill-keyword-loader.test.ts`
  - Run: `bun test tests/extensions/pi-oven-runtime/gate.test.ts`
  - Run: `bun test tests/extensions/pi-oven-runtime/gate-handler.test.ts`
  - Run: `bun test tests/extensions/pi-oven-runtime/wiring.test.ts`
  - Run: `bun test tests/plugin/skill-discoverability.test.ts`
  - Run: `bun test tests/plugin/skill-count.test.ts`

- [ ] **Step 3: Implement minimum skill-ownership path**
  - Add explicit canonical skill mapping helpers in `shipped-skill-registry.ts`, including a function that derives the exact plugin-owned SKILL.md read target for each shipped skill.
  - Update `skill-keyword-loader.ts` so pi-oven automatic skill intent emits and records plugin-owned read targets derived from the shipped registry, instead of relying on implicit foreign bare fallback or unresolved `skill://pi-oven:*` assumptions.
  - Update `pi-oven.ts` and `gate-state.ts` so `ownedSkillReadTargets` is persisted alongside `requiredSkills`.
  - Update gate credit logic so pi-oven-owned success is measured from exact proof-path matches in `ownedSkillReadTargets`, not from any foreign/bare requested read string.
  - Update reminder/wiring code in `pi-oven.ts` and `gate.ts` so blocked cases explain ownership failure clearly.
  - Touch `plugin.json` only if discoverability or shipped-registry parity demands it; otherwise leave manifest paths unchanged.

- [ ] **Step 4: Re-run skill/gate tests to Green**
  - Same commands as Step 2.

- [ ] **Step 5: Commit**
  - Commit message: `feat(runtime): fail-close automatic skill ownership outside pi-oven`

---

### Task 4: Align setup, status, and truth-surface policy output

**Files:**
- Modify: `scripts/pi-oven-setup/config-yml.ts:627-903`
- Modify: `scripts/pi-oven-setup.ts:176-211,323-325`
- Modify: `scripts/pi-oven-setup/standalone-truth-surface.ts:104-134,254-279`
- Modify: `scripts/pi-oven-setup/project-settings.ts:191-326` only if project-scope policy output must mirror the new default
- Test: `tests/scripts/pi-oven-setup/config-yml.test.ts`
- Test: `tests/scripts/pi-oven-setup/status.test.ts:421-505`
- Test: `tests/scripts/pi-oven-setup-cli.test.ts:658-766`
- Test: `tests/scripts/pi-oven-setup/suppress-sibling.test.ts:80-243`
- Test: `tests/scripts/pi-oven-setup/isolate.test.ts:31-83`
- Test: `tests/plugin/pi-oven-doctor.test.ts:154-190`

**Interfaces:**
- Consumes: runtime ownership policy from Task 2 and Task 3.
- Produces: truthful policy/status/setup wording and persisted config semantics for pi-oven-first vs sibling-suppressed vs clean-room.

- [ ] **Step 1: Write failing tests for policy surface**
  - Verify setup/status output describes pi-oven-first as default.
  - Verify sibling suppression remains selective.
  - Verify clean-room/isolate messaging explicitly warns about home-layer/kzk loss without claiming it is the default fix.

- [ ] **Step 2: Run setup/status tests to Red**
  - Run: `bun test tests/scripts/pi-oven-setup/config-yml.test.ts`
  - Run: `bun test tests/scripts/pi-oven-setup/status.test.ts`
  - Run: `bun test tests/scripts/pi-oven-setup-cli.test.ts`
  - Run: `bun test tests/scripts/pi-oven-setup/suppress-sibling.test.ts`
  - Run: `bun test tests/scripts/pi-oven-setup/isolate.test.ts`
  - Run: `bun test tests/plugin/pi-oven-doctor.test.ts`

- [ ] **Step 3: Implement minimum policy-surface changes**
  - Keep `skills.ignoredSkills` and `disabledProviders` behavior scoped and non-destructive.
  - Make pi-oven-first the described/advertised default lane.
  - Ensure doctor/status/truth-surface output matches the real runtime ownership model and does not overclaim namespaced skill resolver support unless runtime truly provides it.
  - Update project settings only if project-scope truth output must mirror the new policy.

- [ ] **Step 4: Re-run setup/status tests to Green**
  - Same commands as Step 2.

- [ ] **Step 5: Commit**
  - Commit message: `feat(setup): align pi-oven-first policy surfaces`

---

### Task 5: Close integration, trace, and parity regressions

**Files:**
- Modify: only files proven necessary after Tasks 1-4 green
- Test: `tests/extensions/pi-oven-runtime/wiring.test.ts`
- Test: `tests/extensions/pi-oven.test.ts`
- Test: `tests/plugin/skill-discoverability.test.ts`
- Test: `tests/plugin/skill-count.test.ts`
- Optional regression surfaces if touched by implementation: `tests/plugin/pi-oven-doctor.test.ts`, `tests/scripts/pi-oven-setup-cli.test.ts`

**Interfaces:**
- Consumes: all prior tasks.
- Produces: final mixed-registry and parity confidence.

- [ ] **Step 1: Write the final failing mixed-registry / trace assertions**
  - Add or extend integration tests so both `kzk:*` and `pi-oven:*` can coexist while pi-oven-owned automatic flows still resolve to pi-oven only.
  - Assert final trace shape includes requested/canonical/resolved/origin/status/reason.

- [ ] **Step 2: Run final integration tests to Red**
  - Run: `bun test tests/extensions/pi-oven-runtime/wiring.test.ts`
  - Run: `bun test tests/extensions/pi-oven.test.ts`
  - Run: `bun test tests/plugin/skill-discoverability.test.ts`
  - Run: `bun test tests/plugin/skill-count.test.ts`

- [ ] **Step 3: Implement only the minimum integration glue**
  - Patch any remaining wiring gaps discovered after earlier task-local changes.
  - Do not widen scope into unrelated provider or registry cleanup.

- [ ] **Step 4: Run the final targeted suite to Green**
  - Same commands as Step 2, plus any earlier test files that became regression-sensitive.

- [ ] **Step 5: Commit**
  - Commit message: `test(runtime): lock mixed-registry pi-oven-first ownership`

---

## Final verification sequence

- [ ] `bun test tests/extensions/pi-oven-runtime/skill-keyword-loader.test.ts`
- [ ] `bun test tests/extensions/pi-oven-runtime/gate.test.ts`
- [ ] `bun test tests/extensions/pi-oven-runtime/gate-handler.test.ts`
- [ ] `bun test tests/extensions/pi-oven-runtime/wiring.test.ts`
- [ ] `bun test tests/extensions/pi-oven.test.ts`
- [ ] `bun test tests/scripts/pi-oven-setup/config-yml.test.ts`
- [ ] `bun test tests/scripts/pi-oven-setup/status.test.ts`
- [ ] `bun test tests/scripts/pi-oven-setup-cli.test.ts`
- [ ] `bun test tests/scripts/pi-oven-setup/suppress-sibling.test.ts`
- [ ] `bun test tests/scripts/pi-oven-setup/isolate.test.ts`
- [ ] `bun test tests/plugin/skill-discoverability.test.ts`
- [ ] `bun test tests/plugin/skill-count.test.ts`
- [ ] `bun test tests/plugin/pi-oven-doctor.test.ts`
- [ ] `bun run check`

## Open risks to watch during execution

- The skill proof path is frozen to plugin-owned SKILL.md targets derived from the shipped registry. Executor must not reopen the namespaced-vs-bare strategy question unless targeted tests prove that proof path cannot work.
- `plugin.json` should stay untouched unless manifest/discoverability parity truly requires it.
- Setup/status wording must only describe behavior the runtime actually enforces after Tasks 1-3 land.
