---
name: deep-dive
version: 0.1.0
description: bug-investigation pipeline — 3 parallel autonomous tracer lanes, then a bounded clarification of only the trace-unresolvable unknowns
trigger: "deep dive, deep-dive, trace and clarify, deep investigation, 깊게 파봐, 심층 분석, 원인 추적"
alwaysApply: false
---

# deep-dive

## Purpose

This is the bug-investigation tool. It follows trace lanes **autonomously**: Stage 1 dispatches `pi-oven:tracer` (agent file: `agents/pi-oven-tracer.md`) across 3 parallel causal investigation lanes. Stage 2 is a **bounded clarification** — the main agent asks only the per-lane critical unknowns the trace genuinely could not resolve, preferring to run the recommended discriminating probe over asking. The trace findings feed forward via a 3-point injection mechanism, producing a spec grounded in evidence rather than assumptions.

deep-dive is **not** a relentless requirements interview — when full spec convergence is needed, that is `brainstorming`'s job. Solving the context-loss problem that occurs when trace and clarification are run separately: findings discovered in the trace carry directly into the clarification's starting point, codebase context, and first questions.

## When to use

- User has a problem but does not know the root cause — investigation is needed before requirements
- User says "deep dive", "deep-dive", "trace and clarify", "deep investigation", or "investigate deeply"
- Bug investigation: something broke and the fix needs to be understood before planning
- Feature exploration: need to understand how something currently works before defining changes
- The problem is ambiguous, causal, and evidence-heavy — jumping to code would waste cycles

## When not to use

- User already knows the root cause — use an interview or `spec-and-review` directly
- User has a clear, specific request with file paths and function names — execute directly
- User wants trace only without requirements gathering
- User says "just do it" or "skip the investigation" — respect the intent

## Dispatch discipline (main orchestrates, subagents do the work)

**Do NOT run this skill's substantive work in the main context.** Main's direct-action budget is narrow: 1–2 file simple edits (≤30 LoC) or operational commands (`git status`, `ls`, install). ANY multi-file change, 3+ file reads, 200+ LoC, or multi-step investigation/implementation MUST be dispatched — main only dispatches, synthesizes, and reviews, never implements inline (see `large-task-delegation` + `subagent-driven-development`).
**Right-agent routing** (model-fit + role-fit is first-class — use these exact names): causal investigation → `pi-oven:tracer`; deep analysis → `pi-oven:analyst`; broad read → `pi-oven:explorer`.

## Phase 1: Initialize

1. Parse the user's idea from the trigger input
2. Generate a slug: kebab-case from the first 5 words, lowercased, special characters stripped
3. Detect brownfield vs greenfield: dispatch `pi-oven:explorer` (model: haiku) to check whether the working directory has existing source files, package files, or git history
4. Generate 3 trace lane hypotheses. Default lanes (use unless the problem strongly suggests a better partition):
   - **Lane 1**: Code-path / implementation cause
   - **Lane 2**: Config / environment / orchestration cause
   - **Lane 3**: Measurement / verification methodology cause — covers verification-method defects, not just system defects (e.g., the verification query uses the wrong key, the comparison filter shape does not match the schema grain)
5. For brownfield: also pass codebase area context to the trace lanes from the explorer's findings

## Phase 2: Lane confirmation

Present the 3 hypotheses to the user via `ask` for a single confirmation round:

> Starting deep dive. I'll investigate through 3 parallel trace lanes, then use the findings for a short, targeted clarification of anything the trace could not resolve.
>
> **Problem:** "{initial_idea}"
> **Project type:** {greenfield|brownfield}
>
> **Proposed trace lanes:**
> 1. {hypothesis_1}
> 2. {hypothesis_2}
> 3. {hypothesis_3}
>
> Confirm these, or adjust them?

**One round only.** After confirmation, proceed immediately. When this confirmation is a single-select option choice, prefer the `pi-oven_ask` tool (options as `{label, description}`) so each lane's rationale shows beside it in the live picker; keep the built-in `ask` for multi-select or free-form input.

