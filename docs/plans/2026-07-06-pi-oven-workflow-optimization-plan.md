> Historical; do not copy runtime syntax examples from this document.
> Historical architecture; implementation removed in vNext; OMP task is current dispatch seam
> Superseded by [the runtime contract remediation implementation plan](2026-07-13-pi-oven-runtime-contract-remediation-implementation-plan.md).

## Goal

pi-oven의 workflow optimization과 gajae-style deep-interview redesign을 staged cutover로 구현해, provider-specific review/verifier wording 제거, runtime-owned provider-family routing, spec-persistence-based interview completion, native `pi-oven_ask` redesign, mutation guard, 그리고 throughput benchmark contract를 코드/테스트/문서에 동시에 반영한다.

## Architecture

- **Provider-family execution lane**: `.omp/extensions/pi-oven.ts`, `.omp/extensions/pi-oven-runtime/model-routing-approval.ts`, `scripts/pi-oven-setup/{profiles,apply,status}.ts`, skill/agent prose, related tests.
- **Deep-interview V2 lane**: `.omp/extensions/pi-oven-runtime/{deep-interview-state,deep-interview-runtime,deep-interview-render}.ts`, `.omp/extensions/pi-oven.ts`, `skills/brainstorming/**`, related tests.
- **Approval/ask lane**: `.omp/extensions/pi-oven-runtime/pi-oven-ask.ts`, `model-routing-approval.ts`, `rules-injector.ts`, `skill-keyword-loader.ts`, `trace-primitives.ts`, related tests.
- **Mutation gate lane**: `.omp/extensions/pi-oven-runtime/{gate,gate-handler,gate-state}.ts`, `.omp/extensions/pi-oven.ts`, related tests.
- **Performance lane**: `scripts/pi-oven-team/{runtime-v2,index,lane-policy,task-file-ops,team-config}.ts`, gate hot-path files above, targeted benchmark tests.

## Tech Stack

- TypeScript / Bun
- `.omp/extensions/` runtime + gate stack
- `scripts/pi-oven-setup/` and `scripts/pi-oven-team/` CLI/runtime modules
- Markdown skills/agents/commands under `skills/`, `agents/`, `commands/`
- Bun test runner + repo lint commands (`bun run lint:agents`, `bun run lint:skills`)

## Delivery invariants

- Staged cutover only. No long-lived dual writers, dual phase enums, or parallel blessed UI contracts.
- Deep-interview completion boundary is spec persistence. Post-spec approval is a separate approval-flow concern.
- Provider family at execution time comes from runtime/session state; setup/profile/status only mirror or validate.
- High-risk review fan-out may widen only within the same provider family.
- Performance work must preserve correctness suites first and prove relative improvement with benchmark evidence.

---

# Tranche T1 — Provider-family execution contract cutover

## Task Group T1-A — Remove provider-specific workflow wording from skill/reference/agent prose

**Depends on**
- none

**Parallelizable slices**
- Not with T1-B. Both touch shared workflow/runtime wording surfaces and should land under one contract review.

**Files**
- Modify:
  - `skills/spec-and-review/SKILL.md`
  - `skills/spec-and-review/references/pattern-loop.md`
  - `skills/fresh-verifier/SKILL.md`
  - `skills/autonomous-loop/SKILL.md`
  - `skills/large-task-delegation/SKILL.md`
  - `skills/receiving-code-review/SKILL.md`
  - `agents/pi-oven-critic.md`
  - `agents/pi-oven-verifier.md`
  - `agents/pi-oven-planner.md`
  - any additional `agents/pi-oven-*.md` whose body still hardcodes `codex`, `zen`, `opus`, or `sonnet` as workflow policy rather than release metadata
  - `.omp/extensions/pi-oven-runtime/skill-keyword-loader.ts`
  - tests that assert the old wording
- Test:
  - `bun test tests/extensions/pi-oven.test.ts tests/extensions/pi-oven-runtime/skill-keyword-loader.test.ts tests/extensions/pi-oven-runtime/rules-injector.test.ts`
  - `bun run lint:skills`
  - `bun run lint:agents`

