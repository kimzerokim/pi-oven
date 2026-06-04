---
name: receiving-code-review
version: 0.1.0
description: "Read this skill when code review feedback arrives and you are about to act on it, including PR comments and cross-vendor review output. Evaluate before implementing: verify each item against this codebase, push back with technical reasoning when wrong, and YAGNI-check 'do it properly' suggestions."
---

# receiving-code-review

## When to use

Whenever review feedback arrives and you are about to act on it — from the user, an external reviewer, a GitHub PR thread, or a cross-vendor `codex` review produced by `spec-and-review`. The obligation is the same in interactive and autonomous mode: feedback is input to **evaluate**, not a queue to **execute**.

**Core principle:** Verify before implementing. Ask before assuming. Technical correctness over social comfort.

## Dispatch discipline (main orchestrates, subagents do the work)

Do NOT do this skill's substantive work in the main context. Main's direct-action budget is narrow: 1–2 simple file edits (≤30 LoC) or operational commands (`git status`, `ls`, install). ANY multi-file change, 3+ file reads, 200+ LoC, or multi-step investigation/implementation MUST be dispatched. Main only dispatches, synthesizes, and reviews — never implements inline. Match the agent to the work (model-fit + role-fit is first-class): re-review / verify the feedback technically → `pi-oven:code-reviewer` or `pi-oven:critic` before implementing. (See `large-task-delegation` + `subagent-driven-development`.)

## Response pattern

1. **READ** — absorb the complete feedback set before reacting to any single item.
2. **UNDERSTAND** — restate each requirement in your own words, or flag it unclear.
3. **VERIFY** — check the claim against codebase reality (`search`, read the callsite via `lsp references`, run the test).
4. **EVALUATE** — is it technically sound for THIS stack, this version, these constraints?
5. **RESPOND** — technical acknowledgment or reasoned pushback. Never performative.
6. **IMPLEMENT** — one item at a time, verify each before the next.

## Forbidden responses

NEVER:
- "You're absolutely right!" — explicit CLAUDE.md violation.
- "Great point!" / "Excellent feedback!" / "Thanks for catching that!" — performative; no gratitude expressions.
- "Let me implement that now" — before verification.

INSTEAD: restate the technical requirement, ask the clarifying question, push back with reasoning, or just start working. Actions over words — the code shows you heard the feedback. If you catch yourself typing "Thanks", delete it and state the fix instead.

## Clarify-before-implement

If ANY item is unclear, STOP — implement nothing yet, ask about the unclear items first. Items are often related; partial understanding produces wrong implementation.

Wrong: understand 1,2,3,6 → implement those now, ask about 4,5 later.
Right: "I understand 1,2,3,6. Need clarification on 4 and 5 before implementing."

## Source-specific handling

**From the user** — trusted; implement after understanding. Still ask if scope is unclear. No performative agreement — skip to action or a one-line technical acknowledgment.

**From external reviewers / cross-vendor codex** — these are suggestions, not orders. Before implementing, check: (1) technically correct for THIS codebase? (2) breaks existing functionality? (3) is there a reason the current implementation exists? (4) works on all targeted platforms/versions? (5) does the reviewer have full context? If a suggestion seems wrong, push back with technical reasoning. If you cannot verify, say so: "I can't verify this without [X]. Investigate / ask / proceed?" If it conflicts with the user's prior architectural decisions, stop and discuss first.

Cross-vendor codex from `spec-and-review` arrives triaged as 🔴 BLOCKER / 🟡 NIT / ⚪ push-back — the ⚪ tier is explicitly reasoned disagreement and is a valid outcome, not a failure to comply.

## YAGNI check for "do it properly"

When a reviewer suggests "implement this properly" (DB layer, filters, export, full config), `search` the codebase for actual usage via `lsp references` first.
- Unused: "Nothing calls this. Remove it (YAGNI)? Or is there usage I'm missing?"
- Used: implement properly.

Reviewer and implementer both serve the user. If the feature is not needed, do not add it.

## Implementation order

1. Clarify everything unclear FIRST.
2. Then: blocking issues (breakage, security) → simple fixes (typos, imports) → complex fixes (refactor, logic).
3. Verify each fix individually; confirm no regressions before moving on.

## When to push back

Push back when the suggestion breaks existing functionality, the reviewer lacks context, it violates YAGNI, it is technically wrong for this stack, legacy/compat reasons exist, or it conflicts with the user's architectural decisions. Use technical reasoning, reference working tests/code, ask specific questions — not defensiveness.

If you pushed back and were wrong: state it factually and move on — "Checked [X], you're correct. Fixing." No long apology, no defending the pushback.

## Acknowledging correct feedback

State the fix, not the praise: "Fixed — [what changed]." / "[specific issue] in [location], corrected." Never "you're absolutely right", "great point", or any thanks.

## GitHub thread replies

Reply to inline review comments in the comment thread (`gh api repos/{owner}/{repo}/pulls/{pr}/comments/{id}/replies`), not as a top-level PR comment.

## Bottom line

External feedback = suggestions to evaluate, not orders to follow. Verify. Question. Then implement. No performative agreement. Technical rigor always.

## Agent Dispatch (omp)

In an omp session, route the evaluate-then-implement passes to the right agent instead of doing everything inline:

- **VERIFY a contested suggestion against codebase reality** (does the callsite/test/version actually behave as the reviewer claims?) → dispatch `pi-oven:verifier` for an evidence-backed VERDICT before accepting or rejecting the item.
- **IMPLEMENT accepted items** (multi-file or non-trivial) → dispatch `pi-oven:executor`; keep authoring and reviewing in separate lanes (model routing per `large-task-delegation`).
- **Re-review after implementing review feedback** (separate pass, never self-approve) → dispatch `pi-oven:code-reviewer` to confirm the fixes are sound and introduced no regressions.

Cross-vendor codex review feedback originates from `spec-and-review`; this skill governs how to receive and act on it. Outside omp, the main agent runs the same evaluate → verify → implement passes inline.

---

Sources: `superpowers:receiving-code-review` (evaluate-don't-obey principle, forbidden-response list, YAGNI check). Adapted for pi-oven omp heterogeneous-model dispatch + cross-vendor codex 🔴/🟡/⚪ triage from `spec-and-review`.
