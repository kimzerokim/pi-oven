## Goal

`skills.includeSkills = ["pi-oven:*"]` 중심의 owned workflow skill-surface cutover를 먼저 구현하고, 그 ownership truth 위에 setup truth / autonomy parity / notice hardening / `pi-oven_ask` spacing polish를 재정렬하며, bootstrap-level gajae parity는 별도 secondary OMP/architecture track으로 분리한다.

## Architecture

- **Owned skill-surface cutover lane**: `.omp/extensions/pi-oven.ts`, `scripts/pi-oven-setup/{config-yml,project-config,status,standalone-truth-surface}.ts`, `scripts/pi-oven-setup.ts`, `commands/{setup,doctor}.md`, `README.md`, ownership/setup tests. Canonical policy는 effective `skills.includeSkills = ["pi-oven:*"]`.
- **Ownership truth / compatibility lane**: `.omp/extensions/pi-oven.ts`, `scripts/pi-oven-setup/{config-yml,isolate,suppress-sibling,status,standalone-truth-surface}.ts`, `scripts/pi-oven-setup.ts`, `commands/{setup,doctor}.md`, `README.md`, ownership diagnostics tests. empty `~/.claude/skills` insufficiency와 `claude-plugins` caveat를 여기에 고정한다.
- **Setup truth lane**: `.omp/extensions/pi-oven.ts`, `scripts/pi-oven-setup/{project-config,status}.ts`, `scripts/pi-oven-setup.ts`, setup/runtime status tests.
- **Autonomy parity lane**: `.omp/extensions/pi-oven-runtime/{gate-state,project-state,gate,gate-handler,autonomous-stop-guard,continuation-marker}.ts`, `.omp/extensions/pi-oven.ts`, autonomy/wiring tests.
- **Hardening / UI lane**: `.omp/extensions/pi-oven.ts`, `.omp/extensions/pi-oven-runtime/pi-oven-ask.ts`, `commands/{setup,doctor}.md`, `README.md`, notice/render tests.
- **Secondary bootstrap-parity track**: current repo mainline 밖에서 OMP/provider bootstrap, plugin-skill gating, native-mirror architecture를 다루는 follow-on architecture track. Task 1 blocker가 아니다.
- **Secondary repo-local candidate**: skills/agents/commands를 native `.omp` surfaces로 mirror한 뒤 `disabledProviders`를 결합하는 practical-equivalence branch. 현재 mainline을 대체하지 않고 secondary ownership track으로만 다룬다.

## Tech Stack

- TypeScript / Bun runtime under `.omp/extensions/`, `.omp/extensions/pi-oven-runtime/`, `scripts/pi-oven-setup/`
- OMP settings surfaces under global `~/.omp/agent/config.yml` and project `.omp/settings.json`
- Markdown command/help surfaces under `commands/` and `README.md`
- Bun test runner for targeted runtime/setup/plugin suites
- Existing repo-native state surfaces under `.pi-oven/state/` and setup metadata under `.pi-oven/config.json`

## Delivery invariants

- Scope stays **workflow skills only** for ownership. Do not silently expand into commands/agents/hooks/MCP server exclusivity.
- Empty `~/.claude/skills` or `claude`-only isolation is insufficient because the real requirement is stronger: even when Claude user workflow skills are populated, ownership mainline must ignore/filter that source for pi-oven workflow-skill truth, and this alone does not suppress `claude-plugins` / namespaced marketplace workflow skills.
- `--isolate` and `--suppress-sibling-skills` remain compatibility aids only, never the canonical ownership proof.
- Bootstrap-level gajae parity stays a secondary OMP/architecture track, not a blocker for the immediate repo-local owned-surface cutover.
- Setup truth comes from routing state, not from `setupCompletedAt` alone.
- Autonomy parity must preserve branch/approval/skill-proof gates and persist blocked reason + next action + same-repo/branch resume target.
- Duplicate setup warning hardening and `pi-oven_ask` option spacing both land in the final hardening/UI tranche.

