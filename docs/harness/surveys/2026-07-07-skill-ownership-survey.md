# 2026-07-07 skill-ownership survey

## Scope

Topic: `skill-ownership` across:
- `~/work/personal/external_harness/gajae-code`
- `~/work/personal/pi-oven`

Questions:
1. How `gajae-code` keeps its workflow skill surface self-owned instead of inheriting unrelated `~/.claude` or sibling marketplace skills.
2. What control points `pi-oven` currently has for owned-skill routing, sibling suppression, and setup/isolation.
3. What would likely need to change to achieve **"pi-oven installed => only pi-oven skills load"**.

Non-goals: no fixes, no config mutation, no speculative redesign beyond naming likely change surfaces.

### Step 0.5 — tool/index availability

- [CONFIRMED] `lsp` is available for the current `pi-oven` workspace and resolved symbols/references successfully (for example `loadSkillKeywordIndexReport`, `markSetupComplete`).
- [CONFIRMED] `ast_grep` is available in this harness.
- [CONFIRMED] Context7 tools were discoverable/activatable in this harness, but the ownership logic in scope is repo-local and stdlib/internal-package driven, so no external library doc lookup was required for the findings below.
- [CONFIRMED] code-review-graph is configured for `pi-oven`; a minimal probe succeeded. A probe against `gajae-code` returned no indexed results, so CRG evidence below is `pi-oven`-only.

```text
CRG probe (pi-oven)
{"status":"ok","pattern":"file_summary","target":".omp/extensions/pi-oven-runtime/skill-keyword-loader.ts","description":"Get a summary of all nodes in a file","summary":"Found 11 result(s) for file_summary('.omp/extensions/pi-oven-runtime/skill-keyword-loader.ts')","result_count":11}

CRG probe (gajae-code)
{"status":"ok","pattern":"file_summary","target":"packages/coding-agent/src/sdk.ts","description":"Get a summary of all nodes in a file","summary":"Found 0 result(s) for file_summary('packages/coding-agent/src/sdk.ts')","result_count":0}
```

## Findings

### 1. `gajae-code` achieves self-owned workflow skill loading by **not bootstrapping Claude/marketplace skill providers at all**, then force-merging a bundled four-skill surface.

#### 1.1 Provider bootstrap is intentionally narrow

- [CONFIRMED] `packages/coding-agent/src/discovery/index.ts:22-34` registers providers by import side effect, and the imported set includes `./builtin`, `./cline`, `./cursor`, `./gemini`, `./opencode`, `./github`, `./mcp-json`, `./ssh`, `./vscode`, `./windsurf` — **not** `./claude` and **not** `./claude-plugins`.
- [CONFIRMED] Separate grep over `packages/coding-agent/src/**/*.ts` found **no imports** of `./claude` or `./claude-plugins`; the provider implementations exist (`packages/coding-agent/src/discovery/claude.ts`, `packages/coding-agent/src/discovery/claude-plugins.ts`) but are inert unless imported.
- [CONFIRMED] `packages/coding-agent/src/config/skill-settings-defaults.ts:14-24` defaults skill discovery to fully off:
  - `enabled: false`
  - `enableClaudeUser: false`
  - `enableClaudeProject: false`
  - `enablePiUser: false`
  - `enablePiProject: false`
- [CONFIRMED] `packages/coding-agent/src/cli/args.ts:49-50` says the `noSkills` flag is retained only for compatibility and that **arbitrary skill discovery is always disabled**.

#### 1.2 When skills are loaded, they come from GJC-native `.gjc` locations or from the bundled defaults

- [CONFIRMED] `packages/coding-agent/src/discovery/builtin.ts:285-314` is the active skill provider (`PROVIDER_ID = "native"` earlier in the same file). It scans:
  - project ancestors under `.gjc/skills`
  - user scope under `~/.gjc/agent/skills`
- [CONFIRMED] `packages/coding-agent/src/extensibility/skills.ts:122-129` rejects non-native providers during skill loading:
  - `if (provider !== "native") return false;`
  - then only `user`/`project` native levels are eligible.
