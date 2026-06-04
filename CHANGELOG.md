# Changelog

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
