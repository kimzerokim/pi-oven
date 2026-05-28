# Survey: Plan 2 Standard Expansion — 2026-05-27 — SUPERSEDED

**Status (2026-05-28)**: SUPERSEDED. This survey was authored at the Plan 2 kickoff entry that was later replaced by the Spec A / Spec B / Spec C initiative (`docs/specs/2026-05-28-pi-oven-{agent-registry,setup-wizard,skill-rewrite-and-new-skills}.md`). v0.1.0 reached via that path, not the "~33 skill expansion" surveyed below. Retained as historical evidence; do NOT use as authoritative SoT for current work.

## Tool availability

| Tool | Status | Evidence |
|---|---|---|
| ast_grep | ok | import/export probes succeeded in `scripts/**/*.ts` and `.omp/extensions/**/*.ts` |
| lsp_workspace_symbols | degraded (`No Project`) | `lsp_workspace_symbols` failed with `TypeScript Server Error: No Project`; `lsp_find_references` worked with absolute paths |
| Context7 | ok | resolved and queried `/can1357/oh-my-pi`, `/oven-sh/bun`, `/microsoft/typescript` |
| CRG | ok but unindexed | `list_graph_stats`: Files `0`, Nodes `0`, Edges `0`; `query_graph`/`get_impact_radius` returned zero results |

## Exact evidence: what Plan 2 means, and current SoT status

### Plan 2 meaning
- The design spec defines the target scope as **Standard ~45 skills** and the plan phase as **Plan 2 — Standard expansion (~33 skill, dogfood mode)** (`docs/specs/2026-05-27-pi-oven-foundation-design.md:40`, `docs/specs/2026-05-27-pi-oven-foundation-design.md:122`).
- The dogfood decision makes Plan 2 the first cycle whose **main driver is omp + installed `pi-oven@pi-oven`**, not a Claude Code migration session (`docs/decisions/0001-dogfood-switch.md:12`, `docs/decisions/0001-dogfood-switch.md:25-27`).
- The flow log restates Plan 2 as **Standard expansion ~33 skills** and the **first cycle to run inside omp + pi-oven** (`docs/harness/harness-flow-progress.md:20`).
- Plan 1 acceptance explicitly stops before Plan 2 and says Plan 2 writing-plans starts only after user check-in (`docs/plans/2026-05-27-pi-oven-plan-1-bootstrap-12-core-skills.md:1925-1931`).

### SoT status right now
- **Authoritative / current:**
  - dogfood switch accepted (`docs/decisions/0001-dogfood-switch.md:12-28`)
  - plugin manifest lists 12 shipped skills and 3 commands at version `0.1.0` (`.claude-plugin/plugin.json:2-26`)
  - marketplace catalog advertises plugin version `0.1.0` (`.claude-plugin/marketplace.json:11-20`)
- **Stale / conflicting:**
  - `package.json` still says version `0.1.0` while plugin/catalog say `0.1.0` (`package.json:2-3`, `.claude-plugin/plugin.json:2-3`, `.claude-plugin/marketplace.json:19`)
  - extension label still says **Plan 0 scaffold** / `v0.1.0` (`.omp/extensions/pi-oven.ts:3-5`)
  - README still says **Current Status: v0.1.0 (Plan 0 scaffold)** (`README.md:26-30`)
  - WORKING-CONTEXT says Plan 1 is complete, but Active Queues still say **Plan 1 (queued)** and **Plan 2/3/4 (deferred)** (`docs/WORKING-CONTEXT.md:11-17`)

## Scope (22 files)

### First-wave file/module map

#### A. Control-plane docs
| File | Lines | Churn | Why in scope |
|---|---:|---:|---|
| `docs/WORKING-CONTEXT.md` | 40 | 5 | active sprint + stale queue state |
| `docs/specs/2026-05-27-pi-oven-foundation-design.md` | 463 | 2 | Plan 2 definition + planned component model |
| `docs/decisions/0001-dogfood-switch.md` | 36 | 1 | dogfood-mode cutover decision |
| `docs/harness/harness-flow-progress.md` | 47 | 4 | latest cycle status + Plan 2 stop point |
| `docs/plans/2026-05-27-pi-oven-plan-1-bootstrap-12-core-skills.md` | 1985 | hot design artifact | acceptance gate and Plan 2 entry contract |

