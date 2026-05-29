# pi-oven-setup Stale-Config & Flag Audit

**Date**: 2026-05-29
**Trigger**: Spec E cycle-2 prep — user request "남은 잘못된 플래그/stale 설정 전수 체크 + 큰 사이클"
**Method**: 4-lens workflow (`wf_81bad0c0-206`, 5 agents / 427k tokens / 123 tool uses), all findings cited file:line against omp source + repo.
**Decision context**: OPTION C locked — per-role model override via omp settings `task.agentModelOverrides` (Record<agentName,string>), keyed by COLON name `pi-oven:<role>`, in user-global `~/.omp/agent/config.yml`. Personal, machine-global, NOT committed.

---

## Headline (root cause)

The entire pi-oven-setup persistence + agent-rewrite spine targets a **DEAD namespace** (`settings.pi-oven` in `~/.omp/plugins/omp-plugins.lock.json`) that omp's model resolver **NEVER reads** — it reads ONLY `task.agentModelOverrides` (`task/index.ts:648-657` → `resolveAgentModelPatterns`). The only thing that actually changes a model today is the agent-rewriter dirtying committed `agents/pi-oven-*.md`. So `--override`, `--status`, `--reset`, `--import`, `--reapply`, and the extension's session_start drift warning are **all non-functional / harmful** under the real omp contract. Option C is the first correct model-override implementation, not an enhancement.

---

## 🔴 BLOCKER (7)

| # | Title | Location | Fix (option C) |
|---|---|---|---|
| A1 | Dead `settings.pi-oven` transport (root enabler) | `persist.ts:74-103`; `apply.ts:49-60` (pi-oven.profile + 23×3 dead keys) | Write `task.agentModelOverrides` Record<`pi-oven:<role>`,model> into `~/.omp/agent/config.yml` (MERGE). Retire writePluginConfig for model data; delete apply.ts:49-60 loop. |
| A2 | Rewriting committed agent frontmatter | `apply.ts:62-65`, `reset.ts:24-38`, `import.ts:188-190`, `agent-rewriter.ts:67-105` | Remove rewriteAllAgents from apply/reset/import. Agent files = read-only PROFILE_A artifacts. profiles.ts→agents = maintainer-only one-time gen. |
| A3 | `--override` dirties tree + writes dead config (zero effect) | `pi-oven-setup.ts:93-104`; `apply.ts:36-65`; doc `pi-oven-setup.md:150` (stale opus-4-7) | MERGE `{ "pi-oven:<role>": "<model>" }` into config.yml task.agentModelOverrides. Hyphen CLI token → colon agentName. No rewrite, no plugin-config. |
| A4 | `--status` reports fiction from dead namespace | `status.ts:20-62,78-99` (readPluginConfig, detectDrift) | Compute REAL effective model: override(`pi-oven:<role>`) ?? frontmatter model[0]. Drop pi-oven.profile/pi-oven.models reads + dead drift. |
| A5 | `--reset`/`--import` mutate dead ns + rewrite files; `--reapply` obsolete | `reset.ts:24-38`, `import.ts:176-190`, `reapply.ts:41-47`, `pi-oven-setup.md:18,190,207` | reset = delete `task.agentModelOverrides["pi-oven:*"]` only. import = write whitelisted colon keys. reapply = retire from dispatcher+doc. |
| A6 | Extension session_start drift warning keys off dead/non-existent ns | `.omp/extensions/pi-oven.ts:155-217, 285-317` | Remove loadProfileMapFromConfig + detectDriftFromMap + session_start drift block. Keep validateAgentRegistry whitelist. |
| A7 | Distribution broken: origin/main ships ZERO agents + version SoT incoherent | `git ls-tree origin/main agents/` = .gitkeep only; `package.json:3`=0.1.0 vs `plugin.json:3`/`marketplace.json:19`=0.1.0; `cache-resolver.ts:60-93` expects 23 | **USER DECISION** — merge 23 agents to main before 0.1.0; pick single version SoT (package.json per omp copy); CI parity check. Out of current-branch contract. |

