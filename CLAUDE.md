# CLAUDE.md — pi-oven

> Project guide for agents working **on** this repo. Terse by design (token budget). Facts here override stale prose in old specs when they conflict.

## What this is

`pi-oven` is a **plugin for omp** (`oh-my-pi`, the pi-coding-agent harness). It is a curated workflow + discipline layer that absorbs the best of 4 sources: **omc** (oh-my-claudecode), **omo** (oh-my-openagent), **Pocock**, **superpowers**. Distributed as `pi-oven@kzk` (marketplace `kzk`).

**Goal: build the optimal agentic workflow that runs natively on omp.** Not a Claude Code plugin — Claude Code interop is a by-product, not maintained.

**Core design principle — heterogeneous models.** Agents do NOT all run on Anthropic. PROFILE_A spreads 24 roles across ~5 models / 4 providers (anthropic opus · openai-codex gpt-5.4 · opencode-zen minimax/glm/kimi). Each agent's body must inject an **execution context optimized for its specific model**, not a generic prompt. Model-fit is a first-class concern.

## Layout

| Dir | What | SoT? |
|---|---|---|
| `agents/pi-oven-*.md` | 24 subagent definitions. Frontmatter `name: pi-oven:<role>` (colon), `model:` array, `thinkingLevel`, body = system prompt. | body hand-authored; `model`/`thinkingLevel` derived from profiles.ts |
| `skills/<name>/SKILL.md` | 22 authored skills; runtime loads the 22-skill SoT set from `.claude-plugin/plugin.json`, exposes them via description discovery, and supplements them with a curated runtime keyword whitelist in the extension. Bodies **English-only**. | hand-authored |
| `commands/*.md` | 3 command templates (setup, doctor, release). omp registers each as `/pi-oven:<basename>` via the Claude Code Marketplace provider, which namespaces marketplace commands as `<plugin>:<file-basename>` — command files MUST NOT carry a `pi-oven-` prefix. Autonomous mode is entered by matching the `autonomous-loop` runtime keyword whitelist (no command required). | hand-authored |
| `scripts/pi-oven-setup/` | Setup-wizard CLI modules (TS, bun). | code |
| `scripts/pi-oven-release/` | Release automation modules (version bump, SoT sync, changelog, publish gate). | code |
| `scripts/lint-{agents,skills}.ts` | CI hard lints. | code |
| `.omp/extensions/pi-oven.ts` | omp extension: load-time `validateAgentRegistry` (provider whitelist) + `session_start` parent-model capture. Built to `dist/`. | code |
| `docs/` | design specs + project identity (`SOUL.md`). | see map below |

## Commands (bun)

```
bun run check        # tsc --noEmit
bun test             # 895 pass currently
bun run lint:agents  # agents/*.md frontmatter == PROFILE_A + colon-name invariant
bun run lint:skills  # SKILL.md pi-oven:<role> refs ∈ ROLES; /pi-oven: slash refs excluded
bun run build        # bundle .omp/extensions/pi-oven.ts -> dist/
bun run eval         # scripts/run-eval.ts (needs LLM keys — gated, see Status)
bun run release:pi-oven -- --bump patch --dry-run  # release automation (safe default)
```

## Model routing — READ THIS (most common source of confusion)

**omp resolves a subagent's model ONLY from settings `task.agentModelOverrides`** (a `Record<agentName, modelId>`), keyed by the **colon** name `pi-oven:<role>`. omp deep-merges this record across layers; precedence (low→high): agent-file `model:` frontmatter < global `~/.omp/agent/config.yml` `task.agentModelOverrides` < **project `<projectRoot>/.omp/settings.json` `task.agentModelOverrides`** < runtime CLI flag; an unset role falls through to the session default (silent fallback). The old `settings.pi-oven` plugin-config namespace is **DEAD and removed** (Spec E / Option C) — never reintroduce per-role model writes there.

**Project layer (`<projectRoot>/.omp/settings.json`).** omp loads this file at `level:"project"` (discovered from `<cwd>/.omp/`, the launch dir — no git-root ancestor walk) and **deep-merges it over** the global `config.yml`: record-typed settings (`task.agentModelOverrides`, `modelRoles`) merge key-by-key, so an unlisted role still inherits from global; **arrays replace** (so `retry.fallbackChains[role]` is replaced, not concatenated). A project override therefore beats even a Profile-A frontmatter-pinned role — by design. `/pi-oven:setup --scope project` writes per-project routing here: **all 24 per-role overrides for EVERY profile incl. A** (so a project can fully diverge from the committed Profile-A frontmatter), plus `modelRoles` + `retry.fallbackChains`; language + the setup-complete marker go to `<cwd>/.pi-oven/config.json`. The file is committable (share routing with a team) or gitignorable (machine-local); memory/async infra stays global-only. **Spec E carve-out:** Spec E bans per-role `task.agentModelOverrides` writes to the **global** namespace for Profile A — writing per-role overrides to a **project-scoped** `.omp/settings.json` is a *different layer* and is the sanctioned mechanism for per-project routing. The global Profile-A orchestrator-only invariant is unchanged.

