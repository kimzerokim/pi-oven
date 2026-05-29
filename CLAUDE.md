# CLAUDE.md — pi-oven

> Project guide for agents working **on** this repo. Terse by design (token budget). Facts here override stale prose in `REVIEW-ME.md`, old specs, and `docs/WORKING-CONTEXT.md` when they conflict.

## What this is

`pi-oven` is a **plugin for omp** (`oh-my-pi`, the pi-coding-agent harness). It is a curated workflow + discipline layer that absorbs the best of 5 sources: **omc** (oh-my-claudecode), **omo** (oh-my-openagent), **Pocock**, **superpowers**, **pi-oven**. Distributed as `pi-oven@pi-oven` (marketplace `pi-oven`).

**Goal: build the optimal agentic workflow that runs natively on omp.** Not a Claude Code plugin — Claude Code interop is a by-product, not maintained.

**Core design principle — heterogeneous models.** Agents do NOT all run on Anthropic. PROFILE_A spreads 23 roles across ~8 model families (codex, gemini-flash, kimi, glm, gpt-nano, opus). Each agent's body must inject an **execution context optimized for its specific model**, not a generic prompt. Model-fit is a first-class concern.

## Layout

| Dir | What | SoT? |
|---|---|---|
| `agents/pi-oven-*.md` | 23 subagent definitions. Frontmatter `name: pi-oven:<role>` (colon), `model:` array, `thinkingLevel`, body = system prompt. | body hand-authored; `model`/`thinkingLevel` derived from profiles.ts |
| `skills/<name>/SKILL.md` | 15 skills (+ `references/`, eval scenarios). Bodies **English-only**. | hand-authored |
| `commands/pi-oven-*.md` | `/pi-oven:setup`, `/pi-oven:doctor`, `/pi-oven:autonomous` (LLM prompt templates). | hand-authored |
| `scripts/pi-oven-setup/` | Setup-wizard CLI modules (TS, bun). | code |
| `scripts/lint-{agents,skills}.ts` | CI hard lints. | code |
| `.omp/extensions/pi-oven.ts` | omp extension: load-time `validateAgentRegistry` (provider whitelist) + `session_start` parent-model capture. Built to `dist/`. | code |
| `docs/` | specs / plans / decisions / adr / harness / research / instincts / contexts / eval. | see map below |

## Commands (bun)

```
bun run check        # tsc --noEmit
bun test             # 195 pass currently
bun run lint:agents  # agents/*.md frontmatter == PROFILE_A + colon-name invariant
bun run lint:skills  # SKILL.md pi-oven:<role> refs ∈ ROLES; /pi-oven: slash refs excluded
bun run build        # bundle .omp/extensions/pi-oven.ts -> dist/
bun run eval         # scripts/run-eval.ts (needs LLM keys — gated, see Status)
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
| `openai-codex/gpt-5.4` | xhigh | scientist, architect, metis (+ planner alt) |
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

## Status (current — 2026-05-29)

Branch `feature/standard-expansion`. **Nothing pushed.** `origin/main` ships **zero agents** (`agents/.gitkeep` only). Tags: **v0.1.0 only**.

Done & local: Plan 0 (v0.1.0) · Plan 1 (v0.1.0, 12 skills) · Spec A (23 agents) · Spec B (setup wizard) · Spec C (15 skills) · Spec D (skill↔agent dispatch, both cycles applied) · **Spec E = FROZEN v3 + implemented** (Option C settings-override; 4 commits `72b7b3a`→`05a3662`; dead-spine grep clean). Plan 2 (33-skill expansion) = **SUPERSEDED**.

**Remaining work (verified):**
1. **Release cutover** (gated on user) — merge v0.1.0 to `main`, resolve **version SoT split** (`package.json` 0.1.0 vs `plugin.json`/`marketplace.json` 0.1.0), tag v0.1.0, release. Needs push consent + main-merge decision (PR vs direct).
2. **Plan 3 decision** — foundation spec defined Plan 3 = TS orchestration runtime (`foundation-design.md:121`), but `/pi-oven:autonomous` is intentionally LLM-driven, no TS state machine (`pi-oven-autonomous.md:75`). Decide: implement OR close as formal non-goal + ADR.
3. **Plan 4 remainder** — `/pi-oven:doctor` is still a Plan-0 stub (`pi-oven-doctor.md:8`); real-eval pipeline gated on LLM keys (`ci.yml` comment); key onboarding.
4. **PROFILE_B redefinition** — deferred (`skill-agent-dispatch.md:267`), user decision.

## docs/ map

`specs/` design specs (foundation, agent-registry, setup-wizard, skill-rewrite, skill-agent-dispatch=Spec D, user-local-override=Spec E) · `plans/` impl plans · `decisions/` + `adr/` decision records · `harness/` `harness-flow-progress.md` (cycle log), `surveys/`, `user-queue.md` · `research/codex-reviews/` critic verdicts · `instincts/` durable facts (omp install layout) · `contexts/` omp mode contexts (autonomous/dev/research/review) · `eval/history/` · `WORKING-CONTEXT.md` (live scratch — may lag).