- [CONFIRMED] `packages/coding-agent/src/sdk.ts:1049-1069` applies three paths:
  1. explicit SDK skill list → `withEmbeddedDefaultGjcSkills(...)`
  2. `settings.get("skills.enabled")` → discovered skills, then `withEmbeddedDefaultGjcSkills(...)`
  3. otherwise → `getEmbeddedDefaultGjcSkills()` only
- [CONFIRMED] `packages/coding-agent/src/sdk.ts:825-832` defines `withEmbeddedDefaultGjcSkills(...)`, which force-adds any missing bundled default skills by name.

#### 1.3 The owned workflow surface is small, fixed, and bundled

- [CONFIRMED] `packages/coding-agent/src/defaults/gjc-defaults.ts:14-15` defines the default workflow skill names as exactly:
  - `deep-interview`
  - `ralplan`
  - `team`
  - `ultragoal`
- [CONFIRMED] `packages/coding-agent/src/defaults/gjc-defaults.ts:75-84` embeds exactly those four `SKILL.md` files.
- [CONFIRMED] `packages/coding-agent/src/defaults/gjc-defaults.ts:128-148` exposes them as `EmbeddedDefaultGjcSkill` entries with `source: "bundled:default"` and `filePath: embedded:gjc/...`.
- [CONFIRMED] `packages/coding-agent/src/defaults/gjc-defaults.ts:150-157` installs defaults to `options.targetRoot ?? getAgentDir()`, i.e. the GJC-owned agent root, not `~/.claude`.
- [CONFIRMED] `packages/coding-agent/src/cli/setup-cli.ts:374-399` `setup defaults` is the supported install/check path for these bundled workflow skills.

#### 1.4 Tests and gates enforce that narrow default surface

- [CONFIRMED] `packages/coding-agent/test/default-gjc-definitions.test.ts:230-255` proves installed project workflow skills become discoverable from `.gjc`, while **project agent stubs are not required**.
- [CONFIRMED] `packages/coding-agent/test/default-gjc-definitions.test.ts:460-495` proves `gjc skills read ultragoal --json` works **outside the repo without `.gjc` files**, returning `embedded:gjc/skills/ultragoal/SKILL.md` and `source: "bundled:default"`.
- [CONFIRMED] `scripts/check-visible-definitions.ts:5-15,30-41,48-80` and `scripts/verify-g002-gates.ts:272-310` assert the visible default surface is exactly the expected bundled workflow skills and role agents, and fail on stray visible `.gjc` definitions.

#### 1.5 Important nuance: GJC is strict for workflow skills, but not universally “nothing from plugins ever loads”

- [CONFIRMED] `packages/coding-agent/src/task/discovery.ts:93-109` still loads **agent definitions** from non-GJC marketplace plugin roots when the `claude-plugins` provider is enabled.
- [CONFIRMED] This means the strict ownership boundary is strongest for **workflow skills**, not a blanket ban on all plugin-provided definitions.

### 2. `pi-oven` already has a strong **owned-skill control plane**, but not a strict **owned-skill discovery plane**.

#### 2.1 Plugin manifest and shipped-skill registry define an owned set

- [CONFIRMED] `.claude-plugin/plugin.json:5-29` enumerates the shipped `pi-oven` skills.
- [CONFIRMED] `scripts/pi-oven-setup/shipped-skill-registry.ts:2-50` duplicates that ownership list as `SHIPPED_SKILL_PATHS`, `SHIPPED_SKILL_NAMES`, and `resolveShippedSkillReadTarget(...)`.
- [CONFIRMED] This means `pi-oven` has an internal source-of-truth for **which skills it owns**.

#### 2.2 Runtime automatic routing is based on **exact plugin-owned read targets**, not by generic skill name lookup

