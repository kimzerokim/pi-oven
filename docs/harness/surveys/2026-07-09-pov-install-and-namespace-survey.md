# 2026-07-09 pov install and namespace survey

## Scope

Codebase-survey 8-step pass for install/setup + namespace surface, focused on:

- `.omp/extensions/**`
- `scripts/pi-oven-setup/**`
- `skills/**`
- `agents/**`
- relevant tests
- docs that instruct reinstall/setup

Primary decision target: distinguish **repo/doc fix only** vs **runtime behavior fix** vs **broader namespace migration**, with explicit attention to:

1. supported install/setup guidance for the `pov:*` workflow-skill cutover
2. bare-skill compatibility surface
3. direct agent-namespace cutover from `pi-oven:` to `pov:`
4. dual plugin surface / stale marketplace-cache behavior

## Step 0.5 — Tool & index availability

- `lsp` is configured and callable in this repo (`lsp status` reported `typescript-language-server (configured, not started)`; subsequent `lsp symbols` / `lsp references` calls succeeded on `.ts` files).
- `ast_grep` is callable; exported-type scans succeeded under both `scripts/pi-oven-setup/**/*.ts` and `.omp/extensions/**/*.ts`.
- Context7 was activated via `search_tool_bm25`, exposing `mcp__context_context_query_docs` and `mcp__context_context_resolve_library_id`.
- code-review-graph MCP tools were also activated. Verbatim availability check output:

```json
{"status":"ok","summary":"Analyzed 58 changed file(s):\n  - 70 changed function(s)/class(es)\n  - 5 affected flow(s)\n  - 17 test gap(s)\n  - Overall risk score: 0.80\n  - Untested: classifyTaskAgent, matchSkillsForText, loadSkillKeywordIndexReport, buildKeywordMatchedSkillsPrompt, buildSetupChecklistNotice","risk_score":0.8,"changed_file_count":58,"test_gap_count":17,"review_priorities":["loadSkillKeywordIndexReport","buildKeywordMatchedSkillsPrompt","lintRoleTokens"],"_hints":{"next_steps":[{"tool":"get_review_context","suggestion":"Build a full review context with source snippets"},{"tool":"get_affected_flows","suggestion":"See which execution flows are affected"},{"tool":"get_impact_radius","suggestion":"Expand the blast radius analysis"}],"related":[],"warnings":["High risk score (0.80) — review carefully"]},"context_savings":{"estimated":true,"saved_tokens":221792,"saved_percent":100}}
```

## Step 1 — Scope expansion

### In-scope install/setup entrypoints

- Operator install/reinstall/setup guidance: `README.md:68,352-363`, `commands/setup.md:17-23,50-53,59-62,244-247,321`, `commands/doctor.md:14-20,47-60,143-144`
- Setup writers/readers: `scripts/pi-oven-setup/apply.ts:157-208`, `scripts/pi-oven-setup/project-settings.ts:196-240`, `scripts/pi-oven-setup/config-yml.ts:577-624,639-661,838-847,941-979`, `scripts/pi-oven-setup/status.ts:38-65,67-110`, `scripts/pi-oven-setup/cache-resolver.ts:57-82,94-124`, `scripts/pi-oven-setup/standalone-truth-surface.ts:221-323`

### In-scope workflow-skill namespace surface

- Plugin manifest skill list: `.claude-plugin/plugin.json:5-29`
- Shipped-skill SoT: `scripts/pi-oven-setup/shipped-skill-registry.ts:2-49`
- Public skill frontmatter example: `skills/codebase-survey/SKILL.md:1-4`
- Runtime keyword loader + proof surface: `.omp/extensions/pi-oven-runtime/skill-keyword-loader.ts:10-15,327-347,428-444`
- Gate bookkeeping for skill reads: `.omp/extensions/pi-oven-runtime/gate-handler.ts:126-133`
- Skill linting: `scripts/lint-skills.ts:19-29,67-84`

### In-scope agent namespace surface

