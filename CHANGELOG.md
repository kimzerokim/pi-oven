# Changelog

## v0.1.1

- Wired the 4 core flows so their skills chain sequentially: `autonomous-loop` now names `subagent-driven-development` as the execution orchestrator, routes bug→`systematic-debugging` / refactor→`improve-codebase-architecture` / deep-investigation→`deep-dive`, and runs the promised self-improvement `skills/+agents/+commands/+evals/` sweep before planner/spec.
- Bug-fix flow: `systematic-debugging` ↔ `deep-dive` escalation, `pre-commit-gate` + `fresh-verifier` exit gates, and a `pi-oven:code-reviewer` second-stage review.
- Refactoring flow: `improve-codebase-architecture` is now the single refactor entry point (Step 0 type-detection) with `tdd-strict` behavior preservation, a `code-quality-discipline` candidate gate, and `pi-oven:code-reviewer`; `code-quality-discipline` routes architectural refactors to it.
- Spec stage: `brainstorming` gains an explicit ~50-question cap, a `codebase-survey` precondition guardrail, and external-docs dispatch; `spec-and-review` makes external research prescriptive with a trigger heuristic.
- Added eval scenarios for `systematic-debugging`, `improve-codebase-architecture`, autonomous bug/refactor/self-improvement routing, and spec-and-review web research.

## v0.1.0

- Initial release: curated omp workflow + discipline layer (4-source successor: omc / omo / Pocock / superpowers).
- 22 self-contained agents under the `pi-oven:` namespace, 21 runtime-loaded skills, `/pi-oven:setup` / `/pi-oven:doctor` / `/pi-oven:release` commands, and the omp runtime extension (repo-CLAUDE.md injection + discipline gate FSM).
