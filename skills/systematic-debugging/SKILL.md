---
name: systematic-debugging
version: 0.1.0
description: Root-cause-first debugging discipline for any bug, test failure, flaky test, or unexpected behavior — investigate before fixing, trace to source, defend in depth. Triggers: bug, test failure, flaky test, "버그 수정", "디버깅", "왜 깨지지", "원인 찾아줘", race condition, regression.
trigger: "bug, test failure, flaky test, unexpected behavior, performance regression, before proposing any fix, 버그 수정, 디버깅, 원인 찾아줘"
alwaysApply: false
---

# systematic-debugging

## Memory — recall prior failure modes at flow start

Before beginning Phase 1 investigation, call `recall(query="prior failure modes and root causes for bugs in this codebase")` to surface known recurring failure patterns, prior root-cause findings, and previously observed regressions. This prevents re-investigating already-solved causes and seeds Phase 1 with confirmed prior art. If a recalled failure mode matches the current symptom, validate it first before exploring new hypotheses.

## Iron law

```
NO FIX WITHOUT ROOT-CAUSE INVESTIGATION FIRST
```

Symptom patches mask bugs and spawn new ones. If Phase 1 is not complete, you cannot propose a fix. Violating the letter of this process is violating its spirit.

## Dispatch discipline (main orchestrates, subagents do the work)

Do NOT run this skill's substantive work in the main context. Main's direct-action budget is narrow: 1–2 file simple edits (≤30 LoC) or operational commands (`git status`, `ls`, install). ANY multi-file change, 3+ file reads, 200+ LoC, or multi-step investigation/implementation MUST be dispatched to a subagent — main only dispatches, synthesizes, and reviews, never implements inline. (See `large-task-delegation` + `subagent-driven-development`.)

Match the agent to the work (model-fit + role-fit is first-class): root-cause isolation → `pi-oven:debugger`; evidence tracing → `pi-oven:tracer`. Full role map in **Agent Dispatch (omp)** below.

## When to use

Any technical defect: test failures, production bugs, unexpected behavior, performance regressions, build failures, integration breaks, flaky tests.

Use it **especially** when the urge to skip is strongest — under time pressure, when "just one quick fix" looks obvious, when a previous fix did not stick, or when you do not fully understand the issue. Simple bugs have root causes too; systematic is faster than guess-and-thrash.

Keyword triggers: "버그 수정", "디버깅", "왜 깨지지", "원인 찾아줘", "테스트 깨짐", "flaky", "race condition", "regression".

## The four phases

Complete each phase before the next.

### Phase 1 — Root cause

1. **Read the error completely** — stack traces, line numbers, file paths, error codes. They often contain the answer.
2. **Reproduce reliably** — exact steps, every time? Not reproducible → gather more data, do not guess.
3. **Check recent changes** — `git diff`, recent commits, new deps, config/env drift.
4. **Instrument component boundaries** (multi-component systems: CI→build→sign, API→service→DB). Before any fix, log what enters and exits each boundary, run once, and read the evidence to locate WHICH layer fails. Then investigate that layer.
5. **Trace data flow backward** when the error is deep in the stack — see Phase 1.5.

### Phase 1.5 — Backward root-cause tracing

The error surfaces deep (git init in wrong dir, file written to wrong path). Fixing where it appears treats a symptom. Instead:

1. Observe the symptom.
2. Find the immediate cause (the code that directly triggers it).
3. Ask what called this, with what value.
4. Keep tracing up — is *this* the source? No → keep going.
5. Find the original trigger (e.g. a getter returning `''` accessed before setup ran). **Fix at source, never at the symptom.**

When you cannot trace by hand, instrument: capture `new Error().stack` plus context (dir, cwd, env) *before* the dangerous operation, run, and grep the output. In tests use `console.error` (loggers may be suppressed). To find which test pollutes shared state, bisect: run tests one at a time until the first polluter appears.

### Phase 2 — Pattern analysis

1. Find a working example of the same pattern in the codebase.
2. Read any reference implementation **completely** — no skimming; partial understanding guarantees bugs.
3. List every difference between working and broken, however small. "That can't matter" is a trap.
4. Map dependencies, config, env, and assumptions.