- Agent frontmatter example: `agents/pi-oven-explorer.md:1-10`
- Runtime dispatch enforcement: `.omp/extensions/pi-oven-runtime/gate-handler.ts:156-234`, `.omp/extensions/pi-oven-runtime/rules-injector.ts:211-213,227-230`
- Setup/config persistence: `scripts/pi-oven-setup/apply.ts:157-208`, `scripts/pi-oven-setup/project-settings.ts:37-40,196-240,370-371`, `scripts/pi-oven-setup/config-yml.ts:241-298` [INFERENCE: exact blast radius extends through the whole file because the helper contract is prefix-specific even where only some ranges were re-read directly], `scripts/pi-oven-setup/override.ts:40,101`, `scripts/pi-oven-setup/import.ts:4,124,189`, `scripts/pi-oven-setup/reset.ts:55-56,95-108,151-164`, `scripts/pi-oven-setup/status.ts:73-89`
- File/registry invariants: `scripts/pi-oven-setup/agent-rewriter.ts:27-38,75-88,136-148`, `scripts/lint-agents.ts:171-179`, `.omp/extensions/pi-oven.ts:255-266,345-392,1060-1065`

### Reverse-dependency evidence from LSP

- `setProjectIncludedSkills` is referenced by `scripts/pi-oven-setup/apply.ts:165` and `scripts/pi-oven-setup/override.ts:127`.
- `resolveShippedSkillReadTarget` is referenced by `.omp/extensions/pi-oven-runtime/skill-keyword-loader.ts:343`.
- `validateAgentRegistry` is invoked at `.omp/extensions/pi-oven.ts:1062` and is also referenced by tests in `tests/extensions/pi-oven.test.ts` and `tests/extensions/repro-parsing.test.ts`.
- `getSkillReadName` is exercised directly by `tests/extensions/pi-oven-runtime/gate-handler.test.ts:1484-1525`.

## Step 2 — Deep read + recent history

### Install/setup guidance actually taught to operators

- README says `/pi-oven:setup` resolves `PI_OVEN_DIR` in install-aware order before dispatching the batch script: `README.md:68`.
- README’s stale-install remediation is a forced reinstall of the marketplace package: `README.md:352-355`.
- README explicitly documents the split plugin identifiers: marketplace commands use `pi-oven@kzk`, runtime commands/scripts use bare `pi-oven`: `README.md:363`.
- `commands/setup.md` hard-requires install-path resolution and forbids cwd-relative `bun scripts/pi-oven-setup.ts` calls: `commands/setup.md:17-23,50-53,321`.
- `commands/doctor.md` mirrors the same install-path rule for diagnostics: `commands/doctor.md:14-20,47-60,143-144`.

### Recent churn on the same surfaces

`git log --oneline -20 -- .omp/extensions/pi-oven.ts .omp/extensions/pi-oven-runtime/gate-handler.ts .omp/extensions/pi-oven-runtime/skill-keyword-loader.ts scripts/pi-oven-setup/config-yml.ts scripts/pi-oven-setup/apply.ts README.md commands/setup.md` returned:

- `d7135ac release: v0.2.2`
- `bde011b feat(pi-oven): redesign control-plane ownership and resume state`
- `d0fb2f9 feat(pi-oven): parallelize task waves and relax sts consent`
- `9f061cd feat(pi-oven): align workflow runtime and ask control plane`
- `1f7eb32 fix(pi-oven): complete harness remediation wave`
- `5da35d3 feat: overhaul pi-oven meta control plane`
- `6895eee feat(pi-oven): cut over native worker runtime`
- `87eee45 fix: stop setup skill uri guidance`

Interpretation: the install/setup and namespace surfaces are actively changing; this is not a cold/stable area.

## Step 3 — Library detection

### External dependencies in scope

From `package.json:22-27`:

- runtime dependency: `@oh-my-pi/pi-coding-agent`
- dev dependencies: `bun-types`, `typescript`

Observed direct imports in scoped files:

- `.omp/extensions/pi-oven.ts:13` imports `ExtensionAPI` from `@oh-my-pi/pi-coding-agent`
- `.omp/extensions/pi-oven-runtime/pi-oven-ask.ts:23` imports from `@oh-my-pi/pi-coding-agent`

Node built-ins (`path`, `fs`, `os`, `url`) are heavily used across setup/runtime files.

## Step 4 — Library knowledge

Context7 resolution for `@oh-my-pi/pi-coding-agent` mapped to `/can1357/oh-my-pi`. Queried docs for config semantics and got current OMP documentation for:

- `disabledProviders` semantics (`docs/providers.md`)
- scoped model/provider config (`docs/models.md`)

This is relevant because pi-oven writes OMP-owned config keys rather than its own independent registry:

