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

---

## v0.1.0 Boost (2026-05-28 update)

The dogfood baseline has been substantially strengthened since the v0.1.0 decision above. This section records the boost; the original decision remains valid (omp + installed plugin = primary driver from Plan 2 onwards).

### What changed

| Layer | v0.1.0 | v0.1.0 |
|---|---|---|
| Agent registry | external dispatch via `oh-my-claudecode:*` (caused 401 failure mode) | 23 file-based `pi-oven-*` agents in `agents/` |
| Model routing | unverified `models.yml` reference, no enforcement | provider whitelist (opencode-zen + openai-codex + anthropic opt-in) + load-time validator + CI hard lint |
| Setup | manual provider config per user | `/pi-oven:setup` wizard — LLM-driven Profile A/B selection + drift detection |
| Skills | 12 with `oh-my-claudecode:*` refs + Korean prose | 15 self-contained with `pi-oven:*` only + English-only bodies |
| External dependency | runtime dependency on omc dispatch | **zero** — superpowers refs are citation-only |

### v0.1.0 evidence

- 23 agent files at `agents/pi-oven-*.md` (Spec A acceptance)
- `/pi-oven:setup` wizard with 8 subcommands (Spec B acceptance)
- 15 skills under `skills/` (Spec C acceptance, post v0.1.0's 12)
- 3 new skills added: `deep-init`, `deep-dive`, `team`
- 2 skill boosts: `autonomous-loop` (autopilot + ralph + ultrawork patterns), `fresh-verifier` (verify + verification-before-completion + no-self-verification rule)
- 152 bun tests pass (from 18 at v0.1.0)
- `scripts/lint-agents.ts` CI hard lint enforces `model:` presence on every agent file
- session_start drift detection in `.omp/extensions/pi-oven.ts` (warns when agent files diverge from persisted plugin config)

### What the boost does NOT change

- The v0.1.0 dogfood switch threshold is still met — that decision stands.
- Plan 2 still runs inside omp + installed plugin, NOT inside a Claude Code session.
- LLM provider keys are still per-user responsibility (Profile A or B selection at `/pi-oven:setup`).
- The auth-fallback whitelist hole (Spec A §6.3, Spec B documented limitation) is still present.

### Implications for ongoing work

- Future Plan 2+ cycles SHOULD use the v0.1.0 agent registry + wizard. The Profile B path becomes useful for users with Anthropic Pro/Max subscriptions; Profile A remains the universal default.
- The `0002-...` decision namespace remains available for future explicit baseline shifts (e.g., when dogfood expands to multi-user collaboration or external-team adoption).

### Source of truth for model routing

`scripts/pi-oven-setup/profiles.ts` (`PROFILE_A` / `PROFILE_B`) is the canonical source for the per-role `model` array and `thinkingLevel`. Agent files under `agents/pi-oven-*.md` are derived artifacts written by `agent-rewriter.ts` during `/pi-oven:setup --apply` and must not be hand-edited; `scripts/lint-agents.ts` enforces the alignment at CI time and `tests/scripts/pi-oven-setup/profiles.test.ts` checks that PROFILE_A and PROFILE_B share `thinkingLevel` per role. A dynamic dispatch-time router was evaluated and rejected — omp's `ExtensionAPI` does not expose a subagent-dispatch hook capable of overriding `model` / `thinkingLevel` per call.

