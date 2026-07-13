> Historical; do not copy runtime syntax examples from this document.

# Spec — omp-style tool discipline + main-orchestrator conduct protocol

> Status: design (2026-06-05). Brainstormed + approved. Implements three approved prongs:
> (1) force every pi-oven agent to USE omp's native tools, mirroring omp's official agent prompt style;
> (2) make setup enable the gated tools at the config layer so the prompts aren't toothless;
> (3) give the main orchestrator (often kimi-k2.6, a weaker instruction-follower) a STANDING, strict
> behavior protocol so it checks skills first and waits for the user instead of barreling ahead.

## 0. Motivation (observed)

The user runs the main orchestrator on `opencode-zen/kimi-k2.6` and observes: subagents don't really use
omp's tools (debugging, web search), and the orchestrator ignores the keyword-skill whitelist and starts
executing without waiting for answers. Root causes found in source:

- omp tools are mostly enabled by default (`web_search.enabled`/`lsp.enabled`/`astGrep.enabled`/`debug.enabled`/
  `browser.enabled` all default `true`) — but **`inspect_image.enabled` defaults `false`**, so the vision
  agents literally cannot see images even though `inspect_image` is in their `tools:` whitelist.
- A subagent can only call tools in its frontmatter `tools:` whitelist (or `["*"]`). `lint-agents.ts` already
  enforces **"every first-class tool named in the body must be granted in `tools:`"** (instructed-but-not-granted
  ERROR) — so body mandates and whitelists must move together; lint is our consistency net.
- pi-oven agent bodies are prose-heavy and rarely NAME tools or mandate their use, unlike omp's official agents
  (`src/prompts/agents/{explore,oracle,plan,reviewer,librarian,designer}.md`), which push tools hard via
  `<directives>`/`<procedure>` MUST/SHOULD/NEVER imperatives.
- The orchestrator skill-injection (`buildKeywordMatchedSkillsPrompt`) only appears WHEN a skill matches, and
  carries no "wait for the user" rule. When nothing matches, the orchestrator gets zero behavioral pressure.
- `RulesInjector` already injects a parent/sub discipline block + language + project-instructions, deduped by
  marker, via `before_agent_start.systemPrompt[]`; the extension knows `isParentSession`. This is the hook for a
  parent-only standing conduct block.

## 1. omp official-agent tool-forcing STYLE (the pattern to mirror)

From `…/pi-coding-agent/src/prompts/agents/*.md`:

- Frontmatter `tools:` lists exactly the tools the role needs (e.g. explore `read,search,find,web_search`;
  reviewer/librarian/plan add `bash,lsp,ast_grep,web_search`).
- XML-tagged sections: `<directives>`, `<procedure>`, `<critical>`, plus role sections.
- Dense **MUST / SHOULD / NEVER** imperatives that NAME tools:
  - explore: *"You MUST use tools for broad pattern matching / code search as much as possible."*,
    *"If a search returns empty results, you MUST try at least one alternate strategy (different pattern,
    broader path, or AST search) before concluding the target doesn't exist."*
  - oracle: *"You MUST use tools to verify claims. You NEVER speculate about code behavior — read it."*,
    *"Exhaust provided context before reaching for tools. External lookups fill genuine gaps, not curiosity."*
  - librarian: *"You NEVER rely on training data for API details — it may be stale or wrong."*,
    *"Source code is truth. Documentation is aspiration. Training data is history."*, *"use `web_search` to
    find the canonical repo URL … fall back to `web_search` for official API documentation before reporting
    failure."*
  - plan: `<procedure>` names tools per step — *"Find existing patterns via `search`/`find`"*; reviewer:
    *"The dispatch point is frequently outside the diff. You MUST read it."*
- `<procedure>` numbered steps reference tools inline; "Parallelize independent reads" recurs.

We mirror this register (terse, imperative, tool-named) in pi-oven agent bodies, tuned per backing model.

## 2. Prong 1 — tool discipline across all 24 agents (full role-by-role rewrite)

**Decision (approved): full role-by-role rewrite.** Each agent body is rewritten into omp's official structure —
`<directives>` (MUST/SHOULD/NEVER), `<procedure>` (numbered, tool-named steps), `<critical>`, plus the role's own
sections — mirroring `src/prompts/agents/*.md`. This is a large diff by design; the goal is for pi-oven agents to
read and behave like omp's official agents.

