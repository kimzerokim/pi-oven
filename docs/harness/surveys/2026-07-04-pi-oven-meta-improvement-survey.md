> Historical architecture; implementation removed in vNext; OMP task is current dispatch seam
> Superseded by [the runtime contract remediation implementation plan](../../plans/2026-07-13-pi-oven-runtime-contract-remediation-implementation-plan.md).

# 2026-07-04 pi-oven meta-improvement survey

## Scope
- Topic: pi-oven meta-improvement survey for parallel execution, worker scheduling, loop/autonomous flow, skill loading, branch/approval gates, dependency boundaries, native tool leverage, and residual oh-my-claudecode / superpowers concepts.
- Non-goals: implementation, speculative rewrite.
- Excluded comparison root: `/Users/kimzerokim/work/personal/external_harness/oh-my-pi`.

- Strategic context: current fixed choice is `pi-oven-first 재설계`.

## Source-root determination

### Observation
Per user clarification, the source-of-truth pi-oven repo for this effort is the current cwd: `/Users/kimzerokim/work/personal/pi-oven`. The installed plugin cache and marketplace cache remain useful reference snapshots, but they are not the change target for this plan.

### Evidence
- User clarified that pi-oven source changes target the cwd repo, not the local installed copy.
- Repo cwd now hosts the planning artifacts for this effort under `docs/`.
- `/Users/kimzerokim/.omp/plugins/cache/plugins/kzk___pi-oven___0.1.23` remains the currently loaded runtime snapshot and is still useful for observing what omp is executing.
- `/Users/kimzerokim/.omp/plugins/cache/marketplaces/kzk` remains a source-like reference tree, but it is not the source-of-truth target for this planning track.
- README in the installed snapshot still documents setup resolution order `dev checkout → installed_plugins.json installPath → install-cache scan` (`/Users/kimzerokim/.omp/plugins/cache/plugins/kzk___pi-oven___0.1.23/README.md:68`), which explains why cache observations were initially useful but not authoritative for planned edits.

### Source roots in scope
1. `/Users/kimzerokim/work/personal/pi-oven` — source-of-truth repo and artifact home for this planning/design work.
2. `/Users/kimzerokim/work/personal/pi-oven/.pi-oven` — per-project runtime state (`autonomous.json`, `branch-contract.json`, `push-consent.json`).
3. `/Users/kimzerokim/.omp/plugins/cache/plugins/kzk___pi-oven___0.1.23` — installed runtime snapshot for behavior observation only.
4. `/Users/kimzerokim/.omp/plugins/cache/marketplaces/kzk` — reference source-like tree, not the planning source of truth.
5. `/Users/kimzerokim/.omp/agent/config.yml` — machine-global runtime config dependency.

### Explicitly ignored
- `/Users/kimzerokim/work/personal/pi-oven/.omc` — user marked this path out of scope for future planning and implementation work.

### Unknowns
- No repo-local `.omp/settings.json` was present in the current minimal cwd during this survey.
- No repo-local `.pi-oven/config.json` was present in the current minimal cwd during this survey.

## 8-step checklist result

### Step 0.5 — Tool/index availability
#### Observation
- `lsp`: unavailable in this project during the survey.
- `ast_grep`: available.
- Context7/CRG MCP were not available as callable tools in this session.

#### Evidence
- `lsp status` returned `No language servers configured for this project`.
- `ast_grep` returned matches for `Promise.all` and `process.env`.

#### Candidate opportunities
- Maintain a fallback-first survey path for installed plugin caches where LSP is absent.
- Keep core runtime modules shallow and grep/ast-friendly because installed-cache analysis often lacks rich indexers.

### Step 1 — Scope expansion
#### Observation
The main runtime/control plane centers on the extension and runtime modules below, with separate native worker orchestration under `scripts/pi-oven-team/`.

