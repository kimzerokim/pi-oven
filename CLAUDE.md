# CLAUDE.md — pi-oven

> Project guide for agents working **on** this repo. Terse by design (token budget). Facts here override stale prose in old specs when they conflict.

## What this is

`pi-oven` is a **plugin for omp** (`oh-my-pi`, the pi-coding-agent harness). It is a curated workflow + discipline layer that absorbs the best of 4 sources: **omc** (oh-my-claudecode), **omo** (oh-my-openagent), **Pocock**, **superpowers**. Distributed as `pi-oven@kzk` (marketplace `kzk`).

**Goal: build the optimal agentic workflow that runs natively on omp.** Not a Claude Code plugin — Claude Code interop is a by-product, not maintained.

**Core design principle — codex-only DEFAULT_PROFILE.** The shipped DEFAULT_PROFILE baseline maps all 24 roles to `openai-codex` primaries. Setup persists only that codex-only routing surface; the legacy `--profile` flag is accepted for backward compatibility and ignored. Each agent's body must inject an **execution context optimized for its specific model**, not a generic prompt. Model-fit is a first-class concern.

## Layout

| Dir | What | SoT? |
|---|---|---|
| `agents/pi-oven-*.md` | 24 shipped agent definition files. These are package/source artifacts; the runtime-visible agent namespace is `pov:<role>`. Frontmatter `model:` array + `thinkingLevel`, body = system prompt. | body hand-authored; `model`/`thinkingLevel` derived from profiles.ts |
| `skills/<name>/SKILL.md` | 23 authored skills; runtime loads the 23-skill SoT set from `.claude-plugin/plugin.json`, publishes them on the visible skill surface as `pov:<skill>`, exposes them via description discovery, and supplements them with a curated runtime keyword whitelist in the extension. Bodies **English-only**. | hand-authored |
| `commands/*.md` | 3 command templates (setup, doctor, release). omp registers each as `/pi-oven:<basename>` via the Claude Code Marketplace provider, which namespaces marketplace commands as `<plugin>:<file-basename>` — command files MUST NOT carry a `pi-oven-` prefix. Autonomous mode is entered by matching the `pov:autonomous-loop` runtime keyword whitelist (no command required). | hand-authored |
| `scripts/pi-oven-setup/` | Setup-wizard CLI modules (TS, bun). | code |
| `scripts/pi-oven-release/` | Release automation modules (version bump, SoT sync, changelog, publish gate). | code |
| `scripts/lint-{agents,skills}.ts` | CI hard lints. | code |
| `.omp/extensions/pi-oven.ts` | omp extension: load-time `validateAgentRegistry` (provider whitelist) + `session_start` parent-model capture. Built to `dist/`. | code |
| `docs/` | design specs + project identity (`SOUL.md`). | see map below |

## Commands (bun)

```
bun run check        # tsc --noEmit
bun test             # full repo test suite
bun run lint:agents  # agents/*.md frontmatter == DEFAULT_PROFILE source baseline
bun run lint:skills  # SKILL.md role refs stay aligned with the shipped roster; /pi-oven: slash refs excluded
bun run build        # bundle .omp/extensions/pi-oven.ts -> dist/
bun run eval         # scripts/run-eval.ts (needs LLM keys — gated, see Status)
bun run release:pi-oven -- --bump patch --dry-run  # release automation (safe default)
```

## Model routing — READ THIS (most common source of confusion)

**omp resolves per-role model routing from settings `task.agentModelOverrides`** (a `Record<agentName, modelId>`), deep-merged across layers; precedence (low→high): agent-file `model:` frontmatter < global `~/.omp/agent/config.yml` `task.agentModelOverrides` < **project `<projectRoot>/.omp/settings.json` `task.agentModelOverrides`** < runtime CLI flag; an unset role falls through to the session default (silent fallback). The user-facing runtime namespace is `pov:<role>`; `/pi-oven:*` stays the slash-command surface and `pi-oven@kzk` stays the install identity. The old `settings.pi-oven` plugin-config namespace is **DEAD and removed** (Spec E / Option C) — never reintroduce per-role model writes there.

**Project layer (`<projectRoot>/.omp/settings.json`).** omp loads this file at `level:"project"` (discovered from `<cwd>/.omp/`, the launch dir — no git-root ancestor walk) and **deep-merges it over** the global `config.yml`: record-typed settings (`task.agentModelOverrides`, `modelRoles`) merge key-by-key, so an unlisted role still inherits from global; **arrays replace** (so `retry.fallbackChains` is replaced, not concatenated). A project override therefore beats even the committed DEFAULT_PROFILE source baseline — by design. `/pi-oven:setup --scope project` writes the codex-only per-project routing here: all 24 per-role overrides, `skills.includeSkills = ["pov:*"]`, `modelRoles`, and an empty `retry.fallbackChains`; language + the setup-complete marker go to `<cwd>/.pi-oven/config.json`. The file is committable (share routing with a team) or gitignorable (machine-local); memory/async infra stays global-only.

