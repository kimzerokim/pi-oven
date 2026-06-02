# pi-oven

> A curated omp marketplace plugin distilled from five frozen sources (oh-my-claudecode / oh-my-openagent / Pocock skills / superpowers / pi-oven). Zero external dispatch dependency; everything you need ships in one plugin.

[![Version](https://img.shields.io/badge/version-0.1.0-blue.svg)]() [![Tests](https://img.shields.io/badge/tests-545%20passing-green.svg)]() [![License](https://img.shields.io/badge/license-MIT-blue.svg)]()

---

## What you get

- **22 self-contained agents** under the `pi-oven:` namespace — explorer, executor, verifier, critic, planner, code-reviewer, debugger, designer, writer, code-simplifier, qa-tester, security-reviewer, test-engineer, git-master, document-specialist, tracer, analyst, architect, librarian, multimodal-looker, oracle, metis. Each is a markdown file in `agents/` with locked model + tool whitelist.
- **21 runtime-loaded skills** that orchestrate the agents — code quality, TDD, brainstorming, planning, codebase survey, spec-and-review, large-task delegation, fresh verifier, pre-commit gate, subagent-driven development, autonomous loop, deep-init (hierarchical AGENTS.md), deep-dive (causal trace + Socratic interview), systematic-debugging, improve-codebase-architecture, receiving-code-review, html-research-orchestrator, git-workflow, aws, bitbucket-pipeline, cloudflare.
- **`/pi-oven:setup` wizard** — Profile A (release default, opencode-zen + openai-codex) or Profile B (Anthropic Pro/Max opt-in), agent-file source of truth, drift detection on every session.
- **CI-grade safety** — load-time model whitelist validator + CI-time hard lint that fails the build if any agent ships without a `model:` field.
- **Project `CLAUDE.md` injection + omp isolation** — the runtime extension reads your repo-root `CLAUDE.md` and injects it into the main + sub agent system prompt (omp does not read repo-root `CLAUDE.md` natively). `/pi-oven:setup --isolate` then makes omp ignore the global `~/.claude` context layer (`~/.claude/CLAUDE.md` + pi-oven skills/hooks), so omp runs as a pi-oven-first environment. It keeps the `claude-plugins` provider enabled (that is how pi-oven's own `/pi-oven:*` commands load), so omc/agentmemory marketplace plugin commands remain visible — the trade-off for not killing pi-oven's own commands. See [omp isolation & project CLAUDE.md](#omp-isolation--project-claudemd).

---

## Install

Prerequisites:

- **omp** ≥ 15.5.3 (`curl -fsSL https://omp.sh/install | sh`)
- **bun** ≥ 1.3.14
- **git**
- At least one provider authenticated in your omp environment:
  - OpenCode Zen subscription (recommended — covers claude / gpt wrappers)
  - OpenAI Codex / ChatGPT subscription (5.3+)
  - Anthropic Pro/Max (optional — enables Profile B)

```sh
# 1. Add the marketplace catalog
omp plugin marketplace add kimzerokim/pi-oven

# 2. Install the plugin (use --force after agent-file changes ship)
omp plugin install pi-oven@pi-oven --force

# 3. Verify
omp plugin list | grep pi-oven
# Expected: pi-oven@pi-oven (0.1.0)
```

### One-shot (install automatic, setup interactive)

```sh
omp plugin marketplace add kimzerokim/pi-oven
omp plugin install pi-oven@pi-oven --force
omp plugin list | grep pi-oven
omp "/pi-oven:setup"   # opens omp and starts the interactive setup wizard
```

The first three lines install pi-oven automatically; the last line opens omp and runs `/pi-oven:setup` interactively — pick your language (Korean, English, or type your own), then choose a profile.

If you already have an older version installed, refresh the marketplace cache first:

```sh
omp plugin marketplace remove pi-oven
omp plugin marketplace add kimzerokim/pi-oven
omp plugin install pi-oven@pi-oven --force
```

---

## Quick start

### 1. Configure model routing

After installation, run `/pi-oven:setup` inside an omp session. The wizard is **LLM-driven** — it asks you questions in the chat and dispatches `bun scripts/pi-oven-setup.ts` in batch mode behind the scenes.

```
> /pi-oven:setup
```

The wizard will:

0. Ask your primary language first (Step 0) — pick `한국어 (Korean)`, `English`, or type your OWN language (e.g. `Español`, `日本語`, `Français`) and it becomes the project default. The wizard conducts the rest of setup in that language and persists it as the project default language to `.pi-oven/config.json` (machine-local, gitignored). The pi-oven extension injects this default at runtime so agents respond in your chosen language; if no config is set, the ambient project/global language preference is respected (nothing is forced).
1. Detect which providers are authenticated (`opencode-zen`, `openai-codex`, `anthropic`).
2. Offer Profile A (release default) or Profile B (Anthropic opt-in, if available).
3. Optionally let you override individual agent roles.
4. Persist your choice to plugin config + rewrite all 22 agent files in-place.
5. Run a smoke validation (7 MUST-tier roles pinged) and report the result.

### 2. Dispatch agents directly

Inside any omp session, dispatch an agent by name:

```
> Use pi-oven:explorer to find all files that touch the User model.
```

The agent loads from `agents/pi-oven-explorer.md`, uses the model from your active Profile, and respects its tool whitelist (read-only research agents cannot Write or Edit).

At `session_start`, pi-oven also mirrors `pi-oven-*.md` into discovery-stable paths:
- project scope: `.omp/agents/`
- user/global scope: `~/.omp/agent/agents/`

So `pi-oven:*` dispatch remains available even when plugin-root agent discovery is disabled in a harness runtime.

### 3. Trigger skills by keyword

Skills auto-activate when their trigger keywords appear in conversation. For example:

| Skill | Sample trigger |
|---|---|
| `autonomous-loop` | `자율 실행`, `자율실행`, `ralph로 돌려`, `autopilot`, `ultrawork`, `must complete` |
| `tdd-strict` | `tdd`, `test first`, `red-green-refactor` |
| `spec-and-review` | `spec 잡자`, `plan draft`, `codex review` |
| `codebase-survey` | `버그 수정`, `callsite 전수`, `상세하게 봐줘` |
| `pre-commit-gate` | `commit`, `pre-commit`, `Gate 0-5` |
| `deep-init` | `deepinit`, `init project context`, `scan codebase` |
| `deep-dive` | `deep dive`, `trace and clarify` |

See `skills/*/SKILL.md` for the complete trigger list per skill.

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

22 agents, grouped by purpose. Each agent's `model:` field locks the LLM choice; the validator at plugin load rejects any agent whose model prefix is outside the whitelist (`opencode-zen/`, `openai-codex/`, or `anthropic/` when Profile B is active).

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

### SHOULD tier (enabled by default, optional in Profile B trim)

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

See `skills/<name>/SKILL.md` for the complete body and `evals/<skill>/scenarios/*.yaml` for behavioral test fixtures.

---

## `/pi-oven:setup` reference

The wizard accepts subcommands:

| Subcommand | Purpose |
|---|---|
| `/pi-oven:setup` | Interactive first-run flow (default) |
| `/pi-oven:setup --status` | Show current Profile + per-role models + drift status |
| `/pi-oven:setup --reset` | Clear all pi-oven plugin config + revert agent files to Profile A |
| `/pi-oven:setup --import <file>` | Apply a JSON config (validated against the 22-role schema + provider whitelist) |
| `/pi-oven:setup --reapply` | Re-apply the persisted Profile to agent files (used after `omp plugin upgrade`) |
| `/pi-oven:setup --apply --profile A` | Non-interactive apply with explicit profile |
| `/pi-oven:setup --apply --profile B --validate full` | Full 22-role smoke ping (default is 7 MUST-tier) |
| `/pi-oven:setup --apply --profile A --override executor=openai-codex/gpt-5.4` | Per-role override (repeatable) |
| `/pi-oven:setup --isolate` | Make omp ignore the `~/.claude` context layer (writes `disabledProviders: [claude]`; keeps `claude-plugins` so pi-oven's own `/pi-oven:*` commands survive). Combinable, e.g. `--apply --profile A --isolate` |
| `/pi-oven:setup --no-isolate` | Re-enable the `~/.claude` layer in omp (removes `claude` + any legacy `claude-plugins`) |

### Profile A (release default)

Optimized for users with **OpenCode Zen + OpenAI Codex subscriptions** — no Anthropic dependency.

- Codex roles (executor, debugger, test-engineer, architect, metis): `openai-codex/gpt-5.4` (alternate: `opencode-zen/gpt-5.4`)
- Explorer / docs (explorer, writer, document-specialist, multimodal-looker): `opencode-zen/gemini-3-flash`
- Reasoning-heavy (critic, planner, security-reviewer, oracle): `anthropic/claude-opus-4-8`
- Structured review / design (designer, verifier, code-reviewer, code-simplifier, tracer, analyst, librarian): `opencode-zen/glm-5.1`
- Vision (qa-tester): `opencode-zen/gemini-3.5-flash` · Cheap git (git-master): `opencode-zen/claude-haiku-4-5`

Beyond the 22 subagent roles, `/pi-oven:setup --profile` also sets the **main orchestrator** model — omp `modelRoles.default` = canonical `gpt-5.4` (openai-codex-first, opencode-zen fallback). The 21 skills enforce subagent dispatch so the orchestrator routes work to the right agent instead of doing it inline.

### Profile B (Anthropic opt-in)

Activates only when your omp environment is authenticated with native Anthropic (Pro/Max). Promotes Anthropic models for reasoning-heavy roles; **preserves `opencode-zen/glm-5` for explorer + librarian** to keep the 1M context window for repo-wide work.

- Executor: `anthropic/claude-sonnet-4-6`
- Reasoning-heavy: `anthropic/claude-opus-4-7`
- Cheap fan-out: `anthropic/claude-haiku-4-5`
- Explorer / Librarian: `opencode-zen/glm-5` (unchanged from Profile A)

If your Anthropic credential is revoked, the wizard's `--status` reports drift and recommends `/pi-oven:setup --reapply` after re-running `/pi-oven:setup` with Profile A.

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
| `opencode-zen` | Always allowed | Default for Profile A. Wraps claude / gpt / kimi / glm. |
| `openai-codex` | Always allowed | ChatGPT subscription, codex variants (5.3-codex, 5.4) |
| `anthropic` | Opt-in (Profile B) | Pro / Max subscription only. Falls back automatically if revoked. |

Any other provider prefix (`bedrock/`, `gemini/`, `cerebras/`, `github-copilot/`, ...) is **hard-blocked** at plugin load. The validator logs a `WHITELIST VIOLATION` error with the offending agent file path.

---

## Known limitations

### Auth-fallback whitelist hole

When a pi-oven agent's primary model is unauthenticated (e.g., you select Profile B but Anthropic auth is rate-limited), omp's `resolveModelOverrideWithAuthFallback` falls back to the **parent session's active model** — NOT to the pi-oven agent's alternate. If your parent session is running on a model outside the whitelist (`google/gemini-flash`, etc.), the subagent will silently route through it.

**Mitigation**: the `session_start` handler in `.omp/extensions/pi-oven.ts` captures the parent model to `~/.omp/plugins/pi-oven-session-model.json`; `/pi-oven:setup` warns when the parent model violates the whitelist.

### omp plugin upgrade resets agent files

`omp plugin upgrade pi-oven@pi-oven` overwrites the install-cache `agents/` directory with the repo defaults (Profile A). If you previously selected Profile B, re-run `/pi-oven:setup --reapply` to restore the anthropic model routing.

The drift detector emits a warning at session start if it notices the agent files no longer match your persisted Profile.

### Install cache must be populated

After installing pi-oven@pi-oven from the marketplace, ensure the install cache has the 22 agent files:

```sh
ls ~/.omp/plugins/cache/plugins/pi-oven___pi-oven___*/agents/ | wc -l
# Expected: 22
```

If empty (`0`), force a reinstall:

```sh
omp plugin install pi-oven@pi-oven --force
```

This is required because the marketplace install copies the repo tree recursively (`fs.cp recursive`); a stale cache from a pre-agent-registry version will show empty.

---

## Troubleshooting

### Wizard reports "Plugin not found"

`omp plugin config` operations use the bare plugin name `pi-oven` (matches `plugin.json` `"name"`). The marketplace-qualified id `pi-oven@pi-oven` is only for `omp plugin install` / `omp plugin uninstall`. If you accidentally pass `pi-oven@pi-oven` to a `config` subcommand, you'll see `Plugin "pi-oven@pi-oven" not found`.

### `Unknown agent "pi-oven:executor"` in task dispatch

This means your current runtime did not load plugin-root agents. pi-oven now auto-mirrors agent files into `.omp/agents/` (project) and `~/.omp/agent/agents/` (user/global) at `session_start`.

If you still see the error in an already-open session, restart the session (or trigger a new one) so `session_start` runs and the mirror is written.

### `bun run lint:agents` fails

The CI hard-lint script (`scripts/lint-agents.ts`) walks `agents/pi-oven-*.md` and fails if any file is missing a `model:` field. If you customized an agent and removed the model lock, this lint will catch it before the build merges.

### Test suite

```sh
bun test       # 515 tests across 42 files
bun check      # tsc --noEmit typecheck
bun run build  # extension bundle (pi-oven.js)
bun run lint:agents  # CI-grade agent file lint
```

### Drift detected at session start

```
[WARN] pi-oven: agent files drifted from plugin config (3 role(s): executor, critic, planner). Run /pi-oven:setup --reapply to sync.
```

This usually means you ran `omp plugin upgrade` and the agent files reset to defaults but your persisted Profile is different. Run `/pi-oven:setup --reapply` to restore.

---

## Development (dev mode)

If you're hacking on pi-oven itself, point omp at your local checkout instead of the marketplace install:

```sh
cd /path/to/pi-oven
bun install
bun test           # baseline 515 passing
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
│   ├── plugin.json          # plugin manifest (21 skills, version, commands)
│   └── marketplace.json     # marketplace catalog (plugins[0].version)
├── .omp/extensions/
│   └── pi-oven.ts               # load-time validator + session_start drift hook
├── agents/                  # 22 pi-oven-prefixed agent files (file-based registry)
│   └── pi-oven-*.md
├── skills/                  # 21 authored skills (all runtime-loaded)
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
├── tests/                   # bun test suite (515 tests, 1235 expect calls, 42 files)
│   ├── extensions/
│   ├── plugin/
│   └── scripts/
├── commands/                # slash command prompt templates
│   ├── setup.md
│   ├── doctor.md
│   └── release.md
└── docs/
    ├── specs/               # design specs (foundation + agent registry + setup wizard + skill rewrite)
    ├── plans/               # implementation plans
    ├── decisions/           # post-implementation decision records (e.g., dogfood switch)
    ├── adr/                 # architecture decision records (e.g., marketplace distribution)
    ├── instincts/           # observed-behavior notes (e.g., omp install layout)
    ├── harness/             # harness-flow progress + user queue
    ├── research/            # codex-reviews / surveys
    ├── WORKING-CONTEXT.md   # current sprint state
    └── SOUL.md              # project identity
```

---

## Architecture in one paragraph

pi-oven is a **file-based agent registry** wrapped in an omp marketplace plugin. The 22 agent files in `agents/pi-oven-*.md` are the single source of truth for model routing — each file's frontmatter `model:` array names the primary + alternate that the omp `task` tool will resolve at dispatch time. A load-time TypeScript validator (`.omp/extensions/pi-oven.ts`) enforces the provider whitelist by reading the agent files themselves: if any file references an `anthropic/*` model, the validator includes `anthropic/` in `ALLOWED_PREFIXES`; otherwise Profile A is in effect. The `/pi-oven:setup` wizard mutates the agent files in-place to switch Profiles; the `session_start` hook detects drift between agent files and persisted plugin config and emits a warning. 21 skills layer workflow discipline on top, including UC5 ops connectors (`aws`, `bitbucket-pipeline`, `cloudflare`).

---

## Documentation

- `docs/specs/2026-05-27-pi-oven-foundation-design.md` — foundation design (omp-native pivot)
- `docs/specs/2026-05-28-pi-oven-agent-registry.md` — Spec A (23 agents + validator + lint)
- `docs/specs/2026-05-28-pi-oven-setup-wizard.md` — Spec B (`/pi-oven:setup` wizard)
- `docs/specs/2026-05-28-pi-oven-skill-rewrite-and-new-skills.md` — Spec C (skill sweep + 3 new skills)
- `docs/adr/0001-omp-marketplace-distribution.md` — Marketplace as sole distribution
- `docs/decisions/0001-dogfood-switch.md` — v0.1.0 dogfood switch threshold
- `docs/harness/harness-flow-progress.md` — Cycle-by-cycle build log
- `docs/WORKING-CONTEXT.md` — Current sprint state
- `docs/research/codex-reviews/` — Critic verdicts from spec-and-review cycles

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