#### Evidence
- Extension/runtime core:
  - `/Users/kimzerokim/.omp/plugins/cache/plugins/kzk___pi-oven___0.1.23/.omp/extensions/pi-oven.ts`
  - `/Users/kimzerokim/.omp/plugins/cache/plugins/kzk___pi-oven___0.1.23/.omp/extensions/pi-oven-runtime/skill-keyword-loader.ts`
  - `/Users/kimzerokim/.omp/plugins/cache/plugins/kzk___pi-oven___0.1.23/.omp/extensions/pi-oven-runtime/rules-injector.ts`
  - `/Users/kimzerokim/.omp/plugins/cache/plugins/kzk___pi-oven___0.1.23/.omp/extensions/pi-oven-runtime/autonomous-stop-guard.ts`
  - `/Users/kimzerokim/.omp/plugins/cache/plugins/kzk___pi-oven___0.1.23/.omp/extensions/pi-oven-runtime/gate.ts`
  - `/Users/kimzerokim/.omp/plugins/cache/plugins/kzk___pi-oven___0.1.23/.omp/extensions/pi-oven-runtime/gate-handler.ts`
  - `/Users/kimzerokim/.omp/plugins/cache/plugins/kzk___pi-oven___0.1.23/.omp/extensions/pi-oven-runtime/gate-state.ts`
- Native worker runtime:
  - `/Users/kimzerokim/.omp/plugins/cache/plugins/kzk___pi-oven___0.1.23/scripts/pi-oven-team/index.ts:71-75,148-185`
  - `/Users/kimzerokim/.omp/plugins/cache/plugins/kzk___pi-oven___0.1.23/scripts/pi-oven-team/runtime-v2.ts:100-121,147-209`
  - `/Users/kimzerokim/.omp/plugins/cache/plugins/kzk___pi-oven___0.1.23/scripts/pi-oven-team/scaling.ts:25-31,38-50,107-142`

#### Candidate opportunities
- Treat extension gate/runtime and team runtime as one cross-module system in any redesign plan.
- Survey follow-up should include all `scripts/pi-oven-team/*` callsites before changing parallel execution semantics.

### Step 2 — Deep read + history
#### Observation
The plugin cache currently contains a single visible commit in its local git history: `release: v0.1.23`.

#### Evidence
- `git -C /Users/kimzerokim/.omp/plugins/cache/plugins/kzk___pi-oven___0.1.23 log --oneline -20 -- ...` returned `5358958 release: v0.1.23`.

#### Candidate opportunities
- For future archaeology, keep richer source-of-truth history outside the installed cache, because installed cache history is too shallow for design reasoning.

### Step 3 — Library detection
#### Observation
The runtime has intentionally narrow package dependencies but broad ambient runtime/tool dependencies.

#### Evidence
- `/Users/kimzerokim/.omp/plugins/cache/plugins/kzk___pi-oven___0.1.23/package.json:raw`
  - dependency: `@oh-my-pi/pi-coding-agent`
  - devDependencies: `bun-types`, `typescript`
- Imports found:
  - `@oh-my-pi/pi-coding-agent` in `.omp/extensions/pi-oven.ts` and `scripts/run-eval.ts`
  - `@oh-my-pi/pi-tui` in `.omp/extensions/pi-oven-runtime/pi-oven-ask.ts`
- Ambient binaries required by scripts and doctor: `omp`, `bun`, `tmux`, `git`.

#### Candidate opportunities
- Keep the hard dependency set small, but document ambient binary assumptions as first-class runtime dependencies.

### Step 4 — Library knowledge source
#### Observation
No external docs lookup was required to answer the in-repo structural questions; the survey stayed code-grounded.

#### Evidence
- All major claims in this report are backed by local files or command output.

#### Unknowns
- No Context7-backed API refresh was possible in this tool environment.

### Step 5 — Pattern extraction

#### A. Skill loading / ownership proof pattern
##### Observation
pi-oven uses a shipped-skill registry + keyword whitelist + owned read target proof model, not free-form skill dispatch.

##### Evidence
- Keyword whitelist: `/Users/kimzerokim/.omp/plugins/cache/plugins/kzk___pi-oven___0.1.23/.omp/extensions/pi-oven-runtime/skill-keyword-loader.ts:12-40`
- `plugin.json` shipped skill list: `/Users/kimzerokim/.omp/plugins/cache/plugins/kzk___pi-oven___0.1.23/.claude-plugin/plugin.json:1-40`
- Indexer resolves `ownedReadTarget` from shipped skill paths: `.../skill-keyword-loader.ts:300-344`
- Prompt rule requires exact plugin-owned skill targets and forbids sibling/legacy aliases: `.../rules-injector.ts:211-212`

##### Candidate opportunities
- Replace or augment literal whitelist matching with a capability/tag registry so deep-interview and other UX flows become easier to evolve without prompt-only coupling.

#### B. Autonomous continuation pattern
##### Observation
Autonomous continuation is enforced twice: prompt conduct and post-stop continuation injection.