- [CONFIRMED] `.omp/extensions/pi-oven-runtime/skill-keyword-loader.ts:322-367` builds the keyword index by reading `.claude-plugin/plugin.json`, resolving each path to a shipped skill name and an exact `ownedReadTarget`, and rejecting entries with missing whitelist coverage or missing files.
- [CONFIRMED] `.omp/extensions/pi-oven-runtime/skill-keyword-loader.ts:423-447` emits a hard-precondition prompt telling the agent to read the **exact plugin-owned `SKILL.md` path** before substantive action.
- [CONFIRMED] The exported type contracts in `.omp/extensions/pi-oven-runtime/skill-keyword-loader.ts:234-262` formalize this ownership proof surface:
  - `SkillKeywordIndexEntry { name, description, phrases, ownedReadTarget }`
  - `MatchedSkill { name, rawMatchedPhrases, ownedReadTarget }`
  - `SkillKeywordIndexLoadResult { index, issues, shippedSkillCount }`
- [CONFIRMED] CRG caller mapping shows this report feeds runtime and diagnostics, not just tests:
  - `.omp/extensions/pi-oven.ts`
  - `scripts/pi-oven-setup/standalone-truth-surface.ts`
  - `scripts/pi-oven-doctor.ts`
  - tests under `tests/extensions/pi-oven-runtime/skill-keyword-loader.test.ts`

#### 2.3 The injected rule layer explicitly says pi-oven skills win on overlap

- [CONFIRMED] `.omp/extensions/pi-oven-runtime/rules-injector.ts:210-213` states:
  - control-plane front door is `requiredSkills` + exact `ownedSkillReadTargets` + branch contract + external execution consent
  - `pi-oven` skills are authoritative
  - same-purpose sibling marketplace skills must not be loaded when pi-oven owns the skill
- [CONFIRMED] `.omp/extensions/pi-oven-runtime/rules-injector.ts:227-230` makes skill-first behavior mandatory before substantive action.
- [CONFIRMED] `.omp/extensions/pi-oven-runtime/rules-injector.ts:81-87,169-184,286-289` also injects repo-root `CLAUDE.md` as project-local guidance, explicitly distinguishing it from global `~/.claude/CLAUDE.md`.

#### 2.4 `pi-oven` setup can diagnose ownership drift, but does not itself make discovery exclusive

- [CONFIRMED] `.omp/extensions/pi-oven.ts:131-170` and `scripts/pi-oven-setup/standalone-truth-surface.ts:143-163,264-280` warn when shipped skills, manifest entries, and keyword whitelist entries drift.
- [CONFIRMED] `scripts/pi-oven-setup/standalone-truth-surface.ts:122-123` explicitly says bootstrap injection and discovery-layer compatibility toggles are **not** the normal control-plane path.
- [CONFIRMED] This is an ownership **audit** surface, not a discovery **enforcement** surface.

#### 2.5 Current sibling suppression is optional, partial, and global-only

- [CONFIRMED] `scripts/pi-oven-setup/config-yml.ts:631-645` defines the current suppression globs as only:
  - `superpowers:*`
  - `oh-my-claudecode:*`
- [CONFIRMED] `scripts/pi-oven-setup/config-yml.ts:703-721` writes those globs into `skills.ignoredSkills` in `~/.omp/agent/config.yml`.
- [CONFIRMED] `scripts/pi-oven-setup/suppress-sibling.ts:1-16,26-40` describes this as a **legacy skill-visibility compatibility filter**, GLOBAL-ONLY, with provenance loss on clear.
- [CONFIRMED] Tests in `tests/scripts/pi-oven-setup/suppress-sibling.test.ts:308-356` verify only that those managed globs are added/removed and user globs are preserved.
- [CONFIRMED] Nothing here says “only pi-oven skills may load”; it only hides selected known sibling namespaces.

#### 2.6 Current `~/.claude` isolation is also optional and intentionally incomplete

