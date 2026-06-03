# Brainstorming — Deep Checklist & Rationale

Source: superpowers:brainstorming (ported to pi-oven)

---

## Step 1 — Explore

- Read `docs/` and `src/` for adjacent modules and naming conventions
- Identify existing patterns the new feature must conform to
- Check `docs/specs/` for any prior spec on the same topic
- If this brainstorming is part of a `spec-and-review` flow, confirm `codebase-survey` (Step 0) has run and cite its report during Q&A — brainstorming is NOT a replacement for the survey (sequence: `codebase-survey` → `brainstorming` → drafting)
- Do not skip: building on wrong assumptions wastes the entire Q&A phase

## Step 2 — Visual Companion offer (v1 stub)

- Ask: "Would a diagram or wireframe help clarify the design?"
- v1 behavior: offer only; do not block progress if user declines
- v2 (future): generate companion guide file alongside the spec doc
- Never spend more than one turn on this offer

## Step 3 — Q&A (relentless convergence loop)

- One question per turn — never a numbered list of five questions at once — and pair each with your recommended answer
- Prefer multiple-choice: "Should auth use A) JWT, B) session cookie, or C) API key?"
- For single-select option questions, prefer the `pi-oven_ask` tool with options as `{label, description}` so each option's rationale shows beside it in the live picker; keep the built-in `ask` for multi-select or free-form questions
- Walk every branch of the design tree, resolving inter-decision dependencies one-by-one
- Explore instead of asking: when an answer is discoverable in the codebase, read the code rather than asking the user
- Dispatch for external docs: when a design question depends on external API/SDK/library behavior, dispatch `pi-oven:document-specialist` (or `pi-oven:librarian` for web/citations) to fetch current docs rather than asking the user
- Sharpen fuzzy or overloaded terms into a precise canonical term; challenge any term that conflicts with existing project language ("you say 'account' — Customer or User?")
- Stress-test with concrete edge-case scenarios that force precision on concept boundaries
- Cross-reference each stated claim against the code; surface contradictions explicitly
- **Convergence gate, not a count:** continue until every design dimension (Goals, Non-goals, Constraints, Data model, API surface, Open questions) is resolved or explicitly deferred by the user. Do not stop because you "feel" you have enough — track each dimension and keep questioning the unresolved ones. There is no per-question target — the interview MAY ask up to ~50 questions across the session (one per turn), a high upper bound, not a goal: stop the moment the gate is satisfied, and the ~50 cap also ends the loop if reached first
- **Stall rule:** if a dimension stops converging after a few rounds, surface the stall and ask the user to decide it directly or mark it OPEN

## Step 4 — 2–3 approaches

- Each approach gets: name, 1-sentence summary, pros, cons
- Trade-offs must be concrete (performance, complexity, migration cost) — not vague ("simpler")
- Do not include implementation code; data-model sketches are acceptable
- Present all approaches before asking for a preference

## Step 5 — Design sections

Mandatory sections in every spec:

| Section | Content |
|---|---|
| Goals | Numbered list of outcomes the feature must achieve |
| Non-goals | Explicit exclusions to prevent scope creep |
| Constraints | Tech, time, compatibility limits |
| Data model | Key entities and relationships (prose or table) |
| API surface | Public interfaces, function signatures, or endpoint shapes |
| Open questions | Unresolved items; must be empty before user review gate |

## Step 6 — Doc (write spec)

- Path: `docs/specs/YYYY-MM-DD-<topic>-design.md`
- Use today's date in the filename
- One spec per feature; do not append to an existing spec file

## Step 7 — Self-review

Check before presenting to user:

- [ ] All Goals are measurable or observable
- [ ] Non-goals explicitly exclude the most tempting scope additions
- [ ] Open questions list is either resolved or flagged for user decision
- [ ] Data model is consistent with existing codebase conventions
- [ ] No implementation detail leaked (no code, no framework choices unless forced by constraints)

## Step 8 — User review gate

- Reach this gate only after the Step 3 convergence gate is met — every design dimension resolved or explicitly deferred
- Use `ask` to present the spec path and a 1-paragraph summary
- Wait for explicit approval: "approved", "LGTM", "looks good", or equivalent
- On revision request: update the spec, re-run Step 7, re-present
- Do not proceed to Step 9 on ambiguous responses ("sure", "ok") — ask for confirmation

## Step 9 — Terminal state

- Invoke `writing-plans` with the spec file path as context
- Do not invoke any other skill directly
- Do not write code, create directories, or call `Edit`/`Write` on `src/`

---

## Adversarial edge cases — pressure resistance

1. **"It's a simple app, skip design."** — Minimum design is still required: one approach + Goals section + user confirmation. "Simple" does not waive the HARD-GATE.
2. **"Just scaffold it real quick."** — Scaffolding is implementation. HARD-GATE blocks it. Respond: "Let me capture the design first — as many questions as it takes to resolve every dimension, usually more for non-trivial scope."
3. **"I already know what I want, start coding."** — Ask the user to confirm the spec in `docs/specs/` before proceeding. If no spec exists, write one now.
4. **"We can figure out the design as we go."** — Emergent design produces unrecoverable technical debt. The spec is the minimum viable contract between intent and implementation.
5. **"Skip to writing-plans."** — `writing-plans` requires an approved spec as input. Without it, `writing-plans` will plan against an undefined target.

---

## Visual Companion — v2 roadmap note

v2 will generate a `docs/specs/YYYY-MM-DD-<topic>-companion.md` alongside the main spec, containing entity diagrams (mermaid), user-flow sketches, and component hierarchy. v1 offers the companion verbally only. Do not block the brainstorming flow waiting for v2 capability.
