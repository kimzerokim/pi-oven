# Design — pi-oven-first agent and skill ownership

> Status: LOCKED (brainstorming-confirmed).
> Date: 2026-06-24
> Required reading: `docs/harness/surveys/2026-06-24-pi-oven-first-tracking-survey.md`
> Topic: when a session is running pi-oven, automatic routing and tracking must resolve to pi-oven-owned agents and skills first, while mixed sibling registries remain observable and controlled instead of silently winning.

## 1. Problem statement (survey-verified)

The current runtime has a split ownership model:

- Agent registry is mixed: both `pi-oven:*` and `kzk:*` agent families exist and resolve.
- Config prefers `pi-oven:*` for model overrides and runtime guidance.
- Skill resolution is not aligned with that preference in live sessions: bare names still resolve globally, while `skill://pi-oven:<name>` is not currently guaranteed to resolve.

The result is inconsistent ownership:

1. pi-oven runtime guidance says auto-dispatch must use `pi-oven:<role>` and auto-skill loading must use `skill://pi-oven:<name>`.
2. Mixed registries mean foreign namespaces can still be present and valid.
3. Bare or foreign resolution can win silently if the runtime does not canonicalize and verify ownership before acting.

This is unacceptable for pi-oven-owned automatic flows. A pi-oven session must make pi-oven the canonical owner of automatic agent dispatch, skill dispatch, and trace attribution.

## 2. Locked decisions

| # | Decision | Choice |
|---|---|---|
| D1 | Session policy | **Pi-oven-first** by default |
| D2 | Agent canonical target | **Always `pi-oven:<role>` for pi-oven automatic flows** |
| D3 | Foreign agent namespace | **Allowed only for user-explicit requests** |
| D4 | Skill canonical target | **Pi-oven-owned canonical skill mapping; no silent fallback to bare/global skill** |
| D5 | Resolution failure behavior | **Fail closed** if a pi-oven automatic flow cannot prove ownership |
| D6 | Tracking model | **Record requested, canonical, resolved, origin, status, reason** |
| D7 | Clean-room isolation | **Keep as niche opt-in mode, not default** |
| D8 | Sibling suppression | **Prefer selective suppression over provider-wide isolation** |
| D9 | Mixed-registry compatibility | **Observe and diagnose mixed registries; do not silently treat `kzk:*` as pi-oven aliases** |

## 3. Invariants

### 3.1 Agent ownership invariant

Any agent dispatch created by pi-oven runtime or pi-oven-owned orchestration must resolve to `pi-oven:<role>`.

- `explorer` requested by pi-oven auto flow -> canonical `pi-oven:explorer`
- `kzk:explorer` produced by pi-oven auto flow -> rewrite or block
- user-explicit `kzk:explorer` -> preserve as explicit foreign choice

### 3.2 Skill ownership invariant

Any skill load created by pi-oven runtime or pi-oven-owned orchestration must resolve through pi-oven-owned canonical skill identity.

- Automatic pi-oven skill matching must not be satisfied by a foreign bare/global skill.
- If pi-oven-owned canonical skill identity cannot be resolved, the flow must fail closed with a diagnostic reason.
- Bare global skill resolution remains allowed only for user-explicit or foreign-explicit flows.

### 3.3 Tracking invariant

For every pi-oven-owned automatic resolution, trace output must record:

- `origin` — `pi-oven-auto` | `user-explicit` | `foreign-auto`
- `kind` — `agent` | `skill`
- `requested`
- `canonical`
- `resolved`
- `status` — `resolved` | `rewritten` | `blocked`
- `reason`

This is the source of truth for later diagnosis.

## 4. Architecture

### 4.1 Agent resolution pipeline

Introduce an explicit agent-ownership resolver for pi-oven automatic flows.

Pipeline:

1. Collect requested target.
2. Classify origin:
   - `user-explicit`
   - `pi-oven-auto`
   - `foreign-auto`
3. Canonicalize:
   - `pi-oven-auto` -> force `pi-oven:<role>`
   - `user-explicit` -> preserve exact namespace
   - `foreign-auto` -> treat as foreign, never silently promoted to pi-oven
4. Verify against registered agent set.
5. Emit trace record.
6. If verification fails for `pi-oven-auto`, block.

This layer owns the rule that pi-oven-generated automatic dispatch must never leak into `kzk:*` or bare-role targets.