## Phase 3: Trace execution

Dispatch `pi-oven:tracer` (agent file: `agents/pi-oven-tracer.md`) for each confirmed hypothesis. Fire all 3 in parallel — one `task` call per lane, all in the same response turn, each with `run_in_background: true`.

This parallel dispatch pattern is established in `skills/large-task-delegation/SKILL.md:51`: "multiple task calls in one response, each with run_in_background: true".

Each tracer lane must:
- Own exactly one hypothesis
- Gather evidence for and against the lane
- Rank evidence strength (controlled reproduction → speculation)
- Name the critical unknown for the lane
- Recommend the best discriminating probe

After all 3 tracer lanes complete:
- Run synthesis: rank hypotheses by confidence, detect convergence (if two hypotheses reduce to the same mechanism, merge explicitly)
- Produce the trace output structure (see below)
- Save to `.omc/specs/deep-dive-trace-{slug}.md`

### Trace output format

```markdown
# Deep Dive Trace: {slug}

## Observed Result
[What was actually observed / the problem statement]

## Ranked Hypotheses
| Rank | Hypothesis | Confidence | Evidence Strength |
|------|------------|------------|-------------------|
| 1    | ...        | High       | Strong            |
| 2    | ...        | Medium     | Moderate          |
| 3    | ...        | Low        | Weak              |

## Evidence Summary by Hypothesis
- **Lane 1**: ...
- **Lane 2**: ...
- **Lane 3**: ...

## Per-Lane Critical Unknowns
- **Lane 1**: {critical_unknown_1}
- **Lane 2**: {critical_unknown_2}
- **Lane 3**: {critical_unknown_3}

## Rebuttal Round
- Best rebuttal to leader: ...
- Why leader held / failed: ...

## Most Likely Explanation
[Current best explanation, or "Insufficient evidence" if all lanes are low-confidence]

## Recommended Discriminating Probe
[Single next probe that would collapse uncertainty fastest]
```

## Phase 4: Bounded clarification with 3-point injection

After the autonomous trace synthesis, the main agent runs a **bounded clarification** — no sub-dispatch in this phase. Ask only the per-lane critical unknowns the trace genuinely could not resolve, and **prefer running the recommended discriminating probe (autonomous) over asking the user.** This is a short clarification, not a convergence interview — relentless spec convergence belongs to `brainstorming`, not deep-dive. Before the first question, inject 3 points from the trace:

**Injection 1 — initial idea enrichment**: if the trace has a high-confidence most likely explanation, reframe the opening with:
```
Trace finding: {most_likely_explanation}
Given this root cause, what should we do about it?
```
If all lanes are low-confidence, skip this injection — do not inject an uncertain conclusion.

**Injection 2 — codebase context replacement**: skip re-exploring the codebase. Use the trace's system area mapping as codebase context. The trace already mapped relevant areas with evidence — re-exploring is redundant.

**Injection 3 — initial question queue**: extract per-lane critical unknowns. Ask only those the trace could not resolve and a probe cannot answer — the clarification is bounded to these, not an open-ended questioning loop.

If all lanes are low-confidence: still apply Injection 2 (even inconclusive findings provide structural context) and Injection 3 (inject all per-lane unknowns — more open questions are more useful when trace is uncertain).

### Clarification loop (bounded)

- Ask only what tracing could not resolve; if a probe can answer it, run the probe instead of asking
- One question per turn when you must ask, targeting a trace-unresolvable critical unknown
- For single-select option questions, prefer the `pi-oven_ask` tool (options as `{label, description}`) so each option's rationale shows beside it; keep the built-in `ask` for multi-select or free-form input
- Keep it bounded — this is a bug-investigation pipeline, not a spec interview; stop once the trace-unresolvable unknowns are answered or deferred
- Spec saved to `.omc/specs/deep-dive-{slug}.md`
- Spec includes all standard sections plus an additional **Trace Findings** section summarizing the trace results

## Phase 5: Execution bridge

Present execution options to the user via `ask`. Always pass `spec_path` explicitly. This skill is a requirements pipeline — never implement directly.