**Preserve, do not lose, role identity.** The rewrite RESTRUCTURES; it MUST carry over each agent's existing
pi-oven-specific content: its mission, its "responsible for / NOT responsible for" scope boundaries, any
`report_finding`/structured-output contract, memory (recall/retain/reflect) habits, and references to pi-oven
skills/gates. Rewrite = same role + same boundaries, expressed in omp's structure with strong tool mandates — not
a generic omp clone. Map each pi-oven agent to its omp counterpart for tone (explorer→explore, planner→plan,
code-reviewer/critic/verifier→reviewer, librarian/document-specialist/deep-researcher→librarian, oracle→oracle,
designer→designer); roles without an omp twin (executor, debugger, tracer, test-engineer, analyst, architect,
metis, data-runner, git-master, security-reviewer, code-simplifier, writer, multimodal-looker, qa-tester) adopt
the same register.

**`model:`/`thinkingLevel` frontmatter is NOT touched** (those are derived from `profiles.ts` and regenerated by
`--apply`). **`tools:`/`blocked_tools` are also a profiles-derived SoT**, enforced by `lint-agents.ts:178-191`
(JSON.stringify equality against `PROFILE_A[role]`) and by `profiles.test.ts` (PROFILE_C and PROFILE_D `tools`/
`blocked_tools` must equal PROFILE_A). To widen a role's `tools:` you MUST edit `tools` IDENTICALLY in all four
profiles (`PROFILE_A`, `PROFILE_B`, `PROFILE_C`, `PROFILE_D`) in `scripts/pi-oven-setup/profiles.ts` AND the
agent file in lockstep — a tools edit to only the agent file fails `bun run lint:agents` with "tools drift from
profiles.ts". `blocked_tools` stays UNCHANGED for every role (preserves read-only safety). `agent-rewriter.ts`
preserves bodies verbatim under `--apply`, so rewriting bodies is safe and never clobbered by lint/regen.

Role-classes and their tool mandates (exact per-agent whitelist deltas enumerated in the plan; lint enforces
body↔tools):

- **Code / debugging** (debugger, tracer, executor, test-engineer, analyst, code-reviewer, architect, oracle,
  code-simplifier, security-reviewer, verifier, data-runner, metis):
  - MUST prefer `lsp` (diagnostics, goto-def, find-refs) and `ast_grep` (structural search) over manual reading
    or plain `search` when navigating/auditing code.
  - MUST use `eval` to reproduce, compute, or inspect runtime behavior instead of reasoning about it in the head;
    MUST use `bash` to run the failing build/tests.
  - Debugging-first roles (debugger, tracer) MUST use `debug` for runtime stepping/breakpoints when a bug needs
    live inspection.
  - NEVER speculate about code behavior — read it or run it. If a search is empty, MUST try ≥1 alternate
    strategy (alt pattern, broader path, AST) before concluding absence.
- **Research / web** (deep-researcher, document-specialist, librarian, explorer, writer, planner, designer):
  - For any external/library/API/framework/doc question: MUST use `web_search` (and read source where possible);
    NEVER answer from training data — "source is truth, training data is history"; fall back to `web_search`
    before reporting "not found".
- **Vision** (multimodal-looker, qa-tester): MUST use `inspect_image` to actually view screenshots/images rather
  than guessing from filenames/paths; qa-tester MAY use `browser` for live UI checks.
- **Memory** (agents with recall/retain/reflect): use them per the memory-discipline skill (recall before
  re-deriving; retain durable facts; reflect to consolidate) — keep existing grants.
- **git-master**: bash-driven git; no new tools.

Model-fit (CLAUDE.md heterogeneous principle): kimi/minimax/glm-backed agents get SHORTER, blunter imperatives
(numbered, few words); gpt-5.4/opus-backed agents get denser directives. The mandate CONTENT is identical; only
phrasing density varies.

**`tools:` whitelist deltas (authoritative — the ONLY 8 roles that change; additions appended to existing tools,
identical across all 4 profiles; `blocked_tools` unchanged):**

