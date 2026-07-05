## Goal

pi-oven의 remediation wave를 실행해 Codex-only default routing, ask-driven per-agent effort approval, detailed code-grounded survey/research enforcement, legacy compatibility cleanup, and follow-up runtime coherence를 현재 repo code/test/doc surfaces에 맞게 구현한다.

## Architecture

- **Routing SoT lane**: `scripts/pi-oven-setup/profiles.ts`, `apply.ts`, `config-yml.ts`, `project-settings.ts`, `override.ts`, `import.ts`, `auth-detect.ts`, `.omp/extensions/pi-oven.ts`, `scripts/lint-agents.ts`, `agents/pi-oven-*.md` frontmatter.
- **Approval/runtime lane**: `.omp/extensions/pi-oven-runtime/pi-oven-ask.ts`, `deep-interview-state.ts`, `deep-interview-runtime.ts`, `deep-interview-render.ts`, `.omp/extensions/pi-oven.ts`.
- **Documentation-evidence lane**: `skills/spec-and-review/SKILL.md`, `skills/writing-plans/SKILL.md`, `agents/pi-oven-planner.md`, plus a new doc-evidence validator + tests.
- **Compatibility/documentation lane**: `commands/setup.md`, `commands/doctor.md`, `README.md`, `CLAUDE.md`, agent-body prose, setup compatibility helpers/tests.
- **Parallel-runtime follow-up lane**: `scripts/pi-oven-team/lane-policy.ts`, `task-file-ops.ts`, `runtime-v2.ts`, `scaling.ts`, related tests.

## Tech Stack

- TypeScript under `.omp/extensions/`, `.omp/extensions/pi-oven-runtime/`, `scripts/pi-oven-setup/`, `scripts/pi-oven-team/`
- Bun test runner for targeted unit/integration suites
- Markdown documentation under `docs/`, `commands/`, `skills/`, `agents/`
- Existing project-local runtime state under `.pi-oven/state/` and project routing layer under `.omp/settings.json`

## Dispatch rules for later execution

- Use fresh implementation subagents per task group; do not mix review and writing in one lane.
- Keep P0 groups sequential where they share routing/control-plane files.
- P1 documentation/prose cleanup may start only after P0 routing/default decisions are in code.
- P2 parallel-runtime work starts only after the new routing/approval/documentation rules are stable.

## Recommended approval matrix to collect in P0-1

This is the starting recommendation that the approval flow must present and persist per role.

| Role | Recommended selector |
| --- | --- |
| executor | `openai-codex/gpt-5.5:high` |
| explorer | `openai-codex/gpt-5.4:medium` |
| verifier | `openai-codex/gpt-5.5:xhigh` |
| critic | `openai-codex/gpt-5.5:xhigh` |
| planner | `openai-codex/gpt-5.5:xhigh` |
| code-reviewer | `openai-codex/gpt-5.5:xhigh` |
| debugger | `openai-codex/gpt-5.5:xhigh` |
| test-engineer | `openai-codex/gpt-5.5:high` |
| security-reviewer | `openai-codex/gpt-5.5:xhigh` |
| writer | `openai-codex/gpt-5.4:medium` |
| designer | `openai-codex/gpt-5.4:high` |
| code-simplifier | `openai-codex/gpt-5.5:xhigh` |
| qa-tester | `openai-codex/gpt-5.4:high` |
| git-master | `openai-codex/gpt-5.4:medium` |
| document-specialist | `openai-codex/gpt-5.4:medium` |
| tracer | `openai-codex/gpt-5.5:xhigh` |
| analyst | `openai-codex/gpt-5.5:xhigh` |
| architect | `openai-codex/gpt-5.5:xhigh` |
| librarian | `openai-codex/gpt-5.4:medium` |
| multimodal-looker | `openai-codex/gpt-5.4:medium` |
| oracle | `openai-codex/gpt-5.5:xhigh` |
| metis | `openai-codex/gpt-5.5:high` |
| deep-researcher | `openai-codex/gpt-5.5:xhigh` |
| data-runner | `openai-codex/gpt-5.4:high` |
| orchestrator `default` | `openai-codex/gpt-5.4:high` |
| orchestrator `title` | `openai-codex/gpt-5.4:medium` |