**Steps**
- [ ] Replace critic/verifier workflow prose with “current-session provider family” wording.
- [ ] Encode the same-family-only fan-out rule for high-risk review and verification.
- [ ] Remove `model="codex"`, `model="zen"`, `model="opus"`, `model: sonnet` examples from skill/reference workflow contracts.
- [ ] Keep release metadata in frontmatter intact where it expresses shipped defaults rather than workflow policy.
- [ ] Update keyword/runtime help strings so prompt injection no longer reintroduces provider-specific lore.
- [ ] Rewrite tests that currently lock provider-name wording so they assert symbolic contract language instead.
- [ ] Run the targeted tests and lint commands.

**Acceptance**
- Workflow instructions talk about same-provider fresh agents, not cross-provider named pairs.
- High-risk fan-out is still allowed, but only within one provider family.
- No prompt injection path reintroduces `codex + zen` or `opus` as mandatory workflow policy.

**Verification**
- `bun test tests/extensions/pi-oven.test.ts tests/extensions/pi-oven-runtime/skill-keyword-loader.test.ts tests/extensions/pi-oven-runtime/rules-injector.test.ts`
- `bun run lint:skills`
- `bun run lint:agents`

## Task Group T1-B — Make runtime the provider-choice SoT and demote setup/profile/status to visibility layers

**Depends on**
- T1-A complete

**Parallelizable slices**
- Can overlap later with T4-A native worker throughput work after the `.omp/extensions/pi-oven.ts` edits settle.

**Files**
- Modify:
  - `.omp/extensions/pi-oven.ts`
  - `.omp/extensions/pi-oven-runtime/model-routing-approval.ts`
  - `scripts/pi-oven-setup/profiles.ts`
  - `scripts/pi-oven-setup/apply.ts`
  - `scripts/pi-oven-setup/status.ts`
  - `tests/extensions/pi-oven.test.ts`
  - `tests/scripts/pi-oven-setup/profiles.test.ts`
  - `tests/scripts/pi-oven-setup/apply.test.ts`
  - `tests/scripts/pi-oven-setup/status.test.ts`
  - `tests/extensions/pi-oven-runtime/model-routing-approval.test.ts`
- Test:
  - `bun test tests/extensions/pi-oven.test.ts tests/scripts/pi-oven-setup/profiles.test.ts tests/scripts/pi-oven-setup/apply.test.ts tests/scripts/pi-oven-setup/status.test.ts tests/extensions/pi-oven-runtime/model-routing-approval.test.ts`

**Steps**
- [ ] Introduce a runtime-visible `sessionProviderFamily` derivation from the captured parent session model.
- [ ] Rework `model-routing-approval.ts` so recommendation materialization accepts provider family input instead of assuming `PROFILE_B` only.
- [ ] Keep setup/apply/status able to report the effective matrix, but stop letting those layers define execution wording.
- [ ] Revisit `getAllowedPrefixes()` / `validateAgentRegistry()` so validation policy matches the new execution contract and expected release defaults.
- [ ] Update tests so status/reporting verifies visibility behavior, not ownership of runtime policy.
- [ ] Add unsupported/current-session family negative-path tests so runtime/provider routing emits explicit refusal or diagnostic behavior instead of silently pretending the family is supported.
- [ ] Run the targeted suites.

**Acceptance**
- Runtime can explain which provider family governs execution without consulting prose-only defaults.
- Routing recommendation materialization is keyed by runtime family.
- Setup/profile/status continue to report and validate, but no longer imply they own execution selection.
- Unsupported or unmapped current-session provider families fail with an explicit diagnostic path that tests can assert.

**Verification**
- `bun test tests/extensions/pi-oven.test.ts tests/scripts/pi-oven-setup/profiles.test.ts tests/scripts/pi-oven-setup/apply.test.ts tests/scripts/pi-oven-setup/status.test.ts tests/extensions/pi-oven-runtime/model-routing-approval.test.ts`

---

# Tranche T2 — Deep-interview V2 envelope + approval cutover

## Task Group T2-A — Replace flat deep-interview state with a V2 nested envelope

**Depends on**
- T1-B complete

**Parallelizable slices**
- T2-B approval cutover can start only after the V2 field names, phase model, and spec-receipt shape are frozen.