##### Evidence
- Orchestrator conduct toggles WAIT/ASK vs KEEP GOING: `.../rules-injector.ts:196-220`
- Stop guard keywords and continuation payload: `.../autonomous-stop-guard.ts:41-79,115-120,153-171`
- Extension uses one shared `needsAutonomousReminder` boolean to drive both reminder and conduct injection: `.../pi-oven.ts:843-887`

##### Candidate opportunities
- Consolidate autonomous truth into a single typed runtime contract to avoid dual maintenance across prompt rules and stop-hook logic.

#### C. Gate / approval pattern
##### Observation
Code-write gating relies on three proof surfaces: branch contract, matched-skill proof, and external execution consent.

##### Evidence
- Required skill proof computation: `.../gate.ts:95-114`
- Parent-session skill read observation: `.../gate-handler.ts:225-233`
- Gate decision reads branch contract + requiredSkills + ownedSkillReadTargets + skillReads: `.../gate-handler.ts:247-263`
- External exec consent shape and TTL cleanup: `.../gate-state.ts:52-73,132-150`
- Branch/push consent files named in state store: `.../gate-state.ts:214-216`

##### Candidate opportunities
- Surface these three proof surfaces in one explicit operator-facing truth UI/report so autonomous loops and manual recovery share the same mental model.

#### D. Parallelism pattern
##### Observation
The codebase already uses `Promise.all` for health/report probes, but the native worker orchestration path is mostly sequential.

##### Evidence
- Parallel doctor gather: `/Users/kimzerokim/.omp/plugins/cache/plugins/kzk___pi-oven___0.1.23/scripts/pi-oven-doctor.ts:665-677`
- Parallel smoke-scenario counting: `.../pi-oven-doctor.ts:554-566`
- Sequential worker startup loop: `.../scripts/pi-oven-team/runtime-v2.ts:115-121,147-199`
- Sequential scale-up loop with per-worker save/spawn: `.../scripts/pi-oven-team/scaling.ts:38-50,107-142`

##### Candidate opportunities
- Highest-leverage throughput work is in `runtime-v2.ts` and `scaling.ts`, not in doctor or setup.
- Introduce dependency-aware batching: parallelize worktree creation / pane prep / non-conflicting spawn steps, keep rollback and commit-to-state serial where necessary.

### Step 6 — Type / contract inventory
#### Observation
The most critical exported contracts are runtime control contracts rather than business-domain models.

#### Evidence
- `ExternalExecConsent` + `FsmState`: `.../gate-state.ts:52-73`
- `SkillKeywordIndexEntry`, `MatchedSkill`, `SkillKeywordLoaderState`: `.../skill-keyword-loader.ts:232-247`
- `applyOrchestratorConduct()` parent-only rule: `.../pi-oven.ts:430-446`

#### Candidate opportunities
- If redesigning deep-interview parity or parallel scheduling, extend these contracts first; otherwise behavior will remain prompt-coupled and difficult to validate.

### Step 7 — Env vars / runtime assumptions
#### Observation
Environment and runtime assumptions are real but scattered. There is no single consolidated contract file.

#### Evidence
- Documented env vars in setup entrypoint: `/Users/kimzerokim/.omp/plugins/cache/plugins/kzk___pi-oven___0.1.23/scripts/pi-oven-setup.ts:9-14`
  - `PI_OVEN_LOCK_FILE`
  - `PI_OVEN_AGENTS_DIR`
  - `PI_OVEN_MOCK_SPAWN`
  - `PI_OVEN_VALIDATE_MODE`
- Additional env access via ast-grep:
  - `PI_BLOCKED_AGENT` in `.omp/extensions/pi-oven.ts`
  - `PI_OVEN_DOCTOR_PROJECT_ROOT` in `scripts/pi-oven-doctor.ts`
  - `PI_OVEN_EVAL_MODEL` in `scripts/run-eval.ts`
  - `PI_OVEN_SHELL_READY_TIMEOUT_MS` in `scripts/pi-oven-team/tmux-session.ts`
- Credential file contract: `/Users/kimzerokim/.omp/plugins/cache/plugins/kzk___pi-oven___0.1.23/.external-credentials.example:1-20`
- Setup writes machine-global assumptions for memory/async/tool gates in `scripts/pi-oven-setup/apply.ts:194-205`.
- Runtime binaries present on this machine: `omp`, `bun`, `tmux`, `git`.