---

# P0 — Required for the remediation wave to be real

## Task Group P0-1 — Implement ask-driven per-agent effort approval

**Files**
- Modify:
  - `.omp/extensions/pi-oven-runtime/pi-oven-ask.ts`
  - `.omp/extensions/pi-oven-runtime/deep-interview-state.ts`
  - `.omp/extensions/pi-oven-runtime/deep-interview-runtime.ts`
  - `.omp/extensions/pi-oven-runtime/deep-interview-render.ts`
  - `.omp/extensions/pi-oven.ts`
  - `tests/extensions/pi-oven-runtime/pi-oven-ask.test.ts`
  - `tests/extensions/pi-oven-runtime/deep-interview-runtime.test.ts`
  - `tests/extensions/pi-oven-runtime/deep-interview-state.test.ts`
  - `tests/extensions/pi-oven-runtime/wiring.test.ts`
- Create:
  - `.omp/extensions/pi-oven-runtime/model-routing-approval.ts`
  - `tests/extensions/pi-oven-runtime/model-routing-approval.test.ts`
- Test:
  - `bun test tests/extensions/pi-oven-runtime/model-routing-approval.test.ts tests/extensions/pi-oven-runtime/pi-oven-ask.test.ts tests/extensions/pi-oven-runtime/deep-interview-runtime.test.ts tests/extensions/pi-oven-runtime/deep-interview-state.test.ts tests/extensions/pi-oven-runtime/wiring.test.ts`

**Steps**
- [ ] Add a typed approval payload in `model-routing-approval.ts` that maps each role to its recommended selector and approval status.
- [ ] Extend deep-interview state types so approval records can persist per role or per bucket with a reversible expansion to per-role results.
- [ ] Add failing tests covering seed → approve → persist → resume for routing approval state.
- [ ] Extend `pi-oven_ask.ts` so approval questions can carry routing-specific metadata without breaking existing single-select behavior.
- [ ] Implement runtime helpers that materialize the recommended matrix, group roles by selector for UX, and persist the resolved per-role choice set.
- [ ] Update `deep-interview-render.ts` to display routing-approval progress instead of only the generic approval summary.
- [ ] Wire the approval state into `.omp/extensions/pi-oven.ts` so interrupted sessions resume at the right routing-approval step.
- [ ] Re-run the targeted runtime/deep-interview test suite and confirm approval state round-trips from disk.

**Acceptance**
- The runtime can seed a recommended routing matrix, ask for approval, persist the resolved result, and resume after interruption without re-asking completed approvals.
- Approval data is stored as explicit state, not inferred from prompt history.
- Existing non-routing deep-interview behavior remains green.

**Verification**
- `bun test tests/extensions/pi-oven-runtime/model-routing-approval.test.ts tests/extensions/pi-oven-runtime/pi-oven-ask.test.ts tests/extensions/pi-oven-runtime/deep-interview-runtime.test.ts tests/extensions/pi-oven-runtime/deep-interview-state.test.ts tests/extensions/pi-oven-runtime/wiring.test.ts`

## Task Group P0-2 — Promote the codex-only matrix to the release-default routing baseline

**Files**
- Modify:
  - `scripts/pi-oven-setup/profiles.ts`
  - `scripts/pi-oven-setup/apply.ts`
  - `scripts/pi-oven-setup/import.ts`
  - `scripts/pi-oven-setup/auth-detect.ts`
  - `.omp/extensions/pi-oven.ts`
  - `scripts/lint-agents.ts`
  - `commands/setup.md`
  - `commands/doctor.md`
  - `README.md`
  - `CLAUDE.md`
  - `agents/pi-oven-critic.md`
  - `agents/pi-oven-planner.md`
  - `agents/pi-oven-document-specialist.md`
  - `agents/pi-oven-designer.md`
  - `agents/pi-oven-code-reviewer.md`
  - `agents/pi-oven-git-master.md`
  - `agents/pi-oven-multimodal-looker.md`
  - `agents/pi-oven-oracle.md`
  - `agents/pi-oven-analyst.md`
  - `tests/scripts/pi-oven-setup/profiles.test.ts`
  - `tests/scripts/pi-oven-setup/apply.test.ts`
  - `tests/extensions/pi-oven.test.ts`
  - `tests/plugin/pi-oven-doctor.test.ts`
  - `tests/scripts/pi-oven-setup/status.test.ts`
  - `tests/plugin/skill-discoverability.test.ts`