- workflow-skill visibility: `skills.includeSkills = ["pov:*"]` via `scripts/pi-oven-setup/config-yml.ts:639` and `scripts/pi-oven-setup/project-settings.ts:228-240`
- compatibility provider suppression: `disabledProviders` with managed `claude` and deprecated `claude-plugins` handling via `scripts/pi-oven-setup/config-yml.ts:838-847,941-979`
- subagent tool/LSP prerequisites: `task.enableLsp` and tool flags via `scripts/pi-oven-setup/config-yml.ts:585-624`

## Step 5 — Pattern extraction

### Pattern A — install-aware dispatch, never cwd-relative

- `commands/setup.md:17-23,50-53,321`
- `commands/doctor.md:14-20,47-60,143-144`
- `README.md:68`

Pattern: resolve `PI_OVEN_DIR` first, then call `bun "${PI_OVEN_DIR%/}/scripts/<tool>.ts" ...`.

### Pattern B — workflow-skill ownership is `pov:*`, not disk deletion

- `scripts/pi-oven-setup/project-settings.ts:228-231`
- `scripts/pi-oven-setup/apply.ts:176-178,206-208`
- `scripts/pi-oven-setup/config-yml.ts:639-656`
- `scripts/pi-oven-setup/standalone-truth-surface.ts:223-250`

Pattern: ownership is established by effective `skills.includeSkills = ["pov:*"]`; populated `~/.claude/skills` remains explicitly non-owning.

### Pattern C — runtime keyword loader exposes `pov:*` publicly but requires exact plugin-owned file reads

- `skills/codebase-survey/SKILL.md:1-4`
- `.claude-plugin/plugin.json:5-29`
- `scripts/pi-oven-setup/shipped-skill-registry.ts:2-49`
- `.omp/extensions/pi-oven-runtime/skill-keyword-loader.ts:327-347,435-444`
- `tests/extensions/pi-oven-runtime/skill-keyword-loader.test.ts:164-175,252-264`

Pattern: public workflow-skill names are `pov:<skill>`, but the control-plane proof surface is **exact plugin-owned `.../SKILL.md` file targets**, not `skill://` aliases.

### Pattern D — agent routing remains hard-pinned to `pi-oven:<role>`

- `.omp/extensions/pi-oven-runtime/rules-injector.ts:211-213,227-230`
- `.omp/extensions/pi-oven-runtime/gate-handler.ts:156-234`
- `agents/pi-oven-explorer.md:2`
- `scripts/lint-agents.ts:171-179`
- `scripts/pi-oven-setup/agent-rewriter.ts:27-38,75-88,136-148`
- `scripts/pi-oven-setup/status.ts:73-89`

Pattern: automatic subagent dispatch may accept a bare role temporarily, but it canonicalizes to `pi-oven:<role>`; persistence, registry, filenames, frontmatter, and lint all still use `pi-oven`.

### Pattern E — legacy compatibility aids still exist beside the ownership mainline

- `scripts/pi-oven-setup/config-yml.ts:653-658,838-847,941-979`
- `scripts/pi-oven-setup/standalone-truth-surface.ts:237-251,276-286,291-294`

Pattern: `skills.ignoredSkills` and `disabledProviders` are still present as compatibility/maintenance paths, but the repo explicitly says they are not the ownership truth surface.

### Pattern F — dual install surface is already encoded in runtime notices

- `README.md:352-363`
- `scripts/pi-oven-setup/cache-resolver.ts:57-82,94-124`
- `.omp/extensions/pi-oven.ts:155-167,171`
- `.omp/extensions/pi-oven.ts:496-513`
- `scripts/pi-oven-setup/standalone-truth-surface.ts:277-280`
- `tests/scripts/pi-oven-setup/cache-resolver.test.ts:102-126`

Pattern: the repo already assumes a split between current runtime asset root, project root, and marketplace install cache; it contains repair messaging and fallback detection rather than a single canonical physical source.

## Step 6 — Type contracts

Relevant exported TypeScript contracts in the focused surface:

