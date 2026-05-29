# ADR 0002 — Plan 3 realized as an omp-native hybrid runtime / discipline layer

- **Date:** 2026-05-29
- **Status:** Accepted
- **Supersedes/Reconciles:** `docs/specs/2026-05-27-pi-oven-foundation-design.md` §Plan 3 ("Workflow orchestration TS extension: single autonomous loop + multi-agent team mode + gate state machine + per-agent disallowedTools").
- **Implements:** `docs/specs/2026-05-29-pi-oven-omp-runtime-layer.md` (Spec F, FROZEN, codex+critic PASS) — minimal v1 scope.
- **Context:** Foundation Plan 3 promised a TS orchestration runtime with a hard FSM and per-agent `disallowedTools`. A capability survey of the real omp ExtensionAPI (`node_modules/@oh-my-pi/pi-coding-agent/src/**`) proved parts of that promise are infeasible as specced. This ADR records what was actually built and why the unbuildable parts are reconciled rather than abandoned.

## Decision

Plan 3 is realized as a **4-layer hybrid "soft-deterministic" runtime** inside the existing `.omp/extensions/pi-oven.ts` extension, not as the originally-specced hard FSM. The realized layers (v1 minimal scope):

- **Layer 1 (HARD) — `tool_call` gate.** The single deterministic lever omp exposes (`tool_call` handler returning `{block?, reason?}`) gates `git commit`, `git push`, and an always-on forbidden-command floor (`rm -rf` of repo/HOME roots, production-access patterns). The `rm -rf` floor covers (a) `/` + single-segment absolute roots, (b) symbolic home (`~`/`$HOME`/`${HOME}` + their `…/` prefixes), and (c) any target that — once resolved to an absolute path against the **concrete** repo root (`process.cwd()`) and expanded HOME (`os.homedir()`) — equals or is an ancestor of either (e.g. `rm -rf <repo-root-abs>`, a relative `rm -rf .` from the repo root, an expanded `~`/`$HOME`). The roots are **supplied by the caller** (`gate-handler.ts`, wired in `pi-oven.ts`), keeping `git-normalize.ts` a pure, testable function that reads no process state. A strict SUBDIR cleanup (`rm -rf ./build`) is intentionally NOT flagged (no false-positive on normal cleanup); a `sudo`-prefixed form is a documented residual (not stripped). Modules: `pi-oven-runtime/git-normalize.ts` (pure command normalization), `pi-oven-runtime/gate.ts` (pure decision), `pi-oven-runtime/gate-state.ts` (FSM store), `pi-oven-runtime/gate-handler.ts` (composition + self-deadline + audit).
- **Layer 2 (static) — per-dispatch model/agent control.** Stays static (`task.agentModelOverrides` + agent frontmatter). No new code in v1.
- **Layer 3 (native) — per-agent tool restriction.** Native `tools:` allowlist in each agent `.md`. No deny semantics; restrictions are expressed as a narrower allowlist.
- **Layer 4 (SOFT) — discipline-rule injection.** `pi-oven-runtime/rules-injector.ts` injects a discipline-rule block (named dedup key `pi-oven:discipline-rules@v1`) via `before_agent_start.systemPrompt`, preserves it across compaction via `session.compacting` `preserveData`, and rehydrates from `session_before_compact.branchEntries` / `session_start` hot-context.

The baseline behaviors are preserved unchanged: load-time `validateAgentRegistry` (provider whitelist) and `session_start` parent-model capture.

## What is infeasible-as-specced (and the substitute)

| Foundation Plan 3 promise | Verdict on real omp | Realized substitute |
|---|---|---|
| Per-agent `disallowedTools` (deny list) | **Infeasible** — `disallowedTools` does not exist in omp; only a positive allowlist `agent.tools` enforced at spawn (`task/executor.ts:621-625`). | Layer 3: express restriction as a narrower `tools:` allowlist (deny-by-omission). |
| Hard FSM the model cannot violate at every step | **Infeasible** — `agent_start/end` and `turn_*` are observe-only (no result type, `shared-events.ts:174-197`); there is no "block until verifier dispatched" lever. | Layer 1 hard-blocks only at the `tool_call` boundary (commit/push/forbidden); Layer 4 SOFT re-injects phase/discipline every turn as the substitute for the impossible loop-end block. |
| Per-call model/thinkingLevel override on dispatch | **Infeasible** — no dispatch-rewrite hook; `task` `tool_call` can be observed/blocked but args/model cannot be mutated (`runner.ts` honors only `block`). Confirms ADR 0001:79. | Static `agentModelOverrides` + frontmatter (Layer 2). Per-call selection deferred to Phase 2 (`pi-oven_dispatch` registerTool). |
| Task-dispatch phase-gating | **Infeasible in v1** — native static primitives (`disabledAgents`/`#blockedAgent`/`allowedSpawns`) exist but are static-not-phase-aware; they cannot express "agent X allowed in phase BUILD, blocked in phase VERIFY". | **Phase 2** — moves with the `pi-oven_dispatch` tool. NOT built in v1 (deliberate scope cut, not omission). |