- Test:
  - `bun test tests/scripts/pi-oven-setup/profiles.test.ts tests/scripts/pi-oven-setup/apply.test.ts tests/extensions/pi-oven.test.ts tests/plugin/pi-oven-doctor.test.ts tests/scripts/pi-oven-setup/status.test.ts tests/plugin/skill-discoverability.test.ts`
  - `bun run lint:agents`

**Steps**
- [ ] Rewrite the routing SoT so the release-default baseline points at the codex-only selector matrix currently represented by `PROFILE_B`.
- [ ] Keep the approved selector matrix and the setup apply path aligned, including `:<thinkingLevel>` persistence rules.
- [ ] Narrow import validation and auth-detection behavior so the default setup path no longer treats non-Codex release profiles as equivalent first-class defaults.
- [ ] Update extension registry validation to match the new default provider policy.
- [ ] Update committed agent frontmatter and the targeted agent-body execution-context prose so shipped prompts no longer promise Claude/GLM/Gemini/OpenCode Zen behavior where the default route is Codex.
- [ ] Rewrite `commands/setup.md`, `commands/doctor.md`, `README.md`, and `CLAUDE.md` in the same task group so the public setup/help contract flips to codex-only at the exact moment the code/test baseline flips.
- [ ] Rewrite tests to lock the new baseline rather than the old heterogeneous assumptions.
- [ ] Run the combined routing/setup/docs test set plus `bun run lint:agents` and fix drift until clean.

**Acceptance**
- One release-default routing story exists across profiles SoT, extension validation, agent frontmatter, public setup/docs guidance, and tests.
- The default product path is codex-only.
- Approved per-role routing can still persist through the existing apply/override stores.
- No user-facing setup, doctor, README, or repo-local guidance path advertises the old mixed-provider default after P0.

**Verification**
- `bun test tests/scripts/pi-oven-setup/profiles.test.ts tests/scripts/pi-oven-setup/apply.test.ts tests/extensions/pi-oven.test.ts tests/plugin/pi-oven-doctor.test.ts tests/scripts/pi-oven-setup/status.test.ts tests/plugin/skill-discoverability.test.ts`
- `bun run lint:agents`

## Task Group P0-3 — Make detailed survey/research artifact quality reproducible in code

**Files**
- Modify:
  - `package.json`
  - `skills/codebase-survey/SKILL.md`
  - `skills/spec-and-review/SKILL.md`
  - `skills/writing-plans/SKILL.md`
  - `agents/pi-oven-planner.md`
  - `agents/pi-oven-critic.md`
  - `agents/pi-oven-document-specialist.md`
  - `agents/pi-oven-explorer.md`
  - `agents/pi-oven-librarian.md`
  - `agents/pi-oven-deep-researcher.md`
  - `agents/pi-oven-verifier.md`
- Create:
  - `scripts/lint-doc-evidence.ts`
  - `tests/scripts/lint-doc-evidence.test.ts`
- Test:
  - `bun test tests/scripts/lint-doc-evidence.test.ts`
  - `bun run lint:doc-evidence docs/harness/surveys/2026-07-05-pi-oven-remediation-detailed-survey.md docs/research/2026-07-05-pi-oven-codex-only-routing-research.md`

**Steps**
- [ ] Define a concrete document-evidence contract for survey and research artifacts: required sections, code-anchor density, explicit unknowns, official-link requirements, and implementation-facing module inventory.
- [ ] Encode that contract into `scripts/lint-doc-evidence.ts` and expose it through a standard repo command in `package.json` so the rule is runnable outside human review.
- [ ] Add failing tests for thin metadata-only survey/research examples and passing tests for code-grounded examples.
- [ ] Tighten every producer/reviewer prompt that participates in survey/research creation or acceptance: `codebase-survey`, `spec-and-review`, `writing-plans`, planner, critic, document-specialist, explorer, librarian, deep-researcher, and verifier.
- [ ] Wire the validator into at least one real rejecting path for remediation docs so a weak survey/research artifact fails outside its own self-test.
- [ ] Run the new doc-evidence tests and the validator against the live remediation survey/research docs until both the contract and the integration path are stable.

