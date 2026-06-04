# CLAUDE.md — pi-oven

> Project guide for agents working **on** this repo. Terse by design (token budget). Facts here override stale prose in old specs when they conflict.

## What this is

`pi-oven` is a **plugin for omp** (`oh-my-pi`, the pi-coding-agent harness). It is a curated workflow + discipline layer that absorbs the best of 4 sources: **omc** (oh-my-claudecode), **omo** (oh-my-openagent), **Pocock**, **superpowers**. Distributed as `pi-oven@kzk` (marketplace `kzk`).

**Goal: build the optimal agentic workflow that runs natively on omp.** Not a Claude Code plugin — Claude Code interop is a by-product, not maintained.

**Core design principle — heterogeneous models.** Agents do NOT all run on Anthropic. PROFILE_A spreads 24 roles across ~6 models / 3 providers (anthropic opus · openai-codex gpt-5.4 · opencode-zen gemini-flash/glm/haiku). Each agent's body must inject an **execution context optimized for its specific model**, not a generic prompt. Model-fit is a first-class concern.

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
bun test             # 598 pass currently
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
| `opencode-zen/gemini-3-flash` | medium / high | explorer, writer, document-specialist, multimodal-looker, deep-researcher |
| `opencode-zen/gemini-3.5-flash` | high | qa-tester (vision) |
| `opencode-zen/glm-5.1` | med→xhigh | designer, verifier, code-reviewer, code-simplifier, tracer, analyst, librarian |
| `opencode-zen/claude-haiku-4-5` | low | git-master (re-validated off gpt-5-nano 2026-05-29) |

`/pi-oven:setup --profile` now also sets the main orchestrator model (`modelRoles.default` + `modelRoles.title`), separate from the 24 subagent roles. PROFILE_A pins these to **canonical** ids (`gpt-5.4:high` / `gpt-5.4-mini:low`, no provider prefix): with an empty `modelProviderOrder`, omp resolves them openai-codex-first and falls back to opencode-zen (both providers carry these models). The codex subagent roles get the same primary→fallback ordering via their frontmatter `model:` array (`openai-codex/gpt-5.4` then `opencode-zen/gpt-5.4`).

Provider whitelist (enforced at load + CI lint): `opencode-zen/`, `openai-codex/` always; `anthropic/` only if an agent file already declares an `anthropic/*` model. **PROFILE_B** (anthropic-promoted opt-in) is **DEFERRED** — do not bump/redefine without explicit user instruction (still on retired `opus-4-7` ids by design).

## Conventions / guardrails

- **Skill bodies English-only.** Korean belongs in the runtime keyword whitelist and user-facing docs/examples, not in SKILL body prose.
- **Commit subjects:** what/why only — **no "Plan N" / "Task N"** progress markers. Per-spec semantic commits, not per-task.
- **`git push` requires explicit user confirmation** every time. Autonomous mode never auto-pushes.
- Agent name frontmatter MUST be `pi-oven:<role>` (colon) — equals omp registry key = override key.
- Smallest viable diff; match existing patterns; no external dispatch (`oh-my-claudecode:*` / `omo:*` → 401, they resolve as model strings).
- Big structural change / new spec → `spec-and-review` (codex cross-vendor review loop) before code. Touching code → TDD-strict + `pre-commit-gate`.

## Status

**Current: v0.1.6** — skill activation contract: skills surface to the model via their `description:` WHEN-conditions (model-initiated `skill://` reads), supplemented by a curated `SKILL_KEYWORD_WHITELIST` in the runtime extension (`.omp/extensions/pi-oven-runtime/skill-keyword-loader.ts`); trigger lists stripped from all 22 frontmatter descriptions, replacing the false "keyword auto-trigger" promise. Builds on v0.1.5 (setup Skill-usage guard) + v0.1.4 (`pi-oven_ask` single-select) + v0.1.3 (doctor 11-check). Version SoT = `package.json` + `.claude-plugin/plugin.json` + `.claude-plugin/marketplace.json`, kept in lockstep by `release:pi-oven` (CI's version-parity step enforces it).

**Release ritual (do before every `release:pi-oven`):** bump the human-facing version refs that the manifest auto-sync does NOT touch — this Status line (`Current: vX`, tag) + `README.md` (the version/tests badges line ~5 and the `# Expected: pi-oven@kzk (X)` line). Then run `release:pi-oven`. CI's version-parity step only checks the three manifests, not this prose, so a stale Status/README will not fail CI — keep them current by hand.

Per-release history → `CHANGELOG.md` + git. This file is the stable guide, not a changelog — don't restate version history here.

## docs/ map

`specs/` design specs (foundation, agent-registry, setup-wizard, skill-rewrite, skill-agent-dispatch, user-local-override) · `plans/` design + execution plans (includes `2026-06-04-agents-omp-native-upgrade-design.md` + `*-plan.md`) · `SOUL.md` project identity.