- [CONFIRMED] `scripts/pi-oven-setup/config-yml.ts:775-784` defines the managed provider set as `['claude']` only.
- [CONFIRMED] `scripts/pi-oven-setup/isolate.ts:4-15,27-42` disables the `claude` provider so omp ignores the `~/.claude` home layer, **but deliberately leaves `claude-plugins` enabled** because pi-oven itself loads through that provider.
- [CONFIRMED] The comments and output explicitly acknowledge the trade-off: marketplace plugin commands that still load via `claude-plugins` remain visible.
- [CONFIRMED] Tests in `tests/scripts/pi-oven-setup/isolate.test.ts:36-60,72-90` lock this behavior in place, including the invariant that `claude-plugins` must not be disabled.

#### 2.7 Setup completion is tracked separately from installation

- [CONFIRMED] `scripts/pi-oven-setup/project-config.ts:171-227` defines `setupCompletedAt` as the boolean signal the runtime uses to decide whether setup is complete for the project path.
- [CONFIRMED] `scripts/pi-oven-setup/project-config.ts:345-398` mirrors the same marker for the global path.
- [CONFIRMED] `scripts/pi-oven-setup.ts:340-350` marks setup complete **only** after a successful model-routing path (`--apply`, `--profile`, `--import`, standalone `--override`), not after isolate/suppress toggles.
- [CONFIRMED] `.omp/extensions/pi-oven.ts:800-850` reads the global and project markers independently and explicitly says that **mere installation (agent files present) does not count as setup complete**.

#### 2.8 `pi-oven` has already fixed one install-root ambiguity, but only for read/display paths

- [CONFIRMED] `scripts/pi-oven-setup/cache-resolver.ts:57-75` documents the fix for “setup looks at the local cwd, not the omp install location”.
- [CONFIRMED] `scripts/pi-oven-setup/cache-resolver.ts:76-89` resolves `<pluginRoot>/agents` based on the script’s own location and only falls back to cache/last-resort read paths.
- [CONFIRMED] The comment explicitly limits this to READ-ONLY display resolution, not ownership enforcement for all runtime surfaces.

### 3. Direct comparison: where `gajae-code` is stricter vs where `pi-oven` is already similar

#### 3.1 Where `gajae-code` is stricter

- [CONFIRMED] GJC removes the problem at discovery bootstrap: `packages/coding-agent/src/discovery/index.ts:22-34` never imports the Claude/marketplace skill providers.
- [CONFIRMED] GJC defaults discovery off (`packages/coding-agent/src/config/skill-settings-defaults.ts:14-24`) and still force-merges its four bundled workflow skills (`packages/coding-agent/src/sdk.ts:1049-1069`).
- [CONFIRMED] GJC has tests/gates asserting the exact visible default workflow surface (`packages/coding-agent/test/default-gjc-definitions.test.ts:230-255,460-495`; `scripts/check-visible-definitions.ts:48-80`; `scripts/verify-g002-gates.ts:272-310`).

#### 3.2 Where `pi-oven` already has similar or stronger ownership semantics

- [CONFIRMED] `pi-oven` has a stronger **runtime proof contract** than a generic skill loader: exact plugin-owned path reads, explicit proof keys, and rule-layer precedence (`.omp/extensions/pi-oven-runtime/skill-keyword-loader.ts:423-447`; `.omp/extensions/pi-oven-runtime/rules-injector.ts:210-230`).
- [CONFIRMED] `pi-oven` also has explicit integrity checks for manifest/whitelist/file drift (`.omp/extensions/pi-oven.ts:147-170`; `scripts/pi-oven-setup/standalone-truth-surface.ts:143-163,264-280`).

#### 3.3 Where OMP/global-layer behavior still leaks through `pi-oven`

- [CONFIRMED] Isolation intentionally leaves `claude-plugins` enabled, so sibling marketplace definitions can still surface (`scripts/pi-oven-setup/isolate.ts:7-12,36-40`; `scripts/pi-oven-setup/config-yml.ts:775-784`).
- [CONFIRMED] Sibling suppression only covers two known glob families and is opt-in/global-only (`scripts/pi-oven-setup/config-yml.ts:642-645,703-721`; `scripts/pi-oven-setup/suppress-sibling.ts:4-8`).
- [CONFIRMED] The runtime rule layer can tell the agent to prefer pi-oven-owned skills, but that happens **after** discovery and does not stop sibling skills from existing in the ambient surface.
- [INFERENCE] This is the core reason `pi-oven installed => only pi-oven skills load` is not yet true: its control plane is strict, but its discovery plane still depends on OMP provider behavior that can expose sibling marketplace/plugin surfaces.

