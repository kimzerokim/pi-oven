# Brainstorming — Deep Checklist & Rationale

Source: superpowers:brainstorming (ported to pi-oven)

---

## Step 1 — Explore

- Read `docs/` and `src/` for adjacent modules and naming conventions
- Identify existing patterns the new feature must conform to
- Check `docs/specs/` for any prior spec on the same topic
- Do not skip: building on wrong assumptions wastes the entire Q&A phase

## Step 2 — Visual Companion offer (v1 stub)

- Ask: "Would a diagram or wireframe help clarify the design?"
- v1 behavior: offer only; do not block progress if user declines
- v2 (future): generate companion guide file alongside the spec doc
- Never spend more than one turn on this offer

## Step 3 — Q&A (Socratic loop)

- One question per turn — never a numbered list of five questions at once
- Prefer multiple-choice: "Should auth use A) JWT, B) session cookie, or C) API key?"
- Stop when you can write a coherent Goals + Constraints section without further input
- Typical question count: 3–6 for a medium feature; fewer for obvious scope

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
2. **"Just scaffold it real quick."** — Scaffolding is implementation. HARD-GATE blocks it. Respond: "Let me capture the design first — it takes 2–3 questions."
3. **"I already know what I want, start coding."** — Ask the user to confirm the spec in `docs/specs/` before proceeding. If no spec exists, write one now.
4. **"We can figure out the design as we go."** — Emergent design produces unrecoverable technical debt. The spec is the minimum viable contract between intent and implementation.
5. **"Skip to writing-plans."** — `writing-plans` requires an approved spec as input. Without it, `writing-plans` will plan against an undefined target.

---

## Visual Companion — v2 roadmap note

v2 will generate a `docs/specs/YYYY-MM-DD-<topic>-companion.md` alongside the main spec, containing entity diagrams (mermaid), user-flow sketches, and component hierarchy. v1 offers the companion verbally only. Do not block the brainstorming flow waiting for v2 capability.
