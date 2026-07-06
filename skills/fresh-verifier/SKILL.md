---
name: fresh-verifier
version: 0.1.0
description: "Read this skill before declaring a cycle complete, committing a MILESTONE:/CYCLE-EXIT:/STUB-CLEAR: marker, or crossing any pre-completion gate. Mandatory fresh-agent verifier — no-self-verification rule, 4 sub-checks, 4 Q-halt patterns; main self-declared PASS/done is FORBIDDEN without this skill."
---

# fresh-verifier

## Memory — recall prior verification failures at dispatch

Before dispatching the fresh `pi-oven:verifier`, call `recall(query="prior verification failures and BLOCK verdicts for this project")` to surface previously failed sub-checks, known recurring BLOCK patterns, and past `Q-VERIFIER-FAIL` entries. Pass any matching recalled failures as explicit checklist items in the verifier dispatch prompt so the fresh agent focuses its investigation on historically problematic areas first.

## Dispatch discipline (main orchestrates, subagents do the work)

Do NOT do this skill's substantive work in the main context. Main's direct-action budget is narrow: 1-2 file simple edits ≤ 30 LoC, or operational commands (`git status`, `ls`, install). ANY multi-file change, 3+ file reads, 200+ LoC, or multi-step investigation/implementation MUST be dispatched to a subagent — main only dispatches, synthesizes, and reviews; never implements inline. (See `large-task-delegation` + `subagent-driven-development`.)

Call the RIGHT agent — model-fit + role-fit is first-class. Completion verification → freshly-dispatched `pi-oven:verifier` (no shared context); main may not self-declare PASS.

## When to use

Three contexts route into fresh-verifier, but not all of them take the same depth:

- **Implementation-stage proof (targeted path)** — Gate 5 or a story-completion claim needs fresh evidence for an executable-code change, but the risk matrix does **not** classify it as high-risk / UI-heavy / cycle-exit / release-like.
- **Cycle exit / release-like closure (heavy path)** — any autonomous loop reaching a terminal state, or any commit message / working note containing `MILESTONE:`, `CYCLE-EXIT:`, or `STUB-CLEAR:`.
- **Gate 6 hook trigger (heavy path)** — the `pre-commit-gate` Gate 6 step fires this skill before `gh pr create` or `git push origin main` is allowed to close the cycle.

---

## Pre-completion gate

Before claiming ANY work complete — not just cycle exits — apply this gate with the narrowest evidence that proves the claim:

1. **Identify the exact behavior to prove**: what observable output or state change is the claim based on?
2. **Intent-match first**: confirm the diff and the acceptance claim point at the same behavior; a passing unrelated test is not evidence.
3. **Prefer relevant TDD evidence**: use the failing/passing test pair, scoped test file, or directly-related existing suite first.
4. **Changed-area checks**: run the narrowest direct command against the touched surface (typecheck slice, API probe, CLI invocation, focused fixture, etc.).
5. **Reverse-dep checks when warranted**: if an exported/public/shared symbol changed, inspect direct reverse dependencies and verify the highest-risk caller path.
6. **Risk-focused probe**: for the touched domain, run the one additional check most likely to catch a real regression (auth path, serializer boundary, migration consumer, etc.).
7. **Escalate to the heavy path** when the change is high-risk, UI-heavy, cycle-exit, release-like, or the targeted path leaves unresolved risk.

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

At cycle exit or release-like closure, a fresh agent — separate from the main execution context — must run the **heavy** verifier path from the matrix below and emit a `VERDICT:` line. The main agent may not run the heavy checks and then claim PASS in the same context. If no fresh agent is dispatched, the cycle is treated as incomplete regardless of how many tests passed.

---

## Intent / risk matrix

| Route | When to use | Required evidence |
|---|---|---|
| **Targeted implementation verifier** | Standard implementation-stage proof where the change is executable but not high-risk, not UI-heavy, and not closing a cycle/release | Intent-match, relevant TDD evidence, changed-area checks, reverse-dep check for exported/shared symbols, and one risk-focused probe on the touched domain |
| **Heavy 4-sub-check verifier** | Any high-risk domain (`auth`, `payment`, `migration`, `public API`, credential / permission policy, prod-mutation path), any UI-heavy change, any cycle exit, any release-like marker (`MILESTONE:`, `CYCLE-EXIT:`, `STUB-CLEAR:`), or any case where the targeted path cannot close the risk | All 4 heavy sub-checks from `references/4-sub-check.md` |
| **Escalation rule** | The targeted path finds unresolved risk, reverse-dep uncertainty, or incomplete evidence | Re-dispatch on the heavy path before issuing `VERDICT: PASS` |

---

## Evidence output format

Every verification report — whether from a fresh-verifier dispatch or inline verification — must state:

- **Route selected**: targeted implementation verifier or heavy 4-sub-check verifier, and why
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

## Provider-family routing

- Default verifier dispatch stays inside the current session provider family.
- Heavy-path verification may widen to a stronger verifier configuration only within that same provider family.
- Do not require a cross-provider handoff just to satisfy the matrix. If the current family cannot supply the needed verifier after retry, report BLOCK rather than inventing a different-family requirement.

---

## Env var contract

| Variable | Meaning |
|---|---|
| `PI_OVEN_CYCLE_EXIT_VERIFIED=1` | Set by verifier after `VERDICT: PASS`; allows the cycle to close |
| `PI_OVEN_CYCLE_EXIT_SKIP=1` | Bypass intent; auto-appends `Q-CYCLE-EXIT-STALE` and proceeds fail-closed |
| Both set simultaneously | BLOCK fail-closed; neither value overrides the conflict |

---

References: `skill://pi-oven:fresh-verifier/references/4-sub-check.md` — 4 sub-check detail.
Sources: omc `verify` skill (evidence-first workflow); `superpowers:verification-before-completion` (evidence before claims principle).
