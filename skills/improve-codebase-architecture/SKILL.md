---
name: improve-codebase-architecture
version: 0.1.0
description: "Read this skill for architecture improvement, deepening modules, consolidating seams, and surfacing refactoring opportunities around shallow modules or deletion tests. It identifies deepening opportunities that turn shallow modules into deep ones for testability and AI-navigability."
---

# improve-codebase-architecture

Surface architectural friction and propose **deepening opportunities** — refactors that turn shallow modules into deep ones. The aim is testability and AI-navigability. The main agent dispatches and synthesises; it does not run the survey or draw the report inline.

This skill is the **single entry point for all refactoring**. A plain "refactor module X" request lands here; Step 0 classifies the intent and routes — light DRY/YAGNI/KISS cleanup to `code-quality-discipline` + `pi-oven:code-simplifier`, deepening / seam work through the full process below.

## Dispatch discipline (main orchestrates, subagents do the work)

ENFORCEMENT: do NOT do this skill's substantive work in the main context. Main's direct-action budget is narrow — 1–2 simple file edits (≤30 LoC) or operational commands (`git status`, `ls`, install). ANY multi-file change, 3+ file reads, 200+ LoC, or multi-step investigation MUST go to a subagent; main only dispatches, synthesises, and reviews — never implements inline (see `large-task-delegation` + `subagent-driven-development`).

RIGHT-AGENT ROUTING — match the agent to the work (model-fit + role-fit is first-class), using these exact names: architecture deepening → `pi-oven:architect`; coupling / testability analysis → `pi-oven:analyst`.

## Vocabulary (use exactly)

Consistent language is the point. Do not drift into "component", "service", "API", "boundary", "layer", or "wrapper".

- **Module** — anything with an interface and an implementation (function, class, package, slice). Scale-agnostic.
- **Interface** — everything a caller must know: types, invariants, ordering, error modes, config, perf. Wider than the type signature.
- **Implementation** — the code inside.
- **Depth** — leverage at the interface: a lot of behaviour behind a small interface. **Deep** = high leverage. **Shallow** = interface nearly as complex as the implementation.
- **Seam** — where an interface lives; a place to alter behaviour without editing in place. (Use this, not "boundary".)
- **Adapter** — a concrete thing satisfying an interface at a seam.
- **Leverage** — what callers get from depth. **Locality** — what maintainers get: change, bugs, knowledge concentrate in one place.

Three tests, applied throughout:

- **Deletion test** — imagine deleting the module. Complexity vanishes → it was a pass-through (delete it). Complexity reappears across N callers → it earned its keep (deepen it).
- **The interface is the test surface** — callers and tests cross the same seam. Needing to test *past* the interface means the module is the wrong shape.
- **One adapter = hypothetical seam. Two adapters = real seam.** Don't introduce a seam unless something actually varies across it.

This skill is *informed* by the project's domain model. If a `CONTEXT.md` / domain glossary exists, names from it label the seams; if `docs/adr/` (or `docs/harness/adr/`) exists, those decisions must not be silently re-litigated.

## Process

### 0. Refactor-type detection (route first)

Classify the refactor intent before doing anything else:

- **Pure DRY/YAGNI/KISS cleanup** — duplication removal, local simplification, no interface reshaping. Apply the `code-quality-discipline` checklist and dispatch `pi-oven:code-simplifier`. Skip Steps 1–5.
- **Shallow→deep deepening, or tightly-coupled consolidation / seam work** — run the full process below (Steps 1–5: survey → candidates → grilling → interface design → verify).

When in doubt, treat it as deepening and run the full process.

### 1. Survey (dispatch — Main MUST NOT investigate inline)

ENFORCEMENT: Main dispatches `pi-oven:explorer` or `codebase-survey` for the architectural survey. Main MUST NOT read 5+ files inline to analyze structure.

**Memory first.** Before dispatching any subagent, call `recall(query="architecture decisions and ADRs for this codebase")` to retrieve prior architecture decisions, ADRs, and previous refactor outcomes. This prevents re-litigating settled decisions and seeds the survey with known friction.