### 4.2 Skill resolution pipeline

Introduce a pi-oven-owned canonical skill mapping layer ahead of global/bare skill resolution.

Pipeline:

1. Match pi-oven runtime intent to canonical pi-oven skill id.
2. Resolve canonical pi-oven skill through a dedicated ownership path.
3. If canonical resolution succeeds, emit ownership trace and continue.
4. If canonical resolution fails, block with diagnostic reason.
5. Do not fall through from pi-oven automatic intent into a foreign bare skill.

This is the core fix for current behavior where bare names can be captured by OMC/superpowers-style skills while pi-oven runtime still believes it required a pi-oven skill.

### 4.3 Mode and policy surface

Three operating modes remain, but the default changes in practice:

#### Default: `pi-oven-first`
- Automatic agent dispatch is pi-oven-owned.
- Automatic skill dispatch is pi-oven-owned.
- Foreign namespaces are allowed only by explicit user request.
- Traces always show ownership and rewrites.

#### Optional: `sibling-suppressed`
- Selectively suppress sibling namespaces such as `superpowers:*` or `oh-my-claudecode:*`.
- Prefer this over broad provider isolation when the goal is conflict reduction.

#### Optional: `clean-room`
- Broad home-layer isolation remains available.
- It is explicitly documented as a mode that may disable kzk/home-layer behavior.
- It is not the default control surface for pi-oven-first routing.

### 4.4 Failure model

Failing to prove pi-oven ownership is a hard error for pi-oven automatic flows.

Behavior:

- Rewrite when deterministic and safe.
- Block when ownership cannot be proven.
- Never silently satisfy a pi-oven-owned request with a foreign namespace.

Example diagnostic classes:

- `pi_oven_agent_namespace_escape`
- `pi_oven_skill_alias_missing`
- `pi_oven_skill_resolver_mismatch`
- `foreign_namespace_requires_user_explicit`

### 4.5 Minimum safe edit set

Per survey, the minimum edit surface for this feature is:

- `.omp/extensions/pi-oven-runtime/rules-injector.ts`
- `.omp/extensions/pi-oven-runtime/skill-keyword-loader.ts`
- `.omp/extensions/pi-oven-runtime/gate-handler.ts`
- `.omp/extensions/pi-oven.ts`
- `scripts/pi-oven-setup/config-yml.ts` (only if policy/config needs a persisted mode or suppression coupling update)
- `scripts/pi-oven-setup.ts` (only if CLI/setup wording or mode plumbing changes)
- matching tests in `tests/extensions/pi-oven-runtime/**`, `tests/extensions/pi-oven.test.ts`, and `tests/scripts/pi-oven-setup/**`

Any broader file set needs explicit justification from the implementation plan.

## 5. Non-goals

- Removing `kzk:*` from the repo entirely
- Treating `kzk:*` as automatic aliases for `pi-oven:*`
- Making clean-room isolation the default
- Rewriting unrelated registry/provider architecture
- Changing user-explicit foreign namespace behavior

## 6. Risks

1. Agent and skill registries may be governed by different underlying resolver paths; a one-sided fix can deepen inconsistency.
2. Existing tests may overfit current mixed-registry behavior and need careful reclassification into explicit-user vs pi-oven-auto cases.
3. Setup/config changes can accidentally turn a routing policy into a destructive global suppression change if not scoped precisely.

## 7. Verification plan

1. Add/adjust agent-resolution tests:
   - pi-oven auto bare role -> canonical `pi-oven:<role>`
   - pi-oven auto foreign namespace -> rewrite or block
   - user-explicit foreign namespace -> preserved
2. Add/adjust skill-resolution tests:
   - pi-oven auto skill request must not be satisfied by foreign bare skill
   - unresolved pi-oven canonical skill -> blocked with diagnostic reason
3. Add trace assertions:
   - requested/canonical/resolved/origin/status/reason recorded
4. Add mixed-registry smoke coverage:
   - both `kzk:*` and `pi-oven:*` present, but pi-oven auto flow still resolves to pi-oven only
5. Run targeted typecheck and relevant tests for runtime and setup surfaces.

## 8. Follow-up sequence

This design -> implementation plan -> TDD-strict executor dispatch -> targeted verification -> fresh verifier before cycle exit.
