---
name: fresh-verifier
version: 0.1.0
description: Cycle-exit mandatory fresh-agent verifier — pre-completion gate, no-self-verification rule, evidence output format, 4 sub-check (prod-build smoke, stub sweep, SoT alignment, spec-freeze) + 4 Q-halt patterns (Q-VERIFIER-FAIL, Q-VERIFIER-INVALID, Q-VERIFIER-DISPATCH-FAIL, Q-COMPLETION-SELF-VERIFY). Main self-declared "PASS" / "done" / "loop exit" is FORBIDDEN without this skill.
trigger: "autonomous cycle exit OR large-cycle commit marker (MILESTONE: / CYCLE-EXIT: / STUB-CLEAR:), verify, verification, verification-before-completion, pre-completion gate, 최종 검증, 완료 전 검증"
alwaysApply: false
---

# fresh-verifier

## When to use

Three contexts require a fresh-verifier dispatch:

- **Cycle exit** — any autonomous loop (ralph, ultrawork, autopilot) reaching a self-declared terminal state.
- **Large-cycle commit** — a commit message or working note contains `MILESTONE:`, `CYCLE-EXIT:`, or `STUB-CLEAR:`.
- **Gate 6 hook trigger** — the `pre-commit-gate` Gate 6 step fires this skill before the commit is allowed to land.

---

## Pre-completion gate

Before claiming ANY work complete — not just cycle exits — apply this gate:

1. **Identify the exact behavior to prove**: what observable output or state change is the claim based on?
2. **Prefer existing tests**: run the relevant test suite first. If tests pass, that is your primary evidence.
3. **Typecheck / build**: run `bun run build` or `tsc --noEmit`. Type errors are evidence of incompleteness.
4. **Narrow direct commands**: run the narrowest direct verification available (e.g. `grep -n "expected string" output.txt`, `curl localhost:3000/health`).
5. **Manual validation** (last resort): if no automated path exists, describe the manual steps and gather observable evidence. Do not bluff with "should work" or "appears correct".

This gate applies to every `DONE` / `complete` / `verified` claim in any context — interactive, executor subagent, or autonomous loop. It is not exclusive to cycle exits.

Using "should", "probably", "seems to", or "looks correct" without running a verification command is a gate violation.

---

## No-self-verification rule

Main agent cannot verify its own work in any of these situations:

- Main wrote the code → main runs the tests → main declares PASS. **Invalid**: same context produced and verified the claim.
- Executor subagent writes code and then says "tests pass" based on its own tool call output without a fresh dispatch. **Invalid**: same agent context.
- Any autonomous loop where main self-declares "verification PASS", "loop exit", or "done" without a prior `VERDICT: PASS` from a freshly-dispatched `pi-oven:verifier`.

Valid verification paths:
- Freshly-dispatched `pi-oven:verifier` agent (dispatch via `task` primitive, `background=false`, agent file `agents/pi-oven-verifier.md`)
- User manually confirms
- CI pipeline returns green on the pushed branch

---

## Cycle-exit mandate

Main self-declared "verification PASS", "loop exit", or "done" is FORBIDDEN.

A fresh agent — separate from the main execution context — must perform all 4 sub-checks and emit a `VERDICT:` line. The main agent may not run the sub-checks and then claim PASS in the same context. If no fresh agent is dispatched, the cycle is treated as incomplete regardless of how many tests passed.

---

## 4 sub-check

| # | Check | Passes when |
|---|---|---|
| 1 | **Prod-build smoke** | Playwright user-persona flow completes without console errors or HTTP 5xx |
| 2 | **Stub sweep** | `git log --oneline -20` contains no unresolved `STUB:` markers; `grep -rn "STUB:" src/` returns zero matches |
| 3 | **SoT alignment** | Every feature listed in the active spec/plan is traceable to staged code; no spec line is unimplemented |
| 4 | **Spec-freeze re-check** | All visual modifiers (size tokens, spacing, color semantics) absorbed from the frozen spec; no open `TODO:` in UI layer |

Any sub-check returning FAIL produces `VERDICT: BLOCK`.

---

## Evidence output format

Every verification report — whether from a fresh-verifier dispatch or inline verification — must state:

- **What was verified**: specific behavior, feature, or contract
- **Commands run**: exact commands with output excerpts
- **What passed**: list with evidence
- **What failed or remains unverified**: explicit list; do not omit failures

If no realistic verification path exists, state that explicitly. Do not substitute "I'm confident" for evidence.

---

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

---

## Q-halt patterns

| Pattern | Trigger condition | Action |
|---|---|---|
| `Q-VERIFIER-FAIL` | 2 consecutive BLOCK verdicts on the same cycle | Dispatch `pi-oven:oracle` for final strategic consultation; if oracle also returns no resolvable path, append to `docs/harness/user-queue.md` and halt cycle |
| `Q-VERIFIER-INVALID` | Verifier response first line does not match `VERDICT: (PASS\|BLOCK)` | Re-dispatch once; second mismatch appends Q entry |
| `Q-VERIFIER-DISPATCH-FAIL` | `task` call throws or returns no agent response | Log error + append Q entry; do not self-verify as fallback |
| `Q-COMPLETION-SELF-VERIFY` | Main agent emits "verification PASS" / "done" / "loop exit" without prior fresh-agent VERDICT | Immediate Q entry; cycle marked incomplete |

---

## Model routing

- **Sonnet baseline** — small cycles (<3 files changed, non-UI, no auth/payment/migration/public API).
- **Opus** — multi-file changes, any UI change, high-risk domains (auth, payment, migration, public API).

The `agents/pi-oven-verifier.md` profile defaults to `model: sonnet`. Opus promotion is automatic when the diff stat exceeds 3 files or the changed paths match `auth/`, `payment/`, `migration/`, or `api/public/`.

---

## Env var contract

| Variable | Meaning |
|---|---|
| `PI_OVEN_CYCLE_EXIT_VERIFIED=1` | Set by verifier after `VERDICT: PASS`; allows the cycle to close |
| `PI_OVEN_CYCLE_EXIT_SKIP=1` | Bypass intent; auto-appends `Q-CYCLE-EXIT-STALE` and proceeds fail-closed |
| Both set simultaneously | BLOCK fail-closed; neither value overrides the conflict |

---

References: `skill://pi-oven/fresh-verifier/references/4-sub-check.md` — 4 sub-check detail.
Sources: omc `verify` skill (evidence-first workflow); `superpowers:verification-before-completion` (evidence before claims principle).