### Phase 3 — Hypothesis

1. State ONE hypothesis: "I think X is root cause because Y." Write it down, be specific.
2. Test it with the **smallest possible** change. One variable at a time.
3. Verify: worked → Phase 4. Didn't → form a NEW hypothesis, do not stack fixes.
4. If you don't understand X, say so and research — do not pretend.

### Phase 4 — Fix the root cause

1. **Failing test first** — simplest reproduction, automated. Must exist before the fix (route via `tdd-strict`).
2. **One fix** addressing the root cause. No "while I'm here" extras, no bundled refactor.
3. **Verify** — test passes, nothing else broke, issue actually resolved.
4. **If it fails, count attempts.** < 3 → return to Phase 1 with new data. **≥ 3 → STOP and question the architecture.**

## Defense in depth (after root cause is known)

One validation point can be bypassed by another code path, a mock, or a refactor. Validate at every layer the bad data passes through to make the bug *structurally impossible*:

- **Layer 1 — entry point**: reject obviously invalid input at the API boundary.
- **Layer 2 — business logic**: ensure data makes sense for this operation.
- **Layer 3 — environment guard**: refuse dangerous operations in specific contexts (e.g. refuse `git init` outside tmpdir during tests).
- **Layer 4 — debug instrumentation**: log context + stack before the dangerous operation for forensics.

Each layer catches what the others miss. Don't stop at one check.

## Condition-based waiting (flaky timing bugs)

Arbitrary `sleep`/`setTimeout` delays create races: pass on fast machines, fail under CI load. Wait for the **actual condition**, not a guess about how long it takes.

```
// ❌ await sleep(50); result = getResult();
// ✅ await waitFor(() => getResult() != null);
```

A `waitFor` polls the condition (every ~10ms, never 1ms) with a timeout that throws a descriptive error, and calls the getter *inside* the loop for fresh data. Arbitrary timeouts are only correct when (1) you first wait for a triggering condition, (2) the delay is based on known timing not a guess, and (3) a comment explains why.

## After 3 failed fixes — question the architecture

Signals: each fix reveals new coupling elsewhere, fixes demand "massive refactoring", each fix spawns a new symptom. This is not a failed hypothesis — it is a wrong architecture. STOP. Do not attempt fix #4. Surface to your human partner: is this pattern fundamentally sound, or are we continuing through inertia?

## Red flags — STOP and return to Phase 1

"Quick fix now, investigate later" · "just try X and see" · "add multiple changes, run tests" · "skip the test, I'll verify manually" · "it's probably X" · "I don't fully get it but this might work" · proposing fixes before tracing data flow · "one more attempt" after 2+ failures.

Partner signals you're doing it wrong: "Is that not happening?" (assumed without verifying) · "Will it show us…?" (should have added evidence) · "Stop guessing" · "Ultrathink this" (question fundamentals).

## "No root cause" outcome

If investigation genuinely shows the issue is environmental/timing/external: document what you investigated, implement appropriate handling (retry, timeout, clear error), add monitoring. But 95% of "no root cause" cases are incomplete investigation — be honest about which.

## Agent Dispatch (omp)

In an omp session, route investigation and fix to dedicated heterogeneous-model agents instead of debugging inline:

- Backward call-chain tracing across boundaries (Phase 1.5, multi-component evidence gathering): dispatch `pi-oven:tracer`. Fire multiple lanes in parallel when several origins are plausible — one `task` per hypothesis, each `run_in_background: true`.
- Reproduce, isolate, and diagnose a specific failing or flaky test (Phases 1–3): dispatch `pi-oven:debugger`.
- Write the failing test that pins the root cause before the fix, and the regression test after (Phase 4 step 1): dispatch `pi-oven:test-engineer` (defers to `tdd-strict`).
- Implement the single root-cause fix plus defense-in-depth layers (Phase 4): dispatch `pi-oven:executor`.
- Independently confirm the fix resolved the issue and broke nothing (Phase 4 step 3): dispatch `pi-oven:verifier` — never self-verify in the same context.
- After 3 failed fixes / suspected architectural fault: escalate to `pi-oven:oracle` for a strategic re-think before any further attempt.

Outside omp the main agent runs the four phases inline.