| Symbol | Anchor | Purpose | Reverse-dependency evidence |
|---|---|---|---|
| `ApplyOptions` | `scripts/pi-oven-setup/apply.ts:63-81` | setup apply mode, validate mode, and `scope` (`global` / `project`) | consumed by `runApply` path in `scripts/pi-oven-setup.ts` [INFERENCE based on module role; direct caller not re-read in this pass] |
| `ConfigYmlOpts` | `scripts/pi-oven-setup/config-yml.ts:6-9` | injectable `spawnFn` for OMP config transport | used by config writer helpers throughout `config-yml.ts` |
| `ProjectSettingsDisplayState` | `scripts/pi-oven-setup/project-settings.ts:135-138` | read-state union for project `.omp/settings.json` | consumed by `runStatus` at `scripts/pi-oven-setup/status.ts:44-50` |
| `AgentFileEntry` | `scripts/pi-oven-setup/agent-rewriter.ts:15-20` | parsed agent registry entry (`role`, `filePath`, `currentModel`, `currentThinkingLevel`) | used by file readers/rewriters and registry validation surfaces |
| `WorkflowSkillOwnershipClassification` | `.omp/extensions/pi-oven.ts:109-112` | runtime classification for skill ownership truth surface | surfaced in setup/runtime notices [INFERENCE: exact call sites exist in this file’s session-start notice flow] |
| `GateHandlerDeps` | `.omp/extensions/pi-oven-runtime/gate-handler.ts:68-91` | gate runtime dependencies: store, env, roots, resume target, logger | consumed by `createGateHandler` in the same file and wired from `.omp/extensions/pi-oven.ts` |
| `FsmState` / `AutonomyOwnershipStatus` | `.omp/extensions/pi-oven-runtime/gate-state.ts:70-73,126-148` | stores `requiredSkills`, `ownedSkillReadTargets`, `skillReads`, and ownership state | read/write path exercised by `gate-handler.ts` |

High-signal reference edges observed directly:

- `setProjectIncludedSkills` → `apply.ts:165`, `override.ts:127`
- `resolveShippedSkillReadTarget` → `skill-keyword-loader.ts:343`
- `validateAgentRegistry` → `.omp/extensions/pi-oven.ts:1062` + tests in `tests/extensions/pi-oven.test.ts` / `tests/extensions/repro-parsing.test.ts`
- `getSkillReadName` → direct tests at `tests/extensions/pi-oven-runtime/gate-handler.test.ts:1484-1525`

## Step 7 — Env vars

Observed env vars in the focused surface:

- `PI_OVEN_PUSH_CONSENT`, `PI_OVEN_GATE_BYPASS`: `.omp/extensions/pi-oven-runtime/gate-handler.ts:445-447,587-592`, `.omp/extensions/pi-oven-runtime/gate.ts:40-42,84-85,671-687`
- `PI_BLOCKED_AGENT`: `.omp/extensions/pi-oven.ts:1122-1123`
- `PI_OVEN_LIST_MODELS_FIXTURE`: `scripts/pi-oven-setup/model-id-validator.ts:75,98-102`
- test-only harness vars: `PI_OVEN_AGENTS_DIR`, `PI_OVEN_MOCK_SPAWN`, `PI_OVEN_VALIDATE_MODE`, `PI_OVEN_LOCK_FILE` in `tests/scripts/pi-oven-setup-cli.test.ts:92-95,138-176`

Cross-check result:

- `glob .env*` with `gitignore:false` found **no `.env.example`** in this repo.
- No `import.meta.env` usage was found in the scoped paths.
- Therefore there is no documented `.env.example` surface to reconcile against these runtime/test env vars in-repo.

## Step 8 — Findings

### Finding 1 — supported install/setup guidance for the `pov:*` cutover already exists, but it is coupled to install-path resolution and stale-cache remediation

Evidence:

- Operator guidance already teaches the install-aware path resolution that `pov:*` ownership depends on: `README.md:68`, `commands/setup.md:17-23,50-53,59-62,244-247,321`, `commands/doctor.md:14-20,47-60,143-144`.
- Global and project setup both write `skills.includeSkills = ["pov:*"]`: `scripts/pi-oven-setup/apply.ts:165-178,205-208`, `scripts/pi-oven-setup/project-settings.ts:228-240`, `scripts/pi-oven-setup/config-yml.ts:639-656`.
- Status/truth surfaces judge success by the visible `pov`-only skill surface, not by deleting `~/.claude/skills`: `scripts/pi-oven-setup/status.ts:63-65`, `scripts/pi-oven-setup/standalone-truth-surface.ts:223-250`.

Conclusion:

- **Doc-only cleanup is not sufficient by itself.** The docs are already aligned with `pov:*`; the harder problem is keeping runtime asset resolution and stale-cache handling consistent with that doc contract.

### Finding 2 — bare-skill compatibility is intentionally narrow: `pov:` public names + exact file reads + legacy `pi-oven:` alias, but not bare `skill://<name>` proof