**Files**
- Modify:
  - `.omp/extensions/pi-oven-runtime/deep-interview-state.ts`
  - `.omp/extensions/pi-oven-runtime/deep-interview-runtime.ts`
  - `.omp/extensions/pi-oven-runtime/deep-interview-render.ts`
  - `.omp/extensions/pi-oven.ts`
  - `tests/extensions/pi-oven-runtime/deep-interview-state.test.ts`
  - `tests/extensions/pi-oven-runtime/deep-interview-runtime.test.ts`
  - `tests/extensions/pi-oven-runtime/wiring.test.ts`
- Create:
  - new fixtures/helpers only if the current test files cannot express migration and scored-round coverage cleanly
- Test:
  - `bun test tests/extensions/pi-oven-runtime/deep-interview-state.test.ts tests/extensions/pi-oven-runtime/deep-interview-runtime.test.ts tests/extensions/pi-oven-runtime/wiring.test.ts`

**Steps**
- [ ] Introduce `DeepInterviewStateV2` with nested `state`, threshold/source, topology, ontology snapshots, milestone, next target, and spec persistence receipt.
- [ ] Add `scored` round lifecycle and answered→scored merge semantics.
- [ ] Keep ambiguity formulas out of TypeScript runtime; only persist and validate scored results.
- [ ] Add read-time migration from legacy V1 state to V2, but **preserve legacy nested approval payload losslessly** until T2-B extracts it into root `approvalFlow`.
- [ ] Do not canonical-write away `approvalHandoff` / `routingApproval` during T2-A; any interim V2 persist must round-trip that legacy approval payload untouched.
- [ ] Update render/injection helpers to project the new envelope and resume data.
- [ ] Extend tests for normalization, merge, migration, scored-round enrichment, and interim legacy-approval round-trip behavior.
- [ ] Run the targeted suites.

**Acceptance**
- Deep-interview state can represent topology, scored rounds, ontology, milestone, next target, and spec persistence without auxiliary prompt-only lore.
- Legacy state still loads, and pre-T2-B canonical writes preserve legacy approval payload until the approvalFlow extraction tranche lands.

**Verification**
- `bun test tests/extensions/pi-oven-runtime/deep-interview-state.test.ts tests/extensions/pi-oven-runtime/deep-interview-runtime.test.ts tests/extensions/pi-oven-runtime/wiring.test.ts`

## Task Group T2-B — Extract approval ownership and codify the boundary-clearing spec-persistence path

**Depends on**
- T2-A field/phase freeze complete

**Parallelizable slices**
- T3-A brainstorming parity may start only after `approvalFlow`, spec receipt, and approval resume ownership are frozen.

**Files**
- Modify:
  - `.omp/extensions/pi-oven-runtime/gate-state.ts`
  - `.omp/extensions/pi-oven-runtime/deep-interview-state.ts`
  - `.omp/extensions/pi-oven-runtime/deep-interview-runtime.ts`
  - `.omp/extensions/pi-oven-runtime/model-routing-approval.ts`
  - `.omp/extensions/pi-oven-runtime/trace-primitives.ts`
  - `.omp/extensions/pi-oven-runtime/deep-interview-render.ts`
  - `.omp/extensions/pi-oven-runtime/pi-oven-ask.ts`
  - `.omp/extensions/pi-oven.ts`
  - `tests/extensions/pi-oven-runtime/deep-interview-runtime.test.ts`
  - `tests/extensions/pi-oven-runtime/deep-interview-state.test.ts`
  - `tests/extensions/pi-oven-runtime/pi-oven-ask.test.ts`
  - `tests/extensions/pi-oven-runtime/trace-primitives.test.ts`
  - `tests/extensions/pi-oven-runtime/wiring.test.ts`
  - `tests/extensions/pi-oven-runtime/model-routing-approval.test.ts`
  - `tests/extensions/pi-oven-runtime/gate-state.test.ts`
- Test:
  - `bun test tests/extensions/pi-oven-runtime/deep-interview-runtime.test.ts tests/extensions/pi-oven-runtime/deep-interview-state.test.ts tests/extensions/pi-oven-runtime/pi-oven-ask.test.ts tests/extensions/pi-oven-runtime/trace-primitives.test.ts tests/extensions/pi-oven-runtime/wiring.test.ts tests/extensions/pi-oven-runtime/model-routing-approval.test.ts tests/extensions/pi-oven-runtime/gate-state.test.ts`

