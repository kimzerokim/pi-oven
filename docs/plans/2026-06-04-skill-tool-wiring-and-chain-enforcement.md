# Plan: skill/agent omp-tool wiring + subagent-driven research + runtime chain enforcement

Branch: `feature/skill-chain-enforcement` (direct commits, push needs explicit consent).
Evidence base: `docs/harness/surveys/2026-06-04-skill-tool-wiring-and-enforcement-survey.md` (primary-source verified).
Corrections applied from planner recon: freshness is pre-commit **Gate 0.5** (not Gate 1); among context7-instructed agents only `document-specialist` actually uses context7 (librarian body does not).

Constraints: skill bodies English-only; agent `model`/`thinkingLevel` frontmatter is SoT-derived (profiles.ts) and OUT OF SCOPE — only `tools:` grants + bodies. Commit subjects = what/why, no "Plan N". Per-workstream semantic commits. Execution is subagent-driven (executor/writer); main dispatches + reviews + runs gates.

---

## WS1 — De-phantom skill refs + skill-ref lint guard

- **Reword `freshness-guard` refs to inline prose.** Targets: `skills/autonomous-loop/SKILL.md:112` (per-cycle step 1 → "stale meta-doc check before reads — inline; same detection as pre-commit Gate 0.5"), `skills/pre-commit-gate/references/gate-detail.md:39,45` (describe the inline Gate 0.5 procedure; drop "fresh-verifier's freshness-guard sub-routine / sub-skill" framing). Acceptance: no token `freshness-guard` remains; behavior described inline; `bun run lint:skills` green.
- **Reword `executing-plans` refs to inline prose.** Targets: `skills/writing-plans/SKILL.md:127` (Option 2 → "inline sequential execution" without the skill name; keep line 128 description), `skills/subagent-driven-development/SKILL.md:17` ("use inline sequential execution instead"). Acceptance: no token `executing-plans` remains.
- **Add skill→skill ref validation to `scripts/lint-skills.ts` + tests.** Validate every `skill://<name>` URI resolves to one of the 22 shipped skills (`.claude-plugin/plugin.json`); flag dangling. OPEN QUESTION (see below): also add bare-name kebab-token validation with an inline allowlist (catches the exact bug class that occurred) vs `skill://`-only (zero false positives). Acceptance: lint fails on a synthetic `skill://nonexistent` ref; passes on current tree after de-phantom; new tests in `tests/scripts/lint-skills.test.ts`.

## WS2 — Agent tool-grant fixes + lint-agents guard

- **Verify MCP/context7 + web_search grant semantics FIRST.** Confirm from omp source whether `web_search` and MCP tools (context7) must appear in frontmatter `tools:` allowlist to be callable, or are governed separately. Drives whether the grant edits below are real bugs. Acceptance: documented finding (file:line) recorded in the commit body / plan note.
- **Grant `web_search`** to `agents/pi-oven-document-specialist.md` + `agents/pi-oven-security-reviewer.md` frontmatter `tools:` (both instruct it in body, neither grants it). Grant **context7** to `document-specialist` only (librarian body does not use it). Conditional on the verification above. Acceptance: every tool named in each agent body is in its `tools:` (or `["*"]`).
- **Grant `lsp` + `ast_grep`** to `agents/pi-oven-explorer.md` and `agents/pi-oven-tracer.md` frontmatter `tools:`. Acceptance: both list lsp + ast_grep.
- **Body instruction fixes:** `architect` (instruct lsp references/ast_grep for dependency/cohesion analysis), `debugger` (instruct lsp definition/references + `debug` DAP), `code-simplifier` (replace pseudo-tools `Grep`/`Glob` + `lsp_diagnostics` typo with omp `search`/`find`/`lsp`/`ast_grep`). Acceptance: no Claude-Code pseudo-tool names remain; bodies name real omp tools.
- **Add `scripts/lint-agents.ts` guard + tests:** flag any tool named in an agent BODY that is not granted by frontmatter `tools:` (accept `["*"]`). Acceptance: lint fails on a synthetic instructed-but-ungranted tool; passes after the grant fixes.

