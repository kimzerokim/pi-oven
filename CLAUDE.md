# CLAUDE.md — pi-oven

> Project guide for agents working **on** this repo. Terse by design (token budget). Facts here override stale prose in `REVIEW-ME.md`, old specs, and `docs/WORKING-CONTEXT.md` when they conflict.

## What this is

`pi-oven` is a **plugin for omp** (`oh-my-pi`, the pi-coding-agent harness). It is a curated workflow + discipline layer that absorbs the best of 5 sources: **omc** (oh-my-claudecode), **omo** (oh-my-openagent), **Pocock**, **superpowers**, **pi-oven**. Distributed as `pi-oven@pi-oven` (marketplace `pi-oven`).

**Goal: build the optimal agentic workflow that runs natively on omp.** Not a Claude Code plugin — Claude Code interop is a by-product, not maintained.

**Core design principle — heterogeneous models.** Agents do NOT all run on Anthropic. PROFILE_A spreads 22 roles across ~8 model families (codex, gemini-flash, kimi, glm, gpt-nano, opus). Each agent's body must inject an **execution context optimized for its specific model**, not a generic prompt. Model-fit is a first-class concern.

## Layout

| Dir | What | SoT? |
|---|---|---|
| `agents/pi-oven-*.md` | 22 subagent definitions. Frontmatter `name: pi-oven:<role>` (colon), `model:` array, `thinkingLevel`, body = system prompt. | body hand-authored; `model`/`thinkingLevel` derived from profiles.ts |
| `skills/<name>/SKILL.md` | 21 authored skills; runtime loads the 21-skill SoT set from `.claude-plugin/plugin.json`. Bodies **English-only**. | hand-authored |
| `commands/pi-oven-*.md` | 4 command templates exist; runtime registers `/pi-oven:setup`, `/pi-oven:doctor`, `/pi-oven:autonomous` from `plugin.json`. | hand-authored |
| `scripts/pi-oven-setup/` | Setup-wizard CLI modules (TS, bun). | code |
| `scripts/pi-oven-release/` | Release automation modules (version bump, SoT sync, changelog, publish gate). | code |
| `scripts/lint-{agents,skills}.ts` | CI hard lints. | code |
| `.omp/extensions/pi-oven.ts` | omp extension: load-time `validateAgentRegistry` (provider whitelist) + `session_start` parent-model capture. Built to `dist/`. | code |
| `docs/` | specs / plans / decisions / adr / harness / research / instincts / contexts / eval. | see map below |

## Commands (bun)