**Steps**
- [ ] Add a root `approvalFlow` state alongside `deepInterview`.
- [ ] Introduce one canonical runtime-owned boundary path, e.g. `persistFinalSpecAndSeedApprovalFlow()`, that writes the final `docs/specs/...` artifact and the paired `deepInterview -> approvalFlow` state transition as one sanctioned completion action.
- [ ] Cut `deep-interview-render.ts`, `pi-oven_ask.ts`, runtime resume wiring, and routing-approval consumers over from `deepInterview.approvalHandoff` / `deepInterview.routingApproval` to `approvalFlow`.
- [ ] Stop writing `approval_pending` / `ready_to_resume` as deep-interview-native completion states.
- [ ] Migrate old nested approval data into the new root approval-flow state on read.
- [ ] Update trace/state-change reporting so approval decisions and the spec-persistence receipt remain observable.
- [ ] Extend tests for migrate → persist → resume across spec-handoff, routing approval, sanctioned spec-write, and legacy approval state cases.
- [ ] Run the targeted suites.

**Acceptance**
- Deep-interview ends at spec persistence/handoff.
- Approval ownership is explicit and resumable without pretending to be an interview phase.
- No runtime UI/resume consumer still depends on `deepInterview.approvalHandoff` or `deepInterview.routingApproval`.
- The sanctioned boundary-clearing spec write is explicit, testable, and produces a receipt/state transition the mutation guard can recognize.

**Verification**
- `bun test tests/extensions/pi-oven-runtime/deep-interview-runtime.test.ts tests/extensions/pi-oven-runtime/deep-interview-state.test.ts tests/extensions/pi-oven-runtime/pi-oven-ask.test.ts tests/extensions/pi-oven-runtime/trace-primitives.test.ts tests/extensions/pi-oven-runtime/wiring.test.ts tests/extensions/pi-oven-runtime/model-routing-approval.test.ts tests/extensions/pi-oven-runtime/gate-state.test.ts`

---

# Tranche T3 — Brainstorming parity + mutation boundary

## Task Group T3-A — Port gajae-style brainstorming semantics into skill prose and render contract

**Depends on**
- T2-B complete

**Parallelizable slices**
- T3-B mutation guard can start only after the completion boundary, sanctioned spec-write path, and approval resume semantics are frozen.

**Files**
- Modify:
  - `skills/brainstorming/SKILL.md`
  - `skills/brainstorming/references/checklist.md`
  - `.omp/extensions/pi-oven-runtime/deep-interview-render.ts`
  - `.omp/extensions/pi-oven-runtime/rules-injector.ts`
  - `.omp/extensions/pi-oven-runtime/skill-keyword-loader.ts`
  - `tests/extensions/pi-oven-runtime/deep-interview-state.test.ts`
  - `tests/extensions/pi-oven-runtime/rules-injector.test.ts`
  - `tests/extensions/pi-oven-runtime/skill-keyword-loader.test.ts`
- Test:
  - `bun test tests/extensions/pi-oven-runtime/deep-interview-state.test.ts tests/extensions/pi-oven-runtime/rules-injector.test.ts tests/extensions/pi-oven-runtime/skill-keyword-loader.test.ts`
  - `bun run lint:skills`

**Steps**
- [ ] Port Round 0 topology confirmation, weakest-component/weakest-dimension targeting, ambiguity formulas, trigger taxonomy, milestone bands, ontology rules, and closure/restate gate into `brainstorming` skill prose.
- [ ] Keep those semantics prompt-owned; do not move scoring into runtime logic.
- [ ] Expand the runtime contract prompt so resume state includes topology, milestone, next target, threshold, spec persistence progress, and approval-flow handoff state instead of only phase/approval summary.
- [ ] Add example-based tests for the richer injected contract.
- [ ] Run skill lint and targeted tests.

**Acceptance**
- Brainstorming skill prose matches the intended gajae-style algorithm closely enough that runtime state has a clear semantic producer.
- Injected runtime contract shows the richer state the skill now relies on.

**Verification**
- `bun test tests/extensions/pi-oven-runtime/deep-interview-state.test.ts tests/extensions/pi-oven-runtime/rules-injector.test.ts tests/extensions/pi-oven-runtime/skill-keyword-loader.test.ts`
- `bun run lint:skills`

## Task Group T3-B — Block `write` / `edit` / `ast_edit` while brainstorming/deep-interview is active

**Depends on**
- T3-A complete

