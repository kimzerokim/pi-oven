# Spec: eval-runner `skill_triggered` matcher hardening

**Status**: ACCEPTED v1 — 2026-06-01
**Scope**: `scripts/lib/eval-runner.ts`, `tests/scripts/eval-runner.test.ts`

## Brainstorming

### Goal
Make skill-invocation evals trustworthy so autonomous/skill quality gates fail when a specific expected skill signal is missing.

### Options considered

1. **Keep current matcher and tighten scenarios only**
   - Pros: zero code change.
   - Cons: cannot enforce `skill_triggered: "<name>"`; silent false positives remain.
2. **Deprecate `skill_triggered` entirely and require `tool_calls_required`**
   - Pros: explicit and strict.
   - Cons: breaks existing scenarios and removes lightweight intent checks.
3. **Harden matcher semantics (chosen)**
   - `true` => any activation evidence.
   - `false` => no activation evidence.
   - `"name"` => that specific token must appear in tool-call names or assistant text.
   - Pros: backward compatible for existing `true`, adds strict named-skill checks.
   - Cons: slightly stricter behavior could surface currently-hidden failures.

## Decision
Implement option 3.

## Acceptance criteria

- `skill_triggered: true` fails when there is no tool-call and no assistant content evidence.
- `skill_triggered: false` fails when activation evidence exists.
- `skill_triggered: "<target>"` fails when `<target>` is absent from tool-call names and assistant content.
- Unit tests cover positive and negative cases for string and boolean modes.

## Non-goals

- No schema shape changes.
- No changes to scenario files in this iteration.
- No CLI/reporting format changes outside new failure messages.
