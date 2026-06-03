# Changelog

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