## WS3 — Skill omp-tool wiring (replace bash/grep-first phrasing)

Add explicit power-tool mandates at workflow junctions. English-only. Targets + tools (survey §C):
- `codebase-survey` — lsp references/hover/call-hierarchy depth beyond current ast_grep+symbols.
- `systematic-debugging` — `debug` (DAP) for live state; lsp definition/references for impact (replace manual-instrumentation-only).
- `improve-codebase-architecture` — lsp references + ast_grep for coupling/seam analysis.
- `code-quality-discipline` — `search`/`lsp` instead of `grep -rn` (lines 29,39,132,136).
- `deep-dive` — ast_grep + lsp alongside the coordination/research steps.
- `tdd-strict` — `lsp_diagnostics` as the type/coverage signal.
- `receiving-code-review` — lsp references to verify impact before implementing.
- `spec-and-review` — ast_grep in Step 0 survey.
Acceptance per skill: the named tool(s) appear as explicit instructions at the right step; `bun run lint:skills` green.

## WS4 — Skill subagent-driven research hardening

Add hard "Main MUST dispatch / MUST NOT investigate inline" guards on research steps (pattern: `codebase-survey` lines 11,42). Targets:
- `systematic-debugging` — Phase 2 (pattern analysis) + Phase 4 (fix research) route reads to `pi-oven:explorer`/`pi-oven:tracer`.
- `improve-codebase-architecture` — Step 1 survey reads via subagent.
- `spec-and-review` — Step 1 draft research via subagent (not inline main).
- `brainstorming` — keep interactive Q&A inline, but route codebase/web discovery to `pi-oven:explorer`/`pi-oven:librarian`.
Acceptance: each named step has an explicit dispatch mandate + inline-investigation prohibition.

## WS5 — Runtime chain enforcement DESIGN (gated on user approval)

Grounded in verified caps (survey §A): ONLY hard lever = block `tool_call`; cannot force actions; can inject `before_agent_start.systemPrompt[]` + steer `sendMessage(nextTurn)`. Extends existing Layer-1 `.omp/extensions/pi-oven-runtime/gate*.ts` (currently commit/push/forbidden).

Proposed gates (negative only):
- **(a) ASK-FIRST branch-contract gate** — block first mutating tool (`write`/`edit`/`apply_patch`/`Bash git commit`) in an autonomous flow until a 3-slot branch-contract marker (`destination`/`branch`/`pr_mode`) is recorded in FSM state. Directly fixes the gap the user hit (autonomous starting without the contract).
- **(b) autonomous skill-read gate** — block code-write tools until the active flow's required `skill://<name>` read is observed (FSM records skill reads from tool_result). Approximates "chain step ran".
- **(c) soft steering** — inject current FSM phase + remaining-chain reminder via `before_agent_start.systemPrompt` each turn; `nextTurn` to re-assert on drift.

Explicitly NOT enforceable (honest): forcing a subagent dispatch, forcing a web_search, forcing in-order sub-skill execution, blocking turn-end until verifier ran (agent_end/turn_* observe-only).

Acceptance (when approved): unit tests on the FSM gate decisions (block/allow) per existing gate test pattern; AC for branch-contract gate + skill-read gate; documented non-enforceable list. **This WS requires explicit user approval of scope/aggressiveness before implementation.**

---

## Sequencing
1. WS1 + WS2 (mechanical, low-risk) — execute now, one semantic commit each.
2. WS3 + WS4 (prose) — execute after WS1/WS2.
3. WS5 (design) — implement only after user approves scope.