**Acceptance**
- A machine-checkable validator exists for the new detailed survey/research requirement and is invokable through a standard repo command.
- The producer prompts and the reviewer/verifier prompts enforce the same artifact structure.
- Real remediation survey/research docs pass the validator, and thin or citation-poor artifacts fail automatically through a real rejecting path.

**Verification**
- `bun test tests/scripts/lint-doc-evidence.test.ts`
- `bun run lint:doc-evidence docs/harness/surveys/2026-07-05-pi-oven-remediation-detailed-survey.md docs/research/2026-07-05-pi-oven-codex-only-routing-research.md`

---

# P1 — Strongly recommended once P0 is stable

## Task Group P1-1 — Close the most important deep-interview parity gaps for routing approval

**Files**
- Modify:
  - `.omp/extensions/pi-oven-runtime/deep-interview-render.ts`
  - `.omp/extensions/pi-oven-runtime/deep-interview-runtime.ts`
  - `.omp/extensions/pi-oven-runtime/deep-interview-state.ts`
  - `.omp/extensions/pi-oven-runtime/pi-oven-ask.ts`
  - `tests/extensions/pi-oven-runtime/deep-interview-runtime.test.ts`
  - `tests/extensions/pi-oven-runtime/deep-interview-state.test.ts`
  - `tests/extensions/pi-oven-runtime/pi-oven-ask.test.ts`
- Test:
  - `bun test tests/extensions/pi-oven-runtime/deep-interview-runtime.test.ts tests/extensions/pi-oven-runtime/deep-interview-state.test.ts tests/extensions/pi-oven-runtime/pi-oven-ask.test.ts`

**Steps**
- [ ] Add explicit topology / closure / approval render blocks needed by the routing-approval flow.
- [ ] Persist any additional per-round metadata needed to support approval progress and resume without ambiguity.
- [ ] Add headless/unattended approval handling instead of leaving that branch as prompt-only behavior.
- [ ] Extend tests to cover the new topology/closure/render/headless states.
- [ ] Re-run the targeted deep-interview test suite.

**Acceptance**
- The routing-approval flow no longer relies on minimal generic rendering.
- Resume/approval behavior is explicit for topology, closure, and unattended branches.

**Verification**
- `bun test tests/extensions/pi-oven-runtime/deep-interview-runtime.test.ts tests/extensions/pi-oven-runtime/deep-interview-state.test.ts tests/extensions/pi-oven-runtime/pi-oven-ask.test.ts`

## Task Group P1-2 — Remove or strictly bound the legacy compatibility front doors

**Files**
- Modify:
  - `scripts/pi-oven-setup.ts`
  - `scripts/pi-oven-setup/config-yml.ts`
  - `scripts/pi-oven-setup/isolate.ts`
  - `scripts/pi-oven-setup/suppress-sibling.ts`
  - `README.md`
  - `commands/setup.md`
  - `commands/doctor.md`
  - `tests/scripts/pi-oven-setup/isolate.test.ts`
  - `tests/scripts/pi-oven-setup/suppress-sibling.test.ts`
  - `tests/scripts/pi-oven-setup/config-yml.test.ts`
  - `tests/scripts/pi-oven-setup/compatibility-boundary.test.ts`
- Test:
  - `bun test tests/scripts/pi-oven-setup/isolate.test.ts tests/scripts/pi-oven-setup/suppress-sibling.test.ts tests/scripts/pi-oven-setup/config-yml.test.ts tests/scripts/pi-oven-setup/compatibility-boundary.test.ts`

**Steps**
- [ ] Decide once whether compatibility toggles are removed or kept as explicitly bounded compatibility-only paths.
- [ ] Update setup dispatch, config helpers, and standalone compatibility helpers to match that single decision.
- [ ] Align README/setup/doctor compatibility language with the same scope, owner, and removal condition.
- [ ] Rewrite compatibility tests so they pin the chosen bounded behavior instead of the old mixed story.
- [ ] Run the targeted compatibility suites and confirm the fresh-verifier blocker is addressed in code, not only prose.