### 4. Likely change surface for “pi-oven installed => only pi-oven skills load”

#### 4.1 Files/symbols inside `pi-oven` that are directly relevant

If the goal is to move from **owned-skill routing** to **owned-skill-only loading**, these are the most likely local change points:

1. `.omp/extensions/pi-oven.ts`
   - runtime checklist/integrity notices
   - setup/install topology interpretation
   - current separation between installation truth and setup-complete truth
2. `.omp/extensions/pi-oven-runtime/skill-keyword-loader.ts`
   - `loadSkillKeywordIndexReport(...)`
   - `buildKeywordMatchedSkillsPrompt(...)`
   - source-of-truth mapping from plugin manifest → exact owned targets
3. `.omp/extensions/pi-oven-runtime/rules-injector.ts`
   - injected precedence contract and project-local CLAUDE framing
4. `.claude-plugin/plugin.json`
   - canonical manifest list of plugin-owned skills
5. `scripts/pi-oven-setup/shipped-skill-registry.ts`
   - duplicated shipped-skill allowlist used by diagnostics
6. `scripts/pi-oven-setup/config-yml.ts`
   - `PI_OVEN_SIBLING_SKILL_GLOBS`
   - `setPiOvenIgnoredSkills(...)`
   - `PI_OVEN_MANAGED_PROVIDERS`
7. `scripts/pi-oven-setup/isolate.ts`
   - current `claude`-only disable behavior
8. `scripts/pi-oven-setup/suppress-sibling.ts`
   - current legacy glob filter behavior
9. `scripts/pi-oven-setup/standalone-truth-surface.ts`
   - integrity diagnostics that would need to reflect any stricter ownership contract
10. `scripts/pi-oven-setup.ts`
   - wiring/order between primary setup, isolate, and sibling-suppression actions

#### 4.2 What likely cannot be fully solved in this repo alone

- [INFERENCE] A truly clean **“only pi-oven skills load”** guarantee probably needs a discovery/provider-layer allowlist or ownership filter in the OMP/`claude-plugins` loading path itself, because `pi-oven` currently must keep `claude-plugins` enabled for its own commands/skills (`scripts/pi-oven-setup/isolate.ts:7-12`; `scripts/pi-oven-setup/config-yml.ts:775-784`).
- [INFERENCE] Without that lower-layer capability, `pi-oven` can keep tightening warning surfaces and sibling glob suppression, but ambient sibling plugin visibility may still leak through.

### 5. History/churn signals

#### `pi-oven`

- [CONFIRMED] Ownership/setup files show recent concentrated churn:
  - `.omp/extensions/pi-oven-runtime/skill-keyword-loader.ts` log includes
    - `9ab5c6a feat(skills): omp-native skill activation contract — description discovery + keyword whitelist`
    - `43909d0 feat(runtime,setup): enforce skill-chain gates and global install policy`
    - `adcd5ca feat(agents,runtime): omp tool discipline & orchestrator conduct`
    - `c15a6f7 fix(runtime): inject namespaced skill://pi-oven:<name> so pi-oven skills resolve`
    - `26c1969 feat(runtime): fail-close automatic skill ownership outside pi-oven`
  - setup/config files log includes
    - `20b4193 feat(setup): add --suppress-sibling-skills to hide sibling marketplace skills`
    - `662c9e1 fix(setup): --isolate disables the claude provider only, not claude-plugins`
    - `0fd4b22 fix(setup,doctor): cwd-independent setup --status + true 11-check doctor`
    - `d984eb7 feat(setup): project-scoped model routing & per-project setup`

#### `gajae-code`