## 🟡 IMPORTANT (8)

| # | Title | Location | Fix |
|---|---|---|---|
| I1 | Supersede Spec E option B (phantom path) | spec `:58-59,69,88,105,118,128,130,148-149,174`; `WORKING-CONTEXT.md:33` | Cycle-2 spec replaces mechanism with task.agentModelOverrides; strike 9 phantom-path lines; WORKING-CONTEXT follow-up. |
| I2 | Remove `--profile custom` (dispatcher hard-rejects) | `pi-oven-setup.ts:83-88` rejects; docs/import/status/reapply disagree | Delete `custom` everywhere; A\|B-only; overrides via repeated `--override`. |
| I3 | lint-agents colon-name invariant missing | `lint-agents.ts:62` (filename role); no name-field test | Assert frontmatter name === `pi-oven:`+filenameRole; add test. Document lint = PROFILE_A baseline only, blind to user-global overrides. |
| I4 | Dead `confirm-auth` flag | `pi-oven-setup.ts:38`; `auth-detect.ts:109` (never called) | Delete parseArgs entry + confirmAuthViaPing. |
| I5 | Command-doc persistence section describes dead model | `pi-oven-setup.md:138,155,194,199,201,206-208` | Rewrite to config.yml task.agentModelOverrides; state wizard MUST NOT touch agent files; drop install-cache/upgrade-drift/--reapply limitations. |
| I6 | models.yml orphaned (0 readers, stale ids, superseded taxonomy) | `models.yml:1-39` (:29 opus-4-7) | **DECISION** — delete (recommended) or regenerate-and-mark-non-authoritative. |
| I7 | README Profile A summary stale + opus-4-7 leftovers | `README.md:197-201,199`; `pi-oven-critic.md:69`; `OPTIMIZED-MODEL.md:98`; `setup-wizard.md` ~13 lines; `agent-registry.md:566,750,1226,1228` | opus-4-7→4-8; source README table from profiles.ts. |
| I8 | Destructive sed in project-memory build/test | `.omc/project-memory.json:29-30` | Apply 4-7→4-8 to OPTIMIZED-MODEL.md once + commit; reset commands to plain pipeline. |

## ⚪ NIT (3)

| # | Title | Location | Note |
|---|---|---|---|
| N1 | cache-resolver compareSemver prerelease mis-sort | `cache-resolver.ts:22-31,45-50` | Latent; guard numeric-only or real semver. Low priority. |
| N2 | profiles.ts docstring 3-vs-4 anthropic contradiction | `profiles.ts:49` vs `:54` (actual 4: critic/planner/security-reviewer/oracle) | Correct to 4; verify codex count = 6. |
| N3 | PROFILE_B opus-4-7 cluster (DEFERRED per memory) + pi-oven-doctor stub | `profiles.ts:197-292`; `README.md:208`; `harness-flow-progress.md:34`; `REVIEW-ME.md:163`; `pi-oven-doctor.md:8-10` | **DO NOT bump in isolation** (PROFILE_B deferred). Couple any change. pi-oven-doctor = mark experimental or implement. |

---

## Spec impact (cycle 2)

- **Flags rewired**: `--override`/`--status`/`--import`/`--reset` → task.agentModelOverrides (config.yml, colon keys), no agent-file mutation.
- **Surface removed**: `--reapply`, `--profile custom`, `confirm-auth`; agent-rewriter out of wizard paths; persist.ts plugin-config transport retired for model data.
- **Extension**: remove session_start drift block; keep validateAgentRegistry.
- **SoT**: profiles.ts→frontmatter→lint triangle stays committed baseline + colon-name invariant added. Overrides layer = user-global task.agentModelOverrides (out of repo, lint-blind).
- **Distribution (USER DECISION / deferred)**: merge agents to main + version SoT — out of current-branch contract.
- **Stale cleanup**: opus-4-7→4-8 sweep; models.yml decision; PROFILE_B left deferred.