**Acceptance**
- Legacy compatibility behavior and public documentation no longer contradict each other.
- Fresh-verifier’s legacy-compatibility blocker has a code-level resolution path.

**Verification**
- `bun test tests/scripts/pi-oven-setup/isolate.test.ts tests/scripts/pi-oven-setup/suppress-sibling.test.ts tests/scripts/pi-oven-setup/config-yml.test.ts tests/scripts/pi-oven-setup/compatibility-boundary.test.ts`

---

# P2 — Follow-on runtime and verification polish

## Task Group P2-1 — Reduce remaining serial bottlenecks in the native worker runtime

**Files**
- Modify:
  - `scripts/pi-oven-team/runtime-v2.ts`
  - `scripts/pi-oven-team/scaling.ts`
  - `scripts/pi-oven-team/task-file-ops.ts`
  - `scripts/pi-oven-team/lane-policy.ts`
  - `tests/scripts/pi-oven-team/runtime-v2.test.ts`
  - `tests/scripts/pi-oven-team/scaling.test.ts`
- Test:
  - `bun test tests/scripts/pi-oven-team/runtime-v2.test.ts tests/scripts/pi-oven-team/scaling.test.ts`

**Steps**
- [ ] Measure which serial sections still dominate startup/scale latency.
- [ ] Parallelize only the safe parts of pane reservation/worktree preparation/startup sequencing while preserving collision guarantees.
- [ ] Extend tests so the new behavior still proves independence gating and latency evidence persistence.
- [ ] Run the targeted team-runtime suites and compare evidence fields before/after.

**Acceptance**
- Startup/scale fan-out improves without weakening lane independence or collision rejection.
- Latency evidence remains persisted and test-backed.

**Verification**
- `bun test tests/scripts/pi-oven-team/runtime-v2.test.ts tests/scripts/pi-oven-team/scaling.test.ts`

## Task Group P2-2 — Final remediation verifier and release-coherence sweep

**Files**
- Modify:
  - `.omp/extensions/pi-oven-runtime/verifier-depth-policy.ts`
  - `.omp/extensions/pi-oven-runtime/trace-primitives.ts`
  - any new remediation validator wiring added in P0/P1
  - `docs/runtime-contracts/` artifacts if the implementation creates or revises them
  - targeted verifier tests that cover the new remediation policy
- Test:
  - targeted runtime/verifier suites that cover the changed files
  - targeted build/check commands required by the changed surfaces

**Steps**
- [ ] Revisit verifier depth policy and trace surfaces only where the remediation flow introduced new approval or documentation-evidence checkpoints.
- [ ] Ensure the verifier can surface the new routing, approval, and document-quality rules as first-class runtime evidence.
- [ ] Run the affected runtime/verifier suites plus the minimal build/check commands required by touched files.
- [ ] Dispatch a fresh verifier pass specifically against the remediation branch after the code settles.

**Acceptance**
- The verifier path can explain the new routing default, approval state, and documentation-quality policy with concrete runtime evidence.
- A fresh verifier can evaluate the remediation wave without relying on stale assumptions.

**Verification**
- Run the exact targeted tests for the changed verifier/runtime files.
- Run `bun run check` and any touched-surface targeted `bun test` suites.

---

## Final handoff checklist

- [x] P0-1 approval flow merged and green
- [x] P0-2 codex-only routing baseline merged and green
- [x] P0-3 doc-evidence validator merged and green
- [x] P1 compatibility/docs/prose updates merged and green
- [x] P2 runtime/verifier follow-up merged and green
- [ ] Fresh verifier re-run against the final remediation branch

## Why this plan is ordered this way

- **P0 first** because approval state, routing default, and artifact quality rules are the new source of truth. Everything else should follow that truth, not race it.
- **P1 second** because compatibility language and deep-interview UX cleanup are meaningful only after the routing/approval contract is real.
- **P2 last** because throughput tuning and final verifier polish are easier and safer once the policy surfaces stop moving.