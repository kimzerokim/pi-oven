# CLAUDE.md — pi-oven runtime contract

> Compact instructions for agents working on this repository. Maintainer and release procedures live in `docs/maintainers/handbook.md`.

## Mission and invariants

`pi-oven` is an omp (`oh-my-pi`) workflow plugin. It is not a Claude Code plugin; Claude Code compatibility is incidental. The shipped baseline is codex-only and each agent prompt must remain optimized for its assigned role/model.

- Runtime dispatch names MUST be `pov:<role>` for the 24 shipped roles. Never dispatch `pi-oven:<role>` or `kzk:<role>`.
- OMP `task` is the single dispatch seam. Pi-oven may target wide dependency-safe waves, but `async.enabled`, `task.maxConcurrency`, and provider/runtime admission determine actual concurrency.
- The workflow-skill namespace is `pov:<skill>` and runtime-mandated reads must use the exact plugin-owned `SKILL.md` target supplied by the extension. `/pi-oven:*` is only the slash-command surface; `pi-oven@kzk` is only the install identity.
- The DEFAULT_PROFILE model map in `scripts/pi-oven-setup/profiles.ts` is the source baseline for agent models, thinking levels, and tool policy. `agents/pov-*.md` frontmatter is derived; agent bodies are hand-authored and preserved by generation.
- Project routing in `<cwd>/.omp/settings.json` overrides global routing. Never restore the removed `settings.pi-oven` routing namespace.
- Parent sessions receive project instructions. Workers receive only their compact role/assignment/skill/safety capsule, never this whole document.

## Repository map

| Path | Contract |
|---|---|
| `agents/pov-*.md` | 24 packaged agent definitions; runtime-visible as `pov:<role>` |
| `skills/<name>/SKILL.md` | authored workflow skills; bodies are English-only |
| `commands/*.md` | `/pi-oven:<basename>` command templates; filenames must not use a `pi-oven-` prefix |
| `.omp/extensions/pi-oven.ts` | runtime registry validation and extension wiring; bundled to `dist/` |
| `.omp/extensions/pi-oven-runtime/` | runtime contracts, gates, prompt composition, and ledgers |
| `scripts/pi-oven-setup/` | setup/status/reset implementation |
| `scripts/pi-oven-release/` | reproducible release checks and publishing helpers |
| `docs/specs/`, `docs/plans/` | design source and execution plans |

## Required workflow

Use the smallest viable diff and preserve existing patterns. Read every exact skill target selected for the turn before substantive action. For code changes, follow `pov:tdd-strict`; before commit, follow `pov:pre-commit-gate`. Large structural changes or new specs require `pov:spec-and-review`.

Core verification commands:

```sh
bun run check
bun test
bun run lint:agents
bun run lint:skills
bun run build
```

Run focused tests first, then the proportional broader gate. `bun run eval` requires configured model credentials and is not a substitute for deterministic tests.

## Runtime conduct and safety

- Skill precedence: pi-oven skills are authoritative. Do not load same-purpose `superpowers:*`, `oh-my-claudecode:*`, or `agentmemory:*` skills.
- Tool use: inspect code with language/structural tools where available, reproduce behavior before fixing it, and verify with real commands. For external API or library facts, search and read primary sources. Inspect images rather than inferring from filenames.
- Do not speculate about runtime behavior. Keep agent bodies' omp-native tool directives intact and update `DEFAULT_PROFILE` with any frontmatter tool-policy change.
- Never put secrets in source, logs, fixtures, or command text. External infrastructure mutations require the user's explicit current-message authorization.
- `git push` always requires explicit user confirmation. Autonomous mode never pushes.
- Never use destructive repository/HOME-root deletion. Preserve unrelated worktree changes.
- Commit subjects describe what and why; do not use plan/task progress markers.

The extension's parent-only orchestrator conduct governs skill-first execution, pending-user-question stops, and autonomous-mode boundaries. The runtime-owned `deepInterview -> approvalFlow` boundary governs final-spec persistence and approval handoff. The runtime gate and capability policy are authoritative for exact write, commit, push, and external-effect decisions.

## Setup and routing boundary

Setup persists only that codex-only routing surface. Global and project scopes write all 24 `task.agentModelOverrides` entries, orchestrator `modelRoles`, `skills.includeSkills = ["pov:*"]`, and an empty `retry.fallbackChains`. The legacy `--profile` flag is accepted but ignored. `--override` and `--import` accept only `openai-codex/<model>[:effort]` selectors.

Setup/status/doctor are visibility and persistence surfaces; the runtime owns current-session provider selection. Use `pi-oven_ask` for semantic user decisions: `askAboutChoices` for bounded choices, with free-text `other` only when it is genuinely valid.

Status and doctor MUST consume `collectRuntimeTruthSurface()` rather than reconstructing contract facts. Its public labels are only `PASS`, `WARN`, `FAIL`, and `NOT RUN`; missing live-canary evidence is `NOT RUN`, never PASS. Recovery hints must be copy-pasteable and neither surface may perform destructive repair. The historical native-team layer is removed; OMP `task` owns dispatch.

## Maintainer boundary

Do not copy release versions, test counts, generated inventories, or historical status into this runtime contract. `package.json.version` is the release source of truth; generated surfaces and the immutable marketplace ref are validated from it. See `docs/maintainers/handbook.md` for generation, release, and historical procedures; use `CHANGELOG.md` and git for per-release history.
