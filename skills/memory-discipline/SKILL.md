---
name: memory-discipline
version: 0.1.0
description: Defines when to retain, recall, and reflect — wires omp Hindsight memory into all pi-oven flows.
alwaysApply: true
trigger: "메모리 규율, 기억 저장, retain 정책, flow start, recall, cycle end"
---

# memory-discipline

## When to use

Fires at every flow entry point and cycle boundary — `spec-and-review`, `autonomous-loop`, `deep-dive`, `deep-init`, `improve-codebase-architecture`. No N-file threshold. Every planning step and every confirmed decision carries the same memory obligation.

## Prerequisite check

If `memory.backend` is not `hindsight` or `mnemopi`, log a warning and skip all `retain`/`recall`/`reflect` calls gracefully. Do not fail. The skill degrades to a no-op when the backend is off — it does not block execution.

## When to `recall` (flow start, before planning)

Call `recall` before the first substantive tool call in any planning or analysis step. Core roles that must recall before first tool call: `pi-oven:planner`, `pi-oven:oracle`, `pi-oven:architect`, `pi-oven:critic`, `pi-oven:deep-researcher`.

Recall query patterns:
- `"prior decisions for <feature/module>"`
- `"past failures in <area>"`
- `"open questions from last session"`

Provisional call syntax (TODO-verify schema against omp tool registration):
```
recall({query: "prior decisions for <feature>"})
```

Do not skip recall on grounds that "this is a fresh task" — prior context prevents repeating mistakes.

## When to `retain` (cycle end / decision / lesson)

Retain immediately after any of the following events:
- Plan finalised
- Architectural decision made
- A hypothesis is disproven (retain the disproof, not the hypothesis)
- A bug root cause is confirmed
- A security finding is filed
- A research synthesis is complete

Format: batch of self-contained factual statements (who/what/when/why). No speculation. No "we decided to" — state facts only. `retain` takes a batch, not a single positional string.

Provisional call syntax (TODO-verify schema):
```
retain([{fact: "…"}, {fact: "…"}])
```

## When to `reflect` (synthesis)

After retaining 3 or more related items in a session, call `reflect` to synthesise them into a higher-level insight and retain the synthesis.

Provisional call syntax (TODO-verify schema):
```
reflect({context: "session topic"})
```

## When NOT to retain

Do not retain: intermediate tool results, work-in-progress, uncertain hypotheses, file contents, transient state.

## Entry-point wiring

### spec-and-review
`recall` prior specs and decisions before first agent dispatch (Step 0, Agent Dispatch block). `retain` immediately after plan approval.

### autonomous-loop
`recall` prior cycle failures at loop entry (ASK-FIRST / pre-loop block). `retain` at each confirmed MILESTONE. `reflect` at loop exit.

### deep-dive
`recall` prior investigation of this component before tracer fan-out (Phase 2). `retain` confirmed root cause on exit.

### improve-codebase-architecture
`recall` prior architecture decisions and ADRs before `pi-oven:explorer` dispatch (Step 1 Survey). `retain` the accepted architecture change.

### large-task-delegation
`recall` prior delegation outcomes for this task type before dispatch anatomy. `retain` delegation result and lessons.

## Agent Dispatch (omp)

Memory operations are lightweight self-calls — they do not require a dedicated subagent dispatch. Each role listed above calls `recall`/`retain`/`reflect` directly within its own task context.

Additional skills that benefit from memory wiring: `systematic-debugging` (recall prior failure modes), `fresh-verifier` (recall prior verification failures).
