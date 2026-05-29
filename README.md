# pi-oven

> A curated omp marketplace plugin distilled from five frozen sources (oh-my-claudecode / oh-my-openagent / Pocock skills / superpowers / pi-oven). Zero external dispatch dependency; everything you need ships in one plugin.

[![Version](https://img.shields.io/badge/version-0.1.0-blue.svg)]() [![Tests](https://img.shields.io/badge/tests-195%20passing-green.svg)]() [![License](https://img.shields.io/badge/license-MIT-blue.svg)]()

---

## What you get

- **23 self-contained agents** under the `pi-oven:` namespace — explorer, executor, verifier, critic, planner, code-reviewer, debugger, designer, writer, code-simplifier, qa-tester, security-reviewer, test-engineer, git-master, document-specialist, tracer, analyst, scientist, architect, librarian, multimodal-looker, oracle, metis. Each is a markdown file in `agents/` with locked model + tool whitelist.
- **15 skills** that orchestrate the agents — code quality, TDD, brainstorming, planning, codebase survey, spec-and-review, large-task delegation, fresh verifier, pre-commit gate, subagent-driven development, autonomous loop, deep-init (hierarchical AGENTS.md), deep-dive (causal trace + Socratic interview), team (multi-agent orchestration), eval-runner.
- **`/pi-oven:setup` wizard** — Profile A (release default, opencode-zen + openai-codex) or Profile B (Anthropic Pro/Max opt-in), agent-file source of truth, drift detection on every session.
- **CI-grade safety** — load-time model whitelist validator + CI-time hard lint that fails the build if any agent ships without a `model:` field.

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

1. Detect which providers are authenticated (`opencode-zen`, `openai-codex`, `anthropic`).
2. Offer Profile A (release default) or Profile B (Anthropic opt-in, if available).
3. Optionally let you override individual agent roles.
4. Persist your choice to plugin config + rewrite all 23 agent files in-place.
5. Run a smoke validation (7 MUST-tier roles pinged) and report the result.

### 2. Dispatch agents directly

Inside any omp session, dispatch an agent by name:

```
> Use pi-oven:explorer to find all files that touch the User model.
```

The agent loads from `agents/pi-oven-explorer.md`, uses the model from your active Profile, and respects its tool whitelist (read-only research agents cannot Write or Edit).

### 3. Trigger skills by keyword

Skills auto-activate when their trigger keywords appear in conversation. For example:

| Skill | Sample trigger |
|---|---|
| `autonomous-loop` | `자율 실행`, `ralph로 돌려`, `autopilot`, `ultrawork`, `must complete` |
| `tdd-strict` | `tdd`, `test first`, `red-green-refactor` |
| `spec-and-review` | `spec 잡자`, `plan draft`, `codex review` |
| `codebase-survey` | `버그 수정`, `callsite 전수`, `상세하게 봐줘` |
| `pre-commit-gate` | `commit`, `pre-commit`, `Gate 0-5` |
| `deep-init` | `deepinit`, `init project context`, `scan codebase` |
| `deep-dive` | `deep dive`, `trace and clarify` |
| `team` | `team mode`, `multi-agent` |

See `skills/*/SKILL.md` for the complete trigger list per skill.

### 4. Verify before claiming done

The `fresh-verifier` skill enforces a hard rule: **the main agent cannot verify its own work**. When you finish a task and want to confirm completion, the skill auto-dispatches `pi-oven:verifier` (a fresh agent with no memory of the implementation) to run a 4-check audit:

1. Production build smoke (`bun run build`)
2. Stub sweep (no `TODO`, `FIXME`, dead-stub patterns in touched files)
3. SoT alignment (specs / plans match implementation)
4. Spec-freeze re-check (no locked decisions silently overridden)

Verdict: `PASS` (cycle exit allowed) or `BLOCK` (with evidence + remediation).

---

## Agent roster

23 agents, grouped by purpose. Each agent's `model:` field locks the LLM choice; the validator at plugin load rejects any agent whose model prefix is outside the whitelist (`opencode-zen/`, `openai-codex/`, or `anthropic/` when Profile B is active).

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
| `pi-oven:scientist` | Hypothesis-driven experimentation |
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
| `eval-runner` | core | scenario YAML execution against omp SDK |
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
| `team` | extended | N-agent orchestration on shared task list |

See `skills/<name>/SKILL.md` for the complete body and `evals/<skill>/scenarios/*.yaml` for behavioral test fixtures.

---

## `/pi-oven:setup` reference

The wizard accepts subcommands:

| Subcommand | Purpose |
|---|---|
| `/pi-oven:setup` | Interactive first-run flow (default) |
| `/pi-oven:setup --status` | Show current Profile + per-role models + drift status |
| `/pi-oven:setup --reset` | Clear all pi-oven plugin config + revert agent files to Profile A |
| `/pi-oven:setup --import <file>` | Apply a JSON config (validated against the 23-role schema + provider whitelist) |
| `/pi-oven:setup --reapply` | Re-apply the persisted Profile to agent files (used after `omp plugin upgrade`) |
| `/pi-oven:setup --apply --profile A` | Non-interactive apply with explicit profile |
| `/pi-oven:setup --apply --profile B --validate full` | Full 23-role smoke ping (default is 7 MUST-tier) |
| `/pi-oven:setup --apply --profile A --override executor=openai-codex/gpt-5.4` | Per-role override (repeatable) |

### Profile A (release default)

Optimized for users with **OpenCode Zen + OpenAI Codex subscriptions** — no Anthropic dependency.

- Executor: `openai-codex/gpt-5.3-codex` (alternate: `opencode-zen/gpt-5.3-codex`)
- Explorer: `opencode-zen/glm-5` (1M context for large repo scans)
- Reasoning-heavy (critic, security-reviewer, architect, ...): `opencode-zen/claude-opus-4-8`
- Mid-tier (planner, code-reviewer, debugger, ...): `opencode-zen/claude-sonnet-4-6`
- Cheap fan-out (writer, git-master): `opencode-zen/claude-haiku-4-5`

### Profile B (Anthropic opt-in)

Activates only when your omp environment is authenticated with native Anthropic (Pro/Max). Promotes Anthropic models for reasoning-heavy roles; **preserves `opencode-zen/glm-5` for explorer + librarian** to keep the 1M context window for repo-wide work.

- Executor: `anthropic/claude-sonnet-4-6`
- Reasoning-heavy: `anthropic/claude-opus-4-7`
- Cheap fan-out: `anthropic/claude-haiku-4-5`
- Explorer / Librarian: `opencode-zen/glm-5` (unchanged from Profile A)

If your Anthropic credential is revoked, the wizard's `--status` reports drift and recommends `/pi-oven:setup --reapply` after re-running `/pi-oven:setup` with Profile A.

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

After installing pi-oven@pi-oven from the marketplace, ensure the install cache has the 23 agent files:

```sh
ls ~/.omp/plugins/cache/plugins/pi-oven___pi-oven___*/agents/ | wc -l
# Expected: 23
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

### `bun run lint:agents` fails

The CI hard-lint script (`scripts/lint-agents.ts`) walks `agents/pi-oven-*.md` and fails if any file is missing a `model:` field. If you customized an agent and removed the model lock, this lint will catch it before the build merges.

### Test suite

```sh
bun test       # 152 tests across 20 files (Spec A + B + C combined)
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
bun test           # baseline 152 passing
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
│   ├── plugin.json          # plugin manifest (15 skills, version, commands)
│   └── marketplace.json     # marketplace catalog (plugins[0].version)
├── .omp/extensions/
│   └── pi-oven.ts               # load-time validator + session_start drift hook
├── agents/                  # 23 pi-oven-prefixed agent files (file-based registry)
│   └── pi-oven-*.md
├── skills/                  # 15 skills
│   └── <skill-name>/
│       ├── SKILL.md
│       └── references/      # progressive disclosure docs
├── evals/                   # behavioral test fixtures per skill
│   └── <skill-name>/scenarios/{smoke,adversarial,regression}.yaml
├── scripts/
│   ├── lint-agents.ts       # CI hard lint
│   ├── run-eval.ts          # scenario runner against omp SDK
│   ├── pi-oven-setup.ts         # /pi-oven:setup batch CLI
│   ├── pi-oven-setup/           # 11 submodules (profiles, persist, apply, ...)
│   └── lib/eval-runner.ts   # SDK subscribe-pattern adapter
├── tests/                   # bun test suite (152 tests, 636 expect calls)
│   ├── extensions/
│   ├── plugin/
│   └── scripts/
├── commands/                # slash command prompt templates
│   ├── pi-oven-setup.md
│   ├── pi-oven-doctor.md
│   └── pi-oven-autonomous.md
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

pi-oven is a **file-based agent registry** wrapped in an omp marketplace plugin. The 23 agent files in `agents/pi-oven-*.md` are the single source of truth for model routing — each file's frontmatter `model:` array names the primary + alternate that the omp `task` tool will resolve at dispatch time. A load-time TypeScript validator (`.omp/extensions/pi-oven.ts`) enforces the provider whitelist by reading the agent files themselves: if any file references an `anthropic/*` model, the validator includes `anthropic/` in `ALLOWED_PREFIXES`; otherwise Profile A is in effect. The `/pi-oven:setup` wizard mutates the agent files in-place to switch Profiles; the `session_start` hook detects drift between agent files and persisted plugin config and emits a warning. 15 skills layer workflow discipline on top of the agent registry — each skill dispatches pi-oven-prefixed agents by name through the omp `task` tool. There is no `subagent_type` registry in omp; everything is file lookup. This avoids the 401 failure mode where external namespaces like `oh-my-claudecode:executor` were passed to omp as model strings.

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
