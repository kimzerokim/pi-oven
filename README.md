# pi-oven

> A curated omp marketplace plugin distilled from four frozen sources (oh-my-claudecode / oh-my-openagent / Pocock skills / superpowers). Zero external dispatch dependency; everything you need ships in one plugin.

[![Version](https://img.shields.io/badge/version-0.1.24-blue.svg)]() [![Tests](https://img.shields.io/badge/tests-965%20passing-green.svg)]() [![License](https://img.shields.io/badge/license-MIT-blue.svg)]()

---

## What you get

- **24 self-contained agents** under the `pi-oven:` namespace — explorer, executor, verifier, critic, planner, code-reviewer, debugger, designer, writer, code-simplifier, qa-tester, security-reviewer, test-engineer, git-master, document-specialist, tracer, analyst, architect, librarian, multimodal-looker, oracle, metis, deep-researcher, data-runner. All 24 are omp-native with killer tools (debug/eval/browser/retain/recall/reflect/lsp/ast_grep); code-reviewer, critic, and verifier use `report_finding` for structured findings. Each is a markdown file in `agents/` with locked model + tool whitelist.
- **23 runtime-loaded skills** that orchestrate the agents — code quality, TDD, brainstorming, planning, codebase survey, spec-and-review, large-task delegation, fresh verifier, pre-commit gate, subagent-driven development, autonomous loop, deep-init (hierarchical AGENTS.md), deep-dive (causal trace + Socratic interview), systematic-debugging, improve-codebase-architecture, receiving-code-review, html-research-orchestrator, html-spec-decision-maker, git-workflow, aws, bitbucket-pipeline, cloudflare, memory-discipline (mnemopi-backed retain/recall/reflect discipline with curated runtime keyword matching).
- **`/pi-oven:setup` wizard** — Profile A (release default, openai-codex-only), Profile B (explicit openai-codex override profile), Profile C (all-Anthropic), or Profile D (opencode-zen-only), with explicit global/project routing layers and `--status` visibility.
- **CI-grade safety** — load-time model whitelist validator + CI-time hard lint that fails the build if any agent ships without a `model:` field.
- **Explicit control-plane proofs** — gated work flows through `requiredSkills`, exact plugin-owned `SKILL.md` reads, the branch contract, external execution consent, and the `--status` truth surface. Bootstrap message injection, tool remap, and discovery-layer compatibility toggles are not normal control-plane paths.

---

## Install

Prerequisites:

- **omp** ≥ 15.5.3 (`curl -fsSL https://omp.sh/install | sh`)
- **bun** ≥ 1.3.14
- **git**
- At least one provider authenticated in your omp environment:
  - OpenAI Codex / ChatGPT subscription (5.3+; required for Profile A release default and Profile B)
  - OpenCode Zen subscription (optional — enables Profile D and the shipped registry alternates)
  - Anthropic Pro/Max (optional — enables Profile C)

```sh
# 1. Add the marketplace catalog
omp plugin marketplace add kimzerokim/pi-oven

# 2. Install the plugin (use --force after agent-file changes ship)
omp plugin install pi-oven@kzk --force

# 3. Verify
omp plugin list | grep pi-oven
# Expected: pi-oven@kzk (0.1.24)
```

### One-shot (install automatic, setup interactive)

```sh
omp plugin marketplace add kimzerokim/pi-oven
omp plugin install pi-oven@kzk --force
omp plugin list | grep pi-oven
omp "/pi-oven:setup"   # opens omp and starts the interactive setup wizard
```

The first three lines install pi-oven automatically; the last line opens omp and runs `/pi-oven:setup` interactively — pick your language (Korean, English, or type your own), then choose a profile.

If you already have an older version installed, refresh the marketplace cache first:

```sh
omp plugin marketplace remove pi-oven
omp plugin marketplace add kimzerokim/pi-oven
omp plugin install pi-oven@kzk --force
```

---

## Quick start

### 1. Configure model routing

After installation, run `/pi-oven:setup` inside an omp session. The wizard is **LLM-driven** — it asks you questions in the chat and resolves `PI_OVEN_DIR` first (dev checkout → `installed_plugins.json` `installPath` → install-cache scan) before dispatching `bun "${PI_OVEN_DIR%/}/scripts/pi-oven-setup.ts"` in batch mode behind the scenes.

```
> /pi-oven:setup
```

The wizard will:

0. Ask your **default response language** first (Step 0) — pick `한국어 (Korean)`, `English`, or type your OWN language (e.g. `Español`, `日本語`, `Français`). This choice is persisted **globally** to `~/.pi-oven/config.json` as the default response language for all future sessions (with an optional per-project override in `.pi-oven/config.json`). The wizard conducts the rest of setup in that language and the pi-oven extension injects it at runtime so agents respond accordingly; if no config is set, the ambient project/global language preference is respected.
1. Detect which providers are authenticated (`opencode-zen`, `openai-codex`, `anthropic`).
2. Offer Profile A (release default, openai-codex-only), Profile B (explicit openai-codex override profile), Profile C (all-Anthropic, if available), or Profile D (opencode-zen-only).
3. Ask the setup scope: global machine config or this project's `.omp/settings.json`.
4. Optionally let you override individual agent roles.
5. Persist routing to the selected layer: global writes all 24 per-role `task.agentModelOverrides` for Profiles A/B/C/D plus `modelRoles`/`retry.fallbackChains`; project scope writes the same 24-role override surface plus `modelRoles`/`retry.fallbackChains` to `.omp/settings.json`. User setup does not rewrite committed agent files.
6. Run a smoke validation (7 MUST-tier roles pinged) and report the result.

### 2. Dispatch agents directly

Inside any omp session, dispatch an agent by name:

```
> Use pi-oven:explorer to find all files that touch the User model.
```

Agents load from the marketplace plugin registry. Their committed frontmatter provides the default model/tool policy, and setup-selected routing can override per-role models through omp settings (`task.agentModelOverrides`) without rewriting committed agent files.

### 3. How skills activate

Skills activate through explicit control-plane proofs:

1. **Runtime keyword whitelist** — on each `turn_start`, the pi-oven extension matches the latest user message against a curated, code-owned keyword list for each shipped skill. On a match, `before_agent_start` injects a system prompt block that tells the model it **MUST** read the exact plugin-owned `SKILL.md` file targets shown in that block before proceeding. Those exact targets become the `ownedSkillReadTargets` proof surface for the current turn.
2. **Description-driven discovery** — even without a keyword hit, shipped skills are still surfaced through their `description:` field in the system prompt. If a pi-oven skill is needed, prefer the exact plugin-owned `SKILL.md` target from the runtime keyword block; do not invent namespaced skill aliases. `/pi-oven:*` entries such as `/pi-oven:setup` are commands, not skills.

For gated work, pi-oven uses `requiredSkills`, exact `ownedSkillReadTargets` reads, the branch contract, and external execution consent as the single front door. Bootstrap message injection and tool remap are explicitly out of bounds as control-plane paths.

The autonomous stop-guard still exists as a separate runtime behavior: autonomous-mode keywords keep the agent looping until completion or explicit stop. That guard now complements skill loading instead of being the only keyword-driven behavior.

See `skills/*/SKILL.md` for each skill's `description:` activation condition.

### 3.1 Verify UC5 ops connectors after install

Run inside omp:

```sh
/pi-oven:doctor
```

If the provider-auth check FAILs, authenticate `openai-codex` (release default), `opencode-zen`, or `anthropic` in omp first, then rerun the command.

### 3.2 Dry-run release automation

Run inside omp from the pi-oven **source repo** checkout:

```sh
/pi-oven:release --bump patch --dry-run --update-changelog --sync-label
```

Release automation is source-repo only. The **source repo** is the authoring target, the **release artifact** is the version-synced package/tag produced from that checkout, and the **installed cache** is an observation-only consumer snapshot under `~/.omp/plugins/cache/plugins/`. The helper refuses installed-cache roots, keeps local git pushes on the current branch plus the `vX.Y.Z` tag, and prints a `boundary` object in dry-run output so the source repo → release artifact → installed cache contract stays explicit.
### 4. Verify before claiming done

The `fresh-verifier` skill enforces a hard rule: **the main agent cannot verify its own work**. When you finish a task and want to confirm completion, the skill auto-dispatches `pi-oven:verifier` (a fresh agent with no memory of the implementation) to run a 4-check audit:

1. Production build smoke (`bun run build`)
2. Stub sweep (no `TODO`, `FIXME`, dead-stub patterns in touched files)
3. SoT alignment (specs / plans match implementation)
4. Spec-freeze re-check (no locked decisions silently overridden)

Verdict: `PASS` (cycle exit allowed) or `BLOCK` (with evidence + remediation).

---

## Agent roster

24 agents, grouped by purpose. All agents are omp-native (read/search/find/bash/web_search + killer tools debug/eval/browser/retain/recall/reflect/lsp/ast_grep; irc auto-injected). Each agent's `model:` field locks the committed baseline LLM choice; setup-selected routing can override per-role models through omp settings. The validator at plugin load rejects any agent whose model prefix is outside the committed pi-oven frontmatter contract: `openai-codex/` primaries plus `opencode-zen/` registry alternates. Anthropic remains setup/override compatibility only, not a committed-agent prefix.

### MUST tier (always available, core workflow)

| Dispatch name | Purpose |
|---|---|
| `pi-oven:executor` | Multi-step implementation, 3+ file edits |
| `pi-oven:explorer` | Read-only codebase search and mapping |
| `pi-oven:verifier` | Semantic verification (VERDICT: PASS / BLOCK) |
| `pi-oven:critic` | Adversarial plan/design challenge |
| `pi-oven:planner` | Plan authoring and task decomposition |
| `pi-oven:code-reviewer` | Code quality review, spec compliance |
| `pi-oven:debugger` | Root-cause investigation + fix (absorbs tracer pattern) |

### SHOULD tier (enabled by default, optional in Profile B/C trim)

| Dispatch name | Purpose |
|---|---|
| `pi-oven:test-engineer` | Test strategy + authoring (TDD support) |
| `pi-oven:security-reviewer` | OWASP / STRIDE / secrets detection |
| `pi-oven:writer` | Documentation + prose |
| `pi-oven:designer` | UI/UX design + accessibility |
| `pi-oven:code-simplifier` | Dead code removal + AI-slop cleanup |
| `pi-oven:qa-tester` | E2E + integration test execution (Playwright-aware) |
| `pi-oven:git-master` | Atomic commits, branch hygiene, force-push guardrails |
| `pi-oven:document-specialist` | External SDK + library docs lookup |

### NICE tier (specialized; opt-in)

| Dispatch name | Purpose |
|---|---|
| `pi-oven:tracer` | Pure causal trace (call graphs, execution traces) |
| `pi-oven:analyst` | Data + metrics analysis |
| `pi-oven:architect` | Cross-cutting architectural decisions |
| `pi-oven:librarian` | Web research (no recursive dispatch) |
| `pi-oven:multimodal-looker` | Vision / image / screenshot analysis |
| `pi-oven:oracle` | Codebase knowledge Q&A |
| `pi-oven:metis` | Requirements clarification (Socratic interview) |
| `pi-oven:deep-researcher` | Web research + arxiv-PDF fetch + adversarial synthesis |
| `pi-oven:data-runner` | Eval REPL data execution + batch result analysis |

---

## Skill roster

| Skill | Tier | Trigger highlights |
|---|---|---|
| `code-quality-discipline` | core | DRY / YAGNI / KISS + deletion test |
| `tdd-strict` | core | Red → Green → Refactor, touched-file coverage |
| `brainstorming` | core | Socratic Q&A before any creative work |
| `writing-plans` | core | bite-sized + no-placeholder + 3-item self-review |
| `codebase-survey` | core | 8-step pre-planning + explore subagent delegation |
| `spec-and-review` | core | Pattern loop with cross-vendor critic |
| `large-task-delegation` | core | 3+ files / 200+ LoC threshold + dispatch routing |
| `fresh-verifier` | core | cycle-exit 4 sub-check + no-self-verification rule |
| `pre-commit-gate` | core | sequential gates 0-4.5 + bypass envs |
| `subagent-driven-development` | core | per-task fresh subagent + 2-stage review |
| `autonomous-loop` | core | meta orchestrator: ASK-FIRST 3-slot + autopilot / ralph / ultrawork modes |
| `deep-init` | extended | hierarchical AGENTS.md auto-generation |
| `deep-dive` | extended | causal trace × 3 lanes → Socratic requirements interview |
| `systematic-debugging` | extended | reproduce → hypothesize → instrument → fix loop |
| `improve-codebase-architecture` | extended | deepening-focused architecture refactor discovery |
| `receiving-code-review` | extended | challenge/validate review comments before applying |
| `html-research-orchestrator` | extended | fan-out research → cited HTML report assembly |
| `html-spec-decision-maker` | extended | pre-decision HTML worksheet for unresolved user-facing questions |
| `git-workflow` | extended | worktree-first branch start/finish lifecycle |
| `aws` | ops (UC5) | AWS production read inspection and infra diagnostics |
| `bitbucket-pipeline` | ops (UC5) | Bitbucket pipeline status/log/variables connector |
| `cloudflare` | ops (UC5) | Cloudflare DNS/zone read connector |
| `memory-discipline` | core | mnemopi-backed recall / retain / reflect discipline; setup writes `memory.backend=mnemopi`, `mnemopi.noEmbeddings=true`, `mnemopi.llmMode=none`, `async.enabled=true`, `task.enableLsp=true` |

See `skills/<name>/SKILL.md` for the complete body and `evals/<skill>/scenarios/*.yaml` for behavioral test fixtures.

---

## `/pi-oven:setup` reference

The wizard accepts subcommands:

| Subcommand | Purpose |
|---|---|
| `/pi-oven:setup` | Interactive first-run flow (default) |
| `/pi-oven:setup --status` | Show effective per-role models across project, global override, and frontmatter layers |
| `/pi-oven:setup --reset` | Clear pi-oven-managed routing overrides; with `--scope project`, clear project `.omp/settings.json` routing |
| `/pi-oven:setup --repair-prereqs` | Repair only the machine-global prerequisites: `memory.backend=mnemopi`, `mnemopi.noEmbeddings=true`, `mnemopi.llmMode=none`, `async.enabled=true`, `task.enableLsp=true`, and the 6 gated tool flags. Does not touch routing, project settings, or setup markers. |
| `/pi-oven:setup --import <file>` | Apply a JSON config (validated against the 24-role schema + provider whitelist) |
| `/pi-oven:setup --apply --profile A\|B\|C\|D` | Non-interactive apply with explicit profile |
| `/pi-oven:setup --apply --profile B --validate full` | Full 24-role smoke ping (default is 7 MUST-tier); same flag works for `--profile C`, `--profile D` |
| `/pi-oven:setup --apply --profile A --override executor=openai-codex/gpt-5.5` | Per-role override (repeatable) |
| `/pi-oven:setup --apply --profile A --scope project` | Write per-project routing (default scope is `global`). See [Per-project routing](#per-project-routing---scope-project) |

### Interactive prompt semantics

The interactive wizard uses `pi-oven_ask` rather than ad-hoc prose parsing. `Other (type your own)` is intentionally valid only when free text is a real next action (for example the language step); closed-set questions such as scope or profile selection suppress it. Routing clarification branches use the dedicated `Ask about these choices` affordance instead of inventing nested approval prose.
### Profile A (release default, openai-codex-only)

Requires **OpenAI Codex / ChatGPT subscription** for the shipped primaries. The committed frontmatter pairs those primaries with matching `opencode-zen/gpt-5.5` / `opencode-zen/gpt-5.4` registry alternates for spawn-time availability fallback.

- `openai-codex/gpt-5.5`: executor, verifier, critic, planner, code-reviewer, debugger, test-engineer, security-reviewer, code-simplifier, tracer, analyst, architect, oracle, metis, deep-researcher
- `openai-codex/gpt-5.4`: explorer, writer, designer, qa-tester, git-master, document-specialist, librarian, multimodal-looker, data-runner

Profile A also sets the main orchestrator to `openai-codex/gpt-5.4:high`, sets the title role to `openai-codex/gpt-5.4:medium`, keeps runtime retry fallback chains empty, and writes all 24 per-role `task.agentModelOverrides` on both global and project scope.
### Profile B (explicit openai-codex override profile)

Same Codex family as Profile A, but setup always writes model selectors with reasoning-effort suffixes (for example `openai-codex/gpt-5.5:xhigh`) into config so the active install is pinned even when the committed frontmatter already defaults to Codex.

Use Profile B when you want override-driven Codex routing rather than the shipped release-default baseline.

If your OpenAI Codex credential changes, re-run `/pi-oven:setup --apply --profile B` on the same scope to refresh routing and validation.
### Profile C (all-Anthropic)

Activates only when your omp environment is authenticated with native Anthropic (Pro/Max). All roles use Anthropic models tiered by task weight.

- High/xhigh reasoning roles: `anthropic/claude-opus-4-8`
- Medium/low roles, git-master, and orchestrator title: `anthropic/claude-sonnet-4-6` (haiku-4-5 is unavailable)

If your Anthropic credential changes, re-run `/pi-oven:setup --apply --profile C` on the same scope, or switch profiles with `/pi-oven:setup --apply --profile A`.

### Profile D (opencode-zen-only)

Requires **OpenCode Zen subscription** — no Anthropic or OpenAI Codex dependency. All roles use opencode-zen models.

- Heavy coding / reasoning (executor, debugger, architect, critic, planner, security-reviewer, oracle, metis, test-engineer, code-reviewer, verifier, tracer, analyst, code-simplifier, deep-researcher, data-runner): `opencode-zen/kimi-k2.6`
- Mid / low weight (explorer, writer, document-specialist, librarian, git-master, designer): `opencode-zen/minimax-m2.5`
- Vision (multimodal-looker, qa-tester): `opencode-zen/gemini-3-flash`

Writes all 24 per-role `task.agentModelOverrides` on `--profile D`. Use `--reset` to revert.

If your OpenCode Zen credential changes, re-run `/pi-oven:setup --apply --profile D` on the same scope to refresh routing and validation.

### Per-project routing (`--scope project`)

By default, setup applies **globally** — model routing, language, and the setup-complete marker are written to your machine-global config (`~/.omp/agent/config.yml` + `~/.pi-oven/config.json`), shared by every project. The wizard's **Step 0.5** lets you choose per-project instead:

| | `--scope global` (default) | `--scope project` |
|---|---|---|
| Per-role overrides | global `config.yml` — profiles A/B/C/D all write all 24 roles | `<repoRoot>/.omp/settings.json` — **all 24 roles for EVERY profile, including A** |
| `modelRoles` + `retry.fallbackChains` | global `config.yml` | `<repoRoot>/.omp/settings.json` |
| language + setup marker | global `~/.pi-oven/config.json` | `<repoRoot>/.pi-oven/config.json` |
| memory/async infra | global `config.yml` (`/pi-oven:setup --repair-prereqs` repairs just this layer) | global-only (not written under project scope) |

omp reads `<repoRoot>/.omp/settings.json` at project level and **deep-merges it over** your global config (record settings merge key-by-key; arrays replace), so a project override wins per-role over global — even over a Profile-A frontmatter default. That means a single project can pin *different* models from your global default. The file is **committable** (share routing with a team) or **gitignorable** (machine-local) — your choice. Launch omp from the **repo root** so the project settings are discovered. The setup notice at session start shows a `↳ project model routing active (N roles)` line whenever this file carries `pi-oven:*` overrides.

```sh
/pi-oven:setup --apply --profile A --scope project   # write Profile A's 24 roles to this repo's .omp/settings.json
```

---

## Project `CLAUDE.md` + control-plane proofs

### Project `CLAUDE.md` injection (automatic, on by default)

omp does not read the repo-root `CLAUDE.md` natively. The pi-oven runtime extension closes that gap: at load it reads `<repoRoot>/CLAUDE.md` and injects it into the **main and sub** agent system prompt (via the `before_agent_start` hook), so omp honors your project's local instructions in every repo. It is project-local by construction (reads only the repo root), fail-open (a missing/oversized file injects nothing), and capped at 256 KB. Opt out per-project with `.pi-oven/config.json`:

```json
{ "projectInstructions": false }
```

### Control-plane front door

For gated work, pi-oven opens the control plane only through explicit runtime proofs: `requiredSkills`, exact plugin-owned `SKILL.md` reads captured in `ownedSkillReadTargets`/`skillReads`, `.pi-oven/state/branch-contract.json`, and external execution consent where relevant. That is the user-visible contract. Bootstrap message injection, tool remap, and discovery-layer compatibility toggles are not normal control-plane paths.

- `/pi-oven:setup`, `/pi-oven:setup --status`, and `/pi-oven:doctor` are **visibility/guard layers only**. They report and persist routing configuration, but the runtime still owns the current-session provider-family choice.
- The sanctioned deep-interview completion path persists the final spec and seeds the paired root-level `approvalFlow` receipt. After that receipt exists, approval may remain pending while `deepInterview.phase` is already `complete`; approval ownership no longer lives nested under `deepInterview`.
- `pi-oven_ask` affordances are semantic: expect `Ask about these choices` for approval/routing clarification branches, and expect `Other (type your own)` only when free text is actually valid.

## Temporary compatibility boundary

- Scope: vendored native worker runtime under `scripts/pi-oven-team/*` only.
- Owner: pi-oven maintainers.
- Removal condition: remove this boundary once native worker startup/scale is owned end-to-end by the omp-native control plane and no runtime path depends on `scripts/pi-oven-team/*`.
- Legacy front doors (`--isolate`, `--no-isolate`, `--suppress-sibling-skills`, `--no-suppress-sibling-skills`) are global-only maintenance paths, owned by pi-oven maintainers, and must be removed once the omp-native control plane owns those surfaces end-to-end.

---

## Provider whitelist

Three providers allowed:

| Provider | Status | Typical use |
|---|---|---|
| `opencode-zen` | Allowed by committed agents | Registry alternates for the Codex release default and the primary provider for Profile D. |
| `openai-codex` | Allowed by committed agents | Release-default Profile A primaries, explicit Profile B overrides, and codex variants (5.4 / 5.5). |
| `anthropic` | Setup/override compatibility only | Profile C writes Anthropic overrides for users with direct Anthropic auth; committed agent frontmatter stays codex/zen-only. |

Any other provider prefix (`bedrock/`, `gemini/`, `cerebras/`, `github-copilot/`, ...) is **hard-blocked** at plugin load. The validator logs a `WHITELIST VIOLATION` error with the offending agent file path.

---

## Known limitations

### Auth-fallback whitelist hole

When a pi-oven agent's primary model is unauthenticated (e.g., you select Profile B but OpenAI Codex auth is revoked or rate-limited), omp's `resolveModelOverrideWithAuthFallback` falls back to the **parent session's active model** — NOT to the pi-oven agent's alternate. If your parent session is running on a model outside the whitelist (`google/gemini-flash`, etc.), the subagent will silently route through it.

**Mitigation**: the `session_start` handler in `.omp/extensions/pi-oven.ts` captures the parent model to `~/.omp/plugins/pi-oven-session-model.json`; `/pi-oven:setup` warns when the parent model violates the whitelist.

### omp plugin upgrade keeps user/project routing

`omp plugin upgrade pi-oven@kzk` updates the installed plugin files. It does not rewrite your global `~/.omp/agent/config.yml` or project `.omp/settings.json` routing. After upgrading, restart the session and run `/pi-oven:setup --status`; re-run `/pi-oven:setup --apply --profile <A|B|C|D> --scope <global|project>` only if you want to refresh the selected profile's routing values.

### Install cache must be populated

After installing pi-oven@kzk from the marketplace, run `/pi-oven:doctor` and inspect the installed-topology line in the standalone truth surface. It should report the shipped assets path cleanly; if it reports missing shipped assets, force a reinstall:

```sh
omp plugin install pi-oven@kzk --force
```

This is required because the marketplace install copies the repo tree recursively (`fs.cp recursive`); a stale cache from a pre-agent-registry version can leave the shipped assets unavailable.

---

## Troubleshooting

### Wizard reports "Plugin not found"

`omp plugin install` / `omp plugin uninstall` use the marketplace-qualified id `pi-oven@kzk`. Runtime commands and setup scripts use the bare plugin name `pi-oven`. If a plugin command reports `Plugin "pi-oven@kzk" not found`, reinstall with `omp plugin install pi-oven@kzk --force` and run `/pi-oven:setup --status`.

### `Unknown agent "pi-oven:executor"` in task dispatch

This means your current runtime did not load plugin-root agents. First verify the plugin is installed and current with `omp plugin list`, then restart the session so omp reloads marketplace agents from the upgraded plugin.

If the error persists after restart, run `/pi-oven:doctor` from a fresh session and include its agent-registry check output.

### `bun run lint:agents` fails

The CI hard-lint script (`scripts/lint-agents.ts`) walks `agents/pi-oven-*.md` and fails if any file is missing a `model:` field. If you customized an agent and removed the model lock, this lint will catch it before the build merges.

### Test suite

```sh
bun test       # 933 tests across 51 files
bun check      # tsc --noEmit typecheck
bun run build  # extension bundle (pi-oven.js)
bun run lint:agents  # CI-grade agent file lint
```

### Routing looks wrong after upgrade

Run:

```sh
/pi-oven:setup --status
```

Check whether the row source is `project(.omp/settings.json)`, `override(config.yml)`, or `default(frontmatter)`. Project routing wins over global routing per role.

---

## Development (dev mode)

If you're hacking on pi-oven itself, point omp at your local checkout instead of the marketplace install:

```sh
cd /path/to/pi-oven
bun install
bun test           # baseline 895 passing
bun check          # typecheck clean
bun run build      # extension bundles to dist/pi-oven.js
bun run lint:agents

# Run omp pointed at this repo's plugin tree:
omp --plugin-dir .
```

In dev mode, agent file edits are picked up immediately (no `omp plugin install --force` cycle needed).

---

## Project structure

```
pi-oven/
├── .claude-plugin/
│   ├── plugin.json          # plugin manifest (23 skills, version, commands)
│   └── marketplace.json     # marketplace catalog (plugins[0].version)
├── .omp/extensions/
│   └── pi-oven.ts               # load-time validator + setup notice + conduct injection
├── agents/                  # 24 pi-oven-prefixed agent files (file-based registry)
│   └── pi-oven-*.md
├── skills/                  # 23 authored skills (all runtime-loaded)
│   └── <skill-name>/
│       ├── SKILL.md
│       └── references/      # progressive disclosure docs
├── evals/                   # behavioral test fixtures per skill
│   └── <skill-name>/scenarios/{smoke,adversarial,regression}.yaml
├── scripts/
│   ├── lint-agents.ts       # CI hard lint
│   ├── run-eval.ts          # scenario runner against omp SDK
│   ├── pi-oven-setup.ts         # /pi-oven:setup batch CLI
│   ├── pi-oven-release/         # release automation modules (bump/sync/changelog/publish)
│   ├── pi-oven-setup/           # 13 submodules (profiles, persist, apply, ...)
├── tests/                   # bun test suite (933 tests, 51 files)
│   ├── extensions/
│   ├── plugin/
│   └── scripts/
├── commands/                # slash command prompt templates
│   ├── setup.md
│   ├── doctor.md
│   └── release.md
└── docs/
    ├── specs/               # design specs (foundation + agent registry + setup wizard + skill rewrite)
    └── SOUL.md              # project identity
```

---

## Architecture in one paragraph

pi-oven is a **file-based agent registry** wrapped in an omp marketplace plugin. The 24 agent files in `agents/pi-oven-*.md` are the committed baseline for model/tool policy; setup-selected routing can override per-role models through omp `task.agentModelOverrides` in global or project settings. All 24 agents are omp-native with killer tools (debug/eval/browser/retain/recall/reflect/lsp/ast_grep); code-reviewer, critic, and verifier emit structured findings via `report_finding`. A load-time TypeScript validator (`.omp/extensions/pi-oven.ts`) enforces the provider whitelist by reading the agent files themselves: if any file references an `anthropic/*` model, the validator includes `anthropic/` in `ALLOWED_PREFIXES`; otherwise only `opencode-zen/` and `openai-codex/` are allowed.

---

## Documentation

- `docs/specs/2026-05-27-pi-oven-foundation-design.md` — foundation design (omp-native pivot)
- `docs/specs/2026-05-28-pi-oven-agent-registry.md` — Spec A (agents + validator + lint)
- `docs/specs/2026-05-28-pi-oven-setup-wizard.md` — Spec B (`/pi-oven:setup` wizard)
- `docs/specs/2026-05-28-pi-oven-skill-rewrite-and-new-skills.md` — Spec C (skill sweep + 3 new skills)
- `docs/specs/2026-05-29-pi-oven-omp-runtime-layer.md` — omp runtime layer (gate FSM + rules injection)
- `docs/specs/2026-05-29-pi-oven-user-local-override.md` — user-local model override (Spec E)
- `docs/SOUL.md` — project identity

---

## Contributing

1. Fork + clone.
2. `bun install` + `bun test` to confirm baseline.
3. New agent file? Place it under `agents/pi-oven-<role>.md` with frontmatter validated by `bun run lint:agents`.
4. New skill? Place it under `skills/<name>/SKILL.md` + add to `plugin.json` `"skills"` array.
5. Cross-vendor critic review on specs/plans is encouraged — `pi-oven:critic` (opus) or via the `spec-and-review` skill.
6. Use the per-spec semantic commit pattern: one commit per spec implementation, no per-task commits.

---

## License

MIT
