# pi-oven meta control-plane runtime contract

## Scope

This document locks the runtime contract that Tasks 1 through 8 established for the current pi-oven redesign wave.

- The **source repo** is the only authoring target for runtime and release work.
- The **release artifact** is the version-synced package/manifests/tag generated from that source checkout.
- The **installed cache** is an observation-only consumer snapshot under `~/.omp/plugins/cache/plugins/`; it is never a patch target.

## 1. Control-plane proof surfaces

The control plane is the typed runtime surface under `.omp/extensions/pi-oven-runtime/` plus the parent extension wiring in `.omp/extensions/pi-oven.ts`.

Locked proof surfaces:

- `requiredSkills` + `ownedSkillReadTargets` gate skill ownership instead of trusting prompt prose alone.
- `branch-contract.json` remains the write gate for source-changing work.
- `externalExecConsent` remains the external-action gate.
- `capability-registry.ts` defines the capability/tag inventory, including `release_install_sync`.
- `project-state.ts` preserves the live `.pi-oven/state/*.json` layout while making ownership explicit.

Evidence anchors:

- `tests/extensions/pi-oven-runtime/capability-registry.test.ts`
- `tests/extensions/pi-oven-runtime/project-state.test.ts`
- `tests/extensions/pi-oven-runtime/gate.test.ts`
- `tests/extensions/pi-oven-runtime/gate-handler.test.ts`

## 2. Deep-interview contract

Deep interview is a pi-oven-native runtime primitive, not a prompt-only convention.

Locked behavior:

- `pi-oven-ask.ts` carries structured deep-interview metadata.
- `deep-interview-runtime.ts` seeds pending questions into persisted state and resumes from the same runtime store.
- `deep-interview-state.ts` owns durable round identity, merge rules, and approval handoff shape.
- Approval answers land in structured state that can resume the next phase without a second prompt-only translation layer.

Evidence anchors:

- `tests/extensions/pi-oven-runtime/deep-interview-runtime.test.ts`
- `tests/extensions/pi-oven-runtime/deep-interview-state.test.ts`
- `tests/extensions/pi-oven-runtime/rules-injector.test.ts`
- `tests/extensions/pi-oven-runtime/wiring.test.ts`

## 3. Continuation and verification contract

Continuation and completion are separate runtime concepts.

Locked behavior:

- `continuation-marker.ts` models four structured continuation markers instead of free-form resume prose.
- `trace-primitives.ts` records function/symbol/state-focused trace evidence for runtime mutations.
- `verifier-depth-policy.ts` decides `light` vs `deep` verification from mode, mutation scope, and material-edit status.
- Autonomous runtime-contract edits require deep verification and a one-step hard cap for consecutive auto-continues.

Evidence anchors:

- `tests/extensions/pi-oven-runtime/continuation-marker.test.ts`
- `tests/extensions/pi-oven-runtime/autonomous-stop-guard.test.ts`
- `tests/extensions/pi-oven-runtime/trace-primitives.test.ts`
- `tests/extensions/pi-oven-runtime/verifier-depth-policy.test.ts`

## 4. Parallel runtime contract

OMP `task` is the single runtime dispatch seam.

Locked behavior:

- Pi-oven guidance packs dependency-ready, file-disjoint work toward an 8-12 sibling wave.
- OMP `async.enabled` and `task.maxConcurrency` own scheduling; provider/runtime admission may impose a smaller actual ceiling.
- Canonical dispatch payloads must satisfy the local strict `RuntimeContract` task schema and, when exported, the installed OMP task schema.
- Static release evidence is reported separately from the opt-in live dispatch canary. A skipped live canary is `NOT RUN`, never a claimed pass.

Evidence anchors:

- `tests/plugin/task-dispatch-canary.test.ts`
- `scripts/canary-runtime-dispatch.ts`
- `tests/extensions/pi-oven-runtime/runtime-contract.test.ts`

## 5. Release/install sync contract

Release/install sync is now explicitly bounded by the release helpers and the docs.

Locked behavior:

1. The **source repo** drives version truth through `package.json`, `.claude-plugin/plugin.json`, and `.claude-plugin/marketplace.json`.
2. The **release artifact** is produced from that checkout and may optionally sync the `.omp/extensions/pi-oven.ts` label plus changelog/tag state.
3. The **installed cache** is observation-only; the release helper refuses installed-cache roots and never treats them as the authoring surface.
4. Local git release writes stay on the current checked-out branch plus the `vX.Y.Z` tag; the helper does not guess `main`.
5. Dry-run output prints a `boundary` object so the source repo → release artifact → installed cache contract is visible in the tool output itself.

Evidence anchors:

- `scripts/pi-oven-release/manifest-sync.ts`
- `scripts/pi-oven-release/git-ops.ts`
- `scripts/pi-oven-release/index.ts`
- `tests/scripts/pi-oven-release/manifest-sync.test.ts`
- `tests/scripts/pi-oven-release/git-ops.test.ts`
- `tests/scripts/pi-oven-release/release-publisher.test.ts`
- `README.md`
- `commands/release.md`

## 6. Shared doctor/status truth contract

`scripts/pi-oven-setup/standalone-truth-surface.ts` owns `collectRuntimeTruthSurface()`. Both `/pi-oven:doctor` and `/pi-oven:setup --status` consume that function, so a single observed state cannot receive contradictory health labels.

The report covers:

- RuntimeContract version and byte-for-byte generated artifact parity.
- The exact 24-role registry plus canonical-agent and stale-config namespace counts.
- Project/global setup transaction terminal, recovered, or manual-recovery state.
- Run-ledger mode, SQLite schema, integrity, WAL, and active/stale leases.
- Capability-policy coverage of every agent profile tool declaration.
- Offline discrimination plus the last local trusted live-canary receipt.
- The exact supported OMP version derived from the pinned package dependency.
- Package/plugin/marketplace version parity and the immutable `v<version>` ref.
- Native-team state as `removed; OMP task owns dispatch`.

Only `PASS`, `WARN`, `FAIL`, and `NOT RUN` are public labels. Missing live-canary evidence and an intentionally inactive optional SQLite ledger are `NOT RUN`, never PASS. Recovery guidance is copy-pasteable; no destructive repair is automatic. Setup transaction startup recovery is limited to its journaled compare-and-swap rollback and stops on conflicts with a manual recovery artifact.

Evidence anchors:

- `scripts/pi-oven-setup/standalone-truth-surface.ts`
- `scripts/pi-oven-setup/status.ts`
- `scripts/pi-oven-doctor.ts`
- `tests/scripts/pi-oven-setup/runtime-truth-surface.test.ts`
