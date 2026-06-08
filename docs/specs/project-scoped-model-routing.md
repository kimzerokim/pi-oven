# Spec — Project-scoped model routing + per-project setup + onboarding checklist

> Status: design (2026-06-05). Implements user request: "setup must be doable per-project; after the
> Korean/English choice ask global-vs-this-project; the launch notice becomes a checklist of global ✓ /
> project ✓". The decisive requirement: **agent models must differ global vs per-project.**

## 1. Mechanism (researched against omp source — do not re-litigate)

omp resolves a subagent's model at **spawn time** from `session.settings.get("task.agentModelOverrides")[agentName]`
(`src/task/index.ts:686`). `Settings` deep-merges three layers into the value `get()` returns
(`src/config/settings.ts:829-831`): `#global` (`~/.omp/agent/config.yml`) → `#project` → `#overrides`.

The **project layer** is discovered from **`<cwd>/.omp/settings.json`** and **`<cwd>/.omp/config.yml`**
(`src/discovery/builtin.ts:808-864`, `getConfigDirs` uses `ctx.cwd` + `CONFIG_DIR_NAME = ".omp"`), loaded at
`level: "project"` (`settings.ts:554-567`). `#deepMerge` (`settings.ts:844-866`) recurses into plain objects,
so **record-typed settings merge key-by-key** (`task.agentModelOverrides` and `modelRoles` are `record` —
`settings-schema.ts:2786`, `342`). Therefore a project file overriding individual `pi-oven:<role>` keys leaves
every unlisted role inheriting from global. **Arrays replace** (so `retry.fallbackChains[role]` is replaced,
not concatenated).

Hard constraints (all verified):

- The **extension API cannot set subagent models.** `ExtensionAPI`/`ExtensionContext` expose no settings-write
  surface; `before_agent_start` has no agent identity and returns only `systemPrompt`/`message`. Rule out
  runtime injection entirely.
- **`omp config set` only writes the homedir-global `config.yml`** (no `--project`/`--scope` flag;
  `settings.ts:213` `#configPath = agentDir/config.yml`). Project writes MUST be a **direct file write**.
- Project settings load from `<cwd>/.omp/` only (the launch dir — **no git-root ancestor walk**). Setup writes
  at the cwd omp was launched from; warn if cwd ≠ repo root is impractical to detect, so document "launch from
  the project root".
- Precedence (low→high): schema default < agent-file frontmatter `model:` < global `config.yml`
  `task.agentModelOverrides` < **project `.omp/settings.json` `task.agentModelOverrides`** < runtime CLI flag.
  A project override therefore beats even a Profile-A frontmatter-pinned role — by design.

## 2. Chosen format & file

- Per-project routing is written to **`<projectRoot>/.omp/settings.json`** (JSON). Reasons: no YAML dep, omp
  reads it at `level:"project"`, simplest read-merge-write. pi-oven writes exactly ONE project settings file
  (never also `.omp/config.yml`) to avoid intra-project merge ambiguity.
- pi-oven **only manages** these keys inside that file: `task.agentModelOverrides` (the `pi-oven:*` keys),
  `modelRoles` (`default`/`title`), `retry.fallbackChains`. Every other key (e.g. `extensions`, user-added
  override keys, sibling `task.*`) is **preserved** by read-merge.
- **Commit policy:** NOT auto-gitignored and NOT auto-committed. `.omp/settings.json` is committable so a team
  can share per-project routing, or the user may gitignore it for machine-local use. Setup output states both
  options. (Contrast: `.pi-oven/config.json` — language + completion marker — stays gitignored/machine-local.)

## 3. Scope model