**SoT chain:** `scripts/pi-oven-setup/profiles.ts` (`DEFAULT_PROFILE`) → `agents/pov-*.md` frontmatter → `lint-agents.ts` enforces equality. These files are source baselines, while the runtime-visible dispatch namespace remains `pov:<role>`. Agent `model`/`thinkingLevel` frontmatter is a **derived artifact** — change it in `profiles.ts`, then maintainer-only `--apply` regenerates frontmatter. `agent-rewriter.ts` **preserves the body verbatim** (only frontmatter `model:`+`thinkingLevel` lines change) → **editing agent prose bodies is safe** and never clobbered by `--apply`/lint.

**Personal override (no git dirt):** users run `/pi-oven:setup --override <role>=<model>` → writes one per-role override entry for the selected runtime role into `~/.omp/agent/config.yml` (machine-global, uncommitted). Agent files remain untouched.

### DEFAULT_PROFILE model map (release default), grouped by model family

| Model | thinkingLevel | Roles |
|---|---|---|
| `openai-codex/gpt-5.5` | high / xhigh | executor, verifier, critic, planner, code-reviewer, debugger, test-engineer, security-reviewer, code-simplifier, tracer, analyst, architect, oracle, metis, deep-researcher |
| `openai-codex/gpt-5.4` | medium / high | explorer, writer, designer, qa-tester, git-master, document-specialist, librarian, multimodal-looker, data-runner |

`/pi-oven:setup --apply` sets the main orchestrator model (`modelRoles.default` + `modelRoles.title`) to `openai-codex/gpt-5.4:high` and `openai-codex/gpt-5.4:medium`. Runtime `retry.fallbackChains` is explicitly empty. **The default profile writes all 24 per-role `task.agentModelOverrides` entries for the runtime-visible `pov:*` roles** plus the orchestrator roles on both global and project scope; committed agent frontmatter remains the release-default SoT. `--profile` remains a backward-compatible no-op that resolves to the same DEFAULT_PROFILE.

`--override` and `--import` accept only `openai-codex/<model>[:effort]` selectors. Use `--reset` to clear written overrides.
## Agent tool discipline + orchestrator conduct

**Every agent body mandates its omp native tools** in omp-official `<directives>`/`<procedure>` MUST/SHOULD/NEVER style. Three tool-class mandates enforced across all 24 agents:

- **Code/debug** roles (executor, debugger, tracer, test-engineer, analyst, code-reviewer, architect, oracle, code-simplifier, security-reviewer, verifier, data-runner, metis): MUST use `lsp` (diagnostics, goto-def, find-refs) and `ast_grep` (structural search) over plain reading/grep; MUST use `eval` to reproduce/inspect runtime and `bash` to run failing build/tests; debug-first roles (debugger, tracer) MUST use `debug` for runtime stepping; NEVER speculate about code behavior.
- **Research/web** roles (deep-researcher, document-specialist, librarian, explorer, writer, planner, designer): for any external/library/API/doc question, MUST use `web_search` and read source; NEVER answer from training data — **source is truth, training data is history**; fall back to `web_search` before reporting "not found".
- **Vision** roles (multimodal-looker, qa-tester): MUST use `inspect_image` to view screenshots/images; NEVER infer from filenames.

**`tools:`/`blocked_tools` are a `profiles.ts` SoT** enforced by `lint-agents.ts` (JSON equality vs `DEFAULT_PROFILE[role]`) and by `profiles.test.ts`. Widening a role's `tools:` requires editing the DEFAULT_PROFILE tool policy and the agent file in lockstep — a tools edit to only the agent file fails `bun run lint:agents` with "tools drift from profiles.ts". `blocked_tools` is UNCHANGED for every role. `agent-rewriter.ts` preserves bodies verbatim under `--apply`, so editing agent prose is safe.

**Setup (global scope) force-enables 6 omp tool flags** via `setToolEnablementConfig` in `apply.ts` so the body mandates have teeth: `inspect_image.enabled=true` (default false — blocks vision agents without this), `web_search.enabled=true`, `lsp.enabled=true`, `astGrep.enabled=true`, `browser.enabled=true`, `debug.enabled=true`. `eval` is ungated (omp has no `eval.enabled` key). These flags are written every global-scope run. `--reset --full` leaves them — they are omp-global infra, not pi-oven routing.

