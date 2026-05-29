# Spec F: pi-oven omp-native runtime / discipline layer (Plan 3 reconciliation)

**Status**: FROZEN v3 pending re-review — v2 re-review returned CONTINUE (5/6 v1 blockers resolved); v3 applies the consistency fixes: B2a (`PI_OVEN_GATE_BYPASS` scoped to gateCache-dependent commit/push only — forbidden-command floor always-on), B2b (`PI_OVEN_PUSH_CONSENT` env = per-process, single-use enforced only by the file source via consume-on-use), AC3 (rehydration data-flow corrected — `before_agent_start` carries NO `branchEntries`; preserved rules read from `session_before_compact`/`session_start`, re-injected via `before_agent_start.systemPrompt`), plus 2 NITs (real source path `node_modules/@oh-my-pi/pi-coding-agent/src/**`; AC6 partial-write reconciled with the atomic temp+rename guarantee). Architecture, ACs, and evidence otherwise intact. Verdict source: `docs/research/codex-reviews/2026-05-29-pi-oven-omp-runtime-layer-critic-review.md`. Central architecture validated sound + honestly scoped by both reviewers; pushbacks P1/P4/P5 preserved.
**Supersedes/Reconciles**: `docs/specs/2026-05-27-pi-oven-foundation-design.md` §Plan 3 (defined as "Workflow orchestration TS extension: single autonomous loop + multi-agent team mode + gate state machine + per-agent disallowedTools"). This spec corrects what is literally feasible against omp's real ExtensionAPI.
**Inputs (evidence)**: discovery `wf_74c81aad-c7b` omp-capability survey (harvest `docs/harness/surveys/2026-05-29-discovery-harvest.jsonl`, `.canEnforce`/`.evidence`); `docs/decisions/0001-dogfood-switch.md:79`; `.omp/extensions/pi-oven.ts` (177 lines, baseline = 1 hook + 1 load-time call). All file:line evidence below verified against the real omp source at `node_modules/@oh-my-pi/pi-coding-agent/src/**` (the in-repo dependency; `external_harness/` is NOT checked into this repo) and bundled types `node_modules/@oh-my-pi/pi-coding-agent/dist/types/**`. The file:line numbers below verify against that real path.
**Absorbs (imports)**: omo `rules-injector` + multi-hook coordination; ECC compaction/memory-persistence hooks; pre-execution-gate pattern (discovery Track 2 P0).

---

## §1 Goal

Reduce the autonomous workflow's reliance on each (heterogeneous, non-Anthropic) model *remembering* to follow discipline, by moving enforcement from prose instructions to a TS runtime that hard-blocks at the only deterministic lever omp exposes. The user's thesis: pure LLM-driven flow is too sensitive to per-model instruction-following; tool-boundary enforcement is model-independent.

**Non-goal**: a true hard FSM the model cannot violate at every step. Survey proves this is impossible in omp today (see §2).

**v1 scope (DECIDED, §5.2)**: **minimal** — gate `git commit`, `git push`, and a forbidden-command set at the `tool_call` boundary only. Task-dispatch phase-gating is **Phase 2** (§3 Layer 2, §7). This is a deliberate scope cut, not an omission.

---

## §2 omp capability facts (LOCKED — survey evidence, file:line, verified v2)

All paths relative to the real omp source root `node_modules/@oh-my-pi/pi-coding-agent/src/`.