**SoT chain:** `scripts/pi-oven-setup/profiles.ts` (`PROFILE_A`/`PROFILE_B`) → `agents/pi-oven-*.md` frontmatter → `lint-agents.ts` enforces equality. Agent `model`/`thinkingLevel` frontmatter is a **derived artifact** — change it in `profiles.ts`, then maintainer-only `--apply` regenerates frontmatter. `agent-rewriter.ts` **preserves the body verbatim** (only frontmatter `model:`+`thinkingLevel` lines change) → **editing agent prose bodies is safe** and never clobbered by `--apply`/lint.

**Personal override (no git dirt):** users run `/pi-oven:setup --override <role>=<model>` → writes `task.agentModelOverrides["pi-oven:<role>"]` to `~/.omp/agent/config.yml` (machine-global, uncommitted). Agent files untouched.

### PROFILE_A model map (release default), grouped by model family

| Model | thinkingLevel | Roles |
|---|---|---|
| `anthropic/claude-opus-4-8` | xhigh / high | critic, planner, security-reviewer, oracle |
| `openai-codex/gpt-5.4` | high / xhigh | executor, debugger, test-engineer, architect, metis, data-runner (+ planner alt) |
| `openai-codex/gpt-5.4-mini` | medium | multimodal-looker, qa-tester (vision) |
| `opencode-zen/minimax-m2.5` | medium / high | explorer, writer, document-specialist, deep-researcher, librarian, git-master |
| `opencode-zen/glm-5.1` | high | designer, code-simplifier |
| `opencode-zen/kimi-k2.6` | med→xhigh | code-reviewer, verifier, analyst, tracer |

`/pi-oven:setup --profile` now also sets the main orchestrator model (`modelRoles.default` + `modelRoles.title`), separate from the 24 subagent roles. PROFILE_A pins these to `openai-codex/gpt-5.4:high` and `gpt-5.4-mini:low`; retry fallback chains provide `default → opencode-zen/kimi-k2.6` and `title → opencode-zen/gpt-5.4-mini`. **Profile A writes orchestrator-only overrides** (`modelRoles.default` + `modelRoles.title`); the 24 per-role `task.agentModelOverrides` live in committed agent frontmatter, not written by global `--profile A`.

**Rate-limit failover (`retry.fallbackChains`).** A frontmatter `model:` array is **resolution-time only** (omp picks the first available; the second entry is an auth/availability fallback at spawn, plus parent-active-model auth fallback). It is **NOT** a runtime rate-limit failover chain. Runtime failover on `usage_limit`/429 is driven by the `retry.fallbackChains` setting (`Record<modelRoleName, string[]>`, consumed in `agent-session.ts` `#tryRetryModelFallback`); when the provider asks to wait longer than `retry.maxDelayMs` with no model/credential switch, omp fails fast. `/pi-oven:setup --apply` now writes `retry.fallbackChains` for the orchestrator roles (PROFILE_A: `default → [opencode-zen/kimi-k2.6]`, `title → [opencode-zen/gpt-5.4-mini]`; SoT = `PROFILE_A_FALLBACK_CHAINS`/`PROFILE_B_FALLBACK_CHAINS`/`PROFILE_C_FALLBACK_CHAINS`/`PROFILE_D_FALLBACK_CHAINS` in `profiles.ts`, kept OUTSIDE `ProfileMap`). **Limitation:** chains are keyed by **modelRole** and matched against the active model's base selector, so a codex subagent benefits only when its base equals a configured `modelRoles.<role>` (e.g. `openai-codex/gpt-5.4` ↔ `modelRoles.default`); subagents pinned via `task.agentModelOverrides` to a non-matching model are not covered (omp has no agent-keyed fallback chains).

Provider whitelist (enforced at load + CI lint): `opencode-zen/`, `openai-codex/` always; `anthropic/` only if an agent file already declares an `anthropic/*` model.