**The extension injects a standing PARENT-ONLY orchestrator-conduct block** every turn (dedup key `pi-oven:orchestrator-conduct@v2`) via `buildOrchestratorConductBlock` in `rules-injector.ts`, wired in `pi-oven.ts` with the `autonomousActive` flag (reusing `needsAutonomousReminder`). Interactive mode: SKILL-FIRST (load skill before acting) + WAIT-FOR-USER (pending question = hard stop) + ASK-WHEN-AMBIGUOUS. Autonomous mode: SKILL-FIRST only; WAIT/ASK rules suspended (boundary contract governs instead, via the `needsAutonomousReminder` carve-out).

**Skill/agent routing (conduct `@v2` + plugin-owned target invariant).** pi-oven keyword matching resolves each shipped skill through `shipped-skill-registry.ts` to an exact plugin-owned `SKILL.md` file target, and `skill-keyword-loader.ts` injects those concrete targets into the runtime keyword block. **Invariant: pi-oven runtime conduct MUST tell agents to read those exact `SKILL.md` file targets and MUST NOT invent skill aliases.** Public skill names on the visible workflow-skill surface are `pov:<skill>`, and the visible runtime agent namespace is `pov:<role>`; `/pi-oven:*` entries are commands, not skills or agent names. `/pi-oven:setup` follows `commands/setup.md`. The gate read-detector (`gate-handler.ts getSkillReadName`) still recognizes the legacy `skill://pi-oven:` alias for bookkeeping compatibility. In-body skill refs may still use documented reference links, but live mandatory reads come from owned file targets. The conduct block also carries two hard rules (both modes): **SKILL PRECEDENCE** (pi-oven skills authoritative; never load same-purpose `superpowers:*`/`oh-my-claudecode:*`/`agentmemory:*`) and **AGENT NAMING** (dispatch only `pov:<role>`; legacy `pi-oven:<role>` is stale migration feedback only, never a healthy runtime path; never `kzk:<role>` — `kzk` is the marketplace catalog name, not an agent namespace). Workflow-skill ownership is established through `skills.includeSkills = ["pov:*"]`; populated user skill folders are filtered, not treated as provider-disable state.

**Setup/help/runtime boundary.** `/pi-oven:setup`, `/pi-oven:setup --status`, and `/pi-oven:doctor` are visibility/guard surfaces only; they may report or persist routing config, but runtime still owns the current-session provider-family choice. The visible runtime agent+skill namespace stays `pov:*`; `/pi-oven:*` stays the slash-command surface and `pi-oven@kzk` stays the package install identity. The sanctioned deep-interview completion path persists the final spec and seeds root `approvalFlow` state; once that receipt exists, approval may stay pending after `deepInterview.phase = "complete"`. `pi-oven_ask` affordances are semantic: use `askAboutChoices` for approval/routing clarification branches, and enable `other` only when free text is a genuinely valid next action.
## Conventions / guardrails

- **Skill bodies English-only.** Korean belongs in the runtime keyword whitelist and user-facing docs/examples, not in SKILL body prose.
- **Commit subjects:** what/why only — **no "Plan N" / "Task N"** progress markers. Per-spec semantic commits, not per-task.
- **`git push` requires explicit user confirmation** every time. Autonomous mode never auto-pushes.
- Runtime dispatch names MUST be `pov:<role>`; `/pi-oven:*` is reserved for slash commands, and `pi-oven@kzk` is install identity.
- Smallest viable diff; match existing patterns; no external dispatch (foreign namespaced refs / `omo:*` → 401, they resolve as model strings).
- Big structural change / new spec → `pov:spec-and-review` (codex cross-vendor review loop) before code. Touching code → `pov:tdd-strict` + `pov:pre-commit-gate`.

## Status

**Current: v0.2.3** — ships codex-only DEFAULT_PROFILE routing, runtime skill pruning with deferred obligations, and the manual runtime injection benchmark.

**Release ritual (do before every `release:pi-oven`):** bump the human-facing version refs that the manifest auto-sync does NOT touch — this Status line (`Current: vX`, tag) + `README.md` (the version/tests badges line ~5 and the `# Expected: pi-oven@kzk (X)` line). Then run `release:pi-oven`. CI's version-parity step only checks the three manifests, not this prose, so a stale Status/README will not fail CI — keep them current by hand.

Per-release history → `CHANGELOG.md` + git. This file is the stable guide, not a changelog — don't restate version history here.

## docs/ map

`specs/` design specs (foundation, agent-registry, setup-wizard, skill-rewrite, skill-agent-dispatch, user-local-override) · `plans/` design + execution plans (includes `2026-06-04-agents-omp-native-upgrade-design.md` + `*-plan.md`) · `SOUL.md` project identity.