## Goal-to-task traceability

- **Spec Goal 1 (immediate owned skill-surface cutover)** -> Task 1
- **Spec Goal 2 (compatibility-aid demotion + empty `~/.claude/skills` finding + secondary bootstrap track)** -> Task 2
- **Spec Goal 3 (routing-truth-based setup UX / false `✗` removal)** -> Task 3
- **Spec Goal 5 (autonomy parity with durable restart target)** -> Task 4
- **Spec Goal 4 + 6 (duplicate warning hardening + ask option spacing)** -> Task 5

---

### Task 1 — Cut over the workflow skill surface to `includeSkills` mainline

**Depends on**
- none

**Files**
- Modify:
  - `.omp/extensions/pi-oven.ts`
  - `scripts/pi-oven-setup/config-yml.ts`
  - `scripts/pi-oven-setup/project-config.ts`
  - `scripts/pi-oven-setup/status.ts`
  - `scripts/pi-oven-setup/standalone-truth-surface.ts`
  - `scripts/pi-oven-setup.ts`
  - `commands/setup.md`
  - `commands/doctor.md`
  - `README.md`
- Test:
  - `tests/extensions/pi-oven.test.ts`
  - `tests/scripts/pi-oven-setup-cli.test.ts`
  - `tests/scripts/pi-oven-setup/config-yml.test.ts`
  - `tests/scripts/pi-oven-setup/status.test.ts`
  - `tests/plugin/pi-oven-doctor.test.ts`

**Steps**
- [x] Confirm the shipped workflow-skill names from `.claude-plugin/plugin.json` and `scripts/pi-oven-setup/shipped-skill-registry.ts` are the exact source feeding the ownership filter contract.
- [x] Make `/pi-oven:setup` write effective `skills.includeSkills = ["pi-oven:*"]` as the default-on workflow-skill ownership policy at the appropriate OMP config layer(s).
- [x] Update runtime/status/doctor truth surfaces so they treat `skills.includeSkills = ["pi-oven:*"]` as the canonical ownership control and report success only when the workflow-skill surface is pi-oven-only.
- [x] Keep workflow-skills-only scope explicit in code/help/tests so Task 1 does not widen into commands/agents/hooks/MCP exclusivity.
- [x] Add regression tests for default policy writing, missing-policy detection, and healthy owned-surface reporting.
- [x] Run `bun test tests/extensions/pi-oven.test.ts tests/scripts/pi-oven-setup-cli.test.ts tests/scripts/pi-oven-setup/config-yml.test.ts tests/scripts/pi-oven-setup/status.test.ts tests/plugin/pi-oven-doctor.test.ts`.

**Acceptance**
- `skills.includeSkills = ["pi-oven:*"]` is the default-on ownership mainline for workflow skills.
- Ownership success is judged by a pi-oven-only visible workflow-skill surface, not by quieter `~/.claude` state alone.
- Runtime, setup status, and doctor agree on the same owned-surface truth model.
- Task 1 remains workflow-skills-only and does not silently expand scope.

**Verification**
- `bun test tests/extensions/pi-oven.test.ts tests/scripts/pi-oven-setup-cli.test.ts tests/scripts/pi-oven-setup/config-yml.test.ts tests/scripts/pi-oven-setup/status.test.ts tests/plugin/pi-oven-doctor.test.ts`

### Task 2 — Reclassify legacy aids and lock the secondary bootstrap-parity distinction

**Depends on**
- Task 1 complete

**Files**
- Modify:
  - `.omp/extensions/pi-oven.ts`
  - `scripts/pi-oven-setup/config-yml.ts`
  - `scripts/pi-oven-setup/isolate.ts`
  - `scripts/pi-oven-setup/suppress-sibling.ts`
  - `scripts/pi-oven-setup/status.ts`
  - `scripts/pi-oven-setup/standalone-truth-surface.ts`
  - `scripts/pi-oven-setup.ts`
  - `commands/setup.md`
  - `commands/doctor.md`
  - `README.md`