**Parallelizable slices**
- None with T4 ask redesign; both touch shared approval/deep-interview decision points.

**Files**
- Modify:
  - `.omp/extensions/pi-oven-runtime/gate.ts`
  - `.omp/extensions/pi-oven-runtime/gate-handler.ts`
  - `.omp/extensions/pi-oven-runtime/gate-state.ts`
  - `.omp/extensions/pi-oven.ts`
  - `tests/extensions/pi-oven-runtime/gate.test.ts`
  - `tests/extensions/pi-oven-runtime/gate-handler.test.ts`
  - `tests/extensions/pi-oven-runtime/gate-state.test.ts`
  - `tests/extensions/pi-oven-runtime/wiring.test.ts`
- Test:
  - `bun test tests/extensions/pi-oven-runtime/gate.test.ts tests/extensions/pi-oven-runtime/gate-handler.test.ts tests/extensions/pi-oven-runtime/gate-state.test.ts tests/extensions/pi-oven-runtime/wiring.test.ts`

**Steps**
- [ ] Introduce a mutation-guard decision that blocks code-write tools while brainstorming/deep-interview is active and spec is not yet persisted.
- [ ] Define the exact unblock boundary as “deep-interview complete via sanctioned spec persistence”; approval-flow state by itself must not keep the deep-interview guard alive.
- [ ] Allow exactly one boundary-clearing completion action: the runtime-owned final spec persistence write plus the paired `deepInterview -> approvalFlow` state transition receipt from T2-B.
- [ ] Surface a clear gate error explaining why the write is blocked, which path is allowed, and what boundary clears it.
- [ ] Add tests for active interview, sanctioned spec-write, persisted spec, approval-flow pending, and migrated legacy states.
- [ ] Re-run the targeted gate suites.

**Acceptance**
- Code-write is impossible during active brainstorming/deep-interview.
- The block lifts at the approved boundary and does not linger incorrectly.
- The only allowed write during active deep-interview is the sanctioned boundary-clearing spec persistence action plus its paired state transition; all other code-write attempts remain blocked.

**Verification**
- `bun test tests/extensions/pi-oven-runtime/gate.test.ts tests/extensions/pi-oven-runtime/gate-handler.test.ts tests/extensions/pi-oven-runtime/gate-state.test.ts tests/extensions/pi-oven-runtime/wiring.test.ts`

# Tranche T4 — `pi-oven_ask` schema + TUI redesign

## Task Group T4-A — Introduce the mixed structured+markdown ask schema and image-style layout

**Depends on**
- T3-B complete

**Parallelizable slices**
- T4-B routing approval integration depends on this schema freeze.

**Files**
- Modify:
  - `.omp/extensions/pi-oven-runtime/pi-oven-ask.ts`
  - `.omp/extensions/pi-oven-runtime/deep-interview-render.ts`
  - `.omp/extensions/pi-oven.ts`
  - `tests/extensions/pi-oven-runtime/pi-oven-ask.test.ts`
  - `tests/extensions/pi-oven-runtime/wiring.test.ts`
- Test:
  - `bun test tests/extensions/pi-oven-runtime/pi-oven-ask.test.ts tests/extensions/pi-oven-runtime/wiring.test.ts`

**Steps**
- [ ] Add `contextHeaders`, `contextSections`, `detailMarkdown`, and affordance flags to the public `pi-oven_ask` schema.
- [ ] Redesign `renderCall()` / `renderResult()` into the image-style hierarchy: title → header chips → markdown context → options → outcome.
- [ ] Preserve per-option descriptions and recommended markers.
- [ ] Make `Other (type your own)` and `Ask about these choices` explicit first-class rows/actions.
- [ ] Expand result details so callers can distinguish `selected`, `other`, `ask_about_choices`, `deferred`, and `cancelled`.
- [ ] Update tests for parse, render, result shape, and resume-safe metadata round-trip.
- [ ] Run the targeted suites.

**Acceptance**
- `pi-oven_ask` becomes a reusable native decision UI contract, not just a thin select wrapper.
- The new affordances are schema-backed and test-backed.

**Verification**
- `bun test tests/extensions/pi-oven-runtime/pi-oven-ask.test.ts tests/extensions/pi-oven-runtime/wiring.test.ts`

## Task Group T4-B — Expand routing approval and explanatory branches on the new ask contract

**Depends on**
- T4-A complete
- T2-B complete