```
bun run check        # tsc --noEmit
bun test             # 515 pass currently
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
| `openai-codex/gpt-5.3-codex` | high | executor, debugger, test-engineer |
| `openai-codex/gpt-5.4` | xhigh | architect, metis (+ planner alt) |
| `opencode-zen/kimi-k2.6` | med→xhigh | verifier, code-reviewer, code-simplifier, tracer, analyst, librarian |
| `opencode-zen/gemini-3-flash` | medium | explorer, writer, document-specialist, multimodal-looker |
| `opencode-zen/gemini-3.5-flash` | high | qa-tester (vision) |
| `opencode-zen/glm-5.1` | high | designer |
| `opencode-zen/claude-haiku-4-5` | low | git-master (re-validated off gpt-5-nano 2026-05-29) |

Provider whitelist (enforced at load + CI lint): `opencode-zen/`, `openai-codex/` always; `anthropic/` only if an agent file already declares an `anthropic/*` model. **PROFILE_B** (anthropic-promoted opt-in) is **DEFERRED** — do not bump/redefine without explicit user instruction (still on retired `opus-4-7` ids by design).

## Conventions / guardrails

- **Skill bodies English-only.** Korean only for trigger-keyword matching. Specs/plans may be Korean.
- **Commit subjects:** what/why only — **no "Plan N" / "Task N"** progress markers. Per-spec semantic commits, not per-task.
- **`git push` requires explicit user confirmation** every time. Autonomous mode never auto-pushes.
- Agent name frontmatter MUST be `pi-oven:<role>` (colon) — equals omp registry key = override key.
- Smallest viable diff; match existing patterns; no external dispatch (`oh-my-claudecode:*` / `omo:*` → 401, they resolve as model strings).
- Big structural change / new spec → `spec-and-review` (codex cross-vendor review loop) before code. Touching code → TDD-strict + `pre-commit-gate`.

## Status (current — 2026-06-02)

**v0.1.0 is the shipped HEAD/tag, PUSHED to `origin/main`** (commit `6f58e95`, tag `v0.1.0`; CI run 26789877692 green). This is the first push of this line — `origin/main` now serves the full plugin (22 agents + extension). Version SoT unified at **0.1.0** across `package.json` + `.claude-plugin/plugin.json` + `.claude-plugin/marketplace.json`. (v0.1.0 — commit `9278b2a` — had added `/pi-oven:setup` primary-language selection + per-project default-language injection + a global-install script-path fix.)

**v0.1.0 bundles, on top of v0.1.0:** `/pi-oven:setup` accepts a **free-form custom primary language** beyond ko/en (sanitized in `.omp/extensions/pi-oven-runtime/language.ts` `resolveLanguage`; unicode-name whitelist + 40-char cap = the **system-prompt injection boundary**, re-validated on both write and read so a hand-edited `.pi-oven/config.json` cannot poison the prompt). ko/en keep their rich directives; any other language gets a generic English directive. Added a **setup-completion marker** `setupCompletedAt` in `.pi-oven/config.json` (written on `--apply`/`--profile`/`--override`/`--import` success only, cleared by `--reset`) that drives a **once-per-session, non-blocking `ctx.ui.notify` "not set up" notice** at `session_start` (tells the user to run `/pi-oven:setup` or uninstall). README gained a **one-shot copy-paste install block** ending in `omp "/pi-oven:setup"` (install automatic → setup interactive) plus doc-staleness fixes (test count 433→474, submodules 11→13; `commands/pi-oven-setup.md` 23→22 roles). Then added **repo-root `CLAUDE.md` injection**: the runtime extension reads `<repoRoot>/CLAUDE.md` at load (`readProjectInstructions`, fail-open + 256 KB cap) and injects it into the **main + sub** agent system prompt via the `before_agent_start` `RulesInjector` (new dedup key `pi-oven:project-instructions`; default ON, opt out per-project with `.pi-oven/config.json` `{ "projectInstructions": false }`). This fills an omp gap — omp's `claude` discovery provider reads `~/.claude/CLAUDE.md` + `<cwd>/.claude/CLAUDE.md` only, **never the repo-root `CLAUDE.md`** (the Claude Code project-memory convention) — so omp now honors a project's local CLAUDE.md while the global `~/.claude` layer is ignored separately via the user-global `~/.omp/agent/config.yml` knob `disabledProviders: [claude, claude-plugins]` (omp-only; never touches `~/.claude` on disk, so real Claude Code sessions are unaffected). That isolation knob is now first-class in the wizard: **`/pi-oven:setup --isolate`** (and `--no-isolate`) read/merge/write `disabledProviders` via the same `omp config get/set` transport as `task.agentModelOverrides` (`scripts/pi-oven-setup/config-yml.ts` + `isolate.ts`; array-typed, fail-closed read, preserves sibling providers; combinable with `--apply`). README gained an "omp isolation & project CLAUDE.md" section; `skill-flow.ko.html` got an isolation note and had all "new" badges/chips + TOC `✦` markers stripped (the `★` model-routing differentiator marker stays). 515 tests pass.

Historical narrative only:
- **v0.4.x** (`v0.1.0`→`v0.1.0`) — UC5 ops connectors (`aws` / `bitbucket-pipeline` / `cloudflare` skills, read-only inspection with a code-first mutation boundary; credentials via gitignored `.external-credentials`), the `pi-oven_ask` advisor path, relentless brainstorming convergence, off-spine prune; later registered `html-research-orchestrator` + dynamic version test.
- **v0.1.0** — FF merge of `feature/standard-expansion`, first local tag.

Done & local: Plan 0 (v0.1.0) · Plan 1 (v0.1.0, 12 skills) · Spec A (23 agents) · Spec B (setup wizard) · Spec C (15 skills) · Spec D (skill↔agent dispatch, both cycles applied) · **Spec E = FROZEN v3 + implemented** (Option C settings-override; 4 commits `72b7b3a`→`05a3662`; dead-spine grep clean) · v0.1.0 / v0.4.x releases (local) · v0.1.0 (local, `9278b2a`) · **v0.1.0 = HEAD/tag, PUSHED to origin (`6f58e95`)**. Plan 2 (33-skill expansion) = **SUPERSEDED**.

**Remaining work (verified):**
1. **Push to origin = DONE** — v0.1.0 pushed to `origin/main` (HEAD `6f58e95`, tag `v0.1.0`, CI green); first remote publish of this line. Local tags `v0.1.0`→`v0.1.0` remain local-only; only `v0.1.0` is on the remote so far. Version SoT reconciled at 0.1.0 across all three manifests. (Future pushes still need explicit per-push consent.)
2. **Plan 3 omp-native runtime — IMPLEMENTED** (commits f61e091/cc71d03: gate FSM + rules-injector + hardened forbidden-floor). Formal ADR for non-goal closure not yet written.
3. **Plan 4 remainder** — `/pi-oven:doctor` is **fully implemented** (10-check health matrix incl. UC5 ops connector readiness); real-eval pipeline gated on LLM keys (`ci.yml` comment); key onboarding pending.
4. **PROFILE_B redefinition** — deferred (`skill-agent-dispatch.md:267`), user decision.

## docs/ map

`specs/` design specs (foundation, agent-registry, setup-wizard, skill-rewrite, skill-agent-dispatch=Spec D, user-local-override=Spec E) · `plans/` impl plans · `decisions/` + `adr/` decision records · `harness/` `harness-flow-progress.md` (cycle log), `surveys/`, `user-queue.md` · `research/codex-reviews/` critic verdicts · `instincts/` durable facts (omp install layout) · `contexts/` omp mode contexts (autonomous/dev/research/review) · `eval/history/` · `WORKING-CONTEXT.md` (live scratch — may lag).
