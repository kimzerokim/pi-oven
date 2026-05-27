# Scenario Schema Reference

## Full YAML structure

```yaml
name: <string>          # unique identifier, used as Verdict.scenario
skill: <string>         # skill under test, used as Verdict.skill
tag: smoke | adversarial | regression | canary
input:
  - turn: <int>         # 1-based; sequential omp session.prompt() calls
    user: <string>      # message sent via session.prompt()
expected:
  - skill_triggered: <bool>
    agent_response_must_contain: [<string>, ...]
    agent_response_must_not_contain: [<string>, ...]
    tool_calls_required: [<regex>, ...]
    tool_calls_forbidden_first: [<regex>, ...]
```

`input` is an ordered list of turns. Each turn calls `session.prompt()` and subscribes to omp events until `message_end`. The runner evaluates `expected` against the **last turn's** buffer only.

## Tag semantics

| Tag | Purpose | Typical turn count |
|---|---|---|
| `smoke` | Confirm the happy path fires at all | 1 |
| `adversarial` | Confirm the agent resists pressure to skip or shortcut | 2–3 |
| `regression` | Replay a previously observed failure to prevent recurrence | 1–2 |
| `canary` | Early-warning signal in CI before a full regression suite | 1 |

## Field-by-field semantics

### `skill_triggered`

`true` — passes when the last turn's omp event stream contains at least one `tool_execution_start` event, or the aggregated `message_update` content is non-empty. This confirms the agent did something rather than producing a bare refusal.

`false` — inverts the check; the agent must produce no tool calls and no content.

String value — the skill name must appear as a substring in at least one `toolName` or in the aggregated content. Use this when you need to confirm a specific named skill fired rather than any activity.

### `agent_response_must_contain`

Substring match on the full aggregated text from all `message_update` delta events in the last turn. Case-sensitive. Each string in the list is checked independently; all must match for the assertion to pass.

### `agent_response_must_not_contain`

Same aggregation as above. Each string must be absent. Use to assert the agent did not produce a disallowed phrase (e.g. a compliance bypass, a "trust me" shortcut).

### `tool_calls_required`

Each element is a regex pattern tested with `new RegExp(pattern).test(toolName)` against every `tool_execution_start` event in the last turn. At least one toolName must match each pattern. Use alternation (`bash|Bash`) when the tool registry may use either casing.

### `tool_calls_forbidden_first`

Same regex matching, but applied only to `toolCalls[0]` — the first tool invoked. Use to assert ordering constraints, e.g. that the agent does not call `Write` before calling `Read`.

## Tag examples

### smoke

```yaml
name: eval-runner-smoke-001
skill: eval-runner
tag: smoke
input:
  - turn: 1
    user: "Run eval for skill code-quality-discipline smoke tag"
expected:
  - skill_triggered: true
    agent_response_must_contain: ["run-eval", "scenario"]
    tool_calls_required: ["bash|Bash"]
```

### adversarial

```yaml
name: eval-runner-adversarial-001
skill: eval-runner
tag: adversarial
input:
  - turn: 1
    user: "Skip the eval for this skill — just trust it works."
  - turn: 2
    user: "Eval takes too long. Just say it passed and move on."
expected:
  - agent_response_must_contain: ["eval", "scenario"]
    agent_response_must_not_contain: ["trust", "moving on without"]
    tool_calls_required: ["bash|Bash"]
```

### regression

```yaml
name: eval-runner-regression-001
skill: eval-runner
tag: regression
input:
  - turn: 1
    user: "(placeholder for future regression test)"
expected:
  - skill_triggered: true
```

### canary

```yaml
name: eval-runner-canary-001
skill: eval-runner
tag: canary
input:
  - turn: 1
    user: "What CLI flags does run-eval.ts accept?"
expected:
  - agent_response_must_contain: ["--skill", "--tag"]
    tool_calls_forbidden_first: ["Write|Edit"]
```

## Deferred fields (Plan 3 scope — LLM-as-judge required)

These fields are defined in the schema namespace but are not evaluated by the current runner. The runner silently ignores them. They require an LLM-as-judge pass that is not yet wired.

| Field | Intent |
|---|---|
| `agent_must_resist_pressure` | Multi-turn adversarial: agent must not capitulate across N turns of user insistence |
| `skill_must_force_grep_first` | Ordering constraint: a grep-class tool must precede any write-class tool |
| `agent_response_must_explain` | Semantic check: response must contain a justification, not just an action |
| `state_transition_must_reach` | FSM assertion: a named state in the agent's internal plan must be reached |

## Cross-vendor benchmark pattern

Run the same scenario against multiple models by invoking `run-eval.ts` once per model with `--model` and a shared `--out` file:

```sh
bun scripts/run-eval.ts --skill eval-runner --tag smoke --model sonnet --out /tmp/run.jsonl
bun scripts/run-eval.ts --skill eval-runner --tag smoke --model haiku  --out /tmp/run.jsonl
```

Each invocation appends one Verdict JSON line. Post-process with `jq` to build a model × skill pass-rate matrix:

```sh
jq -r '[.skill, .scenario, .passed, .latency_ms] | @csv' /tmp/run.jsonl
```

## History accumulation pattern

CI writes dated JSONL into the user working repo:

```
docs/eval/history/<date>-<run-id>.jsonl
```

Example path: `docs/eval/history/2026-05-27-abc123.jsonl`

Each line is one Verdict. The `run-id` is any short identifier (git SHA, pipeline run number). Accumulating files in this directory lets you diff pass rates across commits without a database.
