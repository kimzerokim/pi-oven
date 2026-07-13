# TDD-Strict — Anti-Patterns, Iron Law, and Auto-Trigger Boundary

Sources: pi-oven/harness-share.md §11, superpowers/test-driven-development, test-coverage

---

## Iron Law

> "Red → Green → Refactor. No exceptions. No retroactive tests. No self-verification by the agent that wrote the code."
> — pi-oven/harness-share.md §11, superpowers/test-driven-development

The Iron Law has three clauses:

1. **Red before Green** — a failing test must exist and be confirmed failing before any production code is written for that behavior.
2. **Green before Refactor** — all tests must pass before structural cleanup begins.
3. **No self-verification** — the agent that wrote the production code cannot be the sole verifier of its correctness. In autonomous mode this is enforced structurally via Q-TDD-MAIN (see below).

---

## Q-TDD-MAIN halt — full specification

**Trigger condition**: all four hold simultaneously:
- Autonomous mode is active (any of: ralph, autopilot, ultrawork, pi-oven autonomous loop).
- The active agent identity is `main` (the orchestrating agent, not a dispatched executor).
- The next planned action is TDD Red — writing a failing test for new or changed behavior.
- No fresh executor subagent has been dispatched for this specific Red task yet.

**Halt sequence**:

1. Stop. Do not call `edit`, `write`, or `MultiEdit` on any test or source file.
2. Append entry to queue file (`docs/harness/user-queue.md` if present, else `<cwd>/.pi-oven/state/queue.md`):
   ```
   Q-TDD-MAIN | PENDING
   Task: <description>
   Planned test path(s): <paths>
   Tentative default: dispatch a fresh pov:executor
   ```
3. Dispatch a fresh `pov:executor` with the full TDD task (Red + Green + Refactor).
4. Main waits for subagent completion signal before continuing the broader autonomous cycle.
5. After subagent reports completion, main performs a review pass only — it does not re-enter the implementation.

**Why this exists**: an agent that writes both the production code and the test for that same code is verifying its own work. The structural error rate for self-verified tests is higher than for tests written by a separate agent because both the code and the test can share the same conceptual blind spot.

---

## Anti-pattern 1: Test-from-impl

Read the implementation first, then write a test that mirrors it line by line.

**Why it fails**: the test confirms the code exists and runs, not that it satisfies the requirement. Bugs in the implementation are faithfully reproduced in the test. The test will pass for the wrong behavior.

**Correct approach**: derive the test from the specification, the user story, or the function signature — before reading the implementation body.

---

## Anti-pattern 2: Coverage-padding

Add `expect(result).toBeDefined()` or similar weak assertions purely to raise line-coverage numbers.

**Why it fails**: 100% line coverage with weak assertions provides no defect-detection value. Coverage is a floor, not a proof. Every assertion must document a specific observable behavior contract: given this input, expect this exact output or side effect.

---

## Anti-pattern 3: Shared test state

Use `beforeAll` to construct a shared object, then mutate it across multiple `it` blocks.

**Why it fails**: test order becomes load-bearing. A mutation in test N causes test N+1 to operate on corrupted state, producing failures that disappear when the test is run in isolation. Each test must call `arrange` independently.

---

## Anti-pattern 4: Mock behavior testing

Assert `expect(mockFn).toHaveBeenCalledWith(x)` as the primary or only assertion.

**Why it fails**: the test verifies wiring, not outcome. If the mock is removed or the real implementation behaves differently, the test gives false confidence. Assert on the output value or observable side effect. Mock only when the real dependency is unavoidable (network, system clock, filesystem in CI).

**pi-oven mock policy**: mocks only when unavoidable. The ECC pattern of mocking all dependencies by default is explicitly rejected. Tests against real in-process logic produce higher signal.

---

## Anti-pattern 5: Impl-first rationalization

Write production code, then write the test, then argue "the test would have been identical anyway."

**Why it fails**: this claim cannot be verified retroactively. The Red phase exists to force you to think about the interface before the implementation. Skipping Red removes the feedback loop that catches interface design problems before they are baked into the codebase.

---

## Anti-pattern 6: "Keep as reference"

Leave a superseded or obsolete test file in the tree because it might be useful later.

**Why it fails**: obsolete tests rot. They accumulate false failures as the codebase evolves, create noise in CI output, and give misleading coverage signals. The git history is the reference. Delete at Refactor time.

---

## Anti-pattern 7: Skip TDD for 1-liners

"This is a one-liner, it doesn't need a test."

**Why it fails**: size is not correlated with defect probability. A one-liner often contains a branch (`??`, ternary, `||`, `&&`) that needs at least two test cases. The coverage requirement applies to all touched files regardless of change size.

---

## Anti-pattern 8: Mock-all by default (ECC pattern — REJECTED)

Mock every dependency in every test regardless of whether the real dependency is expensive.

**Why it fails**: tests against mocks are tests of your mock configuration, not of your system. When the real implementation diverges from the mock contract, tests continue passing while the system breaks. pi-oven overrides the ECC 80%-mock-all guidance: use real in-process dependencies unless the cost is genuinely prohibitive (I/O, clock, network).

---

## Auto-trigger boundary — "touched file" definition

A file is **touched** for coverage purposes when it appears in the current session's staged diff with status `A` (added) or `M` (modified).

Not touched (excluded from 100% coverage requirement):

- `R` (renamed only, no content change)
- `D` (deleted)
- `*.d.ts` (type declarations)
- `*.md`, `*.yaml`, `*.json` (doc/config — triggers doc-only fast-path, skill does not fire)
- ORM entity files where body is decorator-only

The staged diff is the source of truth. If a file is in the working tree but not staged, it is not touched for this cycle.
