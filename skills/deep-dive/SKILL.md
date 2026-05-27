---
name: deep-dive
version: 0.1.0
description: 2-stage causal investigation → requirements crystallization pipeline; dispatches 3 parallel tracer lanes then runs Socratic interview
trigger: "deep dive, deep-dive, trace and clarify, deep investigation"
alwaysApply: false
---

# deep-dive

## Purpose

Orchestrates a 2-stage pipeline: Stage 1 dispatches `pi-oven:tracer` (agent file: `agents/pi-oven-tracer.md`) across 3 parallel causal investigation lanes; Stage 2 conducts a Socratic interview (main agent drives, no sub-dispatch) to crystallize requirements. The trace findings feed into the interview via a 3-point injection mechanism, producing a spec grounded in evidence rather than assumptions.

Solves the context-loss problem that occurs when trace and interview are run separately: findings discovered in the trace carry directly into the interview's starting point, codebase context, and first questions.

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

> Starting deep dive. I'll investigate through 3 parallel trace lanes, then use the findings to conduct a targeted interview.
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

**One round only.** After confirmation, proceed immediately.

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

## Phase 4: Interview with 3-point injection

The main agent conducts a Socratic interview — no sub-dispatch in this phase. Before the first question, inject 3 points from the trace:

**Injection 1 — initial idea enrichment**: if the trace has a high-confidence most likely explanation, reframe the opening with:
```
Trace finding: {most_likely_explanation}
Given this root cause, what should we do about it?
```
If all lanes are low-confidence, skip this injection — do not inject an uncertain conclusion.

**Injection 2 — codebase context replacement**: skip re-exploring the codebase. Use the trace's system area mapping as codebase context. The trace already mapped relevant areas with evidence — re-exploring is redundant.

**Injection 3 — initial question queue**: extract per-lane critical unknowns. Ask these as the first 1–3 questions before normal ambiguity-driven questioning resumes.

If all lanes are low-confidence: still apply Injection 2 (even inconclusive findings provide structural context) and Injection 3 (inject all per-lane unknowns — more open questions are more useful when trace is uncertain).

### Interview loop

- One question per turn, targeting the weakest ambiguity dimension
- Continue until the spec is sufficiently specified (ambiguity ≤ threshold)
- Spec saved to `.omc/specs/deep-dive-{slug}.md`
- Spec includes all standard sections plus an additional **Trace Findings** section summarizing the trace results

## Phase 5: Execution bridge

Present execution options to the user via `ask`. Always pass `spec_path` explicitly. This skill is a requirements pipeline — never implement directly.

**Options** (map to pi-oven skill equivalents):
1. **Full pipeline (recommended)**: `spec-and-review` → `writing-plans` → `subagent-driven-development`
2. **Direct execution**: `autonomous-loop` with the spec as input
3. **Planning only**: `writing-plans` with the spec as input (skip critic loop)
4. **Refine further**: return to Phase 4 interview loop

## Tool usage

- `ask` for lane confirmation (Phase 2) and each interview question (Phase 4)
- `task` with `run_in_background: true` to dispatch 3 parallel `pi-oven:tracer` lanes (Phase 3)
- `pi-oven:explorer` (model: haiku) for brownfield codebase detection (Phase 1)
- `Write` to save trace result to `.omc/specs/deep-dive-trace-{slug}.md` and final spec to `.omc/specs/deep-dive-{slug}.md`

## Stop conditions

- **User says "stop", "cancel", "abort"**: stop immediately, save current state
- **Trace timeout**: if a tracer lane takes unusually long, warn the user and offer to proceed with partial results
- **All lanes inconclusive**: proceed to interview with graceful degradation — skip Injection 1 only
- **User says "skip trace"**: allow skipping to Phase 4 with a warning that the interview will have no trace context (effectively becomes a standalone interview)
- **Interview stalls**: if ambiguity stops decreasing after 3 rounds targeting the same dimension, surface the stall explicitly and ask the user to provide the missing information directly

## Examples

**Bug investigation — trace-to-interview flow:**
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

[Phase 4] Interview with injection:
  "Trace finding: clock skew between auth server and validator.
   Given this root cause, what should we do about it?"
  First questions from per-lane unknowns:
    Q1: "Are the auth and validator services on the same host or different hosts?"
    Q2: "Is NTP configured on both?"
  → Continues until spec threshold reached.

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
  Injection 3 applied: all 3 per-lane unknowns seeded as first questions.
  → Interview drives exploration forward from concrete unknowns.
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
