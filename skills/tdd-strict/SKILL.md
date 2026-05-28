---
name: tdd-strict
version: 0.1.0
description: TDD-strict enforcement — Red → Green → Refactor per cycle + 100% line/branch coverage on touched files + Q-TDD-MAIN halt when autonomous main attempts to enter Red directly
trigger: "any code-write tool_call (Edit|Write|MultiEdit) in autonomous mode OR explicit user keyword: tdd, test first, 테스트 먼저"
alwaysApply: false
---

# tdd-strict

## When to use

**Auto-trigger (autonomous mode)** — fires when all three conditions hold simultaneously:

1. Autonomous mode is active (ralph, autopilot, ultrawork, or any pi-oven autonomous loop).
2. The staged diff contains at least one touched code file (path matches `src/**`, `lib/**`, `*.ts`, `*.js`, `*.py`, or equivalent source extensions for the project language).
3. The tool call is `Edit`, `Write`, or `MultiEdit`.

Doc-only fast-path: if every file in the staged diff is `*.md`, `*.yaml`, `*.json` (config/schema), or `*.d.ts`, this skill does not fire.

**Manual trigger** — user writes any of: `tdd`, `test first`, `테스트 먼저`, `red-green`, `TDD strict`.

## Red → Green → Refactor

Each cycle produces exactly three commits (or three logical checkpoints inside one commit when the change is small enough that a single atomic commit is clearer):

| Phase | What happens | Allowed tool calls |
|---|---|---|
| **Red** | Write the failing test. No production code yet. Run the test suite; confirm the new test fails for the right reason. | `Write` / `Edit` test files only |
| **Green** | Write the minimum production code that makes the failing test pass. Do not refactor yet. | `Write` / `Edit` source files |
| **Refactor** | Clean up duplication, naming, structure. All tests stay green throughout. | `Edit` source and test files |

Commit message convention: prefix with `test:` (Red), `feat:`/`fix:` (Green), `refactor:` (Refactor).

The cycle is atomic: do not ship a Green commit without a preceding Red commit in the same session.

## Coverage requirement

**100% line coverage and 100% branch coverage on every touched file.**

"Touched" means the file appears in the session's staged diff — added or modified. Files that are only renamed or deleted are not subject to coverage measurement.

Run the project's coverage tool after the Refactor commit and confirm the report shows 100% on each touched path before handing off or merging.

**Exemptions** — declare in the PR body as `Coverage exemption: <file> — <reason>`:

1. `main.ts` / entry-point boot files — wires the process together; side-effect-heavy; infrastructure, not logic.
2. `*.d.ts` type-only declaration files — no executable statements to cover.
3. ORM entity files where the body is decorator-only (e.g. `@Entity()`, `@Column()`) — decorators are metadata; there is no branch logic to exercise.

No other exemptions are recognized. "It's small" and "it's obvious" are not valid reasons.

## Q-TDD-MAIN halt

**Condition**: autonomous mode is active AND the current agent is `main` AND the next planned action is entering TDD Red (writing a failing test) directly.

**Action**:

1. Halt. Do not write any test or source file.
2. Append a `Q-TDD-MAIN` entry to `docs/harness/user-queue.md` (or `.omc/state/queue.md` if the harness queue is not present) with:
   - The task description.
   - The planned test file path(s).
   - Tentative default: dispatch fresh sonnet executor.
3. Dispatch a fresh sonnet subagent with the TDD Red task. Main resumes after the subagent completes Green + Refactor and reports back.

**Rationale**: main in autonomous mode is the orchestrator. Entering TDD Red directly conflates orchestration with implementation. A fresh executor maintains clean separation and prevents main from silently self-verifying its own test authorship.

## Anti-patterns

| # | Pattern | Why it fails |
|---|---|---|
| 1 | **Test-from-impl** — read the implementation first, then write a test that mirrors it | Tests confirm the code exists, not that it is correct. Write the test from the specification or requirement only. |
| 2 | **Coverage-padding** — add assertions that exercise lines without asserting behavior | Line count rises; defect detection does not. Every assertion must document an observable behavior contract. |
| 3 | **Shared test state** — `beforeAll` mutates a shared object that multiple `it` blocks read | Test order dependency. One failing test poisons the suite. Each test must arrange its own state. |
| 4 | **Mock behavior testing** — assert that a mock was called with specific arguments as the primary assertion | Tests the wiring, not the outcome. Assert on the output or observable side effect; use mocks only when the real dependency is unavoidable (network, clock, file system on CI). |
| 5 | **Impl-first rationalization** — write production code, then claim the test "would have been the same anyway" | Violates Iron Law. The Red phase is not optional. Retroactive tests do not catch the class of bugs TDD prevents. |
| 6 | **"Keep as reference"** — leave a superseded test file in the tree because it might be useful later | Dead tests rot. Delete obsolete tests at Refactor time; the git history is the reference. |
| 7 | **Skip TDD for 1-liners** — "it's a one-liner, no test needed" | Size does not exempt production code from coverage. A one-liner can carry a branch (`if`, ternary, `??`). Write the test. |
| 8 | **Mock-all by default (ECC pattern — REJECTED)** — mock every dependency regardless of cost | pi-oven policy overrides ECC: mocks only when the real dependency is unavoidable. Overuse of mocks produces tests that pass against an imaginary system. |

Deeper rationale: skill://pi-oven/tdd-strict/references/anti-patterns.md

## Agent Dispatch (omp)

In an omp session, run TDD via dedicated agents instead of inline:

- Red phase (test design + failing test): dispatch `pi-oven:test-engineer`.
- Green phase (minimal implementation that makes the test pass): dispatch `pi-oven:executor`.
- Refactor verification (behavior preserved, test still green): dispatch `pi-oven:verifier`.
- Diagnose a stubbornly failing test: dispatch `pi-oven:debugger`.

If two consecutive green attempts fail, escalate to `pi-oven:oracle` for a strategic re-think before continuing.