| Role | Current `tools:` | Additions |
|---|---|---|
| tracer | read,search,find,bash | +lsp,ast_grep,eval,debug |
| analyst | read,search,find,bash,eval,recall | +lsp,ast_grep |
| critic | read,search,find,report_finding,recall | +web_search |
| verifier | read,search,find,bash,recall,task,report_finding | +lsp |
| security-reviewer | read,search,find,bash,recall,web_search | +lsp,ast_grep |
| planner | read,search,find,bash,recall,task | +lsp,ast_grep,web_search |
| architect | read,search,find,bash,lsp,ast_grep,recall,retain | +web_search |
| oracle | read,search,find,bash,recall,retain | +lsp,ast_grep,web_search |

The other 16 roles get NO `tools:` change: executor, debugger, test-engineer, designer, code-simplifier,
qa-tester (all `["*"]`); explorer, code-reviewer, librarian, document-specialist, writer, deep-researcher,
multimodal-looker, data-runner, git-master, metis (already have what their body needs).

**Critic / reviewer-class read-only rule.** critic has `bash` in `blocked_tools` — it is a read-only plan/diff
reviewer. Its rewritten body MUST NOT contain any mandate to run `bash` (e.g. "run the failing build/tests").
**General rule: a body must never mandate a tool that appears in that role's `blocked_tools`.**

## 3. Prong 2 — setup enables the gated tools (config layer)

New `setToolEnablementConfig({spawnFn})` in `config-yml.ts` (sibling to `setMemoryAndAsyncConfig`), called from
`apply.ts` ONLY on **global-scope** user setup (project scope writes routing only — unchanged from the prior
spec). It writes these scalar settings via individual `omp config set <key> <value>` calls:

- `inspect_image.enabled=true` (the real gap — default false; blocks vision agents)
- `web_search.enabled=true`, `lsp.enabled=true`, `astGrep.enabled=true`, `browser.enabled=true`,
  `debug.enabled=true` (default true already, written defensively so a user toggle can't silently neuter the
  tool mandates).

Note: `eval` is **ungated** (omp has no `eval.enabled` key — only `eval.py`/`eval.js` runtime config), so the
tracer/analyst `eval` grants (Prong 1) need NO enablement entry here. `debug.enabled=true` above backs the
tracer/debugger `debug` grants.

SoT: a `TOOL_ENABLEMENT` constant (key→value) in `config-yml.ts` or `profiles.ts`. Reflected in the apply output
("✓ tools enabled: inspect_image, web_search, lsp, ast_grep, browser, debug"). `--reset --full` leaves these
alone (they are omp-global infra, not pi-oven routing) OR optionally resets them — default: leave them (document
the choice).

## 4. Prong 3 — standing main-orchestrator conduct protocol (kimi-fit)

Add to `RulesInjector`:
- `ORCHESTRATOR_CONDUCT_DEDUP_KEY = "pi-oven:orchestrator-conduct@v1"`.
- `buildOrchestratorConductBlock(opts: { autonomousActive: boolean }): string` — a SHORT, blunt, numbered block
  placed FIRST in the parent system prompt (kimi-fit: imperative, minimal prose):
  1. **SKILL-FIRST.** Before any substantive action, decide whether the request matches a pi-oven skill (the
     runtime keyword whitelist AND your own judgment). If it does, you MUST `read("skill://<name>")` and follow
     it BEFORE acting. Do not start work that a skill governs without loading the skill.
  2. **WAIT FOR THE USER.** When you ask the user anything or present options (e.g. AskUserQuestion), STOP and
     wait for their reply. NEVER begin executing the task until the user has answered. A pending question is a
     hard stop.
  3. **ASK WHEN AMBIGUOUS.** If the request is ambiguous, or a decision is the user's to make, ask first — do
     not assume a default and run.
  4. **AUTONOMOUS CARVE-OUT.** When autonomous mode is active, the autonomous boundary contract governs instead:
     keep going per the contract; rules 2–3 are suspended (do not stall a running loop waiting for input).
- The extension injects this block **parent-only**, every turn, via a new parent-only append in
  `before_agent_start` (the extension already has `isParentSession` and the autonomous FSM state to pass
  `autonomousActive`). When `autonomousActive`, the block emphasizes rule 4 / drops the WAIT wording.

