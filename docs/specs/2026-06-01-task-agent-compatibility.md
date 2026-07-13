> Historical; do not copy runtime syntax examples from this document.

# Spec: task agent compatibility for unknown pi-oven aliases

**Status**: ACCEPTED v1 — 2026-06-01
**Scope**: `.omp/extensions/pi-oven-runtime/gate-handler.ts`, `tests/extensions/pi-oven-runtime/gate-handler.test.ts`, `commands/pi-oven-autonomous.md`

## Problem

In some harness sessions, the `task` tool agent registry is fixed to built-in names only. Dispatching `pi-oven:executor` then fails with `Unknown agent` before work starts.

The previous runtime guard hard-blocked bare built-in names and required `pi-oven:*`, which amplified this failure mode.

## Decision

1. `task` dispatch guard is changed to compatibility mode:
   - allow bare names (`executor`, `planner`, ...)
   - allow `pi-oven:*` aliases
   - block only foreign namespaced refs (`oh-my-claudecode:*`, `omo:*`, ...)
2. Documentation is updated to explicitly describe fallback behavior:
   - prefer `pi-oven:*` when registry is loaded
   - use bare names when `pi-oven:*` is not registered in current harness

## Acceptance criteria

- Built-in bare names are not blocked by gate handler.
- `pi-oven:*` aliases are not blocked by gate handler.
- Foreign namespaced refs are blocked with a clear reason.
- `/pi-oven:autonomous` command guidance documents both modes.

## Non-goals

- No task-argument rewrite (not supported by current tool-call hook contract).
- No runtime registration API for agents (outside plugin scope).