| Capability | Verdict | Evidence |
|---|---|---|
| Gate state machine (block tool actions) | ✅ YES via `tool_call` hook | `extensibility/shared-events.ts:265-270` `ToolCallEventResult={block?,reason?}`; `extensibility/extensions/wrapper.ts:145-165` emits `tool_call` before EVERY tool (incl. `task`) and honors `callResult.block` (`:155`) |
| per-agent `disallowedTools` (deny list) | ❌ absent in omp | grep `disallowedTools` = 0; only positive allowlist `agent.tools` (`task/executor.ts:621-625`), enforced at spawn |
| Block "until verifier dispatched" | ❌ `agent_start/end`,`turn_*` observe-only | `extensibility/shared-events.ts:174-197` (no result type). Substitute: Layer-4 `sendMessage(deliverAs:'nextTurn', triggerTurn:true)` re-injection |
| per-call model/thinkingLevel override | ❌ no dispatch-rewrite hook | static `task.agentModelOverrides[agentName]` (`task/index.ts:648-649`) + frontmatter + parent precedence; confirms ADR 0001:79. `setModel/setThinkingLevel` session-global only |
| subagent-dispatch interception | ⚠️ observe + block only, cannot rewrite | `task` tool fires `tool_call` with `params.agent` visible (`task/index.ts:222,303,333`); `emitToolCall` (`extensibility/extensions/runner.ts:614-647`) honors only `block`, cannot mutate args/model |
| native static agent gating primitives | ⚠️ exist, **static-not-phase-aware** | `task.disabledAgents` settings filter (`task/index.ts:255,618-625`); `#blockedAgent` from `$env.PI_BLOCKED_AGENT` recursion-prevention (`task/index.ts:273,794-799`); parent `allowedSpawns` (`task/index.ts:812-816`). None are phase-aware — they cannot express "agent X allowed in phase BUILD, blocked in phase VERIFY". This is why phase-gating needs Layer 1 logic, deferred to Phase 2. |
| `tool_call` handler timeout | **NONE** | `emitToolCall` (`extensibility/extensions/runner.ts:614-647`) `await`s the handler **directly** at `:624` — the ONLY emit path not wrapped by `#runHandlerWithTimeout` (compare `:547,581,668,703,740,782,812,843,869`). The 30s `EXTENSION_HANDLER_TIMEOUT_MS` (`extensibility/extensions/runner.ts:63`) applies to session/turn/agent/context emits only. **Split, per P2/P3:** a *thrown* error fail-CLOSES the gated tool (`{block:true}`, `extensibility/extensions/runner.ts:641`) — SAFE for the gate; a *hung* handler deadlocks the agent forever — DANGEROUS for the agent. → Layer 1 MUST self-impose an internal deadline (see §3 Layer 1, B1). |

---

## §3 Design — 4-layer hybrid "soft-deterministic" runtime

### Layer 1 — Gate state machine (HARD, the real win) [B1, B2, B3, B4]

Layer 1 is registered as a single `tool_call` handler inside the extension (`.omp/extensions/pi-oven.ts`). It owns a persisted FSM in `.pi-oven/state/autonomous.json` (`{ phase, gateCache, dispatchLog, version, schemaVersion }`), updated by observing `tool_result`/`turn_end` + file writes. The handler is the only hard lever; everything below is its contract.

**Self-deadline (B1).** Because `emitToolCall` is un-timed (§2 row 7), the handler MUST wrap ALL of its own work in an internal `Promise.race` against a **1500 ms** deadline. On overrun the handler **throws**, which omp converts to `{block:true}` (`extensibility/extensions/runner.ts:641`) — fail-CLOSED. Rationale for 1500 ms: comfortably above the p95 cache-hit budget (§6 AC2) so legitimate lookups never trip it, yet low enough that a wedged FS or pathological input cannot deadlock the agent. One number, picked: **1500 ms**. The handler must NEVER run the full gate suite inline — only a precomputed cache lookup + cheap command normalization.

**Gated actions (minimal v1 scope, §5.2):**
- `Bash` whose normalized command (see B3) contains a `git commit` verb → `{block:true, reason}` unless `gateCache.commit === "PASS"`. Mirrors the pi-oven `pre-commit-gate` skill, now machine-enforced.
- `Bash` whose normalized command contains a `git push` verb → `{block:true, reason}` unless the push-consent flag is set (§5.4 schema).
- `Bash` whose normalized command matches the forbidden set (`rm -rf` of repo/HOME roots, prod-access patterns per `production-access`) → `{block:true, reason}`.
- (Phase 2 only — NOT v1) `task` dispatch phase-gating: inspect `params.agent`, block agents disallowed in the current phase.

