# pi-oven

> A curated omp marketplace plugin distilled from four frozen sources (oh-my-claudecode / oh-my-openagent / Pocock skills / superpowers). Zero external dispatch dependency; everything you need ships in one plugin.

[![Version](https://img.shields.io/badge/version-0.1.13-blue.svg)]() [![Tests](https://img.shields.io/badge/tests-893%20passing-green.svg)]() [![License](https://img.shields.io/badge/license-MIT-blue.svg)]()

---

## What you get

- **24 self-contained agents** under the `pi-oven:` namespace — explorer, executor, verifier, critic, planner, code-reviewer, debugger, designer, writer, code-simplifier, qa-tester, security-reviewer, test-engineer, git-master, document-specialist, tracer, analyst, architect, librarian, multimodal-looker, oracle, metis, deep-researcher, data-runner. All 24 are omp-native with killer tools (debug/eval/browser/retain/recall/reflect/lsp/ast_grep); code-reviewer, critic, and verifier use `report_finding` for structured findings. Each is a markdown file in `agents/` with locked model + tool whitelist.
- **22 runtime-loaded skills** that orchestrate the agents — code quality, TDD, brainstorming, planning, codebase survey, spec-and-review, large-task delegation, fresh verifier, pre-commit gate, subagent-driven development, autonomous loop, deep-init (hierarchical AGENTS.md), deep-dive (causal trace + Socratic interview), systematic-debugging, improve-codebase-architecture, receiving-code-review, html-research-orchestrator, git-workflow, aws, bitbucket-pipeline, cloudflare, memory-discipline (mnemopi-backed retain/recall/reflect discipline with curated runtime keyword matching).
- **`/pi-oven:setup` wizard** — Profile A (release default, heterogeneous cost-optimized), Profile B (openai-codex-only), Profile C (all-Anthropic), or Profile D (opencode-zen-only), with explicit global/project routing layers and `--status` visibility.
- **CI-grade safety** — load-time model whitelist validator + CI-time hard lint that fails the build if any agent ships without a `model:` field.
- **Project `CLAUDE.md` injection + omp isolation** — the runtime extension reads your repo-root `CLAUDE.md` and injects it into the main + sub agent system prompt (omp does not read repo-root `CLAUDE.md` natively). `/pi-oven:setup --isolate` then makes omp ignore the global `~/.claude` context layer (`~/.claude/CLAUDE.md` + pi-oven skills/hooks), so omp runs as a pi-oven-first environment. It keeps the `claude-plugins` provider enabled (that is how pi-oven's own `/pi-oven:*` commands load), so omc/agentmemory marketplace plugin commands remain visible — the trade-off for not killing pi-oven's own commands. See [omp isolation & project CLAUDE.md](#omp-isolation--project-claudemd).

---

## Install

Prerequisites:

- **omp** ≥ 15.5.3 (`curl -fsSL https://omp.sh/install | sh`)
- **bun** ≥ 1.3.14
- **git**
- At least one provider authenticated in your omp environment:
  - OpenCode Zen subscription (recommended — covers minimax / glm / kimi / gemini wrappers; enables Profile A and Profile D)
  - OpenAI Codex / ChatGPT subscription (5.3+; enables Profile B)
  - Anthropic Pro/Max (optional — enables Profile C)

```sh
# 1. Add the marketplace catalog
omp plugin marketplace add kimzerokim/pi-oven

# 2. Install the plugin (use --force after agent-file changes ship)
omp plugin install pi-oven@kzk --force

# 3. Verify
omp plugin list | grep pi-oven
# Expected: pi-oven@kzk (0.1.13)
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

After installation, run `/pi-oven:setup` inside an omp session. The wizard is **LLM-driven** — it asks you questions in the chat and dispatches `bun scripts/pi-oven-setup.ts` in batch mode behind the scenes.

```
> /pi-oven:setup
```

The wizard will:

0. Ask your **default response language** first (Step 0) — pick `한국어 (Korean)`, `English`, or type your OWN language (e.g. `Español`, `日本語`, `Français`). This choice is persisted **globally** to `~/.pi-oven/config.json` as the default response language for all future sessions (with an optional per-project override in `.pi-oven/config.json`). The wizard conducts the rest of setup in that language and the pi-oven extension injects it at runtime so agents respond accordingly; if no config is set, the ambient project/global language preference is respected.
1. Detect which providers are authenticated (`opencode-zen`, `openai-codex`, `anthropic`).
2. Offer Profile A (release default), Profile B (openai-codex-only), Profile C (all-Anthropic, if available), or Profile D (opencode-zen-only).
3. Ask the setup scope: global machine config or this project's `.omp/settings.json`.
4. Optionally let you override individual agent roles.
5. Persist routing to the selected layer: global writes `modelRoles`/`retry.fallbackChains` and B/C/D per-role `task.agentModelOverrides`; project scope writes all 24 per-role overrides plus `modelRoles`/`retry.fallbackChains` to `.omp/settings.json`. User setup does not rewrite committed agent files.
6. Run a smoke validation (7 MUST-tier roles pinged) and report the result.

### 2. Dispatch agents directly

Inside any omp session, dispatch an agent by name:

```
> Use pi-oven:explorer to find all files that touch the User model.
```

Agents load from the marketplace plugin registry. Their committed frontmatter provides the default model/tool policy, and setup-selected routing can override per-role models through omp settings (`task.agentModelOverrides`) without rewriting committed agent files.

### 3. How skills activate

Skills can now activate in two ways:

1. **Runtime keyword whitelist** — on each `turn_start`, the pi-oven extension matches the latest user message against a curated, code-owned keyword list for each shipped skill. On a match, `before_agent_start` injects a system prompt block that tells the model it **MUST** read the matched `skill://pi-oven:<name>` entries before proceeding.
2. **Description-driven discovery** — even without a keyword hit, shipped skills are still surfaced through their `description:` field in the system prompt, and the model can decide a skill applies and read `skill://pi-oven:<name>` on its own.

The autonomous stop-guard still exists as a separate runtime behavior: autonomous-mode keywords keep the agent looping until completion or explicit stop. That guard now complements skill loading instead of being the only keyword-driven behavior.

See `skills/*/SKILL.md` for each skill's `description:` activation condition.

### 3.1 Verify UC5 ops connectors after install

Run:

```sh
bun scripts/pi-oven-doctor.ts
```

Expected check:

- `[PASS] uc5 ops connector` when connector skills exist and one credential file is present (`.external-credentials` or `.external_certificate`; legacy alias `.external_cerficate` is also accepted)
- `[WARN] uc5 ops connector` when skills are installed but no credential file exists yet (non-blocking onboarding state)
- `[FAIL] uc5 ops connector` only when required skill files are missing

### 3.2 Dry-run release automation

Run:

```sh
bun run release:pi-oven -- --bump patch --dry-run --update-changelog --sync-label
```

Default behavior is safe (`--dry-run` unless `--publish` is explicitly set without dry-run). The release script enforces version SoT sync across `package.json`, `.claude-plugin/plugin.json`, and `.claude-plugin/marketplace.json`.
### 4. Verify before claiming done

The `fresh-verifier` skill enforces a hard rule: **the main agent cannot verify its own work**. When you finish a task and want to confirm completion, the skill auto-dispatches `pi-oven:verifier` (a fresh agent with no memory of the implementation) to run a 4-check audit:

1. Production build smoke (`bun run build`)
2. Stub sweep (no `TODO`, `FIXME`, dead-stub patterns in touched files)
3. SoT alignment (specs / plans match implementation)
4. Spec-freeze re-check (no locked decisions silently overridden)

Verdict: `PASS` (cycle exit allowed) or `BLOCK` (with evidence + remediation).

---

## Agent roster

24 agents, grouped by purpose. All agents are omp-native (read/search/find/bash/web_search + killer tools debug/eval/browser/retain/recall/reflect/lsp/ast_grep; irc auto-injected). Each agent's `model:` field locks the committed baseline LLM choice; setup-selected routing can override per-role models through omp settings. The validator at plugin load rejects any agent whose model prefix is outside the prefixes present in the committed pi-oven agent files (`opencode-zen/`, `openai-codex/`, and `anthropic/` in the current Profile A baseline).

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
| `git-workflow` | extended | worktree-first branch start/finish lifecycle |
| `aws` | ops (UC5) | AWS production read inspection and infra diagnostics |
| `bitbucket-pipeline` | ops (UC5) | Bitbucket pipeline status/log/variables connector |
| `cloudflare` | ops (UC5) | Cloudflare DNS/zone read connector |
| `memory-discipline` | core | mnemopi-backed recall / retain / reflect discipline; setup writes `memory.backend=mnemopi`, `mnemopi.noEmbeddings=true`, `mnemopi.llmMode=none`, `async.enabled=true` |

See `skills/<name>/SKILL.md` for the complete body and `evals/<skill>/scenarios/*.yaml` for behavioral test fixtures.

---

## `/pi-oven:setup` reference

The wizard accepts subcommands:

| Subcommand | Purpose |
|---|---|
| `/pi-oven:setup` | Interactive first-run flow (default) |
| `/pi-oven:setup --status` | Show effective per-role models across project, global override, and frontmatter layers |
| `/pi-oven:setup --reset` | Clear pi-oven-managed routing overrides; with `--scope project`, clear project `.omp/settings.json` routing |
| `/pi-oven:setup --import <file>` | Apply a JSON config (validated against the 24-role schema + provider whitelist) |
| `/pi-oven:setup --apply --profile A\|B\|C\|D` | Non-interactive apply with explicit profile |
| `/pi-oven:setup --apply --profile B --validate full` | Full 24-role smoke ping (default is 7 MUST-tier); same flag works for `--profile C`, `--profile D` |
| `/pi-oven:setup --apply --profile A --override executor=openai-codex/gpt-5.4` | Per-role override (repeatable) |
| `/pi-oven:setup --apply --profile A --scope project` | Write per-project routing (default scope is `global`). See [Per-project routing](#per-project-routing---scope-project) |
| `/pi-oven:setup --isolate` | Make omp ignore the `~/.claude` context layer (writes `disabledProviders: [claude]`; keeps `claude-plugins` so pi-oven's own `/pi-oven:*` commands survive). Combinable, e.g. `--apply --profile A --isolate` |
| `/pi-oven:setup --no-isolate` | Re-enable the `~/.claude` layer in omp (removes `claude` + any legacy `claude-plugins`) |

### Profile A (release default)

Heterogeneous cost-optimized. Requires **OpenCode Zen + OpenAI Codex subscriptions** — no hard Anthropic dependency.

- Codex roles (executor, debugger, test-engineer, architect, metis, data-runner): `openai-codex/gpt-5.4` (alternate: `opencode-zen/gpt-5.4`)
- Vision (multimodal-looker, qa-tester): `openai-codex/gpt-5.4-mini`
- Explorer / docs / librarian / git (explorer, writer, document-specialist, deep-researcher, librarian, git-master): `opencode-zen/minimax-m2.5`
- Design / simplify (designer, code-simplifier): `opencode-zen/glm-5.1`
- Reasoning-heavy (critic, planner, security-reviewer, oracle): `anthropic/claude-opus-4-8` (advisory; no hard Anthropic auth required — falls back to `opencode-zen/kimi-k2.6` if unavailable)
- Structured review (code-reviewer, verifier, analyst, tracer): `opencode-zen/kimi-k2.6`

Beyond the 24 subagent roles, `/pi-oven:setup --profile` also sets the **main orchestrator** model — omp `modelRoles.default` = `openai-codex/gpt-5.4:high` with retry fallback to `opencode-zen/kimi-k2.6`. The 22 skills enforce subagent dispatch so the orchestrator routes work to the right agent instead of doing it inline.

### Profile B (openai-codex-only)

Requires **OpenAI Codex / ChatGPT subscription** — no OpenCode Zen or Anthropic dependency. Profile B is now performance-first for Codex Pro/20x-style usage:

- `openai-codex/gpt-5.5:high`: executor, test-engineer, metis.
- `openai-codex/gpt-5.5:xhigh`: verifier, critic, planner, code-reviewer, debugger, security-reviewer, code-simplifier, tracer, analyst, architect, oracle, deep-researcher.
- `openai-codex/gpt-5.4:high`: designer, qa-tester, data-runner.
- `openai-codex/gpt-5.4:medium`: explorer, writer, git-master, document-specialist, librarian, multimodal-looker, plus the title model role.

Profile B sets the main orchestrator to `openai-codex/gpt-5.4:high` so OpenAI-subscription users get the 1M context window. Runtime retry fallback chains for Profile B are empty, so setup does not route usage-limit retries through OpenCode Zen.

Profile B intentionally avoids `gpt-5.4-mini` and `gpt-5.4-nano`. Setup writes Profile B subagent overrides as model selectors with reasoning-effort suffixes (for example `openai-codex/gpt-5.5:xhigh`), so the install path carries both model and thinking-level routing.

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
| Per-role overrides | global `config.yml` — profiles B/C/D only (A stays orchestrator-only) | `<repoRoot>/.omp/settings.json` — **all 24 roles for EVERY profile, including A** |
| `modelRoles` + `retry.fallbackChains` | global `config.yml` | `<repoRoot>/.omp/settings.json` |
| language + setup marker | global `~/.pi-oven/config.json` | `<repoRoot>/.pi-oven/config.json` |
| memory/async infra | global `config.yml` | global-only (not written under project scope) |

omp reads `<repoRoot>/.omp/settings.json` at project level and **deep-merges it over** your global config (record settings merge key-by-key; arrays replace), so a project override wins per-role over global — even over a Profile-A frontmatter default. That means a single project can pin *different* models from your global default. The file is **committable** (share routing with a team) or **gitignorable** (machine-local) — your choice. Launch omp from the **repo root** so the project settings are discovered. The setup notice at session start shows a `↳ project model routing active (N roles)` line whenever this file carries `pi-oven:*` overrides.

```sh
/pi-oven:setup --apply --profile A --scope project   # write Profile A's 24 roles to this repo's .omp/settings.json
```

---

## omp isolation & project CLAUDE.md

pi-oven installs as an **omp** plugin, but a stock omp also ingests the **Claude Code** layer under `~/.claude/` — `~/.claude/CLAUDE.md`, `~/.claude/skills/*`, Claude hooks, and `~/.claude/plugins/*` (e.g. omc). If you also use Claude Code, that global layer leaks into every omp session. pi-oven gives you two pieces so omp runs as a clean, self-contained environment that still honors each project's own guidance.

### Project `CLAUDE.md` injection (automatic, on by default)

omp's `claude` discovery provider only reads `~/.claude/CLAUDE.md` and `<cwd>/.claude/CLAUDE.md` — it **never reads the repo-root `CLAUDE.md`** that is the Claude Code project-memory convention. The pi-oven runtime extension closes that gap: at load it reads `<repoRoot>/CLAUDE.md` and injects it into the **main and sub** agent system prompt (via the `before_agent_start` hook), so omp honors your project's local instructions in every repo. It is project-local by construction (reads only the repo root), fail-open (a missing/oversized file injects nothing), and capped at 256 KB. Opt out per-project with `.pi-oven/config.json`:

```json
{ "projectInstructions": false }
```

### omp isolation (`/pi-oven:setup --isolate`)

To make omp **ignore the `~/.claude` Claude-Code context layer**, run:

```
/pi-oven:setup --isolate          # or combine: /pi-oven:setup --apply --profile A --isolate
```

This writes one user-global setting to `~/.omp/agent/config.yml`:

```yaml
disabledProviders:
  - claude          # ~/.claude/CLAUDE.md + skills + hooks + commands
```

It disables the `claude` discovery provider **only**. It deliberately leaves `claude-plugins` enabled: pi-oven's own `/pi-oven:*` commands and skills register through that very provider (it serves `~/.omp/plugins` too, not just `~/.claude/plugins`), so disabling it would also remove pi-oven's own commands. The accepted trade-off is that omc/agentmemory marketplace plugin commands (`/oh-my-claudecode:*`) stay visible. With `claude` disabled, the omc `~/.claude/CLAUDE.md`, pi-oven skills, and Claude hooks/commands stop loading in omp — while pi-oven keeps loading and injects your repo-root `CLAUDE.md`. The write is **omp-only and never touches `~/.claude` on disk**, so genuine Claude Code sessions are completely unaffected. It is a snapshot at startup, so **restart omp** to apply. Undo any time with `/pi-oven:setup --no-isolate` (it removes `claude` plus any legacy `claude-plugins` an earlier build added, preserving any other providers you disabled yourself).

The net effect: in omp you get **pi-oven + your project's `CLAUDE.md`** with the global `~/.claude` context gone, while marketplace plugin commands (omc/agentmemory) stay available.

---

## Provider whitelist

Three providers allowed:

| Provider | Status | Typical use |
|---|---|---|
| `opencode-zen` | Allowed by committed agents | Default for Profile A exploration/docs/review/design roles; wraps minimax / kimi / glm and others. |
| `openai-codex` | Allowed by committed agents | ChatGPT subscription, codex variants (5.4, 5.4-mini, 5.5) |
| `anthropic` | Allowed by committed agents | Profile A advisory roles and Profile C; Pro / Max subscription only. |

Any other provider prefix (`bedrock/`, `gemini/`, `cerebras/`, `github-copilot/`, ...) is **hard-blocked** at plugin load. The validator logs a `WHITELIST VIOLATION` error with the offending agent file path.

---

## Known limitations

### Auth-fallback whitelist hole

When a pi-oven agent's primary model is unauthenticated (e.g., you select Profile B but OpenAI Codex auth is revoked or rate-limited), omp's `resolveModelOverrideWithAuthFallback` falls back to the **parent session's active model** — NOT to the pi-oven agent's alternate. If your parent session is running on a model outside the whitelist (`google/gemini-flash`, etc.), the subagent will silently route through it.

**Mitigation**: the `session_start` handler in `.omp/extensions/pi-oven.ts` captures the parent model to `~/.omp/plugins/pi-oven-session-model.json`; `/pi-oven:setup` warns when the parent model violates the whitelist.

### omp plugin upgrade keeps user/project routing

`omp plugin upgrade pi-oven@kzk` updates the installed plugin files. It does not rewrite your global `~/.omp/agent/config.yml` or project `.omp/settings.json` routing. After upgrading, restart the session and run `/pi-oven:setup --status`; re-run `/pi-oven:setup --apply --profile <A|B|C|D> --scope <global|project>` only if you want to refresh the selected profile's routing values.

### Install cache must be populated

After installing pi-oven@kzk from the marketplace, ensure the install cache has the 24 agent files:

```sh
ls ~/.omp/plugins/cache/plugins/kzk___pi-oven___*/agents/ | wc -l
# Expected: 24
```

If empty (`0`), force a reinstall:

```sh
omp plugin install pi-oven@kzk --force
```

This is required because the marketplace install copies the repo tree recursively (`fs.cp recursive`); a stale cache from a pre-agent-registry version will show empty.

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
bun test       # 893 tests across 51 files
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
bun test           # baseline 893 passing
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
│   ├── plugin.json          # plugin manifest (22 skills, version, commands)
│   └── marketplace.json     # marketplace catalog (plugins[0].version)
├── .omp/extensions/
│   └── pi-oven.ts               # load-time validator + setup notice + conduct injection
├── agents/                  # 24 pi-oven-prefixed agent files (file-based registry)
│   └── pi-oven-*.md
├── skills/                  # 22 authored skills (all runtime-loaded)
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
├── tests/                   # bun test suite (893 tests, 51 files)
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