**Options** (map to pi-oven skill equivalents):
1. **Full pipeline (recommended)**: `spec-and-review` → `writing-plans` → `subagent-driven-development`
2. **Direct execution**: `autonomous-loop` with the spec as input
3. **Planning only**: `writing-plans` with the spec as input (skip critic loop)
4. **Refine further**: return to Phase 4 clarification loop

## Tool usage

- `ask` for lane confirmation (Phase 2) and each bounded clarification question (Phase 4) — prefer `pi-oven_ask` with `{label, description}` options for single-select choices so rationales show beside each option; keep built-in `ask` for multi-select / free-form
- `task` with `run_in_background: true` to dispatch 3 parallel `pi-oven:tracer` lanes (Phase 3)
- `pi-oven:explorer` (model: haiku) for brownfield codebase detection (Phase 1)
- `Write` to save trace result to `.omc/specs/deep-dive-trace-{slug}.md` and final spec to `.omc/specs/deep-dive-{slug}.md`

## Stop conditions

- **User says "stop", "cancel", "abort"**: stop immediately, save current state
- **Trace timeout**: if a tracer lane takes unusually long, warn the user and offer to proceed with partial results
- **All lanes inconclusive**: proceed to clarification with graceful degradation — skip Injection 1 only
- **User says "skip trace"**: allow skipping to Phase 4 with a warning that the clarification will have no trace context (and that full spec convergence is `brainstorming`'s job, not deep-dive's)
- **Clarification stalls**: if a trace-unresolvable unknown stays unanswered after a couple of rounds, surface the stall explicitly and ask the user to provide the missing information directly or run the discriminating probe

## Examples

**Bug investigation — trace-to-clarification flow:**
```
User: deep dive into why our auth token expires early

[Phase 1] Brownfield detected. 3 hypotheses generated:
  1. Code-path: token TTL is set incorrectly at issuance
  2. Config/env: clock skew between auth server and validator
  3. Measurement: test is measuring wall-clock time, not token expiry field

[Phase 2] User confirms hypotheses.

[Phase 3] 3 parallel pi-oven:tracer dispatches (run_in_background: true).
  Synthesis: Most likely = clock skew (Lane 2, High confidence)
  Per-lane critical unknowns:
    Lane 1: where TTL is set vs. where it is validated
    Lane 2: NTP sync status between services
    Lane 3: which timestamp field the test asserts against

[Phase 4] Bounded clarification with injection:
  "Trace finding: clock skew between auth server and validator.
   Given this root cause, what should we do about it?"
  Only the trace-unresolvable unknowns are asked:
    Q1: "Are the auth and validator services on the same host or different hosts?"
    Q2: "Is NTP configured on both?"
  → Stops once those unknowns are answered (or a probe resolves them).

[Phase 5] Spec ready. User selects writing-plans → subagent-driven-development.
```

**Low-confidence trace — graceful degradation:**
```
User: deep-dive — improve our caching layer

[Phase 3] All lanes low-confidence (exploration, not a bug).
  Per-lane critical unknowns:
    Lane 1: which cache keys have the highest miss rate
    Lane 2: TTL configuration per cache tier
    Lane 3: whether cache hit rate is actually being measured correctly

[Phase 4] Injection 1 skipped (no confident conclusion).
  Injection 2 applied: trace system mapping used as codebase context.
  Injection 3 applied: the trace-unresolvable per-lane unknowns seeded as the clarification questions.
  → Bounded clarification confirms direction from concrete unknowns; deeper spec convergence, if needed, hands off to brainstorming.
```

**Bad — skipping lane confirmation:**
```
[Phase 1] Hypotheses generated.
[Phase 3] Trace starts immediately without showing hypotheses to user.
```
Wrong: Phase 2 must run. The user may know one hypothesis is irrelevant, wasting a tracer lane.

**Bad — implementing directly after spec:**
```
[Phase 5] Spec is ready. I'll now write the fix...
```
Wrong: this skill ends at spec generation. Always present execution options via `ask` and invoke the chosen skill.