**State failure policy (B2).** The state file is the single point of brittleness, so the read path is hardened:
- **Atomic write**: every FSM mutation writes `autonomous.json.tmp` then `rename()`s over `autonomous.json` (POSIX atomic same-dir rename). A partial write therefore never produces a torn primary file; a crash leaves a stale-but-valid primary plus an orphan `.tmp` (ignored on read).
- **Read failure = fail-CLOSED for commit/push** (the dangerous verbs): corrupt JSON (`JSON.parse` throw), missing file, or a primary that fails schema validation all yield `{block:true, reason: "pi-oven state unreadable; gate fail-closed"}`. Forbidden-command checks remain enforced (they do not depend on `gateCache`, only on the static forbidden set).
- **Escape hatch (B2, anti-brick)**: env var `PI_OVEN_GATE_BYPASS=1` (process env, read fresh on every handler invocation) bypasses **only the gateCache-dependent gates — `git commit` and `git push`** — so a corrupt state file can never permanently brick the repo. The operator sets it, runs `git commit`/`git push` to recover, then unsets it. **The forbidden-command floor (`rm -rf` of repo/HOME roots, prod-access patterns) is ALWAYS-ON and is NOT bypassed**, even under `PI_OVEN_GATE_BYPASS=1`: it does not depend on `gateCache` (only on the static forbidden set), so corrupt state never requires it to be lifted, and keeping it on avoids a safety regression during recovery. The bypass is logged (`pi.logger.warn`) on every gated commit/push tool so its use is auditable.
- A bypassed or fail-closed decision NEVER mutates state (read-only failure path).

**Concurrency / single-writer (B4).** `tool_call` fires before every tool including those issued by task-spawned subagents, so multiple writers can race the single state file:
- **Single-writer rule**: only the parent session's extension instance mutates `autonomous.json`. Subagent `tool_call` events are still *gated* (read-only cache lookup) but never *write* the FSM. Writes are serialized through an in-process async mutex (promise chain) inside the extension so two events in the same process cannot interleave a read-modify-write.
- **Stale-cache invalidation rule**: the in-memory cache carries the source file's `mtimeMs`. On every gated lookup the handler `stat()`s the file; if `mtimeMs` advanced past the cached value, the cache is re-read before the decision. This makes an out-of-band gate-runner write (e.g. the pre-commit suite writing `gateCache.commit="PASS"`) visible to the next `tool_call` without restart.
- Cross-process safety (two omp processes on one repo) is out of v1 scope; documented as a known limitation (single-machine single-session assumption).

**Git-command normalization (B3, best-effort + documented residual).** String matching `"git commit"` is trivially bypassable, so Layer 1 normalizes before matching:
1. Tokenize the command (shell-aware split: respect quotes; split on `;`, `&&`, `||`, `|`, newlines into sub-commands; strip a leading `env VAR=val` prefix).
2. For each sub-command, resolve a leading interpreter wrapper one level: `bash -c '...'`, `bash -lc '...'`, `sh -c '...'`, `zsh -c '...'` → recurse on the inner string. (One level; deeper nesting is residual surface.)
3. Detect the `git` program even with options: `git -C <dir> commit`, `git --git-dir=... commit`, `git -c key=val commit` → locate the first non-option token after `git` as the verb. Match verbs `commit` and `push`.
4. **Residual bypass surface (documented, best-effort by design)**: heredocs feeding `git` via stdin, shell aliases/functions resolved at the user's rc, `$(...)` command substitution producing the verb, `eval`, writing a script file then executing it, base64/printf-decoded commands, and `git`-equivalent porcelain via `GIT_*` env tricks. Layer 1 does NOT claim to be a sandbox. The honest framing: this raises the cost of *accidental* discipline violation by a cooperating-but-forgetful model to ~impossible, and the cost of *deliberate* evasion to "the model has to actively construct an obfuscated command" — which is itself an observable red flag. We accept this residual rather than pretend at a security boundary omp cannot provide.

The LLM physically cannot run a gated tool through the normal path because the tool refuses to run. **Budget caveat**: the gate cache must be precomputed/fast; the full suite never runs inside the hook (enforced by the 1500 ms self-deadline).

### Layer 2 — Per-dispatch model/agent control
- **Default (ship now)**: static — `task.agentModelOverrides[pi-oven:<role>]` (settings, `task/index.ts:648-649`) + agent frontmatter `model:` (Spec E mechanism, already built). No new code.
- **Phase 2 (DEFERRED, §5.1)**: register `pi-oven_dispatch` via `pi.registerTool` that drives subagents through the omp SDK with an extension-chosen model+thinkingLevel per call — the ONLY path to genuine per-call selection. Cost: reimplements dispatch/worktree/merge the built-in `task` tool already provides. Also the home of task-dispatch **phase-gating** (the FSM blocks dispatch of an agent disallowed in the current phase), which native static primitives (`disabledAgents`/`#blockedAgent`/`allowedSpawns`, §2 row 6) cannot express. **Decision: defer** unless per-call model selection or phase-gating proves necessary.

