# Changelog

## v0.1.19 - 2026-06-29

- fix(runtime): stop setup from triggering unresolved namespaced skill reads
- test(runtime): remove stale TUI mocks so the full suite uses the installed API
- docs(release): bump human-facing refs to v0.1.19

## v0.1.18 - 2026-06-26

- docs(release): bump human-facing refs to v0.1.18
- feat(runtime): gate external execution on explicit consent
## v0.1.17 - 2026-06-25

- docs(plan): add pi-oven-first tracking design and plan
- Align pi-oven ask theme test fixture
- test: fix pi-oven runtime typing
- Fix pi-oven ask symbol theme typing
- test(runtime): lock mixed-registry pi-oven-first ownership
- feat(setup): align pi-oven-first policy surfaces
- feat(runtime): fail-close automatic skill ownership outside pi-oven
- feat(runtime): enforce pi-oven-first agent dispatch ownership
- feat(runtime): add ownership resolution state contract
## v0.1.16 - 2026-06-23

- merge: runtime reliability hardening
- feat(runtime): harden new-user reliability and tool exposure
- Align project apply truth surface
- Harden standalone runtime reliability
## v0.1.15 - 2026-06-18

- fix: use omp models in setup flow
## v0.1.14 - 2026-06-18

- fix(runtime): stop `/pi-oven:setup` ask UI from reading the coding-agent global theme singleton; build markdown/select-list themes from the callback-provided UI theme instead
- fix(commands): quote `/pi-oven:setup` and `/pi-oven:release` `argument-hint` frontmatter so interactive command loading reaches the first setup prompt cleanly

## v0.1.13 - 2026-06-18

- fix(setup): route Profile B main orchestrator to `openai-codex/gpt-5.4:high` for the 1M OpenAI Codex context window
- fix(setup): keep Profile B runtime fallback chains empty so OpenAI-subscription setup does not route through OpenCode Zen

## v0.1.12 - 2026-06-18

- fix(setup): remove unsupported `omp --max-tokens` flag from model smoke validation

## v0.1.11 - 2026-06-18

- fix(runtime): namespaced `skill://pi-oven:<name>` injection so pi-oven skills resolve before sibling plugins
- feat(setup): add sibling-skill suppression switch for global setup
- feat(profiles): tune Profile B for Codex Pro/20x with `gpt-5.5`/`gpt-5.4` model selectors and reasoning-effort suffixes

## v0.1.10 - 2026-06-08

- feat(setup): project-scoped model routing & per-project setup
- feat(agents,runtime): omp tool discipline & orchestrator conduct
## v0.1.9 - 2026-06-05

- docs(release): bump human-facing version refs to v0.1.9
- fix(profiles,setup): enabled-only models A/B/C/D + Profile D + robust validation + global onboarding/language
- docs(setup): fix stale Profile B (now openai-codex-only) + per-role override refs
## v0.1.8 - 2026-06-05

- docs(release): bump human-facing version refs to v0.1.8
- feat(profiles): redefine A/B/C model routing — cheaper A, openai-codex B, anthropic C
- feat(setup): add Profile C (all-Anthropic) + bump PROFILE_B to opus-4-8
- fix(setup): parse quoted agent name in status + bound validate ping timeout
## v0.1.7 - 2026-06-04

- docs(release): bump human-facing version refs to v0.1.7
- docs: note retry.fallbackChains routing + drop stale syncPiOvenAgentMirrors gitignore comment
- test(runtime): cover gate-handler pure helper functions
- refactor(runtime): remove dead agent-mirror sync and stream-of-consciousness comments
- fix(lint): enforce tools/blocked_tools consistency as the real capability boundary
- feat(setup): write retry.fallbackChains so codex orchestrator roles fail over to opencode-zen
- docs(plans): spec + plan for session-findings fixes (fallback, blocked_tools, dead code)
- fix(setup,runtime): restore per-project language/marker writers, keep install detection global-only
- feat(runtime,setup): enforce skill-chain gates and global install policy
- feat(skills,agents): wire omp power-tools, make research subagent-driven, de-phantom refs
- fix(eval): run authed with a fast default model + load workspace extension
- feat: add ISO timestamp formatting utilities
## v0.1.6 - 2026-06-04

- feat(skills): omp-native skill activation contract — description discovery + keyword whitelist
- docs(setup): correct stale "22 roles" to 24 in prompt, comments, tests
## v0.1.5

- `/pi-oven:setup` adds a "Skill usage" guard: the orchestrator must drive setup from `setup.md` alone and must not invoke other skills mid-flow, keeping the language-pick → provider-detect → profile → persist sequence deterministic.

## v0.1.4

