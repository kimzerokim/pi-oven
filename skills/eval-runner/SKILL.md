---
name: eval-runner
version: 0.1.0
description: Run skill eval scenarios (smoke/adversarial/regression/canary) via omp SDK + scenario YAML schema
trigger: keywords "eval", "benchmark", "scenario", "run-eval"
alwaysApply: false
---

# eval-runner

## When to use

Use eval-runner whenever you need evidence that a skill behaves as specified under real agent conditions.

Three contexts trigger it:

- **Manual eval run** — a user or agent wants to verify a specific skill before shipping or after modifying it.
- **Verdict gate in per-skill migration cycle** — each skill cycle ends with a smoke pass before merge. The eval-runner produces the `Verdict` JSON that the gate reads.
- **CI eval pipeline** — scheduled or PR-triggered runs over all scenarios; `--out <file>` writes JSONL for history accumulation.

## Command summary

| Invocation | What it does |
|---|---|
| `/pi-oven:eval <skill>` | Run all scenarios for `<skill>` across every tag |
| `/pi-oven:eval-all [--tag smoke]` | Run every skill's scenarios, optionally filtered by tag |
| `/pi-oven:benchmark <task>` | Cross-model matrix run; `--model` selects one model by fuzzy name |

All three slash commands drive the same underlying CLI:

```sh
bun scripts/run-eval.ts --skill <name> [--scenario <name>] [--tag smoke|adversarial|regression|canary] [--out <file>] [--model <fuzzy>]
```

- `--skill` — limit discovery to `evals/<skill>/scenarios/`
- `--scenario` — substring filter on scenario filename
- `--tag` — regex match on the `tag:` field inside each YAML file
- `--out` — write one JSON Verdict per line to this file (JSONL)
- `--model` — fuzzy model name forwarded to omp `ModelRegistry.refresh()`

## Scenario YAML schema (5 evaluable fields)

Each `expected` block may include any combination of these assertions. All assertions evaluate against the **last turn's** aggregated omp event buffer.

- `skill_triggered: bool` — passes when at least one `tool_execution_start` event fired, or content is non-empty; `false` asserts the opposite
- `agent_response_must_contain: string[]` — each string must appear as a substring in the aggregated `message_update` deltas
- `agent_response_must_not_contain: string[]` — each string must be absent from the aggregated content
- `tool_calls_required: string[]` — regex patterns; at least one `tool_execution_start` toolName must match each pattern
- `tool_calls_forbidden_first: string[]` — regex patterns; the first `tool_execution_start` toolName must not match any pattern

## Result schema (JSON Verdict)

```json
{
  "scenario":    "eval-runner-smoke-001",
  "skill":       "eval-runner",
  "passed":      true,
  "failures":    [],
  "observations": ["turn 1: tools=[Bash] content=\"bun scripts/run-eval.ts...\""],
  "latency_ms":  1240,
  "token_in":    0,
  "token_out":   0
}
```

`token_in` / `token_out` are reserved; the omp SDK does not yet emit a standardised token-count event. They will be non-zero once that event lands.

## Failure modes

| Exit code | Cause |
|---|---|
| `0` | All scenarios passed, or no scenario files matched the filters |
| `1` | One or more `Verdict.passed === false` |
| `2` | Unhandled exception — most common cause: no LLM key found by `discoverAuthStorage()` |

---

Deep schema: skill://pi-oven/eval-runner/references/scenario-schema.md