Evidence:

- Public skill frontmatter uses `pov:`: `skills/codebase-survey/SKILL.md:1-4`; parity is tested in `tests/plugin/skill-discoverability.test.ts:73-82`.
- Runtime loader maps shipped skill paths to public `pov:` names and exact owned file targets: `.omp/extensions/pi-oven-runtime/skill-keyword-loader.ts:327-347,435-444`.
- The matched-skills prompt explicitly forbids alias-based proof and requires exact `SKILL.md` targets: `tests/extensions/pi-oven-runtime/skill-keyword-loader.test.ts:164-175,252-264`.
- Gate bookkeeping recognizes `skill://pov:<skill>` and legacy `skill://pi-oven:<skill>` but rejects bare `skill://autonomous-loop`: `.omp/extensions/pi-oven-runtime/gate-handler.ts:126-133`; `tests/extensions/pi-oven-runtime/gate-handler.test.ts:1484-1525`.

Conclusion:

- Current repo behavior is **not** “bare skill compatibility everywhere.” It is “public `pov:` names + exact owned read targets + a legacy bookkeeping alias.”
- Unknown remains in OMP core resolver behavior outside pi-oven-owned layers; see Unknown 2.

### Finding 3 — direct agent-namespace cutover from `pi-oven:` to `pov:` is a broad runtime migration, not an alias-only phase

#### Required touchpoints for a direct cutover

1. **Runtime dispatch / gate / prompt contract**
   - `.omp/extensions/pi-oven-runtime/gate-handler.ts:156-234`
   - `.omp/extensions/pi-oven-runtime/rules-injector.ts:211-213,227-230`

   Why: exact `pi-oven:<role>` enforcement, bare-role canonicalization, and foreign-namespace blocking are all hard-coded here.

2. **Persisted routing keys in both global and project setup**
   - `scripts/pi-oven-setup/apply.ts:157-208`
   - `scripts/pi-oven-setup/project-settings.ts:37-40,196-240,370-371`
   - `scripts/pi-oven-setup/override.ts:40,101`
   - `scripts/pi-oven-setup/import.ts:4,124,189`
   - `scripts/pi-oven-setup/reset.ts:55-56,95-108,151-164`
   - `scripts/pi-oven-setup/status.ts:73-89`
   - `.omp/extensions/pi-oven.ts:255-266`

   Why: persisted `task.agentModelOverrides` keys, clear/reset/status logic, and project/global readers all assume `pi-oven:` keys.

3. **Agent registry shape: filenames + frontmatter + cache detection**
   - `agents/pi-oven-explorer.md:2` (representative agent frontmatter)
   - `scripts/pi-oven-setup/agent-rewriter.ts:27-38,75-88,136-148`
   - `scripts/pi-oven-setup/cache-resolver.ts:65-82,123-124`
   - `.omp/extensions/pi-oven.ts:348-368,467-468` [INFERENCE: file-discovery helper range inferred from validator usage and agent file contract; the exact helper body was not re-read in this pass]
   - `scripts/lint-agents.ts:171-179`

   Why: agent files are discovered as `pi-oven-*.md`, parsed from `name: pi-oven:<role>`, and linted against that exact invariant.

4. **Repo-local skill references and linting for agent tokens**
   - `scripts/lint-skills.ts:19-29,67-84`
   - plus any `pi-oven:<role>` references embedded across `skills/**`, `commands/**`, and tests.

   Why: repo-local skill text is linted against `pi-oven:<role>` references today, even though public workflow-skill names are already `pov:*`.

5. **Tests that pin both behaviors**
   - `tests/extensions/pi-oven-runtime/gate-handler.test.ts:1484-1525`
   - `tests/extensions/pi-oven-runtime/skill-keyword-loader.test.ts:164-175,252-264`
   - `tests/plugin/skill-discoverability.test.ts:73-82`
   - `tests/scripts/pi-oven-setup-cli.test.ts:87-102`
   - `tests/scripts/pi-oven-setup/cache-resolver.test.ts:102-126`
   - `tests/scripts/pi-oven-setup/config-yml.test.ts:911-928`

#### Blast-radius judgment

- [INFERENCE] A direct `pi-oven:` → `pov:` agent cutover is **broader than a runtime alias phase** because it crosses persisted user config, runtime gating, repo-local filenames/frontmatter, lint rules, cache detection, status/readback, and test fixtures.
- [INFERENCE] This means the decision is closer to a **broader namespace migration** than a targeted runtime bug fix.

