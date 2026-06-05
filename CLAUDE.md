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
bun test             # 643 pass currently
bun run lint:agents  # agents/*.md frontmatter == PROFILE_A + colon-name invariant
bun run lint:skills  # SKILL.md pi-oven:<role> refs ∈ ROLES; /pi-oven: slash refs excluded
bun run build        # bundle .omp/extensions/pi-oven.ts -> dist/
bun run eval         # scripts/run-eval.ts (needs LLM keys — gated, see Status)
bun run release:pi-oven -- --bump patch --dry-run  # release automation (safe default)
```

## Model routing — READ THIS (most common source of confusion)

**omp resolves a subagent's model ONLY from settings `task.agentModelOverrides`** (a `Record<agentName, modelId>` in user-global `~/.omp/agent/config.yml`), keyed by the **colon** name `pi-oven:<role>`. Precedence: `task.agentModelOverrides[pi-oven:<role>]` > agent-file `model:` frontmatter > session default (silent fallback). The old `settings.pi-oven` plugin-config namespace is **DEAD and removed** (Spec E / Option C) — never reintroduce per-role model writes there.

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

`/pi-oven:setup --profile` now also sets the main orchestrator model (`modelRoles.default` + `modelRoles.title`), separate from the 24 subagent roles. PROFILE_A pins these to **canonical** ids (`gpt-5.4:high` / `gpt-5.4-mini:low`, no provider prefix): with an empty `modelProviderOrder`, omp resolves them openai-codex-first and falls back to opencode-zen (both providers carry these models). The codex subagent roles get the same primary→fallback ordering via their frontmatter `model:` array (`openai-codex/gpt-5.4` then `opencode-zen/gpt-5.4`). **Profile A writes orchestrator-only overrides** (`modelRoles.default` + `modelRoles.title`); the 24 per-role `task.agentModelOverrides` live in committed agent frontmatter, not written by `--profile A`.

**Rate-limit failover (`retry.fallbackChains`).** A frontmatter `model:` array is **resolution-time only** (omp picks the first available; the second entry is an auth/availability fallback at spawn, plus parent-active-model auth fallback). It is **NOT** a runtime rate-limit failover chain. Runtime failover on `usage_limit`/429 is driven by the `retry.fallbackChains` setting (`Record<modelRoleName, string[]>`, consumed in `agent-session.ts` `#tryRetryModelFallback`); when the provider asks to wait longer than `retry.maxDelayMs` with no model/credential switch, omp fails fast. `/pi-oven:setup --apply` now writes `retry.fallbackChains` for the orchestrator roles (PROFILE_A: `default → [opencode-zen/kimi-k2.6]`, `title → [opencode-zen/gpt-5.4-mini]`; SoT = `PROFILE_A_FALLBACK_CHAINS`/`PROFILE_B_FALLBACK_CHAINS`/`PROFILE_C_FALLBACK_CHAINS`/`PROFILE_D_FALLBACK_CHAINS` in `profiles.ts`, kept OUTSIDE `ProfileMap`). **Limitation:** chains are keyed by **modelRole** and matched against the active model's base selector, so a codex subagent benefits only when its base equals a configured `modelRoles.<role>` (e.g. `openai-codex/gpt-5.4` ↔ `modelRoles.default`); subagents pinned via `task.agentModelOverrides` to a non-matching model are not covered (omp has no agent-keyed fallback chains).

Provider whitelist (enforced at load + CI lint): `opencode-zen/`, `openai-codex/` always; `anthropic/` only if an agent file already declares an `anthropic/*` model.

**PROFILE_B** (openai-codex-only, tiered by thinking level): `openai-codex/gpt-5.5` (xhigh) for the highest-demand reasoning roles; `openai-codex/gpt-5.4` (high) for standard execution roles; `openai-codex/gpt-5.4-mini` (medium) for lighter roles and git-master (gpt-5.4-nano is unsupported and no longer used); vision roles use a vision-capable `openai-codex` model.