#### Undocumented / weakly documented assumptions
- The live runtime depends on `~/.omp/agent/config.yml` even when project cwd is minimal.
- Team runtime depends on tmux availability.
- Installed-cache analysis often lacks LSP, so observability and operator docs should not assume language-server availability.

#### Candidate opportunities
- Add one canonical runtime contract doc for env vars, state files, binaries, and config layers.

### Step 8 — Relationship map
#### Observation
There are two major planes with a thin seam:
1. Extension/runtime plane: skill matching, prompt injection, autonomous continuation, gate enforcement.
2. Native worker plane: tmux/team state, worker startup, scale-up, rollback.

#### Evidence
- Extension/runtime plane files listed above.
- Worker plane files listed above.
- Setup/status bridge to worker plane: `scripts/pi-oven-setup/config-yml.ts:587-591` and `scripts/pi-oven-team/index.ts:71-75,148-185`.

#### Candidate opportunities
- Any meta-improvement plan should explicitly decide whether worker scheduling becomes an extension-owned contract or remains a separate launcher-owned concern.

## Dependency leak survey

### Observation
Residual foreign-layer concepts still leak through in three ways: suppression policy, layer-isolation behavior, and vendored implementation ancestry.

### Evidence
1. Sibling suppression still names the legacy ecosystems directly:
   - `/Users/kimzerokim/.omp/plugins/cache/plugins/kzk___pi-oven___0.1.23/scripts/pi-oven-setup/config-yml.ts:641-644`
2. Isolation mode is still defined relative to the `~/.claude` layer and keeps `claude-plugins` enabled as an exception:
   - `.../scripts/pi-oven-setup/isolate.ts:4-14,35-40`
3. Native team runtime files retain explicit OMC ancestry:
   - `.../scripts/pi-oven-team/fs-utils.ts:1-5`
   - `.../scripts/pi-oven-team/runtime-v2.ts:1-5`
   - `.../scripts/pi-oven-team/rollback.ts:1-6`
4. The project identity still states pi-oven is distilled from four frozen sources, including omc and superpowers:
   - `/Users/kimzerokim/.omp/plugins/cache/plugins/kzk___pi-oven___0.1.23/README.md:3`
   - `/Users/kimzerokim/.omp/plugins/cache/plugins/kzk___pi-oven___0.1.23/CLAUDE.md:7`

### Candidate opportunities
- Move from legacy-source-aware runtime behavior to pure capability boundaries.
- Treat vendored OMC team runtime as an explicit cutover target with a provenance-removal plan.

## Native tool / debug leverage survey

### Observation
pi-oven is intentionally built around native harness tools and enables them globally during setup.

### Evidence
- Setup enables `inspect_image, web_search, lsp, ast_grep, browser, debug`:
  - `/Users/kimzerokim/.omp/plugins/cache/plugins/kzk___pi-oven___0.1.23/scripts/pi-oven-setup/apply.ts:200-205`
- Setup configures mnemopi + async for retain/recall/reflect + irc:
  - `.../apply.ts:194-198`
- Agent definitions frequently mandate `lsp`, `ast_grep`, `web_search`, `debug`, `recall`, `retain`.

### Candidate opportunities
- Deep-interview parity should probably be implemented as a native tool/capability path, not as more prompt prose.

## Highest-leverage opportunities
1. **Parallelize native worker startup/scale** in `scripts/pi-oven-team/runtime-v2.ts` and `scaling.ts`; this is the clearest throughput bottleneck.
2. **Unify extension FSM and native worker scheduler contracts** so autonomous loop state, branch/gate proof, and worker concurrency share one truth surface.
3. **Cut direct legacy suppression/isolation semantics** (`superpowers:*`, `oh-my-claudecode:*`, `~/.claude`-relative logic) in favor of pi-oven-first capability boundaries.
4. **Promote deep-interview/gajae parity from prompt policy to typed runtime primitives** (capability/tag registry, elicitation/approval objects, explicit pending-question state).
5. **Create one runtime contract doc** covering source-root resolution, state files, env vars, global vs project config layers, external consent, and native worker assumptions.

## Explicit unknowns
- Not confirmed in this session: whether a newer non-installed dev checkout exists outside the installed cache and is intended to supersede it.
- Not confirmed in this session: the exact future ownership boundary between extension runtime and native worker runtime.
- Not confirmed in this session: whether deep-interview parity should be implemented as setup UX, runtime prompting, or a new native tool primitive.