## Open questions for user
1. **WS1 lint scope:** `skill://`-URI validation only (zero false positives) vs additionally bare-name kebab validation with an inline allowlist (catches the exact freshness-guard/executing-plans bug class, but needs allowlist maintenance). Recommendation: bare-name + allowlist, since that is the bug that actually occurred.
2. **freshness-guard / executing-plans:** inline-reword (recommended, no new skills; freshness already = Gate 0.5) vs build them as real shipped skills (adds plugin.json/keyword/eval/test surface).
3. **WS5 enforcement aggressiveness:** gates (a)+(b)+(c), or start with just (a) ASK-FIRST branch-contract gate (smallest, highest-value) and defer (b)/(c)?
4. **WS5 scope confirm:** implement this cycle, or land WS1-WS4 first and do WS5 as a separate spec-and-review cycle?

---

## WS5 — CRITICAL finding (2026-06-04, verified) + locked design

**Locked design (user pick):** contract signal = **marker file** `.pi-oven/state/branch-contract.json` (option A). The autonomous-loop skill instructs the model to write it after the 3-slot answers; the gate reads it to unblock mutating tools. The marker-WRITE itself must be exempt from the gate (bootstrap, else chicken-and-egg).

**Prerequisite finding — the existing FSM gate is DORMANT.** Verified: nothing in `.omp/extensions/**`, `scripts/**`, or `commands/**` ever calls `store.mutate(...)` / `store.writeState(...)`. So the gate FSM `.pi-oven/state/autonomous.json` is never created/activated, `readState()` returns ABSENT, and `decideGate` allows all commit/push. The existing Spec-F Layer-1 commit/push gate is wired into the `tool_call` handler but **never fires in production**. The autonomous-stop-guard keeps its own in-memory `autonomousActive`, which is NOT synced to the gate FSM.

**Therefore WS5 scope expands to (in order):**
1. **FSM activation wiring** — sync `autonomous-stop-guard.autonomousActive` → `store.mutate(s => ({...s, active}))` on `turn_start` (parent only). This alone revives the dormant commit/push gate.
2. **Branch-contract gate** — gate-handler inspects `write`/`edit`/`apply_patch`; when FSM active && marker absent/invalid → block (PI_OVEN_GATE_BYPASS + CORRUPT semantics consistent with commit/push); EXEMPT a `write` whose path is `.pi-oven/state/branch-contract.json`. New `store.readBranchContract()`.
3. **Skill-read gate** — required skills = skill-keyword-loader `matchedSkills`; observe `read skill://<name>` tool_calls → FSM `skillReads`; block code-write while a required skill is unread.
4. **Soft steering** — extend rules-injector to inject FSM phase + required-skills/remaining-chain reminder via `before_agent_start.systemPrompt`; `nextTurn` re-assert on drift.
5. Tests for each (gate-state, gate, gate-handler, wiring).

This is load-bearing extension code. With codex/Sonnet executor providers down (2026-06-04), implementation is main-authored + TDD, no fresh-agent verifier available.

---

## WS6 — follow-up (deferred): capitalized Claude-Code pseudo-tool cleanup

Pre-existing across multiple agents/skills NOT touched this cycle: capitalized Claude-Code tool names (`Read`/`Write`/`Edit`/`Bash`/`Grep`/`Glob`/`MultiEdit`/`WebFetch`) that should be omp-native (`read`/`write`/`edit`/`bash`/`search`/`find`/(drop MultiEdit)/`read`-url). Known sites: agents/pi-oven-executor.md (L77-80), agents/pi-oven-git-master.md (L107-110), agents/pi-oven-test-engineer.md (L144-149); skills/code-quality-discipline/SKILL.md (L11), skills/tdd-strict/SKILL.md (L19), skills/code-quality-discipline/references/principles.md (L64). Also document-specialist's `WebFetch`/`chub` external-docs strategy (L65-66) needs an omp-native equivalent review. A blind codemod is unsafe (capitalized words appear in prose, e.g. "Write access", sentence-initial "Read"), so this is a careful context-aware pass, not a regex sweep. Fixed THIS cycle (files already touched): lsp_servers→`lsp` status (8-step-checklist.md:13), Grep/Glob→search/find in security-reviewer:28 + document-specialist:64.