**Pre-survey research.** If the architecture area involves unfamiliar patterns, academic techniques, or ecosystem-level design decisions, dispatch `pi-oven:deep-researcher` before the explorer to research relevant architecture patterns, prior art, and known trade-offs. The deep-researcher returns a synthesis with citations; feed it as context into the explorer brief.

Before exploring, read any domain glossary and the ADRs in the area being touched. If the survey will require 5+ file reads, route through `codebase-survey` rather than reading in the main session.

Dispatch `pi-oven:explorer` AND `pi-oven:analyst` in parallel: the explorer walks the codebase organically and notes friction using `lsp references` to map coupling and `ast_grep` to detect shallow module patterns — not rigid heuristics; the analyst assesses coupling and testability. Have both report, with file + line evidence:

- Where understanding one concept means bouncing between many small modules (analyze call-hierarchy depth via `lsp`).
- Where modules are **shallow** — interface nearly as complex as implementation (identify via `ast_grep` pattern matching).
- Where pure functions were extracted only for testability, but real bugs hide in how they're called (no **locality**; trace via `lsp references`).
- Where tightly-coupled modules leak across their seams (analyze seam usage via `lsp`).
- Which parts are untested or hard to test through their current interface.

Apply the **deletion test** to each suspect. A "yes, concentrates complexity" is the signal worth surfacing.

**Benchmark baseline.** After the explorer returns its friction report, dispatch `pi-oven:data-runner` to run a benchmark/performance baseline in the REPL for any modules flagged as performance-sensitive or high-churn. This establishes a pre-change baseline so that any recommended deepening can be validated against real numbers, not assumptions.

### 2. Candidates as an HTML report

Dispatch `pi-oven:architect` to synthesise the explorer's findings into deepening candidates and write a self-contained HTML report to the OS temp dir — never into the repo. Resolve the temp dir from `$TMPDIR` (fall back to `/tmp`, `%TEMP%` on Windows) and write `<tmpdir>/architecture-review-<timestamp>.html`. Open it (`open` on macOS, `xdg-open` on Linux, `start` on Windows) and report the absolute path.

The report uses **Tailwind via CDN** for layout and **Mermaid via CDN** for graph-shaped diagrams (call graphs, dependencies, sequences). Mix Mermaid with hand-built divs / inline SVG for editorial visuals (mass diagrams, cross-sections, call-graph collapse) so it doesn't read as generic. Each candidate gets a **before/after** visualisation — the diagrams carry the weight; prose is sparse.

Each candidate must pass a `code-quality-discipline` check before it earns a card: **DRY** (does it open a true new seam, not a pass-through wrapper?), **YAGNI** (do ≥2 distinct callers already exist?), **KISS** (is this the simplest expression of the deepening?). A candidate failing any of these is dropped or folded into an existing module.

Each candidate is one card:

- **Files** — modules involved (`font-mono`).
- **Problem** — one sentence: what hurts.
- **Solution** — one sentence: what changes.
- **Wins** — bullets, ≤6 words, named in glossary terms ("leverage: one interface, N call sites", "locality: bugs concentrate", "interface shrinks; implementation absorbs the wrappers"). Never "cleaner code" / "easier to maintain".
- **Before / After diagram** — side-by-side, ~320px tall, showing shallowness then the deepening.
- **Recommendation strength** — badge: `Strong` (emerald), `Worth exploring` (amber), `Speculative` (slate).
- **ADR callout** — only when a candidate contradicts an existing ADR *and* the friction warrants reopening it; one amber line. Don't enumerate every refactor an ADR forbids.

End with a **Top recommendation** card: which candidate to tackle first, one sentence why, anchored to its card.

Use domain vocabulary (e.g. "the Order intake module", not "FooBarHandler" or "the Order service") for the domain, and the glossary above for the architecture. Do NOT propose interfaces yet. After the file is written, ask: "Which of these would you like to explore?"

### 3. Grilling loop

Once the user picks a candidate, walk the design tree with them — constraints, dependencies, the shape of the deepened module, what sits behind the seam, which tests survive. Side effects happen inline as decisions crystallise:

