# 2026-06-04 — Session findings fixes design

## Status
Approved direction (user): fix all problems discovered this session. Work on
branch `feature/skill-chain-enforcement`, direct commits, NO PR.

Source evidence: `docs/plans/2026-06-04-open-problems-survey.md` plus this
session's verifier/security/code-review findings.

## Problems in scope

### P1 — Model rate-limit failover does not happen (headline)
Symptom: codex subagents hit `usage_limit_reached` with a ~30-min retry-after and
fail fast with `Provider requested 1800000ms wait, exceeds retry.maxDelayMs
(300000ms)` instead of falling over to opencode-zen.

Root cause (verified against omp source):
- Agent frontmatter `model: [...]` arrays are resolution-time only
  (`resolveAgentModelPatterns` picks first available; `model-resolver.ts:778-792`
  is an AUTH fallback, not a rate-limit fallback). They are NOT runtime failover
  chains.
- Runtime rate-limit failover is `retry.fallbackChains`
  (`settings-schema.ts:876`, consumed in `agent-session.ts:7561-7731`,
  fail-fast at `:7900-7911`). It is **empty by default** (`{}`), keyed by
  **modelRole name**, with the primary read from `settings.getModelRole(role)`.
- pi-oven's setup wizard configures `modelRoles` + `task.agentModelOverrides`
  but never `retry.fallbackChains`, so no failover is ever configured.

Fix:
- Setup wizard writes `retry.fallbackChains` for the orchestrator model roles
  (`default`, `title`) so the primary codex selector fails over to its
  opencode-zen equivalent.
- Because `#resolveRetryFallbackRole` matches the active model's base selector
  (`provider/id`) against `getModelRole(role)`, a codex subagent whose resolved
  base equals `modelRoles.default`'s base ALSO benefits (executor/planner on
  `openai-codex/gpt-5.4` match `modelRoles.default = gpt-5.4`). This is the exact
  failure class we hit.
- Honest limitation documented: subagents pinned (via `agentModelOverrides`) to a
  model whose base does NOT match a configured `modelRoles` selector are not
  covered — that is an omp limitation (no agent-keyed fallback chains today),
  not something this repo can fully fix.

PROFILE_A model roles (canonical, `profiles.ts:254-257`):
- `default: "gpt-5.4:high"` → fallback `["opencode-zen/gpt-5.4"]`
- `title: "gpt-5.4-mini:low"` → fallback `["opencode-zen/gpt-5.4-mini"]`

(opencode-zen carries both ids per CLAUDE.md provider notes. Chain selectors are
provider-qualified and omit thinkingLevel so the candidate inherits the current
level — `agent-session.ts:7692`.)

### P2 — `blocked_tools` is a dead/advisory field (false security boundary)
Root cause: omp's `ParsedAgentFields` has no `blocked_tools`; omp ignores it. The
pi-oven runtime cannot drop an agent's tools at `before_agent_start` (the payload
carries no agent identity/tool list — `agent-registry.md:981-984`). The ONLY
enforced boundary is the frontmatter `tools:` allowlist. A role with
`tools: ["*"]` therefore has full capability regardless of `blocked_tools` — this
is exactly how the read-only agents were momentarily escalated this session.

Fix (lint-enforced invariant, since runtime enforcement is impossible):
- `lint-agents.ts` adds two hard checks against the effective frontmatter:
  1. A role MUST NOT declare `tools: ["*"]` together with a non-empty
     `blocked_tools` (a `*` grant silently ignores the block — contradiction).
  2. `tools ∩ blocked_tools` MUST be empty (no tool both granted and blocked).
- Document in `docs/specs/2026-05-28-pi-oven-agent-registry.md` that `tools:` is
  the only enforced boundary and `blocked_tools` is advisory/documentation that
  lint keeps consistent.

This makes the read-only/authoring split tamper-evident: future drift that
re-grants `*` to a constrained role fails CI.