- Test:
  - `tests/extensions/pi-oven.test.ts`
  - `tests/scripts/pi-oven-setup/isolate.test.ts`
  - `tests/scripts/pi-oven-setup/suppress-sibling.test.ts`
  - `tests/scripts/pi-oven-setup/status.test.ts`
  - `tests/plugin/pi-oven-doctor.test.ts`

**Steps**
- [x] Add the explicit finding that empty `~/.claude/skills` is not the target state; the real requirement is that populated Claude user workflow skills remain intact for other users while ownership mainline ignores/filters them for pi-oven workflow-skill truth, and that this alone does not stop `claude-plugins` or namespaced marketplace workflow skills.
- [x] Expose an ownership classification such as `owned-surface active`, `compatibility aids only`, and `ownership not established` so runtime/status/doctor reflect the new truth model.
- [x] Record bootstrap-level gajae parity as a secondary OMP/architecture track in the relevant diagnostics/help surfaces without making it a blocker for Task 1 success.
- [x] Add regression tests for the new classification/copy and compatibility-aid behavior.
- [x] Run `bun test tests/extensions/pi-oven.test.ts tests/scripts/pi-oven-setup/isolate.test.ts tests/scripts/pi-oven-setup/suppress-sibling.test.ts tests/scripts/pi-oven-setup/status.test.ts tests/plugin/pi-oven-doctor.test.ts`.

**Acceptance**
- Legacy aids are documented and tested as compatibility helpers only.
- The empty-`~/.claude/skills` insufficiency finding is explicit in runtime/docs/tests.
- Ownership truth surfaces distinguish immediate owned-surface success from compatibility-only states.
- Bootstrap parity is visible as a secondary track rather than being silently hidden inside Task 1.

**Verification**
- `bun test tests/extensions/pi-oven.test.ts tests/scripts/pi-oven-setup/isolate.test.ts tests/scripts/pi-oven-setup/suppress-sibling.test.ts tests/scripts/pi-oven-setup/status.test.ts tests/plugin/pi-oven-doctor.test.ts`

### Task 3 — Make routing state the single setup truth

**Depends on**
- Task 2 complete

**Files**
- Modify:
  - `.omp/extensions/pi-oven.ts`
  - `scripts/pi-oven-setup/project-config.ts`
  - `scripts/pi-oven-setup/status.ts`
  - `scripts/pi-oven-setup.ts`
  - `commands/setup.md`
  - `commands/doctor.md`
  - `README.md`
- Test:
  - `tests/extensions/pi-oven.test.ts`
  - `tests/scripts/pi-oven-setup-cli.test.ts`
  - `tests/scripts/pi-oven-setup/status.test.ts`
  - `tests/scripts/pi-oven-setup/project-config.test.ts`
  - `tests/plugin/pi-oven-doctor.test.ts`

**Steps**
- [x] List the exact routing/prereq facts that represent global readiness and project readiness so runtime and CLI stop using `setupCompletedAt` as a proxy for truth.
- [x] Rework the setup checklist predicate in `.omp/extensions/pi-oven.ts` so readiness derives from routing state first and receipts/metadata are secondary.
- [x] Remove the false global incomplete path when global routing/prereqs are already active, while preserving a real project incomplete path when project routing is absent.
- [x] Make `scripts/pi-oven-setup/status.ts` emit the same readiness classification the runtime notice uses, while reusing the ownership classification from Tasks 1-2.
- [x] Keep `scripts/pi-oven-setup/project-config.ts` writing receipt metadata without letting the receipt become the sole readiness authority again.
- [x] Update setup/doctor/README wording so user-facing guidance matches the routing-truth contract.
- [x] Add tests for stale receipt + valid routing, absent project routing, and fully configured global + project states.
- [x] Run `bun test tests/extensions/pi-oven.test.ts tests/scripts/pi-oven-setup-cli.test.ts tests/scripts/pi-oven-setup/status.test.ts tests/scripts/pi-oven-setup/project-config.test.ts tests/plugin/pi-oven-doctor.test.ts`.

