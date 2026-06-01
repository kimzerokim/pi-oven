# Plan — spec-interview convergence (grill-with-docs) + deep-dive autonomy + metis delegation fix

> Branch: `feature/simplify` (continuing, per user). Commit-only, no PR.
> Trigger: user verified `pi-oven:metis` caps at MAX 3 questions and the default spec path (brainstorming)
> has no convergence gate — it stops when the model "feels" it has enough (docs literally say "3–6" / "2–3 questions").
> This closes audit gap #11 (spec-negotiation convergence) for UC1.

## Decisions (user, 2026-06-01)
1. Model the relentless questioning on **grill-with-docs** (`external_harness/.../engineering/grill-with-docs`). Port the discipline into pi-oven's `brainstorming` (English-only, self-contained — no external path dependency; credit the pattern like checklist.md credits superpowers).
2. **deep-dive is the bug-investigation tool — it must follow trace lanes AUTONOMOUSLY, not run a long user interview.** Trim Phase 4 to a bounded clarification. The relentless spec-convergence interview belongs to `brainstorming`, NOT deep-dive.
3. `pi-oven:metis` is a one-shot pre-analysis subagent (≤3 seed questions, non-interactive). The interactive multi-round convergence interview is owned by the **main agent inline** (it takes user turns). Fix the skills that wrongly delegate the interactive interview to metis.

## grill-with-docs discipline to port (the convergence engine)
- Interview relentlessly, **one question at a time**, waiting for feedback on each; **provide a recommended answer per question.**
- Walk **each branch of the design tree**, resolving inter-decision dependencies one-by-one.
- **If a question can be answered by exploring the codebase, explore instead of asking.**
- **Sharpen fuzzy/overloaded terms** → propose a precise canonical term; **challenge terms** that conflict with existing project language.
- **Stress-test with concrete scenarios** that probe edge cases and force precision on concept boundaries.
- **Cross-reference claims against the code**; surface contradictions explicitly.
- Continue **until shared understanding is reached** — not until the model thinks it has enough.

## Exact edits

### File 1 — `skills/brainstorming/SKILL.md`
- **Step 3 (line ~32)** "Q&A — ask clarifying questions one at a time ... stop when intent is unambiguous": rewrite into a **relentless convergence loop** — one question per turn, each with a recommended answer; walk every design-tree branch resolving dependencies; explore the codebase instead of asking when the answer is discoverable; sharpen/challenge fuzzy or conflicting terms; stress-test with concrete edge-case scenarios; cross-reference claims against code. **No fixed question count.**
- **"Q&A discipline" section (lines ~40–45):** replace "Stop asking when you have enough to write a coherent spec" with the **convergence gate**: continue until EVERY design dimension (Goals, Non-goals, Constraints, Data model, API surface, Open questions) is **resolved or explicitly deferred by the user**, then present for approval. **Never stop on "I think I have enough" alone.** Add a **stall rule**: if a dimension stops converging after a few rounds, surface the stall and ask the user to decide directly or mark it OPEN.
- **Agent Dispatch (line ~69)** "Intent clarification (one-question-at-a-time interview): dispatch `pi-oven:metis`": change to — the **interactive convergence interview is run inline by the main agent** (it owns the user turns); dispatch `pi-oven:metis` **once** for pre-analysis only (intent classification + codebase pre-analysis + at most a few informed seed questions), never as the convergence loop.
- Add a one-line credit: convergence discipline adapted from the `grill-with-docs` pattern.

### File 2 — `skills/brainstorming/references/checklist.md`
- **Step 3 (lines ~21–26):** remove "Typical question count: 3–6 for a medium feature; fewer for obvious scope" and "Stop when you can write a coherent Goals + Constraints section without further input." Replace with the dimension-tracked convergence gate + the grill disciplines (recommended answer per Q; explore-instead-of-ask; sharpen terms; concrete-scenario stress-test; code cross-ref; relentless until shared understanding).
- **Adversarial edge case #2 (line ~82):** "it takes 2–3 questions" → reframe so it never promises a tiny count (e.g., "Let me capture the design first — as many questions as it takes to resolve every dimension, usually more for non-trivial scope").
- Keep Step 8 approval gate; clarify approval comes only **after** all dimensions are resolved-or-deferred.

### File 3 — `skills/deep-dive/SKILL.md`
- **description (line ~4) + Purpose (line ~13):** reframe headline from "Socratic interview to crystallize requirements" to **autonomous causal tracing** (3 parallel lanes) + a **bounded clarification** of trace-unresolvable unknowns. deep-dive does not run a relentless user interview.
- **Phase 4 (lines ~115–137):** trim. After the autonomous trace synthesis, ask **only the per-lane critical unknowns the trace genuinely could not resolve** — a short bounded clarification, not a convergence interview. **Prefer running the recommended discriminating probe (autonomous) over asking the user.** Cross-ref: relentless spec convergence is `brainstorming`'s job, not deep-dive's.
- **Interview loop (lines ~132–137)** "Continue until the spec is sufficiently specified (ambiguity ≤ threshold)": reframe → "Ask only what tracing could not resolve; if a probe can answer it, run the probe instead. Keep the clarification bounded — this is a bug-investigation pipeline, not a spec interview."
- Keep Phases 1–3 (autonomous trace lanes) intact — that is the core.

### File 4 — `skills/writing-plans/SKILL.md`
- **Line ~146** "Requirements gathering and ambiguity resolution: dispatch `pi-oven:metis`": clarify metis does **one-shot pre-analysis** (intent + seed questions feeding the plan); the interactive convergence interview, when needed, is `brainstorming` run inline by the main agent — not metis.

### File 5 — `agents/pi-oven-metis.md`
- Add ONE clarifying line (Role or Constraints): interactive multi-round user interviews are owned by `brainstorming` (main-agent inline). metis produces a single pre-analysis report (≤3 impact-ordered seed questions); it is not the convergence interviewer. (Keep the existing MAX-3 / one-shot contract — it is correct for metis's lane.)

## Constraints
- Skill bodies **English-only** (Korean only for trigger keywords). Specs/plans may be Korean.
- Smallest viable diff; match existing skill prose style. No code changes (markdown discipline only).
- Do NOT touch the pi-oven:metis MAX-3 contract itself — it is correct; only fix the skills that mis-delegate the interactive interview to it.

## Verification
1. `bun run lint:skills` + `bun run lint:agents` clean (all `pi-oven:<role>` refs still ∈ ROLES — no scientist reintroduced).
2. `bun run check` clean; `bun test` 336 pass (skill prose edits do not change counts).
3. English-only confirmed in all edited skill bodies.
4. Coherence: brainstorming now relentless-until-shared-understanding; deep-dive bounded/autonomous; no skill still tells you to run the interactive convergence interview via metis.