A new `--scope global|project` flag (**default `global`**, preserving today's behavior) governs WHERE three
things are written. Model **infra** (memory/async) is global-only regardless of scope.

| Artifact | `--scope global` (default) | `--scope project` |
|---|---|---|
| 24 `task.agentModelOverrides` | global `config.yml` — only profiles B/C/D (A stays orchestrator-only) | **project `.omp/settings.json` — ALL profiles incl. A, all 24 roles** |
| `modelRoles` (default/title) | global `config.yml` | project `.omp/settings.json` |
| `retry.fallbackChains` | global `config.yml` | project `.omp/settings.json` |
| memory/async infra | global `config.yml` | **not written** (configure once via global scope) |
| default response language | global `~/.pi-oven/config.json` | project `<cwd>/.pi-oven/config.json` |
| setup-complete marker | global `~/.pi-oven/config.json` | project `<cwd>/.pi-oven/config.json` |

Why Profile A writes all 24 under project scope: agent-file frontmatter is the *global plugin* default (committed
in the plugin repo, shared by every project). A project that wants *different* models cannot express that through
frontmatter, so the project file must carry explicit overrides for all 24 roles to actually diverge from global.

**Spec E carve-out (must be documented, not a violation):** Spec E bans writing per-role
`task.agentModelOverrides` to the **global** namespace for Profile A. Writing per-role overrides to a
**project-scoped** `.omp/settings.json` is a *different layer* and is the sanctioned mechanism for per-project
routing. The global Profile-A invariant (orchestrator-only) is unchanged.

## 4. Onboarding checklist (user: "항상 표시" = always show)

The extension's `session_start` notice changes from a single conditional warning to an **always-shown 2-line
checklist** (when `hasUI`):

```
pi-oven setup
  [✓] Global   (~/.pi-oven/config.json)
  [✗] Project  (.pi-oven/config.json) — run /pi-oven:setup
```

- `globalComplete`  = `~/.pi-oven/config.json` has non-empty `setupCompletedAt`.
- `projectComplete` = `<repoRoot>/.pi-oven/config.json` has non-empty `setupCompletedAt`.
- Notify level: `info` when `projectComplete` (or both) else `warning`.
- Optional 3rd line when a project routing layer is detected: read `<repoRoot>/.omp/settings.json`
  `task.agentModelOverrides`; if it has any `pi-oven:*` keys, append `  ↳ project model routing active (N roles)`.
- Keep the existing "uninstall hint" only when nothing is set up.

## 5. File-by-file changes

### Lane A — `scripts/pi-oven-setup/**` (+ their tests). One coherent executor; TDD where natural.

1. **NEW `scripts/pi-oven-setup/project-settings.ts`** — owns `<cwd>/.omp/settings.json`:
   - `projectSettingsPath(cwd)` → `path.resolve(cwd, ".omp", "settings.json")`.
   - `readProjectSettingsStrict({cwd})` → `{ok:true,data}` (absent ⇒ `data:{}`) | `{ok:false,error}` when the
     file is PRESENT but unparsable/not-a-plain-object (fail-CLOSED for writes — never clobber a hand-authored file).
   - `readProjectSettingsSoft({cwd})` → `Record<string,unknown>` ({} on any fault — for status/extension reads).
   - `setProjectAgentModelOverrides(record,{cwd})` — every key must start with `pi-oven:`; strict-read;
     deep-merge `record` into `data.task.agentModelOverrides` (create nested path if absent), preserving
     non-`pi-oven:*` keys, sibling `task.*`, and unrelated top-level keys; atomic write (tmp+rename).
   - `setProjectModelRoles(roles,{cwd})` — strict-read; merge into `data.modelRoles`; atomic write.
   - `setProjectRetryFallbackChains(chains,{cwd})` — strict-read; merge into `data.retry.fallbackChains`
     (whole record; arrays replace per role); atomic write.
   - `readProjectAgentModelOverrides({cwd})` → `Record<string,string>` (soft; string values only) — for status/extension.
   - `clearProjectAgentModelOverrides({cwd})` → `string[]` removed: soft-read; delete `pi-oven:*` keys from
     `data.task.agentModelOverrides`; prune empty `task.agentModelOverrides`/empty `task`; if `data` becomes `{}`
     remove the file; else atomic write. Returns sorted removed keys. No-op (returns `[]`) when file absent.
   - `clearProjectOrchestrator({cwd})` → delete `data.modelRoles` + `data.retry.fallbackChains`; prune/remove
     file as above (used by project `--reset --full`).
   - Local `deepMerge(base,override)` mirroring omp (recurse plain objects; else replace; arrays replace).

2. **`apply.ts`** — add `scope?: "global"|"project"` (default `"global"`) and `cwd?: string` to `ApplyOptions`.
   In the user-setup branch (no `agentsDir`): when `scope==="project"`, for EVERY profile build
   `overrideRecord = { "pi-oven:<role>": profileMap[role].primary }` for all `ROLES` and call
   `setProjectAgentModelOverrides`; call `setProjectModelRoles({default,title})` and
   `setProjectRetryFallbackChains(fallbackChains)`; do NOT call any global `config-yml` writer and do NOT call
   `setMemoryAndAsyncConfig`; set output to name the project file + scope. When `scope==="global"`: unchanged.
   Validation (`runValidate`) runs in both scopes. Thread `cwd` to the project writers (default `process.cwd()`).

3. **`pi-oven-setup.ts` (CLI)** — add `scope: { type: "string" }`. Resolve+validate
   (`global`|`project`, default `global`; else exit 1 `Invalid scope "<x>". Allowed: global, project.`). Thread:
   - `--language`: `scope==="project"` ⇒ `setProjectLanguage` only; else `setGlobalLanguage` only (was: both).
     Message names the written path/scope.
   - `--profile`/`--apply`: pass `scope` (and rely on default `cwd`) to `runApply`.
   - `--override`: pass `scope` to `runOverride`.
   - `--reset`: pass `scope` to `runReset`.
   - completion marker on success: `scope==="project"` ⇒ `markSetupComplete()` only; else
     `markSetupCompleteGlobal()` only (was: both).
   - update the "No action specified" usage string to mention `--scope`.

4. **`override.ts`** — add `scope?: "global"|"project"` + `cwd?`. Phase-2 write: `scope==="project"` ⇒ batch all
   parsed entries into one `setProjectAgentModelOverrides({ "pi-oven:<role>": model, … },{cwd})`; else keep the
   existing per-entry global `setAgentModelOverride` loop. Validation unchanged.

5. **`reset.ts`** — add `scope?: "global"|"project"`. `scope==="project"` ⇒
   `clearProjectAgentModelOverrides({cwd})` (+ `clearProjectOrchestrator({cwd})` when `full`), then
   `clearSetupComplete({cwd})` (project marker); output names the project file. `scope==="global"` ⇒ existing
   global delete (+ `--full` keys) but clear the **global** marker via new `clearSetupCompleteGlobal()` instead of
   the project marker.

6. **`project-config.ts`** — add `clearSetupCompleteGlobal({homeDir?})` (mirror of `clearSetupComplete`, deleting
   `setupCompletedAt` from `~/.pi-oven/config.json`, no-op when absent).

7. **`status.ts`** — show both layers: read project overrides directly via `readProjectAgentModelOverrides`
   (authoritative for the project layer) and keep `readAgentModelOverrides` for the rest. Per role label
   `project(.omp/settings.json)` when present in the project layer, else `override(config.yml)` /
   `default(frontmatter)`. Header lines name both files + note "project wins per role"; print whether the project
   file exists.

8. **Tests (Lane A):**
   - NEW `tests/scripts/pi-oven-setup/project-settings.test.ts`: partial merge over existing keys; preserves
     non-`pi-oven:*` + sibling `task.*` + top-level keys; malformed-present file ⇒ write throws; clear removes only
     `pi-oven:*` and prunes/removes file; atomicity (no partial file on simulated mid-write is best-effort).
   - UPDATE `apply.test.ts`: `scope:"project"` writes all 24 to the project file for A AND D (assert via reading
     `.omp/settings.json`), writes `modelRoles`+`retry.fallbackChains`, and performs ZERO `omp config set` (assert
     spawnFn captured no `config set` calls); `scope:"global"` unchanged.
   - UPDATE `reset.test.ts`: project-scope clear removes project `pi-oven:*` + project marker; `--full` clears
     modelRoles+retry; global-scope clears the global marker.
   - UPDATE `override.test.ts`: project scope writes the project file, leaves global untouched.
   - UPDATE `status.test.ts`: project-layer rows labelled `project(...)`.
   - UPDATE `pi-oven-setup-cli.test.ts`: `--scope project`/`global` accepted, `--scope bogus` ⇒ exit 1 with the
     Allowed message; `--language ko --scope project` writes project `.pi-oven/config.json` only (not global);
     `--language ko --scope global` writes global only; marker written to the scoped location only.
   - UPDATE `project-config.test.ts`: `clearSetupCompleteGlobal`.

### Lane B — extension + docs (+ extension test). Disjoint file set; runs in parallel.

9. **`.omp/extensions/pi-oven.ts`** — replace the single `effectiveSetupComplete` notice with the always-shown
   2-line checklist of §4 (compute `globalComplete`/`projectComplete` as separate booleans; optional project
   routing-layer line; level `warning`/`info`). Keep model capture etc. unchanged. (Also update the cosmetic
   `pi.setLabel` string to the release version.)

10. **`tests/extensions/pi-oven.test.ts`** — assert the checklist renders both states (global-only, project-only,
    both, neither) and chooses level by `projectComplete`.

11. **`commands/setup.md`** — insert **Step 0.5 — Setup scope** right after the language choice: ask
    global-vs-this-project via `pi-oven_ask` ("이번 셋업을 글로벌로 적용할까요, 이 프로젝트에만 적용할까요?" /
    "Apply this setup globally or to this project only?"; options `글로벌 (모든 프로젝트 기본값)` /
    `이 프로젝트만 (.omp/settings.json + .pi-oven/config.json)`). Persist language WITH the chosen
    `--scope`. Thread `--scope <scope>` into Step 4 (`--override`) and Step 5 (`--profile`) dispatches. Add
    `--scope` to the flag reference; explain per-project routing writes `.omp/settings.json` (committable for
    team-sharing or gitignore for machine-local) and that project scope writes all 24 roles for every profile.

12. **`CLAUDE.md`** — in "Model routing": add the project layer to the precedence chain and document the
    `.omp/settings.json` mechanism + the Spec E carve-out (§3). Update the Status line (release ritual).

13. **`README.md`** — document `--scope` + per-project routing; bump version/test badges per the release ritual.

14. **`docs/site/skill-flow.ko.html`** — light touch only if a routing/scope diagram exists; otherwise skip.

## 6. Gates (verifier, after both lanes)

`bun run check` · `bun test` (all pass) · `bun run lint:agents` · `bun run lint:skills` · `bun run build`.
No `git push`/commit without explicit user confirmation. Version bump + reinstall is a separate, user-gated step.

## 7. Risks (carried from research)

- Committed `.omp/settings.json` silently applies to anyone opening the repo (no trust prompt) → if a teammate
  lacks auth for a pinned provider, omp falls back to the parent model silently. Mitigation: documented commit
  policy + per-project default models that match the plugin's enabled set.
- cwd coupling: launching omp from a subdir reads `<subdir>/.omp/...`. Document "launch from repo root".
- omp internals are the contract (merge order, `.omp/` discovery). A future `doctor` probe should write a
  throwaway project override and assert it surfaces in `omp config get` (out of scope here; note as follow-up).