- **Fix: `/pi-oven:setup` language picker showed a bogus `unused: unused` question and aborted.** Root cause: `pi-oven_ask` exposed a batch/`questions[]` mode that no caller ever used, and orchestrator models mis-called it — emitting a degenerate batch call with `unused` placeholder id/question, then cancelling. Removed batch mode entirely: `pi-oven_ask` is now single-select only (one `question` + `options`; ask multiple questions by calling it multiple times). Dropped `questions[]`/`multi`/`formatBatchResult`/`summarizeBatchAnswer`/`askBatch` and the v0.1.3 batch-result formatting (it served only the now-removed mode). `commands/setup.md` Step 0 simplified to a plain two-argument call with no mode language.

## v0.1.3

- `pi-oven_ask` batch results now surface the actual selection in the visible tool text instead of a generic "User answered N questions": a single-question batch renders `User selected: <label>` or `User provided custom input: <value>` (newlines normalized), and multi-question batches list each `id: <summary>`. This makes the `/pi-oven:setup` Step 0 single-question contract readable — the wizard reads the choice back from the visible text. Adds `summarizeBatchAnswer` + tests; `commands/setup.md` Step 0 documents reading `details.selected` / `details.customInput` with the visible-text fallback.

## v0.1.2

- `/pi-oven:setup` now resolves the agent files from the script's own install location (`import.meta.dir`) instead of the caller's cwd, so `--status` shows the real per-role model defaults for users who installed pi-oven globally (previously every role rendered `(no agent file)` outside the dev checkout). Adds `resolveDefaultAgentsDir` (script-relative → install-cache → graceful fallback); the apply path's maintainer-vs-user mode selector is unchanged.
- `/pi-oven:doctor` is now a true **11-check** matrix: implemented the documented check #11 (memory / killer-tools — mnemopi backend + async readiness, WARN-only) that `pi-oven-doctor.ts` had never run.
- Fixed a doctor false-FAIL: the script's `SOT_SKILL_PATHS` list was missing `memory-discipline` (21 vs the real 22), so check #6 reported `plugin.json skills[] diverges from SoT` on a healthy install. `commands/doctor.md` check #7 also corrected from `count == 22` to `24`.
- Documentation drift sweep: README test badge + counts (563/42 → 600/45), `CLAUDE.md` status, and `docs/site/skill-flow.ko.html` (version stamps v0.1.0/v0.1.1 → v0.1.2, doctor 10-check → 11-check) brought back in line with the SoT.

## v0.1.1

- Wired the 4 core flows so their skills chain sequentially: `autonomous-loop` now names `subagent-driven-development` as the execution orchestrator, routes bug→`systematic-debugging` / refactor→`improve-codebase-architecture` / deep-investigation→`deep-dive`, and runs the promised self-improvement `skills/+agents/+commands/+evals/` sweep before planner/spec.
- Bug-fix flow: `systematic-debugging` ↔ `deep-dive` escalation, `pre-commit-gate` + `fresh-verifier` exit gates, and a `pi-oven:code-reviewer` second-stage review.
- Refactoring flow: `improve-codebase-architecture` is now the single refactor entry point (Step 0 type-detection) with `tdd-strict` behavior preservation, a `code-quality-discipline` candidate gate, and `pi-oven:code-reviewer`; `code-quality-discipline` routes architectural refactors to it.
- Spec stage: `brainstorming` gains an explicit 15–100 question budget (floor of 15, ceiling of 100), a `codebase-survey` precondition guardrail, and external-docs dispatch; `spec-and-review` makes external research prescriptive with a trigger heuristic.
- Added eval scenarios for `systematic-debugging`, `improve-codebase-architecture`, autonomous bug/refactor/self-improvement routing, and spec-and-review web research.
- Trigger keywords: added English keywords to `codebase-survey` and `large-task-delegation` (previously Korean-only).
- `pi-oven_ask` now renders the focused option's full (wrapped, multi-line) description below the picker, and brainstorming authors substantive 1–3 sentence option rationales.
- Eval harness now actually runs headless in omp: `run-eval` auto-approves tool calls (was hanging on approval), captures output from the completed assistant message (was capturing nothing), and honors `--model` for a fast eval model.
- `docs/site/skill-flow.ko.html` updated to the v0.1.1 wiring (new 5.5 refactoring diagram, work-type routing, exit gates) with the complete trigger-keyword set per skill.
- `.omp/agents` mirror is now gitignored — it is regenerated from the SoT `agents/` on every session and was never a load source.

## v0.1.0

- Initial release: curated omp workflow + discipline layer (4-source successor: omc / omo / Pocock / superpowers).
- 22 self-contained agents under the `pi-oven:` namespace, 21 runtime-loaded skills, `/pi-oven:setup` / `/pi-oven:doctor` / `/pi-oven:release` commands, and the omp runtime extension (repo-CLAUDE.md injection + discipline gate FSM).