### P3 — Dead code + AI-slop in the runtime extension
- `syncPiOvenAgentMirrors` (`.omp/extensions/pi-oven.ts:193-240`) has no runtime
  or CLI caller (survey §2); only `tests/extensions/pi-oven.test.ts:208-275`
  references it. It mirrors agents to a PROJECT-LOCAL dir, which also contradicts
  the global-only policy. Remove the function, its export, and its tests.
- Stream-of-consciousness comments around `captureSessionModel`
  (`pi-oven.ts:274-279`) and the mirror-removal note must be deleted / replaced
  with a single concise comment.

### P4 — Test gaps for runtime helpers
`gate-handler.ts` helpers `isCodeWriteTool`, `getTargetPath`, `getSkillReadName`,
`toGateFsmView` are only covered indirectly. Add focused unit tests (export the
pure helpers if needed for testability).

### Verified, no action
- session-model JSON `{model, capturedAt}` shape matches all consumers (survey
  §3) — no change.

## Non-goals
- Implementing omp agent-keyed fallback chains (harness-side).
- Removing `blocked_tools` from frontmatter entirely (kept as documented advisory).
- Re-litigating the global-only install / per-project language decisions (already
  shipped + reverted to the conservative state).

## File-by-file change surface
- `scripts/pi-oven-setup/profiles.ts` — add per-profile `retryFallbackChains`
  (or derive from modelRoles); export for setup + tests.
- `scripts/pi-oven-setup/config-yml.ts` — add `setRetryFallbackChains` writer
  (mirrors `setModelRoles`, `:300-319`).
- `scripts/pi-oven-setup/apply.ts` — call the writer in `runApply` (`:63-80`)
  alongside `setModelRoles`.
- `scripts/lint-agents.ts` — add the two `blocked_tools`/`tools` invariants
  (near existing checks `:156-188`).
- `.omp/extensions/pi-oven.ts` — delete `syncPiOvenAgentMirrors` + export; clean
  the AI-slop comments.
- `tests/extensions/pi-oven.test.ts` — remove syncPiOvenAgentMirrors tests.
- `docs/specs/2026-05-28-pi-oven-agent-registry.md` — blocked_tools advisory note.
- `CLAUDE.md` — model-routing section: note `retry.fallbackChains` is now set by
  setup and the subagent failover limitation.
- New/updated tests:
  - `tests/scripts/pi-oven-setup/config-yml.test.ts` (or existing) —
    `setRetryFallbackChains`.
  - `tests/scripts/pi-oven-setup-cli.test.ts` / apply test — fallbackChains
    written on `--apply`.
  - `tests/scripts/lint-agents.test.ts` — the two new invariants (pass + fail).
  - `tests/extensions/pi-oven-runtime/gate-handler.test.ts` — helper unit tests.

## Testing strategy
- Unit: config-yml writer round-trip; apply writes fallbackChains; lint invariant
  pass/fail cases; gate-handler helper behaviors.
- Full suite (`bun test`) MUST be green; `bun run check`, `bun run lint:agents`,
  `bun run lint:skills` MUST pass.
- After commit, `bun run build` to refresh local `dist/` (untracked; runtime
  reflection only).

## Commit strategy
Per-spec semantic commits on `feature/skill-chain-enforcement`, no PR:
1. fallback chain config (P1)
2. blocked_tools lint invariant + docs (P2)
3. dead-code/slop removal (P3)
4. helper tests (P4)
(Or fewer cohesive commits if changes are small; never one giant commit.)

## Risks
- Wrong fallback selector ids → failover no-ops. Mitigation: provider-qualify,
  unit-test the written config, validate against `parseRetryFallbackSelector`
  rules (provider/id[:thinking]).
- Removing syncPiOvenAgentMirrors could break agent placement IF setup relied on
  runtime mirroring. Mitigation: survey confirms no caller; agent resolution is
  via the global plugin cache (`cache-resolver.ts`), not runtime mirroring.