#### B. Install/publish/runtime surface
| File | Lines | Churn | Why in scope |
|---|---:|---:|---|
| `package.json` | 28 | n/a | dependency + build + extension registration |
| `tsconfig.json` | 17 | n/a | TS project boundaries for Plan 2 code |
| `models.yml` | 38 | 1 | provider routing + only concrete key name |
| `.claude-plugin/plugin.json` | 27 | 5 | shipped skills/commands/agents/hooks truth |
| `.claude-plugin/marketplace.json` | 31 | n/a | published marketplace metadata |
| `.omp/extensions/pi-oven.ts` | 6 | 1 | installed extension entry; currently no-op |
| `commands/pi-oven-setup.md` | 10 | n/a | promised install wizard, still stub |
| `commands/pi-oven-doctor.md` | 10 | n/a | promised health check, still stub |
| `commands/pi-oven-autonomous.md` | 11 | n/a | promised dogfood entrypoint, still stub |
| `README.md` | 42 | 2 | install docs + stale status |
| `agents/` | 0 meaningful files | empty | spec wants 14 agents; repo has only `.gitkeep` |
| `hooks/`, `rules/` | 0 meaningful files | empty | spec promises hook/rule enforcement; repo has only `.gitkeep` |

#### C. Dogfood/eval surface
| File | Lines | Churn | Why in scope |
|---|---:|---:|---|
| `scripts/run-eval.ts` | 114 | 2 | only real runtime TS path beyond no-op extension |
| `scripts/lib/eval-runner.ts` | 135 | 1 | scenario executor + SDK event adapter |
| `scripts/lib/scenario-schema.ts` | 35 | 1 | exported type contracts |
| `tests/scripts/eval-runner.test.ts` | 90 | n/a | type-contract consumers |
| `tests/scripts/run-eval.test.ts` | 18 | n/a | CLI smoke boundary |
| `evals/dogfood/scenarios/v0.1.0-end-to-end.yaml` | 11 | n/a | canary proving Plan 1 dogfood threshold |
| `.github/workflows/ci.yml` | 30 | n/a | CI stops at build/tests; no live eval |

## Libraries (3 packages)

| Package | Version | In-scope usage | Source used | Findings |
|---|---|---|---|---|
| `@oh-my-pi/pi-coding-agent` | `*` | `.omp/extensions/pi-oven.ts:1`; `scripts/run-eval.ts:3,56-84` | Context7 `/can1357/oh-my-pi` | `createAgentSession` auto-discovers config; `ExtensionAPI` expects a real extension factory. Wildcard version is drift risk for Plan 2 dogfood. |
| `bun-types` | `*` | `scripts/lib/eval-runner.ts:6`; `scripts/run-eval.ts:88`; `tests/scripts/run-eval.test.ts:2` | Context7 `/oven-sh/bun` | Bun globals (`Bun.YAML.parse`, `Bun.argv`, `spawnSync`) are real runtime dependencies. Wildcard version is drift risk. |
| `typescript` | `^5.5.0` | `tsconfig.json:2-16`; LSP behavior in this survey | Context7 `/microsoft/typescript` | `moduleResolution: bundler` is intentional (`tsconfig.json:4-13`). LSP workspace-symbol indexing is not currently attached despite valid include globs. |

## Patterns

- **Naming:** values use `camelCase`; exported contracts use `PascalCase` (`Args`, `RunnerEvent`, `SessionLike`, `Scenario`, `Verdict`) (`scripts/run-eval.ts:7-25`, `scripts/lib/eval-runner.ts:18-29`, `scripts/lib/scenario-schema.ts:1-35`).
- **Error handling:** parser throws on invalid scenario shape (`scripts/lib/eval-runner.ts:5-12`), but scenario discovery silently swallows missing directories via `catch {}` (`scripts/run-eval.ts:34-48`). CLI exits `0` on no matches and `1` on failed verdicts (`scripts/run-eval.ts:91-109`).
- **Async model:** runtime code is `async/await` end-to-end; SDK integration uses `session.subscribe()` + `message_end` synchronization because `prompt()` returns `Promise<void>` (`scripts/lib/eval-runner.ts:24-30`, `scripts/lib/eval-runner.ts:38-60`, `scripts/run-eval.ts:52-84`).
- **State management:** all real TS state is local, per-call mutable buffers (`TurnBuffer`, `lastBuf`, `verdicts`) with no persisted runtime state (`scripts/lib/eval-runner.ts:33-36`, `scripts/lib/eval-runner.ts:63-135`, `scripts/run-eval.ts:94-108`). This diverges sharply from the planned extension-owned state machine in the spec (`docs/specs/2026-05-27-pi-oven-foundation-design.md:52`, `docs/specs/2026-05-27-pi-oven-foundation-design.md:136-145`).
- **Module boundaries:** direct relative imports only; no barrels. The only shipped extension default-export is a no-op label/logger (`.omp/extensions/pi-oven.ts:3-5`). Commands are markdown stubs, not real implementation surfaces (`commands/pi-oven-setup.md:6-10`, `commands/pi-oven-doctor.md:6-10`, `commands/pi-oven-autonomous.md:7-11`).