**Parallelizable slices**
- Can overlap with T5-A native worker startup work; file sets are disjoint.

**Files**
- Modify:
  - `.omp/extensions/pi-oven-runtime/pi-oven-ask.ts`
  - `.omp/extensions/pi-oven-runtime/deep-interview-runtime.ts`
  - `.omp/extensions/pi-oven-runtime/model-routing-approval.ts`
  - `.omp/extensions/pi-oven-runtime/deep-interview-render.ts`
  - `.omp/extensions/pi-oven.ts`
  - `tests/extensions/pi-oven-runtime/pi-oven-ask.test.ts`
  - `tests/extensions/pi-oven-runtime/deep-interview-runtime.test.ts`
  - `tests/extensions/pi-oven-runtime/model-routing-approval.test.ts`
  - `tests/extensions/pi-oven-runtime/wiring.test.ts`
- Test:
  - `bun test tests/extensions/pi-oven-runtime/pi-oven-ask.test.ts tests/extensions/pi-oven-runtime/deep-interview-runtime.test.ts tests/extensions/pi-oven-runtime/model-routing-approval.test.ts tests/extensions/pi-oven-runtime/wiring.test.ts`

**Steps**
- [ ] Route routing-bucket approvals through the canonical `approvalFlow` + `pi-oven_ask` schema established in T2-B/T4-A.
- [ ] Route post-spec handoff choices through the same ask contract with explicit context headers and markdown guidance.
- [ ] Define affordance semantics precisely: `affordances.other` and `affordances.askAboutChoices` control row presence and action validity in both UI and headless paths.
- [ ] Ensure `Ask about these choices` opens the explanatory branch without collapsing pending approval state and persists a distinct `ask_about_choices` action in traces/resume state.
- [ ] Preserve per-role expansion and resume semantics for routing approval.
- [ ] Add tests for approve / override / ask-about / reject / resume scenarios in UI and headless branches.
- [ ] Run the targeted suites.

**Acceptance**
- Both routing approval and spec-handoff approval use the same ask/runtime contract.
- Resume works across all branches without prompt reconstruction.
- UI and headless paths agree on affordance visibility, result shape, and persisted action semantics.

**Verification**
- `bun test tests/extensions/pi-oven-runtime/pi-oven-ask.test.ts tests/extensions/pi-oven-runtime/deep-interview-runtime.test.ts tests/extensions/pi-oven-runtime/model-routing-approval.test.ts tests/extensions/pi-oven-runtime/wiring.test.ts`

---

# Tranche T5 — Performance workstreams

## Task Group T5-A — Improve native worker startup throughput

**Depends on**
- T1-B complete

**Parallelizable slices**
- Can run in parallel with T4-B and T5-B because file ownership is disjoint.

**Files**
- Modify:
  - `scripts/pi-oven-team/runtime-v2.ts`
  - `scripts/pi-oven-team/task-file-ops.ts`
  - `scripts/pi-oven-team/team-config.ts`
  - `tests/scripts/pi-oven-team/runtime-v2.test.ts`
  - `tests/scripts/pi-oven-team/scaling.test.ts`
  - `tests/scripts/pi-oven-team/lane-policy.test.ts`
  - `tests/scripts/pi-oven-team/task-file-ops.test.ts`
- Reuse unchanged contract surfaces:
  - `scripts/pi-oven-team/index.ts`
  - `scripts/pi-oven-team/lane-policy.ts`
- Test:
  - `bun test tests/scripts/pi-oven-team/runtime-v2.test.ts tests/scripts/pi-oven-team/scaling.test.ts tests/scripts/pi-oven-team/lane-policy.test.ts tests/scripts/pi-oven-team/task-file-ops.test.ts`

**Steps**
- [ ] Instrument current startup barriers so the benchmark captures pane reservation, persistence, and spawn overlap separately.
- [ ] Reduce safe serialization points without weakening dependency-aware batching or collision rejection.
- [ ] Keep the launcher boundary and lane classification contract unchanged; optimize only within startup batching/persistence surfaces.
- [ ] Add correctness cases where a dependency-bearing writer lane and a read-only/verification lane share the same startup batch graph, proving barrier relaxation does not reorder or overrun collision rules.
- [ ] Preserve the existing evidence fields and add an explicit relative improvement assertion.
- [ ] Re-run the targeted native worker startup suite.
- [ ] Make the benchmark realism deterministic: use synthetic clock, deterministic counters, or equivalent stable instrumentation instead of flaky wall-clock-only assertions.