**PROFILE_C** (tier-appropriate all-Anthropic): `anthropic/claude-opus-4-8` for high/xhigh roles, `anthropic/claude-sonnet-4-6` for medium roles and for git-master + orchestrator title (haiku-4-5 is unavailable); opencode-zen anthropic equivalents serve as `registry_alternate` in each entry.

**PROFILE_D** (opencode-zen-only): `opencode-zen/kimi-k2.6` for heavy coding and reasoning roles; `opencode-zen/minimax-m2.5` for mid and low-weight roles; `opencode-zen/gemini-3-flash` for vision roles (multimodal-looker, qa-tester). No Anthropic or OpenAI Codex auth required. Writes all 24 per-role `task.agentModelOverrides` on `--profile D`.

**Profiles B, C, and D all write all 24 per-role `task.agentModelOverrides`** on `--profile B/C/D` — a Spec E relaxation covering all non-A profiles. Profile A remains orchestrator-only (its 24 subagent models live in committed frontmatter). Use `--reset` to clear written overrides.

## Conventions / guardrails

- **Skill bodies English-only.** Korean belongs in the runtime keyword whitelist and user-facing docs/examples, not in SKILL body prose.
- **Commit subjects:** what/why only — **no "Plan N" / "Task N"** progress markers. Per-spec semantic commits, not per-task.
- **`git push` requires explicit user confirmation** every time. Autonomous mode never auto-pushes.
- Agent name frontmatter MUST be `pi-oven:<role>` (colon) — equals omp registry key = override key.
- Smallest viable diff; match existing patterns; no external dispatch (`oh-my-claudecode:*` / `omo:*` → 401, they resolve as model strings).
- Big structural change / new spec → `spec-and-review` (codex cross-vendor review loop) before code. Touching code → TDD-strict + `pre-commit-gate`.

## Status

**Current: v0.1.8** — profile model-routing overhaul + new Profile C: Profile A's opencode-zen subagent roles move to cheaper benchmark-validated models (`minimax-m2.5` / `qwen3.5-plus` vision / `kimi-k2.6`), with the main orchestrator on `openai-codex/gpt-5.4` and fallback `opencode-zen/kimi-k2.6`; **Profile C** is new (tier-appropriate all-Anthropic: opus-4-8 / sonnet-4-6 / haiku-4-5), and **Profile B** is redefined as openai-codex-only (gpt-5.5 / gpt-5.4 / gpt-5.4-mini / gpt-5.4-nano by thinkingLevel). Both B and C bulk-write the 24 per-role `task.agentModelOverrides` on `--profile` (Spec E relaxation extended from C to B); Profile A stays orchestrator-only over its committed agent frontmatter. Also fixes `--status` dropping a quoted agent `name:` (metis) and bounds the validate ping with a per-call timeout (slow models no longer hang the wizard). Builds on v0.1.7 (runtime chain enforcement + global-only install + retry.fallbackChains). Version SoT = `package.json` + `.claude-plugin/plugin.json` + `.claude-plugin/marketplace.json`, kept in lockstep by `release:pi-oven` (CI's version-parity step enforces it).

**Release ritual (do before every `release:pi-oven`):** bump the human-facing version refs that the manifest auto-sync does NOT touch — this Status line (`Current: vX`, tag) + `README.md` (the version/tests badges line ~5 and the `# Expected: pi-oven@kzk (X)` line). Then run `release:pi-oven`. CI's version-parity step only checks the three manifests, not this prose, so a stale Status/README will not fail CI — keep them current by hand.

Per-release history → `CHANGELOG.md` + git. This file is the stable guide, not a changelog — don't restate version history here.

## docs/ map

`specs/` design specs (foundation, agent-registry, setup-wizard, skill-rewrite, skill-agent-dispatch, user-local-override) · `plans/` design + execution plans (includes `2026-06-04-agents-omp-native-upgrade-design.md` + `*-plan.md`) · `SOUL.md` project identity.