**PROFILE_B** (openai-codex-only, performance-first Codex Pro/20x profile): setup writes subagent overrides as model selectors with reasoning-effort suffixes, and sets the main orchestrator to `openai-codex/gpt-5.4:high` so subscription users get the 1M context window. Runtime `retry.fallbackChains` for Profile B are empty, so setup does not route usage-limit retries through OpenCode Zen. `openai-codex/gpt-5.5:high` handles executor, test-engineer, and metis; `openai-codex/gpt-5.5:xhigh` handles verifier, critic, planner, code-reviewer, debugger, security-reviewer, code-simplifier, tracer, analyst, architect, oracle, and deep-researcher; `openai-codex/gpt-5.4:high` handles designer, qa-tester, and data-runner; `openai-codex/gpt-5.4:medium` handles explorer, writer, git-master, document-specialist, librarian, multimodal-looker, and title. It intentionally avoids `gpt-5.4-mini`/nano.

**PROFILE_C** (tier-appropriate all-Anthropic): `anthropic/claude-opus-4-8` for high/xhigh roles, `anthropic/claude-sonnet-4-6` for medium roles and for git-master + orchestrator title (haiku-4-5 is unavailable); opencode-zen anthropic equivalents serve as `registry_alternate` in each entry.

**PROFILE_D** (opencode-zen-only): `opencode-zen/kimi-k2.6` for heavy coding and reasoning roles; `opencode-zen/minimax-m2.5` for mid and low-weight roles; `opencode-zen/gemini-3-flash` for vision roles (multimodal-looker, qa-tester). No Anthropic or OpenAI Codex auth required. Writes all 24 per-role `task.agentModelOverrides` on `--profile D`.

**Profiles B, C, and D all write all 24 per-role `task.agentModelOverrides`** on `--profile B/C/D` — a Spec E relaxation covering all non-A profiles. Profile A remains orchestrator-only (its 24 subagent models live in committed frontmatter). Use `--reset` to clear written overrides.

## Agent tool discipline + orchestrator conduct

**Every agent body mandates its omp native tools** in omp-official `<directives>`/`<procedure>` MUST/SHOULD/NEVER style. Three tool-class mandates enforced across all 24 agents:

- **Code/debug** roles (executor, debugger, tracer, test-engineer, analyst, code-reviewer, architect, oracle, code-simplifier, security-reviewer, verifier, data-runner, metis): MUST use `lsp` (diagnostics, goto-def, find-refs) and `ast_grep` (structural search) over plain reading/grep; MUST use `eval` to reproduce/inspect runtime and `bash` to run failing build/tests; debug-first roles (debugger, tracer) MUST use `debug` for runtime stepping; NEVER speculate about code behavior.
- **Research/web** roles (deep-researcher, document-specialist, librarian, explorer, writer, planner, designer): for any external/library/API/doc question, MUST use `web_search` and read source; NEVER answer from training data — **source is truth, training data is history**; fall back to `web_search` before reporting "not found".
- **Vision** roles (multimodal-looker, qa-tester): MUST use `inspect_image` to view screenshots/images; NEVER infer from filenames.

**`tools:`/`blocked_tools` are a `profiles.ts` SoT** enforced by `lint-agents.ts` (JSON equality vs `PROFILE_A[role]`) and by `profiles.test.ts` (`PROFILE_B`/`PROFILE_C`/`PROFILE_D` `tools`/`blocked_tools` must equal `PROFILE_A`). Widening a role's `tools:` requires editing `tools` IDENTICALLY in all four profiles in `profiles.ts` AND the agent file in lockstep — a tools edit to only the agent file fails `bun run lint:agents` with "tools drift from profiles.ts". `blocked_tools` is UNCHANGED for every role. `agent-rewriter.ts` preserves bodies verbatim under `--apply`, so editing agent prose is safe.

**Setup (global scope) force-enables 6 omp tool flags** via `setToolEnablementConfig` in `apply.ts` so the body mandates have teeth: `inspect_image.enabled=true` (default false — blocks vision agents without this), `web_search.enabled=true`, `lsp.enabled=true`, `astGrep.enabled=true`, `browser.enabled=true`, `debug.enabled=true`. `eval` is ungated (omp has no `eval.enabled` key). These flags are written every global-scope run. `--reset --full` leaves them — they are omp-global infra, not pi-oven routing.