- **Deepened module named after a concept not in the domain glossary** → add the term to `CONTEXT.md` (create lazily if absent).
- **A fuzzy term sharpened mid-conversation** → update `CONTEXT.md` right there.
- **User rejects a candidate with a load-bearing reason** → offer an ADR ("Want me to record this so future reviews don't re-suggest it?"). Only when a future explorer would genuinely need it — skip ephemeral ("not worth it now") and self-evident reasons.
- **User accepts a candidate** → call `retain(items=[{content:"<module> deepened: <one-sentence summary of change and rationale>", context:"architecture decision"}])` so future sessions recall the accepted change and do not re-propose it.

### 4. Interface design (optional — Design It Twice)

When the user wants alternative interfaces for the chosen candidate, first frame the problem space for them: constraints any new interface must satisfy, the dependencies it relies on and their category, and a rough code sketch to ground the constraints (not a proposal). Then dispatch 3+ `pi-oven:architect` agents in parallel, each with a separate technical brief (file paths, coupling, what sits behind the seam) and a different constraint:

- Minimise the interface — 1–3 entry points, maximise leverage per entry point.
- Maximise flexibility — many use cases, extension points.
- Optimise for the most common caller — make the default trivial.
- (If cross-seam) design around ports & adapters.

Each agent returns: interface (types + invariants + ordering + error modes), a caller usage example, what the implementation hides behind the seam, dependency/adapter strategy, and trade-offs. Present designs sequentially, then compare by **depth**, **locality**, and **seam placement**. Give an opinionated recommendation; propose a hybrid if elements combine well.

### 5. Verify before claiming improvement

Each deepening must **preserve behavior under `tdd-strict`** — tests green before AND after the change; author or extend tests for the deepened interface first, then land the deepening.

When a deepening lands as code, dispatch `pi-oven:code-simplifier` to confirm the wrappers actually collapsed and a separate `pi-oven:verifier` to confirm the interface still passes its tests. Once both PASS (collapse confirmed + interface tests green), dispatch `pi-oven:code-reviewer` for a separate code-quality review — no new coupling or `code-quality-discipline` violations introduced by the deepening. The main agent must not self-approve the refactor in the same context.

The landed refactor exits through `pre-commit-gate`, consistent with the other flows.

## Anti-patterns

- **Vocabulary drift** — calling a module a "component" / "service", or a seam a "boundary". The shared language is the deliverable.
- **Report in the repo** — the HTML belongs in the temp dir, not committed.
- **Proposing interfaces in Step 2** — candidates first, interfaces only after the user picks one.
- **Re-suggesting an ADR-settled refactor** — surface a contradiction only when friction warrants reopening the decision.
- **Depth as line-ratio** — depth is leverage at the interface, not implementation lines per interface line. Padding the implementation is not deepening.
- **Self-approval** — the agent that authored the deepening does not verify it; route Step 5 to fresh agents.

## Agent Dispatch (omp)

The main agent dispatches and synthesises; the heavy work routes to per-model agents.

- **Pre-survey research** → `pi-oven:deep-researcher` — researches architecture patterns, prior art, and ecosystem-level design decisions before the explorer survey (Step 1). Dispatch when the area involves unfamiliar patterns or academic techniques.
- **Benchmark baseline** → `pi-oven:data-runner` — runs benchmark/performance baseline in REPL after the survey, before recommending changes (Step 1 post-survey). Dispatch when modules are performance-sensitive or high-churn.
- **Survey / friction walk** → `pi-oven:explorer` — organic codebase exploration, returns file+line friction evidence (Step 1). For 5+ reads, go through `codebase-survey` first.
- **Candidate synthesis + HTML report** → `pi-oven:architect` — turns friction into deepening candidates and writes the before/after report (Step 2).
- **Interface alternatives** → 3+ parallel `pi-oven:architect` agents, one constraint each (Step 4).
- **Collapse verification** → `pi-oven:code-simplifier` — confirms shallow wrappers actually disappeared after a landed deepening (Step 5).
- **Test-surface verification** → `pi-oven:verifier` — confirms the deepened interface still passes its tests; separate context from the author (Step 5).
- **Code-quality review** → `pi-oven:code-reviewer` — after collapse + interface tests both PASS, confirms the deepening introduced no new coupling or `code-quality-discipline` violations (Step 5).

Agents return findings and designs; the main agent makes the call and runs the grilling loop with the user.
