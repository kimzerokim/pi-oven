> Historical architecture; implementation removed in vNext; OMP task is current dispatch seam
> Superseded by [the runtime contract remediation implementation plan](../plans/2026-07-13-pi-oven-runtime-contract-remediation-implementation-plan.md).

# 2026-07-04 pi-oven meta-improvement baseline

## Evidence source

This baseline records the post-Task-8 state using the runtime/test surfaces created in Tasks 1 through 7, plus the release/install boundary locked in Task 8.

## 1. Control-plane baseline

Confirmed evidence:

- Capability inventory includes `code_write`, `owned_write_lane`, `shared_write_lane`, `external_read`, `external_mutation`, `ask`, `autonomous_continuation`, `verification_completion`, `debug_trace`, and `release_install_sync`.
- Capability tags prove the registry-first split: `deep-interview`, `verification`, and `runtime-routing`.
- Project state preserves the live `.pi-oven/state/{autonomous,push-consent,branch-contract}.json` layout while making writers and lanes explicit.
- Gate proof still depends on `requiredSkills`, exact `ownedSkillReadTargets`, branch contract, and external execution consent.

Evidence anchors:

- `tests/extensions/pi-oven-runtime/capability-registry.test.ts`
- `tests/extensions/pi-oven-runtime/project-state.test.ts`
- `tests/extensions/pi-oven-runtime/gate.test.ts`
- `tests/extensions/pi-oven-runtime/gate-handler.test.ts`

## 2. Deep-interview baseline

Confirmed evidence:

- Deep-interview question seeding persists a stable round key and pending-question record into runtime state.
- Answer recording clears pending state, persists the answered round, and resumes from the stored state.
- Approval handoff is structured metadata, not prompt-only text.

Evidence anchors:

- `tests/extensions/pi-oven-runtime/deep-interview-runtime.test.ts`
- `tests/extensions/pi-oven-runtime/deep-interview-state.test.ts`
- `tests/extensions/pi-oven-runtime/rules-injector.test.ts`
- `tests/extensions/pi-oven-runtime/wiring.test.ts`

## 3. Parallel-runtime baseline

Confirmed evidence:

- Startup fan-out occurs before first dispatch for independence-safe lanes.
- Scale-up fan-out persists the same startup evidence surface.
- Collision evidence, reducer order, and persistence order are stored together with the KPI metrics.

Evidence anchors:

- `tests/scripts/pi-oven-team/runtime-v2.test.ts`
- `tests/scripts/pi-oven-team/scaling.test.ts`
- `tests/scripts/pi-oven-team/index.test.ts`
- `scripts/pi-oven-team/team-config.ts`

### Runtime-v2 startup sample (captured 2026-07-05 from the Task 6 startup fan-out path)

fanoutLatencyMs: 252
sequentialComparableLatencyMs: 506
startupImprovementRatio: 2.008

### Scale-up startup sample (captured 2026-07-05 from the Task 6 scale-up fan-out path)

fanoutLatencyMs: 1
sequentialComparableLatencyMs: 4
startupImprovementRatio: 4

## 4. Autonomous-mode baseline

Confirmed evidence:

- Continuation state is structured into explicit marker types instead of free-form resume prose.
- Runtime trace evidence stays function/symbol/state-focused.
- Runtime-contract and team-runtime material edits force deep verification and material revalidation.
- Deep autonomous material edits hard-cap consecutive auto-continues at 1.

Evidence anchors:

- `tests/extensions/pi-oven-runtime/continuation-marker.test.ts`
- `tests/extensions/pi-oven-runtime/autonomous-stop-guard.test.ts`
- `tests/extensions/pi-oven-runtime/trace-primitives.test.ts`
- `tests/extensions/pi-oven-runtime/verifier-depth-policy.test.ts`

## 5. Release/install baseline

Confirmed evidence:

- The source repo is the only authoring target for release automation.
- The release artifact is defined by version-synced manifests plus optional label/changelog/tag work from that checkout.
- The installed cache is observation-only and the release helper refuses installed-cache roots.
- Local git publish behavior stays on the current checked-out branch plus the `vX.Y.Z` tag.
- The dry-run output now exposes the same boundary via a `boundary` object.

Evidence anchors:

- `docs/runtime-contracts/pi-oven-meta-control-plane.md`
- `scripts/pi-oven-release/manifest-sync.ts`
- `scripts/pi-oven-release/git-ops.ts`
- `scripts/pi-oven-release/index.ts`
- `tests/scripts/pi-oven-release/manifest-sync.test.ts`
- `tests/scripts/pi-oven-release/git-ops.test.ts`
- `tests/scripts/pi-oven-release/release-publisher.test.ts`
- `README.md`
- `commands/release.md`