**The extension injects a standing PARENT-ONLY orchestrator-conduct block** every turn (dedup key `pi-oven:orchestrator-conduct@v2`) via `buildOrchestratorConductBlock` in `rules-injector.ts`, wired in `pi-oven.ts` with the `autonomousActive` flag (reusing `needsAutonomousReminder`). Interactive mode: SKILL-FIRST (load skill before acting) + WAIT-FOR-USER (pending question = hard stop) + ASK-WHEN-AMBIGUOUS. Autonomous mode: SKILL-FIRST only; WAIT/ASK rules suspended (boundary contract governs instead, via the `needsAutonomousReminder` carve-out).

**Skill/agent routing (conduct `@v2` + namespaced-injection invariant).** omp's `claude-plugins` provider registers every marketplace plugin skill **namespaced** as `<plugin>:<skill>` (`claude-plugins.ts:121`), so pi-oven's skills are `pi-oven:<name>`. The `read` tool resolver is exact-match, so a **bare** `skill://<name>` injection fails to resolve and the model loads a sibling plugin's same-named skill (e.g. `superpowers:brainstorming`) instead. **Invariant: every runtime `skill://` emitter MUST emit `skill://pi-oven:<name>`, never the bare form** — the four emitters are `skill-keyword-loader.ts` (`PI_OVEN_SKILL_NS` const), the autonomous reminder in `pi-oven.ts`, the gate message in `gate.ts`, and the conduct block. The gate read-detector (`gate-handler.ts getSkillReadName`) strips the `pi-oven:` namespace + any `:line-range` suffix back to the bare `requiredSkills` key (internal keys stay bare). In-body skill refs use `skill://pi-oven:<name>/references/...` (colon, NOT the old slash `skill://pi-oven/<name>` form — `lint-skills.ts` enforces colon). The conduct block also carries two hard rules (both modes): **SKILL PRECEDENCE** (pi-oven skills authoritative; never load same-purpose `superpowers:*`/`oh-my-claudecode:*`/`agentmemory:*`) and **AGENT NAMING** (dispatch only `pi-oven:<role>`, never `kzk:<role>` — `kzk` is the marketplace catalog name, not an agent namespace). **Opt-in sibling suppression:** `/pi-oven:setup --suppress-sibling-skills` (global-only) writes omp's `skills.ignoredSkills` globs (`superpowers:*`, `oh-my-claudecode:*`, SoT `PI_OVEN_SIBLING_SKILL_GLOBS`) to hide those sibling marketplace skills entirely; default OFF; `--no-suppress-sibling-skills`/`--reset` clears.

## Conventions / guardrails

- **Skill bodies English-only.** Korean belongs in the runtime keyword whitelist and user-facing docs/examples, not in SKILL body prose.
- **Commit subjects:** what/why only — **no "Plan N" / "Task N"** progress markers. Per-spec semantic commits, not per-task.
- **`git push` requires explicit user confirmation** every time. Autonomous mode never auto-pushes.
- Agent name frontmatter MUST be `pi-oven:<role>` (colon) — equals omp registry key = override key.
- Smallest viable diff; match existing patterns; no external dispatch (`oh-my-claudecode:*` / `omo:*` → 401, they resolve as model strings).
- Big structural change / new spec → `spec-and-review` (codex cross-vendor review loop) before code. Touching code → TDD-strict + `pre-commit-gate`.

## Status

**Current: v0.1.15** — makes Profile B use `openai-codex/gpt-5.4:high` for the main orchestrator so OpenAI-subscription users get the 1M context window, and leaves Profile B runtime fallback chains empty so setup does not route through OpenCode Zen. Profile B remains performance-first for Codex Pro/20x subagents: no `gpt-5.4-mini`/nano, per-role overrides include reasoning-effort suffixes, and xhigh is reserved for planner/debugger/review/security/architecture/oracle/deep-research roles.

**Release ritual (do before every `release:pi-oven`):** bump the human-facing version refs that the manifest auto-sync does NOT touch — this Status line (`Current: vX`, tag) + `README.md` (the version/tests badges line ~5 and the `# Expected: pi-oven@kzk (X)` line). Then run `release:pi-oven`. CI's version-parity step only checks the three manifests, not this prose, so a stale Status/README will not fail CI — keep them current by hand.

Per-release history → `CHANGELOG.md` + git. This file is the stable guide, not a changelog — don't restate version history here.

## docs/ map

`specs/` design specs (foundation, agent-registry, setup-wizard, skill-rewrite, skill-agent-dispatch, user-local-override) · `plans/` design + execution plans (includes `2026-06-04-agents-omp-native-upgrade-design.md` + `*-plan.md`) · `SOUL.md` project identity.