**Acceptance**
- Startup throughput improves by the contract target with benchmark evidence.
- Independence gating and collision safety remain green.
- Mixed dependency/read-only lane cases stay correct while the benchmark target is met.

**Verification**
- `bun test tests/scripts/pi-oven-team/runtime-v2.test.ts tests/scripts/pi-oven-team/scaling.test.ts tests/scripts/pi-oven-team/lane-policy.test.ts tests/scripts/pi-oven-team/task-file-ops.test.ts`

## Task Group T5-B — Reduce gate hot-path I/O while preserving proof semantics

**Depends on**
- T3-B complete

**Parallelizable slices**
- Can run in parallel with T5-A.

**Files**
- Modify:
  - `.omp/extensions/pi-oven-runtime/gate-handler.ts`
  - `.omp/extensions/pi-oven-runtime/gate-state.ts`
  - `.omp/extensions/pi-oven-runtime/gate.ts`
  - `.omp/extensions/pi-oven.ts`
  - `tests/extensions/pi-oven-runtime/gate-handler.test.ts`
  - `tests/extensions/pi-oven-runtime/gate.test.ts`
  - `tests/extensions/pi-oven-runtime/gate-state.test.ts`
- Create:
  - focused benchmark helper/test only if current suites cannot express the target clearly; if created, it becomes a required member of this tranche's verification commands and the final T6-B matrix
- Test:
  - `bun test tests/extensions/pi-oven-runtime/gate-handler.test.ts tests/extensions/pi-oven-runtime/gate.test.ts tests/extensions/pi-oven-runtime/gate-state.test.ts`

**Steps**
- [ ] Add turn-local snapshot reuse or equivalent coalescing to avoid redundant state-store reads/writes for same-turn code-write checks.
- [ ] Keep branch-contract proof, owned skill read proof, external consent, verifier-depth, and mutation-guard outcomes identical for equivalent inputs.
- [ ] Encode a benchmark assertion or state-I/O count assertion proving the relative reduction.
- [ ] Use synthetic clock or deterministic counter instrumentation for gate hot-path benchmark assertions so the evidence is stable under CI variance.
- [ ] Run the targeted suites.

**Acceptance**
- Same-turn gate latency or state-I/O count meets the relative improvement contract.
- No correctness regressions appear in existing gate tests.

**Verification**
- `bun test tests/extensions/pi-oven-runtime/gate-handler.test.ts tests/extensions/pi-oven-runtime/gate.test.ts tests/extensions/pi-oven-runtime/gate-state.test.ts`
- if T5-B creates a dedicated focused benchmark suite, run the exact additional `bun test <focused-gate-benchmark-suite>` command in this tranche as a required verification step

---

# Tranche T6 — Final contract sweep and tranche-close verification

## Task Group T6-A — Reconcile docs/help/runtime outputs with the new contracts

**Depends on**
- T1 through T5 complete

**Parallelizable slices**
- Final sweep only; do not overlap with implementation work.

**Files**
- Modify:
  - `commands/setup.md`
  - `commands/doctor.md`
  - `README.md`
  - `CLAUDE.md`
  - any remaining tests that still pin pre-cutover wording or state shapes
- Test:
  - targeted doc/help/runtime suites touched by the edits
  - `bun run lint:agents`
  - `bun run lint:skills`

**Steps**
- [ ] Rewrite user-facing setup/help prose so it matches runtime-owned provider-family policy and the new interview/approval boundary.
- [ ] Remove leftover references to `approval_pending` as native deep-interview completion, `codex + zen` as mandatory critic pair, or old ask affordance assumptions.
- [ ] Update any touched tests.
- [ ] Run the affected suites and lint commands.

**Acceptance**
- Docs, help surfaces, runtime behavior, and tests describe the same contracts.

**Verification**
- Run the exact targeted tests for the changed files.
- `bun run lint:agents`
- `bun run lint:skills`

## Task Group T6-B — Tranche-close targeted verification matrix

**Depends on**
- T6-A complete

**Parallelizable slices**
- Verification is sequential by contract group.

**Files**
- Test only; no new source targets