Also: strengthen `buildKeywordMatchedSkillsPrompt` wording (more imperative; "this is a hard precondition, not a
suggestion") and broaden keyword matching (`matchSkillsForText` / the curated keyword index) so common phrasings
the user actually uses are caught. Keep the dedup-marker discipline.

Interaction with existing pieces: the conduct block is ORTHOGONAL to the discipline block (commit/push/forbidden
floor) and the autonomous stop-guard (which forces continuation on polite stops). The carve-out (rule 4) keeps
them consistent: stop-guard still drives autonomous continuation; the conduct block only constrains INTERACTIVE
turns.

## 5. File-by-file (contract for the plan)

Agents (Prong 1): `agents/pi-oven-*.md` — body tool-discipline + `tools:` deltas (24 files; many body-only).
`scripts/pi-oven-setup/profiles.ts` — for the 8 delta roles, edit `tools` IDENTICALLY across `PROFILE_A`,
`PROFILE_B`, `PROFILE_C`, and `PROFILE_D` (`blocked_tools` untouched); agent file edits must be in lockstep.
`tests/scripts/pi-oven-setup/profiles.test.ts` — PROFILE_C/D === PROFILE_A tools equality tests must stay green
after profiles.ts edits.
Setup (Prong 2): `scripts/pi-oven-setup/config-yml.ts` (+`setToolEnablementConfig`, `TOOL_ENABLEMENT` SoT),
`scripts/pi-oven-setup/apply.ts` (call it on global scope), tests `config-yml.test.ts` + `apply.test.ts`.
Extension (Prong 3): `.omp/extensions/pi-oven-runtime/rules-injector.ts` (conduct block + key),
`.omp/extensions/pi-oven-runtime/skill-keyword-loader.ts` (stronger prompt + broadened matching),
`.omp/extensions/pi-oven.ts` (parent-only injection wired with autonomousActive), tests
`tests/extensions/*` (rules-injector + skill-keyword-loader + pi-oven).
Skills (Prong 1 support): `skills/systematic-debugging`, `skills/html-research-orchestrator`,
`skills/deep-dive`, `skills/codebase-survey` SKILL.md bodies — name the omp tools they should drive
(English-only bodies). Light touch; only where it sharpens tool usage.
Docs: `CLAUDE.md` (note the tool-discipline convention + orchestrator conduct + tool-enablement), `README.md`
(badge bump on release), `commands/setup.md` (mention tool enablement in the apply step).
Lint: `lint-agents.ts` already enforces body↔tools; no change expected, but run it as the consistency gate. If a
body names a tool an agent shouldn't get, fix the body, not the lint.

## 6. Testing + verification (full, approved)

- TDD per touched code file (config-yml/apply/rules-injector/skill-keyword-loader): red→green→refactor.
- Unit tests: `setToolEnablementConfig` writes the six flags (mock spawn records calls); apply calls it on
  global scope, NOT on project scope; `buildOrchestratorConductBlock` content + autonomous carve-out variant +
  dedup; broadened keyword matching catches new phrasings; lint stays green.
- Extension test locations: tests for rules-injector and skill-keyword-loader live at
  `tests/extensions/pi-oven-runtime/*.test.ts` (3-level `../../../` import depth into `.omp/extensions/
  pi-oven-runtime/`). ADD cases to the EXISTING files (`rules-injector.test.ts`,
  `skill-keyword-loader.test.ts`) — do NOT create `tests/extensions/rules-injector.test.ts` or
  `tests/extensions/skill-keyword-loader.test.ts`. `tests/extensions/pi-oven.test.ts` uses 2-level `../../`
  and is correct as-is.
- Gates: `bun run check` · `bun run lint:agents` · `bun run lint:skills` · `bun test` (all pass) · `bun run build`.
- **Live omp smoke** (approved): in a throwaway project, run setup (global) and assert `omp config get
  inspect_image.enabled` (and the others) is `true`; spawn a pi-oven subagent (or inspect the built system
  prompt) to confirm the tool-discipline + orchestrator-conduct text is present; confirm the conduct block
  appears on a parent turn and is suppressed/relaxed under autonomous mode.
- Adversarial critic review of the diff against this spec; cross-vendor codex review via spec-and-review for the
  spec itself before implementation.

## 7. Out of scope / guardrails

- Do NOT change `model:`/`thinkingLevel` frontmatter (derived from `profiles.ts`).
- Skill BODIES stay English-only (Korean only in runtime keyword whitelist + user docs).
- No `git push`/commit without explicit user confirmation; the prior project-scoped-routing changes remain
  uncommitted and separate.
- Keep the smallest viable diff; match each agent's existing voice; don't rewrite whole bodies — add/sharpen the
  tool-discipline section.