## Type contracts

`lsp_workspace_symbols` was unavailable, so contracts were enumerated via `ast_grep` + file reads, then reverse dependencies were mapped with `lsp_find_references`.

| Contract | Defined at | LSP refs | Consumers in scope | Risk |
|---|---|---:|---|---|
| `ScenarioTurn` | `scripts/lib/scenario-schema.ts:1-4` | 2 | only `Scenario.input` (`scripts/lib/scenario-schema.ts:22`) | internal-only |
| `ScenarioExpectation` | `scripts/lib/scenario-schema.ts:10-16` | 2 | only `Scenario.expected` (`scripts/lib/scenario-schema.ts:23`) | internal-only |
| `Scenario` | `scripts/lib/scenario-schema.ts:18-24` | 7 | `eval-runner.ts` import + parser + runner (`scripts/lib/eval-runner.ts:1,3,5-12,63`) | highest-impact contract in current runtime |
| `Verdict` | `scripts/lib/scenario-schema.ts:26-35` | 3 | `eval-runner.ts` import + `runScenario()` return (`scripts/lib/eval-runner.ts:1,63`) | internal-only |
| `RunnerEvent` | `scripts/lib/eval-runner.ts:18-22` | 2 | `SessionLike.subscribe()` (`scripts/lib/eval-runner.ts:28`) | internal-only |
| `SessionLike` | `scripts/lib/eval-runner.ts:27-30` | 3 | `runTurn()`, `runScenario()` (`scripts/lib/eval-runner.ts:38,63`) plus `run-eval.ts` adapter import (`scripts/run-eval.ts:2,56-84`) and tests (`tests/scripts/eval-runner.test.ts:2,34-75`) | medium-impact adapter contract |

No exported TS contract in the current runtime surface is unused. None has broad reverse dependencies outside the eval runner/test slice.

## Env vars

### Code-level scan result
- `process.env`, `import.meta.env`, `os.environ`, `os.getenv`: **no hits** in surveyed TS/runtime files.
- `.env.example`: **absent**.

### Operational env/doc surface already promised in scope
| Env var | Evidence | Status | Gap |
|---|---|---|---|
| `ANTHROPIC_API_KEY` | `models.yml:35-38` | undocumented in canonical env file | README promises generic provider-key detection (`README.md:16-24`) but never names concrete keys besides this one; no `.env.example` exists |
| `PI_OVEN_CYCLE_EXIT_VERIFIED` | skill/docs only (`skills/fresh-verifier/SKILL.md:74`; plan mentions throughout) | undocumented in canonical env file | runtime extension does not implement verifier gate yet |
| `PI_OVEN_CYCLE_EXIT_SKIP` | `skills/fresh-verifier/SKILL.md:75`; `skills/pre-commit-gate/SKILL.md:53` | undocumented in canonical env file | bypass semantics documented before hook implementation exists |
| `PI_OVEN_GATE05_SKIP`, `PI_OVEN_GATE35_SKIP`, `PI_OVEN_GATE35_DISABLE`, `PI_OVEN_GATE4_SKIP`, `PI_OVEN_GATE45_SKIP`, `PI_OVEN_GATE5_SKIP` | `skills/pre-commit-gate/SKILL.md:47-53` | undocumented in canonical env file | all are spec/skill-level, not executable in current extension |

## Concrete blockers / risks for running Plan 2 inside omp + installed plugin