### Layer 3 — Per-agent tool restriction
Native allowlist `tools:` in each agent .md (`task/executor.ts:621-625`, enforced at spawn). No deny semantics — express restrictions as a narrower allowlist. (plan-mode precedent.)

### Layer 4 — Reminder/steering (SOFT)
**MUST be implemented as an extension, not a hook** (N5): `deliverAs:'nextTurn'` is defined only on the extensions `sendMessage`/context API (`extensibility/extensions/types.ts:966,1150` accept `"steer"|"followUp"|"nextTurn"`); the hooks API (`extensibility/hooks/types.ts:529`) accepts only `"steer"|"followUp"`. Layer 4 uses `before_agent_start.systemPrompt` + `context.messages` replacement + `sendMessage(deliverAs:'nextTurn')` to inject the current FSM phase + discipline rules every turn — the substitute for the impossible "block loop end until verifier ran" (`shared-events.ts:174-197` observe-only, P5). **This is where the omo `rules-injector` pattern is absorbed**: a session-cached rule store + transcript hydration + post-compaction re-injection so discipline rules survive compaction without redundant re-application. **Rehydration data-flow (no fictional event shape):** preserved rules are emitted via `session.compacting` `preserveData`, land in a `CompactionEntry`, and are read back from `session_before_compact` (`SessionBeforeCompactEvent.branchEntries`) or `session_start` hot-context; they are then **re-injected via `before_agent_start.systemPrompt`** (which carries only `prompt`/`images`/`systemPrompt`, NOT `branchEntries`). See §4 for the cited field references.

---

## §4 Absorbed import mechanisms (Track 2 P0)
- **rules-injector** (omo `src/hooks/rules-injector`) → Layer 4 rule store + hydration, as an extension module (N5).
- **multi-hook coordination** → extension grows from its baseline **1 hook + 1 load-time `validateAgentRegistry` call** (N6, verified `.omp/extensions/pi-oven.ts:152,156`) to the coordinated set: `tool_call` (Layer 1), `tool_result`/`turn_end` (FSM observation), `before_agent_start`, `context`, `session.compacting`/`session_start` (Layer 4 + persistence).
- **compaction/memory-persistence** (ECC) → persist + rehydrate FSM state and hot rules across compaction. The real data-flow: a `session.compacting` handler returns `preserveData` (`SessionCompactingResult.preserveData?: Record<string, unknown>`, `extensibility/shared-events.ts:328`), which lands in a `CompactionEntry` (a `SessionEntry`); that entry is surfaced back to extensions at the **next** compaction via `SessionBeforeCompactEvent.branchEntries` (`extensibility/shared-events.ts:64,69` — `SessionBeforeCompactEvent` with `branchEntries: SessionEntry[]`). Re-injection into the live turn is then done through `before_agent_start.systemPrompt` (`extensibility/extensions/types.ts:450,454` event `systemPrompt: string[]`; `:774,777` result `systemPrompt?: string[]`). NOTE: `before_agent_start` carries **only** `prompt`/`images`/`systemPrompt` — it does **NOT** carry `branchEntries`; preserved rules are read from `session_before_compact`/`session_start` hot-context, not from `before_agent_start`. Plus session-manager persistence (relevant for long heterogeneous-model sessions).

---

## §5 Open questions — RESOLVED (decided defaults; user may override)
1. **Phase 2 custom `pi-oven_dispatch` tool** — **DECIDED: DEFER.** Stay static (`agentModelOverrides` + frontmatter). Revisit only if per-call model selection or phase-gating proves necessary. Task-dispatch phase-gating moves with it to Phase 2.
2. **Scope of gated tools** — **DECIDED: minimal** = `git commit` + `git push` + forbidden-commands only. Task-dispatch phase-gating is Phase 2. §1/§6 aligned to this scope.
3. **Relationship to `/pi-oven:autonomous`** — **DECIDED: AUGMENT, not replace.** The extension *enforces* (hard tool-boundary block); the `/pi-oven:autonomous` prompt still *drives* the flow. The prose template and the runtime are complementary: prose steers, runtime fail-closes.
4. **Push-consent flag schema (B2/N4)** — **DECIDED** (see §5.4 below).
5. **State dir** — `.pi-oven/state/` (gitignored) confirmed as FSM home.