## Critical safety refinement of Spec B2 (the absent ≠ corrupt distinction)

The spec's state-failure policy was refined during implementation and is recorded here as a load-bearing safety decision:

- **The gate is ACTIVE only when the FSM file EXISTS and marks `active: true`** (an autonomous run is in progress).
- **ABSENT file → gate INACTIVE → ALLOW ALL** gated verbs. A normal, non-autonomous dev session has no `.pi-oven/state/autonomous.json` and must NEVER have its commits or pushes blocked by this layer. This is the single most important correctness guarantee: the runtime augments autonomous mode, it does not impose itself on ordinary development.
- **CORRUPT / unreadable-WHEN-PRESENT → fail-CLOSED** for `git commit` / `git push`, with a clear reason. A torn primary is impossible by construction (atomic temp + rename); a present-but-unparseable or schema-invalid primary is the only corrupt case and is treated conservatively.
- **`PI_OVEN_GATE_BYPASS=1`** is the anti-brick escape hatch. It lifts ONLY the gateCache-dependent gates (commit/push) so a corrupt state file can never permanently brick the repo. Every bypass is logged at `warn` for auditability.
- **The forbidden-command floor is ALWAYS-ON**, independent of the FSM (it depends only on the static forbidden set, never on `gateCache`) and is **NOT** lifted by `PI_OVEN_GATE_BYPASS`. Keeping it on during recovery avoids a safety regression.
- **Push consent has per-source lifetime.** The env source (`PI_OVEN_PUSH_CONSENT`) authorizes every push while set (per-process; the operator inline-prefixes a single command to scope it — Layer 1 cannot make an env var single-use). The file source (`.pi-oven/state/push-consent.json`) is single-use via consume-on-use inside the single-writer mutex plus a TTL.
- **Handlers never throw uncaught except the intentional self-deadline fail-closed.** Any unexpected error on a non-gated path fails OPEN so a normal omp session is never broken. The 1500 ms `Promise.race` self-deadline is the only deliberate throw (because `emitToolCall` is un-timed in omp, `runner.ts:614-647`); a thrown handler is converted by omp to `{block:true}` = fail-CLOSED, which is SAFE for the gate.

## Consequences

- Plan 3 is no longer an open decision in `CLAUDE.md` §Status remaining-work item 2: it is implemented as this hybrid runtime, not closed as a non-goal.
- The runtime AUGMENTS `/pi-oven:autonomous` (prose drives the flow; the runtime fail-closes at the tool boundary). They are complementary, not a replacement.
- Git-command gating is **best-effort, not a sandbox.** A documented residual bypass surface remains (heredocs, shell aliases, `$(...)`, `eval`, decode-then-exec, deeper-than-one-level interpreter nesting, a `sudo` prefix — not stripped, so `sudo git commit` / `sudo rm -rf …` are not detected — and `GIT_*` porcelain tricks). This raises the cost of *accidental* discipline violation to ~impossible and the cost of *deliberate* evasion to "the model must construct an obfuscated command" — itself an observable red flag.
- Cross-process / multi-session-on-one-repo concurrency is out of scope (v1 assumes single-machine single-session). The single-writer mutex + mtime stale-cache invalidation cover the in-process case.
- Phase 2 work is explicitly deferred: the `pi-oven_dispatch` registerTool path, per-call model override, and task-dispatch phase-gating.

## Alternatives Considered

- **A true hard FSM enforced at every step** — rejected as infeasible (observe-only lifecycle events; no loop-end block). Honestly scoped in Spec F §2 rather than pretended at.
- **Per-agent `disallowedTools`** — rejected as absent in omp; substituted by the `agent.tools` allowlist (Layer 3).
- **A hook (not an extension) for Layer 4** — rejected: `deliverAs:'nextTurn'` is defined only on the extensions API, not the hooks API (Spec F §3 Layer 4 / N5).
- **Blocking ALL commits whenever state is unreadable, including absent** — rejected: it would brick every normal dev session that has no `.pi-oven/` state. Replaced by the absent ≠ corrupt refinement above.

## Spec / Evidence Reference

- Spec: `docs/specs/2026-05-29-pi-oven-omp-runtime-layer.md` (FROZEN v3, codex+critic PASS).
- Verdict: `docs/research/codex-reviews/2026-05-29-pi-oven-omp-runtime-layer-critic-review.md`.
- Capability survey: `docs/harness/surveys/2026-05-29-discovery-harvest.jsonl`.
- omp ExtensionAPI source (in-repo dependency): `node_modules/@oh-my-pi/pi-coding-agent/src/**` (file:line citations in Spec F §2).