1. **Installed-plugin driver gap:** Plan 2 assumes omp + installed plugin is the primary driver (`docs/decisions/0001-dogfood-switch.md:12`, `:25-27`), but the actual extension is still a no-op (`.omp/extensions/pi-oven.ts:3-5`), commands are stubs (`commands/pi-oven-setup.md:8-10`, `commands/pi-oven-doctor.md:8-10`, `commands/pi-oven-autonomous.md:9-11`), and `agents[]` is empty in the manifest (`.claude-plugin/plugin.json:19-26`).
2. **SoT/version drift at dogfood boundary:** package/README/extension still advertise Plan 0 / `v0.1.0` (`package.json:2-3`, `README.md:26-29`, `.omp/extensions/pi-oven.ts:4`) while plugin/catalog advertise `v0.1.0` (`.claude-plugin/plugin.json:3`, `.claude-plugin/marketplace.json:19`). Fresh installed users will see contradictory state.
3. **Planned component surface is mostly missing:** spec expects ~45 skills, 14 agents, ~23 commands, hooks/rules, and stateful extension enforcement (`docs/specs/2026-05-27-pi-oven-foundation-design.md:51-56`); shipped repo currently has 12 skills (`.claude-plugin/plugin.json:5-17`), 3 commands (`.claude-plugin/plugin.json:20-23`), empty `agents/`, empty `hooks/`, empty `rules/`.
4. **Provider bootstrap remains deferred:** decision and CI both defer live eval execution until Plan 4 key bootstrap (`docs/decisions/0001-dogfood-switch.md:27,30-36`, `.github/workflows/ci.yml:23-26`). `tests/scripts/run-eval.test.ts:13-17` also explicitly removed real CLI smoke due to missing API keys.
5. **Survey/fix-scope support infra is degraded inside current repo:** CRG is configured but empty (0 files/nodes), and `lsp_workspace_symbols` is unavailable. Plan 2 work can proceed, but callsite and impact analysis will fall back to text/AST search until indexing is fixed.
6. **Dependency drift risk:** both runtime dependencies are wildcards (`package.json:18-23`), which is high-risk for a dogfood cycle coupled to a fast-moving SDK.

## Recommended next 3 implementation tasks for fresh executor subagents

1. **SoT/version sync cutover**
   - Files: `package.json`, `README.md`, `.omp/extensions/pi-oven.ts`, `docs/WORKING-CONTEXT.md`
   - Goal: make all user-visible and runtime-visible version/state strings agree on `v0.1.0` + “Plan 2 preflight” instead of Plan 0 scaffold.

2. **Dogfood install-preflight MVP**
   - Files: `commands/pi-oven-setup.md`, `commands/pi-oven-doctor.md`, `models.yml`, `docs/instincts/omp-install-layout.md`
   - Goal: turn setup/doctor from stubs into concrete preflight flows that verify installed plugin path, provider availability, required MCPs, and known env/key expectations before Plan 2 execution.

3. **Minimal dogfood runtime substrate**
   - Files: `.claude-plugin/plugin.json`, `agents/explore.md`, `agents/executor.md`, `agents/verifier.md`, `commands/pi-oven-autonomous.md`
   - Goal: seed the minimal agents + manifest wiring required for installed-plugin-driven survey/plan/verify loops before attempting the full ~33-skill Standard expansion.

## CRG status (if configured)

```text
Graph statistics for pi-oven:
  Files: 0
  Total nodes: 0
  Total edges: 0
  Languages: none
  Last updated: never

Nodes by kind:

Edges by kind:

Embeddings: 0 nodes embedded
  (install sentence-transformers for semantic search)
```

Additional CRG probes:
- `file_summary('scripts/run-eval.ts')` → `0 result(s)`
- impact radius for `scripts/run-eval.ts` + `.omp/extensions/pi-oven.ts` → `0 directly changed`, `0 impacted`

## Evidence summary

Plan 2 means “Standard expansion” in dogfood mode: spec says ~45 total skills / ~33-skill Plan 2, and the accepted dogfood-switch decision says Plan 2 is the first cycle driven by omp + installed `pi-oven@pi-oven` rather than Claude Code. The current SoT is inconsistent: plugin/catalog say `v0.1.0`, but `package.json`, README, extension label, and WORKING-CONTEXT queue text still reflect Plan 0 / `v0.1.0`. The practical runtime surface is thin: 12 shipped skills, 3 stub commands, no agents, empty hooks/rules, no-op extension, real eval runner only. Code-level env usage is zero, but operational env names (`ANTHROPIC_API_KEY`, `PI_OVEN_*`) are already documented without a canonical `.env.example`. Biggest blockers for Plan 2 inside installed omp: no real plugin driver, SoT drift, provider-key bootstrap still deferred, empty CRG index, and wildcard SDK/runtime dependency pins.