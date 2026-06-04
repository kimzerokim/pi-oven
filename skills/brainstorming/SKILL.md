---
name: brainstorming
version: 0.1.0
description: "Read this skill WHEN the user wants to brainstorm, design, or spec out a feature/project before coding — or when no approved spec exists for an implementation request. Socratic Q&A → approved spec with a HARD-GATE blocking all code until design is confirmed. (triggers: brainstorm, brainstorming, 브레인스토밍, 아이디어 정리, 같이 설계, 설계부터 하자)"
---

# brainstorming

## When to use

Invoke before any creative work — new features, new projects, spec requests, or any pre-implementation planning. Do not touch code or scaffolding until this skill reaches its terminal state.

Four conditions each independently trigger this skill:

- User says "brainstorm", "brainstorming", "브레인스토밍", "아이디어 정리", or "같이 설계"
- A new project or new feature is requested without an existing approved spec
- User asks "what should we build" or equivalent open-ended design question
- Any implementation request that lacks a written spec in `docs/specs/`

## Dispatch discipline (main orchestrates, subagents do the work)

Do NOT do this skill's substantive work in the main context. Main's direct-action budget is narrow: 1–2 file simple edits ≤ 30 LoC, or operational commands (`git status`, `ls`, install). ANY multi-file change, 3+ file reads, 200+ LoC, or multi-step investigation/implementation MUST be dispatched to a subagent — main only dispatches, synthesizes, and reviews, never implements inline (see `large-task-delegation` + `subagent-driven-development`). Route by model-fit + role-fit (first-class): design exploration / trade-off analysis → `pi-oven:planner` or `pi-oven:architect`. Main stays the facilitator, not the implementer.

## HARD-GATE

> "You are BLOCKED from invoking any implementation skill, writing any code, creating any scaffold, or calling any file-write tool until the user has explicitly approved the design." — superpowers:brainstorming

This gate applies even when the user says "it's simple", "just scaffold it", or "skip design". Minimum design = at least one approach documented and user-confirmed.

## 9-step checklist

1. **Explore** — read existing codebase context; identify adjacent modules, constraints, and conventions. If this brainstorming is part of a `spec-and-review` flow, first confirm `codebase-survey` (Step 0) has run and cite its report during Q&A — brainstorming is NOT a replacement for the survey (sequence: `codebase-survey` → `brainstorming` → drafting)
2. **Visual Companion offer** — ask if a companion diagram or wireframe would help (v1: stub; v2 feature)
3. **Q&A convergence loop** — interview relentlessly using `ask`, one question per turn, each with your recommended answer; walk every branch of the design tree, resolving inter-decision dependencies one-by-one; when an answer is discoverable in the codebase, explore instead of asking; when a design question depends on external API/SDK/library behavior, dispatch `pi-oven:document-specialist` (or `pi-oven:librarian` for web/citations) to fetch current docs instead of asking the user; sharpen fuzzy or overloaded terms into a precise canonical term and challenge any term that conflicts with existing project language; stress-test with concrete edge-case scenarios that force precision on concept boundaries; cross-reference each stated claim against the code and surface contradictions explicitly. Question budget — ask **at least 15 and at most 100 questions** across the session (one per turn). Never present for approval before the 15-question floor (unless the user explicitly skips brainstorming); past the floor, keep going until the convergence gate below is met; hard-stop at the 100-question ceiling even if dimensions remain (mark the rest OPEN)
4. **2–3 approaches** — present distinct design options with trade-offs; no implementation detail yet
5. **Design sections** — draft Goals, Non-goals, Constraints, Data model, API surface, Open questions
6. **Doc** — write spec to `docs/specs/YYYY-MM-DD-<topic>-design.md`
7. **Self-review** — re-read the spec; check for gaps, contradictions, and missing edge cases
8. **User review gate** — use `ask` to present the spec and wait for explicit approval or revision requests
9. **writing-plans transition** — on approval, invoke `writing-plans` only; no other implementation skill

## Q&A discipline

- Ask one question per turn, not a list — and pair each with your recommended answer
- Prefer multiple-choice options when possible (`A / B / C`)
- For single-select option questions, prefer the `pi-oven_ask` tool with each option as `{label, description}` — the recommended-answer rationale goes in `description`, shown beside the option in the live picker. Write a **substantive 1–3 sentence `description`** per option (the concrete trade-off, when to pick it, and the consequence) — not a few words or a restatement of the label. Keep the built-in `ask` for multi-select or free-form questions
- Never ask for information you can infer from codebase exploration — explore instead
- When a question depends on external API/SDK/library behavior, dispatch `pi-oven:document-specialist` (or `pi-oven:librarian` for web/citations) to fetch current docs instead of asking the user
- **Convergence gate:** do not stop until EVERY design dimension — Goals, Non-goals, Constraints, Data model, API surface, Open questions — is either resolved or explicitly deferred by the user. Then present for approval. The interview asks **at least 15 and at most 100 questions**: never present before the 15-question floor, keep questioning unresolved dimensions until the gate is met, and the 100-question ceiling also ends the loop (mark any still-open dimensions OPEN). Never stop on "I think I have enough" alone; track each dimension and keep questioning the unresolved ones
- **Single-question exit is invalid:** asking one question and then switching to implementation/autonomous execution is a hard violation unless the user explicitly says to skip brainstorming
- **Stall rule:** if a dimension stops converging after a few rounds, surface the stall explicitly and ask the user to decide it directly or mark it OPEN — do not loop silently

Convergence discipline adapted from the `grill-with-docs` pattern (relentless one-question-at-a-time interview until shared understanding).

## Spec save path

```
docs/specs/YYYY-MM-DD-<topic>-design.md
```

Example: `docs/specs/2026-05-27-note-taking-app-design.md`

This path is the pi-oven project override. Do not use `docs/superpowers/specs/`.

## Terminal state

Invoke `writing-plans` **only**. No other implementation skill is valid at exit. Do not invoke `tdd-strict`, `subagent-driven-development`, `large-task-delegation`, or any executor directly from this skill.

---

Deeper rationale + checklist detail: skill://pi-oven/brainstorming/references/checklist.md

## Agent Dispatch (omp)

When running this skill inside an omp session, route work to the pi-oven agent registry rather than handling every step inline:

- Intent clarification: the interactive convergence interview is run **inline by the main agent** (it owns the user turns). Dispatch `pi-oven:metis` **once** for pre-analysis only — intent classification, codebase pre-analysis, and at most a few informed seed questions — never as the convergence loop.
- Project context exploration (files, recent commits, patterns): dispatch `pi-oven:explorer`.
- Approach comparison and architectural trade-offs: dispatch `pi-oven:architect`.
- Spec writing and clear documentation: the main agent owns this, optionally consulting `pi-oven:writer` for prose polish.

Outside omp the same steps run inline.