- [CONFIRMED] The relevant GJC files also show intentional surface-hardening churn:
  - `packages/coding-agent/src/defaults/gjc-defaults.ts` includes
    - `0b03edd3 Establish GJC as the only runtime and workflow surface`
    - `96d79380 Make GJC delegation prompts source-bundled`
  - `packages/coding-agent/src/sdk.ts` includes
    - `e17540f0 feat(gjc-plugins): binding-only sub-skill plugin framework (#347)`
    - newer runtime work, but the current ownership model still keeps bundled workflow skills invariant

### 6. Library detection / dependency notes

- [CONFIRMED] `pi-oven` root package depends on `@oh-my-pi/pi-coding-agent` plus TypeScript/Bun dev tooling (`package.json:22-28`). The surveyed ownership logic itself is mostly Node/Bun stdlib plus plugin-manifest conventions.
- [CONFIRMED] `@gajae-code/coding-agent` depends mainly on internal monorepo packages (`@gajae-code/agent-core`, `@gajae-code/ai`, `@gajae-code/utils`, `@gajae-code/natives`, `@gajae-code/tui`) plus generic libs such as `chalk` (`packages/coding-agent/package.json:50-74`). The ownership behavior in scope is implemented in repo-local code, not third-party policy code.
- [CONFIRMED] No third-party dependency appeared to be the decisive ownership control point, so no Context7/Web lookup changed the conclusions.

### 7. Type contracts in scope

- [CONFIRMED] `packages/coding-agent/src/extensibility/skills.ts:13-39,96-99`
  - `Skill`
  - `SkillWarning`
  - `LoadSkillsResult`
  - `LoadSkillsOptions extends SkillsSettings`
- [CONFIRMED] `packages/coding-agent/src/defaults/gjc-defaults.ts:16-33,44-73`
  - `EmbeddedDefaultGjcSkill`
  - `InstallDefaultGjcDefinitionsOptions`
  - `DefaultGjcDefinitionInstallResult`
- [CONFIRMED] `.omp/extensions/pi-oven-runtime/skill-keyword-loader.ts:234-262`
  - `SkillKeywordIndexEntry`
  - `MatchedSkill`
  - `SkillKeywordLoaderState`
  - `SkillKeywordIndexIssue`
  - `SkillKeywordIndexLoadResult`
- [CONFIRMED] `scripts/pi-oven-setup/apply.ts:60-78`
  - `ApplyOptions`
- [CONFIRMED] `scripts/pi-oven-setup/status.ts:23-32`
  - `StatusOptions`

### 8. Env vars

- [CONFIRMED] No ownership-critical env var surfaced in the surveyed control points.
- [CONFIRMED] `pi-oven` env vars found in nearby files (`PI_OVEN_LIST_MODELS_FIXTURE`, `PI_OVEN_SHELL_READY_TIMEOUT_MS`, `PI_BLOCKED_AGENT`) are test/runtime-adjacent, not the ownership toggles described above.
- [CONFIRMED] No `.env.example` was present at either repo root during this survey, so there was no documented env-var inventory to cross-check.

## Constraints

- Read-only survey only; no code edits or config writes were performed.
- CRG evidence is strong for `pi-oven` only; `gajae-code` did not return indexed results from the same MCP probe, so `gajae-code` findings are grounded via source reads/grep/tests instead.
- This report distinguishes what the code **does now** from what would **likely** be required for stricter behavior.

## Unknowns

1. [INFERENCE] Whether OMP already exposes a provider/plugin allowlist hook elsewhere outside this repo that could make `claude-plugins` load only `pi-oven` without changing `pi-oven` runtime code.
2. [INFERENCE] Whether `pi-oven` wants strict exclusivity only for skills, or also for sibling commands/agents/hooks/MCP servers. The current code treats those as related but distinct discovery surfaces.
3. [INFERENCE] Whether a future “strict pi-oven-only mode” should live as:
   - a provider-layer ownership filter,
   - a setup-written discovery policy,
   - or a runtime fail-close refusal when foreign sibling skills are visible.