**Steps**
- [ ] Run provider-family contract suites.
- [ ] Run deep-interview/approval/ask suites.
- [ ] Run mutation-gate suites.
- [ ] Run native-worker performance suites.
- [ ] Run gate hot-path performance suites.
- [ ] If T5-B introduced a dedicated focused gate benchmark suite, run that exact suite here as part of tranche-close verification.
- [ ] Run `bun run check` after the state/schema cutovers settle.
- [ ] Capture benchmark outputs and confirm the relative targets are met.

**Acceptance**
- All changed contract families have direct test evidence.
- Benchmark-backed speed claims are proven, not inferred.
- Type-level/schema integration stays green after the V2 state + approvalFlow + ask contract cutover.

**Verification**
- `bun test tests/extensions/pi-oven.test.ts tests/scripts/pi-oven-setup/profiles.test.ts tests/scripts/pi-oven-setup/apply.test.ts tests/scripts/pi-oven-setup/status.test.ts tests/extensions/pi-oven-runtime/model-routing-approval.test.ts tests/extensions/pi-oven-runtime/skill-keyword-loader.test.ts tests/extensions/pi-oven-runtime/rules-injector.test.ts`
- `bun test tests/extensions/pi-oven-runtime/deep-interview-state.test.ts tests/extensions/pi-oven-runtime/deep-interview-runtime.test.ts tests/extensions/pi-oven-runtime/pi-oven-ask.test.ts tests/extensions/pi-oven-runtime/trace-primitives.test.ts tests/extensions/pi-oven-runtime/wiring.test.ts`
- `bun test tests/extensions/pi-oven-runtime/gate.test.ts tests/extensions/pi-oven-runtime/gate-handler.test.ts tests/extensions/pi-oven-runtime/gate-state.test.ts`
- `bun test tests/scripts/pi-oven-team/runtime-v2.test.ts tests/scripts/pi-oven-team/scaling.test.ts tests/scripts/pi-oven-team/lane-policy.test.ts tests/scripts/pi-oven-team/task-file-ops.test.ts`
- `bun run check`
- `bun run lint:agents`
- `bun run lint:skills`
- if T5-B introduced a dedicated focused gate benchmark suite, run the exact additional `bun test <focused-gate-benchmark-suite>` command here as well

---

## Dependency ordering summary

1. **T1 first** — provider-family execution contract must settle before routing approval and verifier flow can consume it symbolically.
2. **T2 next** — deep-interview V2 envelope, approvalFlow extraction, and the sanctioned spec-persistence completion path define the canonical state boundary.
3. **T3 after T2-B** — brainstorming parity and mutation guard depend on the new completion and approval ownership semantics.
4. **T4 after T3-B / T4-A schema freeze** — ask redesign must wait for the mutation boundary to settle because both lanes touch approval/deep-interview decision points.
5. **T5 in parallel lanes** — worker startup and gate hot-path can proceed once their prerequisite semantics settle.
6. **T6 last** — final docs/help/test sweep only after runtime contracts stop moving.

## Parallelizable workstreams

- **Parallel lane P1**: `T5-A` native worker startup throughput can overlap with `T4-B` ask/routing integration.
- **Parallel lane P2**: `T5-B` gate hot-path optimization can overlap with `T5-A` once `T3-B` is merged.
- **Not parallelizable**:
  - `T1-A` with `T1-B` (shared runtime/policy ownership)
  - `T2-A` with `T2-B` before field/phase freeze
  - `T3-A` with `T3-B` (shared completion boundary logic)
  - `T3-B` with `T4-A` (shared approval/deep-interview decision surface)
  - `T4-A` with `T4-B` (shared ask schema/render surface)
  - `T6` with any implementation tranche

## Highest-risk areas to watch during execution

1. `approval_pending` → separated `approvalFlow` migration and resume correctness.
2. `brainstorming` skill prose와 runtime validation boundary가 다시 섞이는 over-implementation 위험.
3. `pi-oven_ask` redesign에서 `Other` / `Ask about these choices` / resume-state persistence가 서로 충돌하는 branch handling.
4. gate hot-path optimization이 mutation guard / skill proof / branch contract semantics를 무너뜨릴 위험.
5. provider-family symbolic wording cutover 후에도 일부 tests/agent bodies가 old named-model assumptions를 숨겨서 유지하는 drift.
