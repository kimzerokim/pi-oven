---
name: brainstorming
version: 0.1.0
description: Transform a raw idea into an approved spec via Socratic Q&A — HARD-GATE blocks all implementation until design is explicitly approved
trigger: keyword 'brainstorm' / '아이디어' OR new project / new feature pre-implementation
alwaysApply: false
---

# brainstorming

## When to use

Invoke before any creative work — new features, new projects, spec requests, or any pre-implementation planning. Do not touch code or scaffolding until this skill reaches its terminal state.

Four conditions each independently trigger this skill:

- User says "brainstorm", "brainstorming", or "아이디어"
- A new project or new feature is requested without an existing approved spec
- User asks "what should we build" or equivalent open-ended design question
- Any implementation request that lacks a written spec in `docs/specs/`

## HARD-GATE

> "You are BLOCKED from invoking any implementation skill, writing any code, creating any scaffold, or calling any file-write tool until the user has explicitly approved the design." — superpowers:brainstorming

This gate applies even when the user says "it's simple", "just scaffold it", or "skip design". Minimum design = at least one approach documented and user-confirmed.

## 9-step checklist

1. **Explore** — read existing codebase context; identify adjacent modules, constraints, and conventions
2. **Visual Companion offer** — ask if a companion diagram or wireframe would help (v1: stub; v2 feature)
3. **Q&A** — ask clarifying questions one at a time using `ask`; prefer multiple-choice; stop when intent is unambiguous
4. **2–3 approaches** — present distinct design options with trade-offs; no implementation detail yet
5. **Design sections** — draft Goals, Non-goals, Constraints, Data model, API surface, Open questions
6. **Doc** — write spec to `docs/specs/YYYY-MM-DD-<topic>-design.md`
7. **Self-review** — re-read the spec; check for gaps, contradictions, and missing edge cases
8. **User review gate** — use `ask` to present the spec and wait for explicit approval or revision requests
9. **writing-plans transition** — on approval, invoke `writing-plans` only; no other implementation skill

## Q&A discipline

- Ask one question per turn, not a list
- Prefer multiple-choice options when possible (`A / B / C`)
- Stop asking when you have enough to write a coherent spec
- Never ask for information you can infer from codebase exploration

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