### Finding 4 — the “one place only” goal for `pov` skills is currently blocked by a real dual-surface install topology, not just wording

Evidence:

- README explicitly documents two plugin identifiers: marketplace install/uninstall uses `pi-oven@kzk`, runtime/setup uses bare `pi-oven`: `README.md:363`.
- Runtime has install-topology warning/fix messaging for cases where shipped assets cannot be read from the active plugin root: `.omp/extensions/pi-oven.ts:155-167,171`.
- Runtime plugin root is chosen heuristically by scanning nearby directories for `.claude-plugin`, `agents`, `skills`, and `package.json`: `.omp/extensions/pi-oven.ts:129-140,496-513`.
- Setup cache resolution still has fallback logic across script-relative assets and the install cache: `scripts/pi-oven-setup/cache-resolver.ts:57-82,94-124`; tests pin the stale-cache preference order in `tests/scripts/pi-oven-setup/cache-resolver.test.ts:102-126`.
- Standalone truth output separately reports plugin asset path, project root, and machine-global config location: `scripts/pi-oven-setup/standalone-truth-surface.ts:277-280`.

Conclusion:

- The repo already encodes a **dual plugin surface / npm-vs-marketplace-cache problem**.
- [INFERENCE] If the user wants `pov` skills to appear from one place only, that is not just a docs cleanup; it likely requires runtime/source-of-truth tightening so the active skill index cannot silently come from stale installed assets when a different local tree is also present.

## Unknowns / decision blockers

### Unknown 1 — stale cache and dual plugin surface

Known:

- Reinstall is the documented remediation for stale shipped assets: `README.md:352-355,363`.
- Setup/cache code prefers script-relative shipped assets when present and only falls back to cache: `scripts/pi-oven-setup/cache-resolver.ts:57-82`; this is tested in `tests/scripts/pi-oven-setup/cache-resolver.test.ts:102-126`.
- Runtime emits an installed-topology warning when the keyword index cannot be read from the active plugin root: `.omp/extensions/pi-oven.ts:155-167`.

Unknown:

- Repo-only evidence does **not** prove which copy wins when a user has both a local/dev tree and a marketplace-installed cache present in different places, nor whether every already-running OMP entrypoint resolves the same active asset root.

### Unknown 2 — bare resolver compatibility outside pi-oven-owned layers

Known:

- Workflow-skill ownership is `pov:*`: `scripts/pi-oven-setup/config-yml.ts:639`, `scripts/pi-oven-setup/project-settings.ts:228-240`.
- Runtime public skill names are `pov:*`: `.omp/extensions/pi-oven-runtime/skill-keyword-loader.ts:10-12,341-343`.
- Gate bookkeeping accepts `skill://pov:` and legacy `skill://pi-oven:` only, and rejects bare `skill://<name>`: `.omp/extensions/pi-oven-runtime/gate-handler.ts:126-133`; `tests/extensions/pi-oven-runtime/gate-handler.test.ts:1484-1525`.

Unknown:

- We do not have repo-local OMP core source proving how the global skill registry / precedence resolver handles bare vs namespaced URIs outside pi-oven-owned layers. Current evidence shows pi-oven behavior and symptoms, not the core algorithm.

### Unknown 3 — direct cutover external blast radius outside repo-local code

Known:

- Repo-local blast radius is already broad across runtime, setup writers/readers, filenames/frontmatter, lints, and tests (Finding 3).

Unknown:

- [INFERENCE] Existing user machines may already persist `task.agentModelOverrides` under `pi-oven:*` in `~/.omp/agent/config.yml` and/or project `.omp/settings.json`; the repo survey cannot prove migration/rollback pain on installed user state without exercising live environments.
- [INFERENCE] OMP-core surfaces outside this repo may also special-case or display existing `pi-oven:` agent names.

## Minimum decision readout

- **Repo/doc fix only?** No. The repo already documents `pov:*` ownership correctly; the open problems are runtime/source-of-truth and namespace migration surfaces.
- **Runtime behavior fix?** Yes, for the dual install surface / stale cache / one-place-only `pov` skill visibility problem.
- **Broader namespace migration?** Yes, if the request truly means direct agent cutover from `pi-oven:` to `pov:`. That is a multi-surface migration, not a small compatibility patch.
