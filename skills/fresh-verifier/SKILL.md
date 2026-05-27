---
name: fresh-verifier
version: 0.1.0
description: Cycle-exit mandatory fresh-agent verifier — 4 sub-check (prod-build smoke, stub sweep, SoT alignment, spec-freeze) + 4 Q-halt patterns (Q-VERIFIER-FAIL, Q-VERIFIER-INVALID, Q-VERIFIER-DISPATCH-FAIL, Q-COMPLETION-SELF-VERIFY). Main self-declared "PASS" / "done" / "loop exit" is FORBIDDEN without this skill.
trigger: "autonomous cycle exit OR large-cycle commit marker (MILESTONE: / CYCLE-EXIT: / STUB-CLEAR:)"
alwaysApply: false
---

# fresh-verifier

## When to use

Three contexts require a fresh-verifier dispatch:

- **Cycle exit** — any autonomous loop (ralph, ultrawork, autopilot) reaching a self-declared terminal state.
- **Large-cycle commit** — a commit message or working note contains `MILESTONE:`, `CYCLE-EXIT:`, or `STUB-CLEAR:`.
- **Gate 6 hook trigger** — the `pre-commit-gate` Gate 6 step fires this skill before the commit is allowed to land.

## Cycle-exit mandate

Main self-declared "verification PASS", "loop exit", or "done" is FORBIDDEN.

A fresh agent — separate from the main execution context — must perform all 4 sub-checks and emit a `VERDICT:` line. The main agent may not run the sub-checks and then claim PASS in the same context. If no fresh agent is dispatched, the cycle is treated as incomplete regardless of how many tests passed.

Dispatch via omp `task` primitive, `background=false`. Use the `agents/verifier.md` profile.

## 4 sub-check

| # | Check | Passes when |
|---|---|---|
| 1 | **Prod-build smoke** | Playwright user-persona flow completes without console errors or HTTP 5xx |
| 2 | **Stub sweep** | `git log --oneline -20` contains no unresolved `STUB:` markers; `grep -rn "STUB:" src/` returns zero matches |
| 3 | **SoT alignment** | Every feature listed in the active spec/plan is traceable to staged code; no spec line is unimplemented |
| 4 | **Spec-freeze re-check** | All visual modifiers (size tokens, spacing, color semantics) absorbed from the frozen spec; no open `TODO:` in UI layer |

Any sub-check returning FAIL produces `VERDICT: BLOCK`.

## Verdict format

The first line of the verifier response must be exactly:

```
VERDICT: PASS
```

or

```
VERDICT: BLOCK
```

Any response that does not match this pattern triggers `Q-VERIFIER-INVALID`.

## Q-halt patterns

| Pattern | Trigger condition | Action |
|---|---|---|
| `Q-VERIFIER-FAIL` | 2 consecutive BLOCK verdicts on the same cycle | Append to `docs/harness/user-queue.md`; halt cycle |
| `Q-VERIFIER-INVALID` | Verifier response first line does not match `VERDICT: (PASS\|BLOCK)` | Re-dispatch once; second mismatch appends Q entry |
| `Q-VERIFIER-DISPATCH-FAIL` | omp `task` call throws or returns no agent response | Log error + append Q entry; do not self-verify as fallback |
| `Q-COMPLETION-SELF-VERIFY` | Main agent emits "verification PASS" / "done" / "loop exit" without prior fresh-agent VERDICT | Immediate Q entry; cycle marked incomplete |

## Model routing

- **Sonnet baseline** — small cycles (<3 files changed, non-UI, no auth/payment/migration/public API).
- **Opus** — multi-file changes, any UI change, high-risk domains (auth, payment, migration, public API).

The `agents/verifier.md` profile defaults to `model: sonnet`. Opus promotion is automatic when the diff stat exceeds 3 files or the changed paths match `auth/`, `payment/`, `migration/`, or `api/public/`.

## Env var contract

| Variable | Meaning |
|---|---|
| `PI_OVEN_CYCLE_EXIT_VERIFIED=1` | Set by verifier after `VERDICT: PASS`; allows the cycle to close |
| `PI_OVEN_CYCLE_EXIT_SKIP=1` | Bypass intent; auto-appends `Q-CYCLE-EXIT-STALE` and proceeds fail-closed |
| Both set simultaneously | BLOCK fail-closed; neither value overrides the conflict |

---

4 sub-check detail: skill://pi-oven/fresh-verifier/references/4-sub-check.md
