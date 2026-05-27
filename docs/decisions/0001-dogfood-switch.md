# Decision 0001 — Dogfood Switch Threshold Met (v0.1.0)

- Date: 2026-05-27
- Status: Accepted

Note on namespacing: `docs/decisions/` is an independent namespace from `docs/adr/`
(architectural decision records). Both start at 0001. No numbering gap — `docs/decisions/`
is empty; this is its first record.

## Decision

After Plan 1 Task 13 acceptance (12 core skills bootstrapped + canary dogfood scenario authored), pi-oven v0.1.0 is sufficient to self-host subsequent migration cycles. From Plan 2 onwards, the main driver of each cycle = omp + installed `pi-oven@pi-oven` plugin (not a Claude Code session driving migration manually).

## Evidence

- 12/12 SKILL.md files present in `skills/<name>/` directories
- `.claude-plugin/plugin.json` lists all 12 skills
- Canary dogfood scenario authored: `evals/dogfood/scenarios/v0.1.0-end-to-end.yaml` (autonomous-loop 3-slot contract + `ask` tool invocation + response substring evidence)
- Smoke + adversarial scenario suites scaffolded across all 12 skills (eval execution deferred to Plan 4 — LLM provider key bootstrap)
- `scripts/run-eval.ts` real implementation TDD-tested (6 bun tests pass, omp SDK `subscribe()` event-aggregation pattern)
- spec-and-review Pattern loop cycle 2 ACCEPT (no BLOCKERs, all 10 cycle-1 BLOCKERs resolved with SDK type evidence)

## Consequences

- Plan 2 cycle setup will install `pi-oven@pi-oven` v0.1.0 in user's omp before starting migration work
- Claude Code session reserved for emergency unblock only (not the primary driver of Plan 2+ cycles)
- Eval execution gate is deferred — Plan 4 will provision LLM provider keys and re-run the full suite for retro-validation
- The dogfood switch is a maturity gate; v0.1.0 is the version under which pi-oven can plausibly improve itself

## Open items for Plan 4

- Provision Codex / Zen / Anthropic-opt-in LLM keys
- Run `bun scripts/run-eval.ts --tag smoke` against all 12 skills (target 12/12 = 100%)
- Run `bun scripts/run-eval.ts --tag adversarial` (target ≥ 10/12 = 83%)
- Run canary `evals/dogfood/scenarios/v0.1.0-end-to-end.yaml` (target 1/1 = 100%)
- Archive results to `docs/eval/history/2026-XX-XX-plan1-{smoke,adv,dogfood}.jsonl`