### §5.4 Push-consent flag schema (DECIDED)
Ties to MEMORY "push-confirm required" policy: push is blocked at the runtime level unless an explicit, short-lived, auditable consent is present.
- **Name**: `PI_OVEN_PUSH_CONSENT` (env var) — primary source.
- **Source**: process env, set by the operator immediately before an intended push (e.g. `PI_OVEN_PUSH_CONSENT=<git-ref-or-token> git push ...`). Fallback file source `.pi-oven/state/push-consent.json` `{ grantedAt, expiresAt, branch }` for non-Bash-env flows.
- **Lifetime (per-source semantics).** The two consent sources have deliberately different lifetimes:
  - **Env source (`PI_OVEN_PUSH_CONSENT`) — per-process / per-invocation, NOT single-use.** An exported env var authorizes *every* push while it remains set (there is no consume step that can unset another process's environment). The operator is therefore instructed to **inline-prefix a single command** (`PI_OVEN_PUSH_CONSENT=<ref> git push ...`) rather than `export` it, so the grant is scoped to that one invocation. Layer 1 does not — and cannot — make an env var single-use.
  - **File source (`.pi-oven/state/push-consent.json`) — single-use + TTL, enforced by Layer 1.** On an authorized push the handler performs a **consume-on-use** step: it deletes the file (or marks it `used:true`) within the single-writer mutex *before* returning the allow decision, so a second push verb finds no valid consent and is blocked. The file additionally expires at `expiresAt` (default `grantedAt + 5 min`); an expired file is treated as absent.
  Layer 1 does NOT auto-persist consent — it never writes a fresh grant of its own, and the file grant is never sticky across pushes (consumed on first use).
- **Audit**: every push decision (granted or blocked) is `pi.logger.info`-logged with the consent source and the target branch (best-effort parse from the normalized command). `PI_OVEN_GATE_BYPASS` is logged at `warn` and is orthogonal: it bypasses **only the gateCache-dependent gates (`git commit` + `git push`)** and is intended only for state-corruption recovery. The forbidden-command floor (`rm -rf` of repo/HOME, prod-access) is **NOT** lifted by `PI_OVEN_GATE_BYPASS` — it stays always-on.

---

## §6 Acceptance Criteria (v2 — aligned to minimal v1 scope)

**AC1 — commit gate (unit + simulated tool_call).** `tool_call` handler blocks a `Bash` `git commit` when `.pi-oven/state/autonomous.json` `gateCache.commit ≠ "PASS"` (returns `{block:true, reason}`); allows when `= "PASS"`. Driven by an in-memory state fixture + a synthetic `ToolCallEvent`.

**AC2 — handler self-deadline + numeric budget (B1, B6).** (a) A cache-hit gate lookup measures **p95 < 50 ms** over ≥1000 synthetic `tool_call` events on a warm cache. (b) The handler wraps its work in `Promise.race` against a **1500 ms** deadline; a fault-injected slow path (artificially delayed FS stub) causes the handler to **throw**, which omp converts to `{block:true}` — asserting fail-CLOSED on overrun. (No assertion about a platform 30 s budget — there is none for `tool_call`, per §2 row 7.)

**AC3 — rule re-injection across compaction (B6, concrete fixture).** Fixture sequence, all asserted:
1. **inject**: a fresh session emits `before_agent_start`; assert the discipline-rule block (carrying FSM phase) is present in `event.systemPrompt` with dedup key `pi-oven:discipline-rules@v1`.
2. **compact**: emit `session.compacting`; assert the handler returns `preserveData` containing the FSM snapshot + active rule IDs (this is what is stored in the resulting `CompactionEntry`).
3. **rehydrate**: emit `session_before_compact` whose `branchEntries` contain the prior `CompactionEntry` with the preserved rules (or, equivalently, supply the preserved snapshot via `session_start` hot-context); assert Layer 4 reads the preserved rules and **re-injects via the next `before_agent_start.systemPrompt`**, AND that the **named dedup key** `pi-oven:discipline-rules@v1` is present **exactly once** (no duplicate injection). NOTE: `before_agent_start` does NOT carry `branchEntries` — the preserved data is sourced from `session_before_compact`/`session_start`, then re-injected via `systemPrompt`. Field references: `extensibility/shared-events.ts:328` `preserveData`, `extensibility/shared-events.ts:64,69` `SessionBeforeCompactEvent.branchEntries`, `extensibility/extensions/types.ts:454`/`:777` `before_agent_start.systemPrompt`.

**AC4 — no regression + correctness (N3).** (smoke) `bun run check/test/lint:agents/lint:skills/build` green; extension still does `validateAgentRegistry` + parent-model capture. (correctness) baseline behaviors retained: a load-time WHITELIST VIOLATION still logs; `session_start` still writes `pi-oven-session-model.json`.

**AC5 — push gate + consent schema (N4, §5.4).** `tool_call` blocks `git push` unless `PI_OVEN_PUSH_CONSENT` (env) or a valid non-expired `.pi-oven/state/push-consent.json` is present; asserts an audit log line records source + branch. **Per-source lifetime asserted separately:** (a) **file source — single-use**: with a valid consent file present, the first `git push` is allowed AND the file is consumed (deleted / marked `used`) within the mutex; a second `git push` in the same state then blocks (no valid consent remains). (b) **env source — per-process**: with `PI_OVEN_PUSH_CONSENT` set in the process env, two successive `git push` verbs are both allowed (the env var is NOT consumed) — documenting that single-use is a file-source-only guarantee and the operator must inline-prefix the env var to scope it. (c) an expired file (`expiresAt` in the past) is treated as absent → block.

**AC6 — state failure policy (B2).** The atomic temp+rename write (§3 Layer 1) guarantees a partial write never produces a *torn primary* — only an orphan `.tmp` — so the cases reduce to: (a) **corrupt JSON primary** (`{` truncated) → fail-CLOSED, block commit/push with a clear reason; (b) **missing primary** → fail-CLOSED, block; (c) **interrupted write = orphan `.tmp` present**, two sub-cases: (c1) orphan `.tmp` + a valid primary → the orphan is ignored and the handler **reads the valid primary** (decision follows that primary's `gateCache`); (c2) orphan `.tmp` + **no primary at all** → fail-CLOSED, block. Plus: with `PI_OVEN_GATE_BYPASS=1` set, the commit/push gates ALLOW in cases (a), (b), (c2) (anti-brick) and emit a `warn` audit line — and in (c1) the bypass likewise allows. Plus: **the forbidden-command floor still blocks in every case**, including under `PI_OVEN_GATE_BYPASS=1` (it does not depend on `gateCache` and is never bypassed, per §3 Layer 1 / §5.4).

**AC7 — git-normalization adversarial (B3).** Each of the following is detected as a gated commit/push (blocked when cache≠PASS / no consent): `git -C /tmp/repo commit -m x`; `bash -lc "git commit -m x"`; `env GIT_AUTHOR_NAME=x git commit`; `git -c user.name=x commit`; `git push origin main && echo done`. AND: the spec's documented residual-bypass cases (heredoc, alias, `$(...)`, `eval`, decode-then-exec) are recorded as **known-uncovered** in a test comment, not asserted-blocked — matching the best-effort framing.

**AC8 — concurrency / single-writer (B4).** (a) Two parallel `tool_call` events in one process serialize through the mutex with no torn read-modify-write (assert final state == one consistent value). (b) A **nested task-subagent** `tool_call` is gated (read-only lookup honored) but does NOT mutate the FSM (assert subagent path took the read-only branch). (c) An out-of-band `mtime` bump on the state file is picked up by the next gated lookup (stale-cache invalidation).

**AC9 — integration: real wrapper path (N2).** An integration test exercises the real `extensibility/extensions/wrapper.ts` → `runner.emitToolCall` → Layer-1 handler → `{block:true}` round-trip (not a hand-rolled event), asserting the blocked tool surfaces the reason to the caller (`wrapper.ts:155-163`).

**AC10 — Plan 3 reconciliation (ADR).** Foundation-design Plan 3 reconciled: ADR records the hybrid runtime as the realized Plan 3; "per-agent disallowedTools" + "hard FSM" marked infeasible-as-specced, with the `agent.tools` allowlist + `tool_call`-gate substitute documented, and task-dispatch phase-gating noted as Phase 2.

---

## §7 Out of scope
- Phase 2: custom `pi-oven_dispatch` registerTool path, per-call model override, AND task-dispatch phase-gating (deferred — §5.1/§5.2). Native static primitives (`disabledAgents`/`#blockedAgent`/`allowedSpawns`) exist but are static-not-phase-aware (§2 row 6), so phase-gating is genuinely Phase-2 work.
- Replacing omp's built-in `task` tool wholesale.
- Cross-process / multi-session-on-one-repo concurrency (v1 assumes single-machine single-session, §3 Layer 1 B4).
- A security sandbox: git-command gating is best-effort with a documented residual bypass surface (§3 Layer 1 B3), not a boundary.
- omp upstream changes (runtime works on stock omp).
- PROFILE_B (deferred separately).

---

## §8 v2 work list — STATUS (from codex+critic review, gate was CONTINUE)

Full verdict: `docs/research/codex-reviews/2026-05-29-pi-oven-omp-runtime-layer-critic-review.md`. Architecture is sound (pushbacks P1/P4/P5 preserved — the thesis, the "impossible" honesty in §2, and Layer-4-SOFT are intact). All 6 blockers + NITs addressed in this v2:

1. **B1 — RESOLVED.** §2 row 7 split (thrown=fail-closed/SAFE per P2; hung=deadlock/DANGEROUS per P3). §3 Layer 1 self-imposes a **1500 ms** `Promise.race` deadline, throws-to-block on overrun. AC2 rewritten around the self-deadline; "never exceeds 30s" removed.
2. **B2 — RESOLVED.** §3 Layer 1 state-failure policy: fail-CLOSED on corrupt/missing/partial for commit/push, `PI_OVEN_GATE_BYPASS` anti-brick escape hatch, atomic temp+rename write. AC6 covers corrupt/missing/partial + bypass.
3. **B3 — RESOLVED.** §3 Layer 1 canonical normalization (tokenize; `git -C`/`-c`/`--git-dir`; one-level `bash -c`/`-lc` unwrap; `;`/`&&`/`||`/`|`/newline split; `env` prefix strip) + documented residual bypass surface as best-effort. AC7 adversarial + known-uncovered cases.
4. **B4 — RESOLVED.** §3 Layer 1 single-writer mutex (parent-only writes; subagents read-only) + `mtime` stale-cache invalidation. AC8 parallel + nested-subagent + invalidation.
5. **B5 — RESOLVED.** §1 + §5.2 set v1 scope = minimal (commit/push/forbidden only); task-phase-gating moved to labeled Phase 2 (§3 Layer 2, §7); §2 row 6 notes native static primitives are not phase-aware. §6 ACs all in minimal scope.
6. **B6 — RESOLVED.** AC2 numeric budget (p95 < 50 ms cache-hit; 1500 ms self-abort). AC3 concrete compaction fixture (inject → `session.compacting` `preserveData` → read back via `session_before_compact` `branchEntries`/`session_start` → re-inject via `before_agent_start.systemPrompt`, asserting named dedup key `pi-oven:discipline-rules@v1` prevents duplicates; `before_agent_start` does NOT carry `branchEntries`).
7. **NITs — RESOLVED.** N1 bare `runner.ts`/`wrapper.ts` → `extensibility/extensions/...` throughout. N2 AC9 real wrapper→emitToolCall→block integration. N3 AC4 adds correctness ACs beyond smoke. N4 push-consent schema §5.4. N5 Layer 4 MUST be an extension (`deliverAs:'nextTurn'` extensions-only, evidence cited). N6 baseline corrected to 1 hook + 1 load-time `validateAgentRegistry` call. N7 pi-oven.ts confirmed 177 lines.

**§5 resolutions (decided defaults, user may override):** (1) DEFER Phase-2 `pi-oven_dispatch`. (2) v1 gate scope = minimal. (3) AUGMENT `/pi-oven:autonomous` (extension enforces, prompt drives). (4) push-consent = `PI_OVEN_PUSH_CONSENT` env + optional TTL'd file (§5.4).

**Implementation gate**: this v3 is FROZEN pending re-review. v3 applied the v2-re-review consistency fixes (B2a `PI_OVEN_GATE_BYPASS` scope, B2b `PI_OVEN_PUSH_CONSENT` per-source lifetime, AC3 rehydration event-shape) + 2 NITs (real source path, AC6 partial-write reconciliation); architecture, ACs, and evidence are otherwise unchanged. Build may begin once re-review returns PASS (BLOCKER count 0, no structural change).