**Acceptance**
- False global `✗` disappears when routing/prereqs are genuinely configured.
- Project `✗` still appears when project routing is actually absent.
- Runtime notice, setup status, and doctor output share one readiness truth model.
- Receipt metadata survives without becoming the single truth source again.

**Verification**
- `bun test tests/extensions/pi-oven.test.ts tests/scripts/pi-oven-setup-cli.test.ts tests/scripts/pi-oven-setup/status.test.ts tests/scripts/pi-oven-setup/project-config.test.ts tests/plugin/pi-oven-doctor.test.ts`

### Task 4 — Persist autonomy blocked reasons and same-repo/branch restart targets

**Depends on**
- Task 3 complete

**Files**
- Modify:
  - `.omp/extensions/pi-oven-runtime/gate-state.ts`
  - `.omp/extensions/pi-oven-runtime/project-state.ts`
  - `.omp/extensions/pi-oven-runtime/gate.ts`
  - `.omp/extensions/pi-oven-runtime/gate-handler.ts`
  - `.omp/extensions/pi-oven-runtime/autonomous-stop-guard.ts`
  - `.omp/extensions/pi-oven-runtime/continuation-marker.ts`
  - `.omp/extensions/pi-oven.ts`
- Test:
  - `tests/extensions/pi-oven-runtime/gate-state.test.ts`
  - `tests/extensions/pi-oven-runtime/project-state.test.ts`
  - `tests/extensions/pi-oven-runtime/gate.test.ts`
  - `tests/extensions/pi-oven-runtime/gate-handler.test.ts`
  - `tests/extensions/pi-oven-runtime/autonomous-stop-guard.test.ts`
  - `tests/extensions/pi-oven-runtime/continuation-marker.test.ts`
  - `tests/extensions/pi-oven-runtime/wiring.test.ts`
  - `tests/extensions/pi-oven.test.ts`

**Steps**
- [x] Define the persisted autonomy fields for ownership status, blocked reason, next action, and resume target inside `.pi-oven/state/autonomous.json`.
- [x] Write blocked reason + next action whenever autonomy stops on branch-contract, approval, skill-proof, verifier-depth, or policy-cap boundaries.
- [x] Capture the repo/branch resume target at the same time so the state can be replayed only on the matching repo/branch restart.
- [x] Teach session start to re-arm continuation or replay the blocked-state explanation when the persisted target matches the current repo/branch.
- [x] Discard or downgrade stale autonomy resume state when the current repo/branch does not match the persisted target.
- [x] Keep write gates strict so persisted blocked-state replay never bypasses branch/approval/skill-proof enforcement.
- [x] Add tests for same-repo restart resume, branch mismatch non-resume, durable blocked-reason persistence, and ownership-status round-trip.
- [x] Run `bun test tests/extensions/pi-oven-runtime/gate-state.test.ts tests/extensions/pi-oven-runtime/project-state.test.ts tests/extensions/pi-oven-runtime/gate.test.ts tests/extensions/pi-oven-runtime/gate-handler.test.ts tests/extensions/pi-oven-runtime/autonomous-stop-guard.test.ts tests/extensions/pi-oven-runtime/continuation-marker.test.ts tests/extensions/pi-oven-runtime/wiring.test.ts tests/extensions/pi-oven.test.ts`.

**Acceptance**
- Autonomy stop state survives restart with ownership status, blocked reason, next action, and same-repo/branch target intact.
- Matching repo/branch restart can resume or replay the correct blocked-state instruction.
- Non-matching repo/branch does not accidentally consume another run’s autonomy state.
- Branch/approval/skill-proof gates remain strict after the parity work lands.

**Verification**
- `bun test tests/extensions/pi-oven-runtime/gate-state.test.ts tests/extensions/pi-oven-runtime/project-state.test.ts tests/extensions/pi-oven-runtime/gate.test.ts tests/extensions/pi-oven-runtime/gate-handler.test.ts tests/extensions/pi-oven-runtime/autonomous-stop-guard.test.ts tests/extensions/pi-oven-runtime/continuation-marker.test.ts tests/extensions/pi-oven-runtime/wiring.test.ts tests/extensions/pi-oven.test.ts`

### Task 5 — Harden setup notices and polish `pi-oven_ask` option spacing

**Depends on**
- Task 4 complete

**Files**
- Modify:
  - `.omp/extensions/pi-oven.ts`
  - `.omp/extensions/pi-oven-runtime/pi-oven-ask.ts`
  - `commands/setup.md`
  - `commands/doctor.md`
  - `README.md`
- Test:
  - `tests/extensions/pi-oven.test.ts`
  - `tests/extensions/pi-oven-runtime/pi-oven-ask.test.ts`
  - `tests/extensions/pi-oven-runtime/wiring.test.ts`
  - `tests/plugin/pi-oven-doctor.test.ts`

**Steps**
- [x] Add a dedupe guard so one repo/session start emits the setup checklist notice at most once even if the host fires duplicate `session_start` paths.
- [x] Reuse the ownership/setup truth classification from Tasks 1-3 so the deduped notice distinguishes owned-surface active, compatibility-only ownership, missing project routing, and healthy setup states.
- [x] Change `pi-oven_ask` option rendering so question/context body spacing stays unchanged but each option follows on the next line without the extra blank spacer.
- [x] Keep detail block spacing and `Other` / `Ask about these choices` affordances unchanged while applying the option-spacing tweak.
- [x] Update setup/doctor/README text to match the final notice and ask UX contract.
- [x] Add snapshot/behavior tests for single notice emission and the new option-spacing layout.
- [x] Run `bun test tests/extensions/pi-oven.test.ts tests/extensions/pi-oven-runtime/pi-oven-ask.test.ts tests/extensions/pi-oven-runtime/wiring.test.ts tests/plugin/pi-oven-doctor.test.ts`.

**Acceptance**
- Duplicate identical setup warnings stop appearing within the same repo/session start path.
- The emitted notice uses the finalized ownership/setup truth classification from the earlier phases.
- `pi-oven_ask` keeps the current body rhythm while removing only the extra blank line between options.
- Existing affordances and detail spacing stay intact.

**Verification**
- `bun test tests/extensions/pi-oven.test.ts tests/extensions/pi-oven-runtime/pi-oven-ask.test.ts tests/extensions/pi-oven-runtime/wiring.test.ts tests/plugin/pi-oven-doctor.test.ts`

## Self-review checklist

- [x] **Spec coverage** — immediate owned-surface cutover, compatibility-aid demotion, empty `~/.claude/skills` insufficiency, setup truth, autonomy restart parity, duplicate warning hardening, and `pi-oven_ask` option spacing each map to at least one task.
- [x] **Placeholder scan** — writing-plans contract가 금지한 placeholder 표현이 step bodies와 acceptance text에 남아 있지 않다.
- [x] **Type consistency** — the plan names only existing repo files, existing runtime concepts from surveyed code, and no phantom file paths.

## Execution Handoff

**Option 1 — subagent-driven-development (recommended)**
Dispatch fresh implementation subagents by task. Task 1 -> Task 2 -> Task 3 stay sequential because they share one ownership/setup truth surface. Task 4 starts after Task 3, and Task 5 lands last because it reuses the finalized ownership/setup classification and notice path.

**Option 2 — inline sequential execution**
One agent executes Task 1 -> Task 2 -> Task 3 -> Task 4 -> Task 5 in order, re-running each task’s targeted verification command before moving on.
