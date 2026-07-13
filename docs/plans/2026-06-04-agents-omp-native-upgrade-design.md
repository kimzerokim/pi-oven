> Historical; do not copy runtime syntax examples from this document.

# Design: pi-oven omp-Native Agent Upgrade

> Status: LOCKED (brainstorming-confirmed decisions). Codex-reviewable.
> Branch: `feat/skill-agent-upgrade`
> Author: executor (2026-06-04)
> Supersedes: comparison.html (pre-brainstorm survey)

---

## 1. Goal & Scope

**What.** Upgrade all 24 pi-oven agents (22 existing + 2 new), 21 skills, commands, and workflows to be fully omp-native: correct tool names, killer-tool activation, 2 new roles, memory/irc infra, and absorbed omp design patterns.

**Why.** pi-oven runs _on_ omp. Yet 0 of 22 agents invoke omp's killer tools (`debug`, `eval`, `browser`, `retain/recall`, `irc`). The root cause is twofold: (A) Claude Code tool names (`Read/Grep/Glob/WebFetch/Bash`) are used everywhere — omp has no auto-alias, so `web_search`/`debug`/`eval`/`browser`/`retain` never reach agents that need them; (B) even agents with `["*"]` (executor, debugger, qa-tester) never call the killer tools because their bodies contain no instructions. This upgrade fixes both layers simultaneously.

**Success criteria.**

1. All frontmatter `tools:` / `blocked_tools:` entries use omp native names.
2. All agent bodies reference killer tools with concrete call syntax where relevant.
3. 6 "corresponding" roles rewritten on omp's battle-tested prompt foundations.
4. 15 pure-injection roles have killer-tool injection paragraphs (git-master: no-op; 7 hybrid roles handled in §4.1).
5. 2 new roles (`deep-researcher`, `data-runner`) added to ROLES, PROFILE_A, PROFILE_B; `EXPECTED_AGENT_COUNT` bumped to 24.
6. `memory-discipline` skill (`alwaysApply: true`) wired into all 5 entry points (spec-and-review, autonomous-loop, deep-dive, improve-codebase-architecture, large-task-delegation).
7. `irc` coordination paragraphs at the 3 parallel fan-out points.
8. `bun run check`, `bun run lint:agents`, `bun run lint:skills`, `bun run build`, `bun test` all pass.

**Out of scope.** `PROFILE_B` model IDs are not changed (deferred per CLAUDE.md). Orchestrator model pairs (`PROFILE_A_ORCHESTRATOR` / `PROFILE_B_ORCHESTRATOR`) are not changed. Claude Code interop is not maintained.

---

## 2. Background — Comparison Findings

**Two orthogonal systems.** pi-oven's strength is role specialisation and model diversity: 22 roles across 6 models / 3 providers, with dedicated roles for security, TDD, verification, causal tracing, and simplification that omp lacks entirely. omp's strength is tool capability: 7 agents wielding 30 native tools — `debug` (DAP), `read` (arxiv/PDF/URL), `web_search` (14-backend), `eval` (Python/JS REPL), `browser` (headless Chromium), `retain/recall/reflect` (Hindsight memory), `irc` (live inter-agent). Of omp's 18 "batteries-included" features, pi-oven agents use 0 of the killer ones.

**The tool-name gap is the primary blocker.** omp registers all 30 tools under lowercase native names. pi-oven agents declare `["Read","Grep","Glob","WebFetch","Bash"]` — these are Claude Code names with no omp alias. The consequence: agents that would benefit from `web_search`, `debug`, `eval`, or `retain` simply never receive those tools, regardless of model capability. Agents with `["*"]` receive everything but are never prompted to use it.

**Integration strategy = Hybrid, not rewrite from scratch.** pi-oven's role taxonomy, model-fit mapping, and SoT chain (`profiles.ts` → agent frontmatter → `lint-agents.ts`) are architectural strengths worth preserving. The 6 omp agents that have a direct pi-oven counterpart carry battle-tested prompt patterns (effort tags, `report_finding`, cross-boundary, anti-slop 14-pattern list, typed output schema) that pi-oven's versions lack. The upgrade absorbs those patterns into the 6 corresponding pi-oven roles while injecting killer-tool paragraphs into all remaining roles.

---

## 3. Part A — omp-Native Tool Conversion

### 3.1 Name-mapping table

| Claude Code name | omp native name | Notes |
|---|---|---|
| `Read` | `read` | Unified: files, dirs, archives, SQLite, images, PDF, URLs, internal URIs |
| `Grep` | `search` | Text pattern search |
| `Glob` | `find` | File pattern / directory structure |
| `Bash` | `bash` | Persistent shell |
| `WebFetch` | `read` (URL path) | `read(path="https://…")` — same tool, no separate name |
| `WebSearch` | `web_search` | 14-backend fallback chain |
| `Write` | `write` | File creation |
| `Edit` | `edit` | File editing (hashline mode available) |
| `apply_patch` | `apply_patch` | Keep as-is (omp-native) |
| `task` | `task` | Keep as-is (omp-native) |

Claude Code names (`Read`, `Grep`, `Glob`, `WebFetch`, `Bash`, `Write`, `Edit`) must be replaced in:
- All `agents/pi-oven-*.md` frontmatter `tools:` and `blocked_tools:` arrays
- All `skills/*/SKILL.md` bodies where tool names appear as instructions
- All `skills/*/references/*.md` sub-files (Fix 11: D2 scope includes reference sub-files, not just SKILL.md)
- All `commands/*.md` bodies — 2 files need conversion: `doctor.md`, `setup.md`; `release.md` is already clean (Fix NIT-4)

> **Fix 11 (D2 scope):** 9 skills have `references/*.md` sub-files containing Claude Code tool names (`brainstorming/references/checklist.md`, `code-quality-discipline/references/principles.md`, `codebase-survey/references/8-step-checklist.md`, `large-task-delegation/references/dispatch-anatomy.md`, `pre-commit-gate/references/gate-detail.md`, `spec-and-review/references/pattern-loop.md`, `subagent-driven-development/references/prompts.md`, `tdd-strict/references/anti-patterns.md`, `writing-plans/references/template.md`). Phase 2 scope must include these. lint-skills does not validate tool names, so add a manual grep gate to §8.3: `grep -rE '\b(Read|Grep|Glob|WebFetch|Bash|Write|Edit)\b' skills/` must return zero matches after Phase 2.

### 3.2 Per-role killer-tool allowlist (all 24 roles)

"Current declared tools" is taken verbatim from each agent's `tools:` frontmatter. "Add to `tools:`" is the net-new delta. Roles with `["*"]` already receive all tools but still need explicit body instructions.

> **BLOCKER (Fix 10):** The "Current declared tools" column below is derived from the actual `agents/pi-oven-*.md` frontmatter, not approximated. Key corrections vs. earlier drafts: critic = `["Read","Grep","Glob"]` (restrictive, NOT `["*"]`); explorer = `["Read","Grep","Glob","Bash"]`; verifier = `["Read","Grep","Glob","Bash","task"]`; planner = `["Read","Grep","Glob","Bash","task"]`; code-reviewer = `["Read","Grep","Glob","Bash"]`. Deltas below are computed from these true baselines.

| Role | Current declared tools (actual frontmatter) | Add to `tools:` | Rationale |
|---|---|---|---|
| executor | `["*"]` | body: `eval`, `debug` only (no `checkpoint` — subagent, tool unavailable) | codex REPL execution, DAP verification |
| explorer | `["Read","Grep","Glob","Bash"]` → convert to `[read,search,find,bash]` | `web_search` | scout agents need web fallback |
| verifier | `["Read","Grep","Glob","Bash","task"]` → convert to `[read,search,find,bash,task]` | `report_finding`, `recall` | structured findings (D5), recall prior context; irc auto-injected (D7) |
| critic | `["Read","Grep","Glob"]` (blocked_tools includes task/bash) → convert to `[read,search,find]` | `report_finding`, `recall` | structured findings (D5/Fix 4/Fix 29), recall; irc auto-injected |
| planner | `["Read","Grep","Glob","Bash","task"]` → convert to `[read,search,find,bash,task]` | `recall`, `retain` (no `checkpoint` — subagent) | memory-first planning |
| code-reviewer | `["Read","Grep","Glob","Bash"]` → convert to `[read,search,find,bash]` | `report_finding`, `web_search`, `recall`, `lsp`, `ast_grep` | structured findings, cross-boundary; irc auto-injected |
| debugger | `["*"]` | body: `debug` (DAP), `eval` (no `checkpoint` — subagent) | actual breakpoints, not just static reasoning |
| test-engineer | `["*"]` | body: `eval`, `debug`, `browser` | REPL-driven TDD, live test execution |
| security-reviewer | `[read,search,find,bash,lsp,ast_grep,web_search]` | `recall` | recall prior security findings |
| writer | `[read,search,find,write,edit]` | `web_search` | source-verified writing |
| designer | `["*"]` | body: `browser`, `inspect_image` | live visual verification, image analysis |
| code-simplifier | `[read,search,find,bash,lsp,ast_grep]` | (no `checkpoint` — subagent unavailable; no delta) | checkpoint removed: tool not available in subagents |
| qa-tester | `["*"]` | body: `browser` (native, not Playwright-MCP) | headless Chromium, a11y snapshots |
| git-master | `[read,bash]` | no change needed | scope is minimal |
| document-specialist | `[read,search,find,web_search]` | `recall` | recall prior doc research |
| tracer | `[read,search,find,bash]` | (no delta — irc auto-injected; no `checkpoint`/`rewind` — subagent unavailable) | irc auto-injected for cross-lane signalling (D7) |
| analyst | `[read,search,find,bash]` | `eval`, `recall` | Python/JS REPL for real data execution |
| architect | `["*"]` | body: `recall` only (no `checkpoint` — subagent) | recall prior ADRs |
| librarian | `[read,search,find,bash,lsp,web_search,ast_grep]` | `recall` | recall prior library research |
| multimodal-looker | `[read,search,find]` | `inspect_image` | dedicated image inspection tool |
| oracle | `["*"]` | body: `recall`, `retain` (on resolution) | recall context before consulting |
| metis | `[read,search,find,bash,web_search]` | `recall` | recall prior requirements |
| deep-researcher (NEW) | `[read,search,find,web_search]` | `retain`, `recall`, `reflect` | memory is core to this role; irc auto-injected for fan-out |
| data-runner (NEW) | `[bash,eval,read,write]` | `retain` (on insight) | REPL execution + persist results |

> **Fix 2 (checkpoint/rewind):** `checkpoint` and `rewind` are NOT available in subagents — `tools/checkpoint.md` states "Not available in subagents." Every pi-oven role runs as a subagent via `task`. Therefore `checkpoint`/`rewind` are removed from all subagent-role allowlists (verifier, planner, architect, tracer, code-simplifier). §4.2 injection paragraphs for these roles must NOT include `checkpoint`/`rewind` calls. If context compression for long-running subagents is desired, use the agent's own yield-with-summary pattern instead.

> **Fix 28 (checkpoint default-off):** Even where `checkpoint` might become available in future, it is gated behind `checkpoint.enabled` (schema default: `false`). Do not inject checkpoint instructions without also enabling the setting via `pi-oven:setup`.

> **Fix 34 (irc auto-injected — no frontmatter needed):** `irc` is auto-injected into every subagent's toolNames by `task/executor.ts`. It need NOT appear in the `tools:` frontmatter array for any role, including explicit-allowlist (non-`["*"]`) roles. Do NOT add `irc` to `tools:` for `code-reviewer`, `critic`, `verifier`, `tracer`, or `deep-researcher` — it is already present unconditionally.

---

## 4. Part B — Hybrid Integration

### 4.1 The 6 hybrid rewrites

Each rewrite absorbs the omp agent's structural patterns while preserving pi-oven's model/frontmatter SoT chain and any pi-oven-specific procedures.

**B1. `pi-oven:oracle` ← omp `oracle`**

Absorb from omp:
- Dual-mode header: explicit `Consult` / `Delegate` mode labels with "if the caller hands you work, you do it" framing.
- Decision framework: pragmatic minimalism + effort tags (Quick <1h / Short 1-4h / Medium 1-2d / Large 3d+).
- Scope discipline: "Do ONLY what was asked. No unsolicited refactors. At most 2 optional future considerations."
- Procedure: form 2–3 hypotheses, gather evidence in parallel, eliminate, deliver with evidence.
- Critical directive: "keep going until solved."

Preserve from pi-oven: model assignment (anthropic/claude-opus-4-8, xhigh), "last-resort after 2+ failures" framing, omp killer-tool recall-first paragraph.

**B2. `pi-oven:code-reviewer` ← omp `reviewer`**

Absorb from omp:
- Structured output via `report_finding` tool (title ≤80 chars imperative, body one paragraph: bug/trigger/impact, priority P0–P3, confidence 0.0–1.0, file_path, line_start, line_end).
- Final `yield` with `overall_correctness` (correct/incorrect), `explanation` (1-3 sentences), `confidence`.
- Cross-boundary protocol (full text, see §6): for every new type crossing a function/module boundary, locate the dispatch point on the consuming side; if it falls through to silent drop, report as defect.
- Criteria: provable impact + actionable + unintentional + introduced in patch.

Preserve from pi-oven: model assignment (opencode-zen/glm-5.1, high), 2-phase review structure (spec-first then code), severity × confidence matrix.

**B3. `pi-oven:librarian` ← omp `librarian`**

Absorb from omp:
- Source-direct reading hierarchy: local `node_modules` / `vendor` first; `git clone --depth 1` if absent; `web_search` for canonical repo URL, then `read(path="https://…")` for arxiv/PDF/SO.
- "Source is truth, documentation is aspiration, training data is history" — verbatim excerpts required.
- Structured `yield` output: `answer`, `sources[]` (repo, path, line_start, line_end, excerpt), `api[]` (signature verbatim, description), `version`, optional `breaking_changes[]`, `caveats[]`.
- Fallback ladder: if result empty → 2 alternate strategies before concluding nothing exists.

Preserve from pi-oven: model assignment (opencode-zen/glm-5.1, medium), document-specialist handoff pattern.

**B4. `pi-oven:explorer` ← omp `explore`**

Absorb from omp:
- Typed structured output: `summary` (string), `files[]` (path, description), `architecture` (string) — enables handoff without re-reading.
- Thoroughness inference: Quick / Medium / Thorough.
- `web_search` as first-class tool (omp's explore agent includes it; pi-oven's does not).
- "Keep going until complete" + read-only critical.

Preserve from pi-oven: 8-step survey pattern, 1M context Gemini Flash model (opencode-zen/gemini-3-flash, medium), parallel search launch discipline, 600-word cap, context budget rules.

**B5. `pi-oven:planner` AND `pi-oven:architect` ← omp `plan`**

omp `plan` maps to both roles (pi-oven splits planning from architecture).

Absorb from omp into `planner`:
- Spawn `pi-oven:explorer` agents in parallel for independent areas and synthesize findings.
- Plan structure: Summary / Changes (exact file paths + line ranges) / Sequence (dependencies) / Edge Cases / Verification / Critical Files.
- "Executable without re-exploration" requirement.

Absorb from omp into `architect`:
- Phase 1 (Understand): parse requirements, list ambiguities, state assumptions.
- Phase 3 (Design): list alternatives, justify choice, note pitfalls.

Preserve from pi-oven: separate model assignments (planner = anthropic/claude-opus-4-8/high; architect = openai-codex/gpt-5.4/xhigh), planner's 1-question-per-turn interview protocol, architect's ADR / coupling-cohesion / migration strategy focus.

**B6. `pi-oven:designer` ← omp `designer`**

Absorb from omp:
- Anti-slop 14 forbidden patterns (verbatim from omp designer `<avoid>` block):
  1. Glassmorphism (blur, glass cards, glow borders decorative)
  2. Cyan-on-dark with purple gradients (2024 AI color palette)
  3. Gradient text on metrics/headings
  4. Card grids with identical cards (icon + heading + text repeated)
  5. Cards nested inside cards
  6. Large rounded-corner icons above every heading
  7. Hero metric layouts (big number, small label, gradient accent)
  8. Same spacing everywhere (no rhythm)
  9. Center-aligned everything
  10. Modals for everything
  11. Overused fonts (Inter, Roboto, Open Sans, system defaults)
  12. Pure black (#000) or pure white (#fff)
  13. Gray text on colored backgrounds
  14. Bounce/elastic easing (use exponential: ease-out-quart/expo)
- UX anti-patterns: missing states (loading/empty/error), redundant information, every button primary, empty states that say "nothing here."
- Critical directive: "Every interface should prompt 'how was this made?' not 'which AI made this?'"
- `browser` native tool for live visual verification.

Preserve from pi-oven: model assignment (opencode-zen/glm-5.1, high), WCAG accessibility checks, multimodal-looker delegation pattern for vision.

### 4.2 The 15-role pure-injection list

> **Fix 7 (count reconciliation):** The original "16-role injection list" was overcounted. The 7 hybrid-rewrite roles (oracle, code-reviewer, librarian, explorer, planner, architect, designer) have their tool activation handled in §4.1 hybrid rewrites — they are NOT in this table. The 22 existing roles minus 7 hybrid = 15 pure-injection roles. Of those, git-master is a no-op. The table below covers 14 body-injection roles + git-master (no-op). `test-engineer` and `writer` were previously missing — they are added here (Fix 7).

> **Fix 2 (checkpoint/rewind removed):** `checkpoint`/`rewind` are not available in subagents (`tools/checkpoint.md`: "Not available in subagents"). Removed from tracer, code-simplifier, architect entries below.

> **Fix 20 (hybrid overlap):** architect, librarian, planner appear in §4.1 hybrid rewrites. Their tool-activation paragraphs are written as part of the hybrid body rewrite (Phase 4), not here. They are excluded from this table to avoid double-editing.

Each role receives a "Killer Tool Activation" paragraph in its body. The paragraph names the tool, gives one concrete call example, and states when to invoke it.

| Role | Tool to inject | Concrete invocation example |
|---|---|---|
| executor | `eval` (REPL verification) | `eval(cells=[{language:"py", code:"import subprocess; r=subprocess.run(['bun','test'],capture_output=True); print(r.stdout.decode())"}])` |
| executor | `debug` (runtime assertion) | `debug(action:"launch", adapter:"debugpy", program:"./dist/app")` → `debug(action:"set_breakpoint", file:"src/app.ts", line:42)` → `debug(action:"continue")` |
| debugger | `debug` (DAP) | `debug(action:"launch", adapter:"debugpy", program:"src/main.py")` → `debug(action:"set_breakpoint", file:"src/main.py", line:55)` → `debug(action:"continue")` → `debug(action:"stack_trace")` / `debug(action:"variables")` / `debug(action:"evaluate", expression:"x", context:"repl")` |
| test-engineer | `eval` + `debug` + `browser` | `eval(cells=[{language:"py", code:"import pytest; pytest.main(['-x','tests/'])"}])`; `debug(action:"launch", adapter:"debugpy", program:"tests/test_main.py")`; `browser(action:"open", name:"main", url:"http://localhost:3000")` |
| writer | `web_search` | `web_search(query="…")` → top URL → `read(path=url)` for source-verified writing |
| analyst | `eval` (REPL data) | `eval(cells=[{language:"py", code:"import pandas as pd; df = pd.read_csv('metrics.csv'); display(df.describe())"}])` |
| librarian | `read` (URL/PDF) — handled in §4.1 B3 | `read(path="https://arxiv.org/pdf/XXXX")` → clean markdown, anchors preserved |
| document-specialist | `read` (URL) + `web_search` | `web_search(query="…")` → top URL → `read(path=url)` |
| qa-tester | `browser` (native) | `browser(action:"open", name:"main", url:"http://localhost:3000")` → `browser(action:"run", code:"document.querySelector('h1').innerText")` |
| multimodal-looker | `read` (PDF) + `inspect_image` | `read(path="https://arxiv.org/pdf/…")` for full-text; `inspect_image(path="img.png", question="what does this diagram show?")` for visual |
| verifier | `recall` + `report_finding` | `recall(query="prior verification failures for this module")` before sub-checks; `report_finding(title:"…", body:"…", priority:"P1", confidence:0.8, file_path:"…", line_start:1, line_end:5)` per finding |
| critic | `report_finding` + `recall` | Per-finding: `report_finding(title:"…", body:"bug + trigger + impact", priority:"P0"|"P1"|"P2"|"P3", confidence:0.0-1.0, file_path:"…", line_start:N, line_end:N)`; `recall(query="prior critique context for this area")` |
| security-reviewer | `web_search` + `recall` | `web_search(query="CVE OWASP …")` for fresh vuln data; `recall(query="security findings")` |
| tracer | `irc` (auto-injected; cross-lane signalling, no checkpoint — subagent) | `irc(op:"send", to:"all", message:"hypothesis confirmed: <component> is root cause")` when lane reaches conclusion; `irc(op:"list")` to discover sibling peer ids |
| code-simplifier | (no killer-tool injection — checkpoint removed, no other tool needed) | — |
| metis | `recall` | `recall(query="prior requirements decisions for this feature")` before interview |
| git-master | (no change needed) | — |

---

## 5. Part C — Two New Roles

### 5.1 `deep-researcher`

**Role.** Multi-source adversarial research with web_search + arxiv/PDF full-text + synthesis. Distinct from `librarian` (library source reading) and `document-specialist` (quick docs lookup).

**Model.**
- primary: `opencode-zen/gemini-3-flash`
- registry_alternate: `opencode-zen/claude-sonnet-4-6`
- thinkingLevel: `high`

**Tools.** `read, search, find, web_search, retain, recall, reflect` (irc auto-injected — not listed)

**Body outline (sections).**
1. Role — multi-source adversarial verifier; returns cited synthesis, never training-data assertions.
2. Execution Context — Gemini Flash (long-context, parallelise fan-out, terse output).
3. Procedure:
   a. `recall(query)` first — retrieve any prior research on the topic.
   b. `web_search` for 3+ independent source angles simultaneously.
   c. `read(path="https://arxiv.org/pdf/…")` or `read(path=url)` for each primary source.
   d. Adversarial verification: for each key claim, find a contradicting source; only accept claim if contradiction fails.
   e. `reflect` on synthesis quality before finalising.
   f. `retain` the final synthesis with citations.
4. Output Format — `## Synthesis`, `## Sources[]` (url, excerpt, confidence), `## Contradictions`, `## Confidence`.
5. Failure modes — do not assert from training data; do not stop at 1 source; do not skip contradictions.

**Wiring to flows (all 5 entry points — D4 requirement).**

> **Fix 6/32 (5 entry points defined):** The canonical 5 entry-point skills are: `spec-and-review`, `autonomous-loop`, `deep-dive`, `improve-codebase-architecture`, `large-task-delegation`.

- `spec-and-review`: Add `pi-oven:deep-researcher` to the `Agent Dispatch (omp)` block (SKILL.md line ~121) as a sibling to `pi-oven:librarian` — invoke for novel domains, papers, or state-of-the-art research. Also wirable at Step -1 (brainstorming) when domain is unfamiliar. **Do NOT use "Step 0 research phase" — that is the codebase-survey precondition, not a research step (Fix 23).**
- `improve-codebase-architecture`: Before `pi-oven:explorer` dispatch at SKILL.md:45 (Step 1 Survey), dispatch `pi-oven:deep-researcher` for pre-survey research on architecture patterns (Fix NIT-9).
- `deep-dive`: Dispatch `pi-oven:deep-researcher` as a pre-Phase-3 "prior-art / known-issues" sibling alongside the tracer fan-out. It is NOT a numbered hypothesis lane — its output feeds Phase-4 Injection-2 (codebase/context) rather than the `## Ranked Hypotheses` table. Lane count = N confirmed hypotheses (not fixed at 3); deep-researcher is a non-hypothesis sibling. **Do NOT use "4th parallel lane" framing — deep-dive lane count equals confirmed hypothesis count (Fix 22).**
- `autonomous-loop`: Add `pi-oven:deep-researcher` dispatch for domain research at the ASK-FIRST / pre-loop clarification step, when the task requires external knowledge.
- `large-task-delegation`: Add `pi-oven:deep-researcher` reference in the dispatch anatomy for research-heavy delegation tasks.

**Skill reference.** The `spec-and-review` SKILL.md body must reference `pi-oven:deep-researcher` using the bare colon form (not `/pi-oven:deep-researcher` — slash-prefixed refs do NOT satisfy lint-skills role coverage; see §8.2, Fix 16).

### 5.2 `data-runner`

**Role.** Real data transformation, statistics, charts, and model runs via `eval` REPL (Python/JS). Distinct from `analyst` (read-only statistical analysis) and `executor` (code implementation). Collaborates with `analyst` for hypothesis → execution loop.

**Model.**
- primary: `openai-codex/gpt-5.4`
- registry_alternate: `opencode-zen/gpt-5.4`
- thinkingLevel: `high`

**Tools.** `bash, eval, read, write, retain`

**Body outline (sections).**
1. Role — data execution specialist; writes and runs Python/JS cells; never modifies production code.
2. Execution Context — gpt-5.4 Codex (strong at code generation, REPL loop, variable inspection).
3. Execution model: `eval` state persists across cells and across `task`-spawned subagents — define helpers once, fan out via `parallel()`.
4. Procedure:
   a. Load data: `eval(cells=[{language:"py", code:"import pandas as pd; df = pd.read_csv(…)"}])`.
   b. Explore: `display(df.describe())`.
   c. Transform + analyse: incremental cells, each one logical step.
   d. Chart: `display(fig)` for Matplotlib/Plotly.
   e. `retain` any significant insight before session end.
5. Output Format — cell-by-cell results inline; final `## Results` block with key findings.
6. Failure modes — do not modify project files; do not use bash for data that eval can handle; do not re-import between cells.

**Wiring to flows (all 5 entry points — D4 requirement).**

> **Fix 6/32 (5 entry points):** Same canonical 5 as §5.1: `spec-and-review`, `autonomous-loop`, `deep-dive`, `improve-codebase-architecture`, `large-task-delegation`.

- `autonomous-loop`: Insert `pi-oven:data-runner` as a step in the per-cycle work order between step 8 (tdd-strict) and step 9 (pre-commit-gate): "data/benchmark validation via `pi-oven:data-runner` when the cycle touches metrics/performance" (Fix 26). Also add to autopilot Phase 3 QA routing (SKILL.md:100). The concrete edit: after the `pi-oven:test-engineer` dispatch, add a conditional: if the work involves data/benchmarks, dispatch `pi-oven:data-runner` via `task` to validate metrics via REPL.
- `deep-dive`: Dispatch `pi-oven:data-runner` in Phase 3/4 for REPL log/trace analysis when static analysis is insufficient. This is a conditional post-lane dispatch (not a hypothesis lane). Add to §8.1 deep-dive row (Fix 25).
- `improve-codebase-architecture`: After architecture survey, dispatch `pi-oven:data-runner` to run benchmark/performance baseline in REPL before recommending changes.
- `spec-and-review`: Add `pi-oven:data-runner` to the `Agent Dispatch (omp)` block for empirical validation of spec claims (metrics, performance assertions).
- `large-task-delegation`: Add `pi-oven:data-runner` reference in the dispatch anatomy for data-validation sub-tasks.

> **Fix 25 (analyst-collaboration host):** "Analyst collaboration" is not an entry-point skill. The analyst→data-runner pairing is realized inside `autonomous-loop` and `deep-dive` where `pi-oven:analyst` is already dispatched (SKILL.md:35 deep-dive Phase 1, SKILL.md:96 autonomous-loop autopilot). The concrete wiring: add a `pi-oven:data-runner` dispatch line in the `Agent Dispatch (omp)` block of `deep-dive` and `autonomous-loop` alongside the `analyst` routing.

**Skill reference.** The `autonomous-loop` SKILL.md body must reference `pi-oven:data-runner` using the bare colon form `pi-oven:data-runner` (not `/pi-oven:data-runner` — slash-prefixed refs do NOT satisfy lint-skills role coverage; see §8.2, Fix 16).

### 5.3 Exact `profiles.ts` edits + required test updates

> **Fix 12/13/18 (test literal updates — Phase 1 atomic unit):** Bumping `EXPECTED_AGENT_COUNT` 22→24 breaks four test files with hard-coded literal `22`. These MUST be updated in the same Phase 1 commit as the profiles.ts edit — they are spec-alignment updates, not test hacks. Phase 7 note: these specific assertion updates are required and expected, not regressions.

**Mandatory test file edits (same atomic commit as profiles.ts):**

- `tests/scripts/pi-oven-setup/profiles.test.ts` — `profiles.test.ts` has `.toBe(22)` in **4 spots** (verified blocker). Change all four occurrences → `toBe(24)`. Prefer `toBe(EXPECTED_AGENT_COUNT)` where the expectation is on `EXPECTED_AGENT_COUNT` itself, so future bumps don't re-break. Confirm exact line numbers by grepping at implementation time: `grep -n 'toBe(22)' tests/scripts/pi-oven-setup/profiles.test.ts`.
- `tests/scripts/pi-oven-setup/apply.test.ts:145` and `:165` — change `expect(entries.length).toBe(22)` → `toBe(ROLES.length)` (two occurrences, after `populateAgents` over ROLES).
- `tests/scripts/pi-oven-setup/validate.test.ts:115` — change `expect(pingedModels.length).toBe(22)` → `toBe(ROLES.length)`. Also update the comment at line 76 (`// Full mode would issue 22`) to 24.
- `tests/scripts/pi-oven-setup/agent-rewriter.test.ts:231` — change `expect(rewritten.length).toBe(22)` → `toBe(ROLES.length)` (after `populateAgentsDir(tempDir, ROLES, ...)` at line 222).

> **Fix NIT-7 (profiles.ts header comment):** Also update the profiles.ts header docstring (lines 1-3 and 170-186) from "all 22 pi-oven roles" → "all 24 pi-oven roles".

> **Fix NIT-8 (Phase 1 atomic commit):** The following form ONE indivisible commit: profiles.ts edits (ROLES, PROFILE_A, PROFILE_B, EXPECTED_AGENT_COUNT), the two new agent files (`agents/pi-oven-deep-researcher.md`, `agents/pi-oven-data-runner.md`), the four test literal updates above, AND the two skill-body references (`pi-oven:deep-researcher` in `spec-and-review/SKILL.md`, `pi-oven:data-runner` in `autonomous-loop/SKILL.md`) — see Fix 17/36. Partial application leaves either `tsc` red or `lint:agents`/`lint:skills` red.

1. `EXPECTED_AGENT_COUNT`: `22` → `24`.
2. `ROLES` array: append `"deep-researcher"` and `"data-runner"` (at the end, before `] as const`).
3. `PROFILE_A`: add two entries:
   ```ts
   "deep-researcher": {
     primary: "opencode-zen/gemini-3-flash",
     registry_alternate: "opencode-zen/claude-sonnet-4-6",
     thinkingLevel: "high",
   },
   "data-runner": {
     primary: "openai-codex/gpt-5.4",
     registry_alternate: "opencode-zen/gpt-5.4",
     thinkingLevel: "high",
   },
   ```
4. `PROFILE_B`: add two entries (PROFILE_B is deferred but `ProfileMap = Record<Role,ModelEntry>` requires completeness or TS fails):
   ```ts
   "deep-researcher": {
     primary: "anthropic/claude-sonnet-4-6",
     registry_alternate: "opencode-zen/claude-sonnet-4-6",
     thinkingLevel: "high",
   },
   "data-runner": {
     primary: "anthropic/claude-sonnet-4-6",
     registry_alternate: "opencode-zen/claude-sonnet-4-6",
     thinkingLevel: "high",
   },
   ```

### 5.4 New agent files

- `agents/pi-oven-deep-researcher.md` — frontmatter `name: pi-oven:deep-researcher`, model array derived from PROFILE_A entry, body per §5.1 outline.
- `agents/pi-oven-data-runner.md` — frontmatter `name: pi-oven:data-runner`, model array derived from PROFILE_A entry, body per §5.2 outline.

---

## 6. Part D — Absorbed Patterns

### 6.1 `report_finding` structured output

**Target roles:** `code-reviewer`, `critic`, `verifier`.

> **Fix 4/8/29/33 (allowlist prerequisite):** `report_finding` is a registered tool (`tools/review.ts:123` name: `"report_finding"`, registered `tools/index.ts:332`). It MUST appear in the `tools:` frontmatter array of every role that uses it — body instructions alone are insufficient (omp resolves tools strictly from the allowlist). Per §3.2: `code-reviewer`, `critic`, and `verifier` all require `report_finding` in their explicit `tools:` arrays. Critic's actual frontmatter is `["Read","Grep","Glob"]` (NOT `["*"]`) — `report_finding` must be explicitly added.

> **Fix 5 (per-role output contract):** `report_finding`'s parameter schema is defined by the tool registration, not the reviewer agent frontmatter. The `overall_correctness`/`explanation`/`confidence` yield contract is `code-reviewer`-specific (reviewer agent `output:` block). Critic and verifier have DIFFERENT output semantics and must define their own `output:` frontmatter rather than reusing reviewer's verbatim. The "≤10-line range, must overlap diff" finding constraint is review-diff-specific and does NOT apply to critic (which reviews plans/designs, not always diffs). Confirm `report_finding`'s exact param schema from the omp tool registry before authoring bodies.

Each `report_finding` call requires: `title` (imperative, ≤80 chars), `body` (one paragraph: issue + trigger + impact, neutral tone), `priority` ("P0"–"P3" string per table below), `confidence` (0.0–1.0), `file_path`, `line_start`, `line_end`.

> **Verified fact (report_finding output schema):** For findings to auto-merge into the structured result, the role's `output:` schema must declare an optional `findings[]` array with `priority` typed as a **NUMBER** — omp coerces the string "P0"/"P1"/"P2"/"P3" to ordinal 0/1/2/3 on merge. Declaring `priority` as `string` in `output:` will prevent auto-merge. Apply this to `code-reviewer`, `critic`, and `verifier` `output:` frontmatter.

- For `code-reviewer`: `line_start`/`line_end` ≤10-line range, finding must overlap diff.
- For `critic`: `file_path`/`line_start`/`line_end` refer to the plan/design artifact being reviewed; range constraint relaxed (critic reviews designs, not always diffs).
- For `verifier`: fields refer to the code path under verification.

| Level | Criteria | Example |
|---|---|---|
| P0 | Blocks release; universal (no input assumptions) | Auth bypass, data corruption |
| P1 | High; fix next cycle | Race condition under load |
| P2 | Medium; fix eventually | Edge case mishandling |
| P3 | Info; nice to have | Suboptimal but correct |

Final `yield` per role:
- `code-reviewer`: `overall_correctness` (correct/incorrect), `explanation` (1-3 sentences), `confidence`. `findings[]` auto-populated — do not set manually.
- `critic`: define explicit `output:` frontmatter with verdict appropriate to critique scope (e.g. `verdict: sound/flawed/partial`). Do NOT reuse reviewer's `overall_correctness` verbatim without explicit intent.
- `verifier`: define explicit `output:` frontmatter with pass/fail evidence schema. Do NOT reuse reviewer's `overall_correctness` verbatim without explicit intent.

**Criteria for filing a finding (all must hold):** provable impact on specific code paths; actionable with a discrete fix; unintentional (not a deliberate design choice); no unstated assumptions; proportionate rigor. For `code-reviewer`: also must be introduced in the diff.

### 6.2 Cross-boundary tracing protocol

**Target roles:** `code-reviewer`, `tracer`.

For every new type, variant, or value introduced by the patch that crosses a function or module boundary (event, message, command, frame, enum variant, queue item, IPC payload):

1. Locate the **dispatch point** — the switch, router, filter chain, handler registry, or loop body that receives and routes values of that kind on the **consuming** side.
2. Confirm the new type has an explicit branch, or that an existing catch-all forwards it correctly.
3. If the new type falls through to a silent drop, no-op, or discard (e.g., an unmatched `if`/`switch` that returns without processing), report it as a P0 or P1 defect.

The dispatch point is frequently **outside the diff**. Reading only the emitting side while skipping the consuming routing logic is the single most common source of missed integration bugs. Both roles must trace to the consuming side before concluding correctness.

### 6.3 Anti-slop aesthetic discipline

**Target role:** `designer`.

The 14 forbidden patterns from omp `designer.md` (listed verbatim in §4.1 B6 above) are to be incorporated as a `<avoid>` section in `pi-oven-designer.md`. The critical directive ("every interface should prompt 'how was this made?' not 'which AI made this?'") must be present in the `<critical>` block.

Additionally absorb from omp:
- Procedure step ordering: read existing components/tokens/patterns first; reuse before inventing.
- Explicit state requirement: implement loading, empty, error, disabled, hover, focus states.
- Accessibility verification: contrast, focus rings, semantic HTML.

---

## 7. Part E — Memory & IRC Infra

### 7.1 `memory-discipline` skill spec

**File:** `skills/memory-discipline/SKILL.md`

> **Fix 27 (memory backend prerequisite — BLOCKER):** `retain`, `recall`, and `reflect` are gated behind `memory.backend` in omp (`tools/index.ts:442-443`). The schema default is `"off"` (`config/settings-schema.ts:1342`). With `memory.backend = "off"` (default), none of these tools appear in any agent's toolset — every `recall`/`retain`/`reflect` call is silently dropped. `pi-oven` currently has zero references to `memory.backend`/`hindsight`/`mnemopi`. **Required action:** `pi-oven:setup` MUST write `memory.backend = "hindsight"` (or `"mnemopi"`) to user/project omp settings, or D6 is entirely inert. Add a verification step to §8.3: confirm `retain`/`recall` present in a live subagent toolset. If pi-oven cannot mandate a backend, memory-discipline must degrade gracefully: skill body instructs "recall IF available; skip gracefully if not."

> **Fix 3 (retain/recall/reflect param schema):** The tool `.md` prose does not expose a parameter schema. Before authoring agent/skill bodies: read the omp tool *registration* (JTD/zod schema) for `retain`, `recall`, `reflect` to pin exact param names and cardinality. Provisional guidance from prose: `retain` takes a batch of fact items (not a single positional string — retain.md: "Batch related facts in a single call"); `recall` likely takes a query object (not a keyword-arg `query=`); `reflect` takes optional `context`. The §7.1 body examples below use provisional syntax — **mark as TODO-verify against actual schema before Phase 6**.

> **Fix 14/19/37 (trigger field required):** `lint-skills.ts:79` hard-fails any skill missing a `trigger:` frontmatter field. `alwaysApply: true` does NOT exempt from this requirement — only `code-quality-discipline` has a hardcoded exemption (line 70-72). `memory-discipline` must have BOTH `trigger:` (with Korean keyword) AND `alwaysApply: true`.

> **Fix 38 (no alwaysApply fallback):** D6 mandates `alwaysApply: true`. Do not degrade to keyword-only trigger. If omp's plugin/skill schema lacks `alwaysApply` support, the implementation must verify/add that support rather than silently switching to keyword trigger. Resolve against omp schema before Phase 6 (verify `alwaysApply` is a real omp skill frontmatter key — R7 flags this as unverified).

**Frontmatter:**
```yaml
name: memory-discipline
description: Defines when to retain, recall, and reflect — wires omp Hindsight memory into all pi-oven flows.
alwaysApply: true
trigger: "메모리 규율, 기억 저장, retain 정책, flow start, recall, cycle end"
```

**Body outline.**

**Prerequisite check.** If `memory.backend` is not `hindsight` or `mnemopi`, log a warning and skip all retain/recall/reflect calls gracefully. Do not fail.

**When to `recall` (flow start, before planning).**
Core roles that must `recall` before first tool call: `planner`, `oracle`, `architect`, `critic`, `deep-researcher`.
Recall query patterns: `"prior decisions for <feature/module>"`, `"past failures in <area>"`, `"open questions from last session"`.
_Provisional call syntax (TODO-verify schema):_ `recall({query: "prior decisions for <feature>"})`.

**When to `retain` (cycle end / decision / lesson).**
Retain immediately after: plan finalised; architectural decision made; a hypothesis is disproven (the disproof is the lesson); a bug root cause is confirmed; a security finding is filed; a research synthesis is complete.
Format: batch of self-contained factual statements (who/what/when/why). No speculation. No "we decided to" — just the facts. `retain` takes a batch, not a single positional string.
_Provisional call syntax (TODO-verify schema):_ `retain([{fact: "…"}, {fact: "…"}])`.

**When to `reflect` (synthesis).**
After retaining ≥3 related items in a session, call `reflect` to synthesise them into a higher-level insight and retain that too.
_Provisional call syntax (TODO-verify schema):_ `reflect({context: "session topic"})`.

**When NOT to retain.**
Do not retain: intermediate tool results, work-in-progress, uncertain hypotheses, file contents.

**Entry-point wiring (per-skill additions — see §7.2).**

### 7.2 Five-entry wiring map

> **Fix 6 (canonical 5 entry points):** The 5 entry-point skills are: `spec-and-review`, `autonomous-loop`, `deep-dive`, `improve-codebase-architecture`, `large-task-delegation`. The previous table listed `spec-and-review` twice (rows 1 and 5) — that is corrected here with 5 distinct skills.

| Entry point | Where to add memory instructions | Specific actions |
|---|---|---|
| `spec-and-review` | `Agent Dispatch (omp)` block (Step 0, before first agent dispatch) | `recall` prior specs/decisions before brainstorm; `retain` after plan approval |
| `autonomous-loop` | Pre-loop ASK-FIRST block | `recall` prior cycle failures at loop entry; `retain` at each confirmed MILESTONE; `reflect` at loop exit |
| `deep-dive` | Before tracer fan-out (Phase 2) | `recall` prior investigation of this component; `retain` confirmed root cause on exit |
| `improve-codebase-architecture` | Before `pi-oven:explorer` dispatch (Step 1) | `recall` prior architecture decisions and ADRs; `retain` accepted architecture change |
| `large-task-delegation` | Before dispatch anatomy | `recall` prior delegation outcomes for this task type; `retain` delegation result and lessons |

Additional skills that benefit: `systematic-debugging` (recall prior failure modes), `fresh-verifier` (recall prior verification failures).

> **Fix 3 (retain/recall provisional syntax):** All `recall`/`retain` call examples in §7.2 skill bodies use provisional syntax pending schema verification (see §7.1 prerequisite note). Mark TODO-verify in each skill body during Phase 6.

### 7.3 IRC fan-out coordination

> **Fix 1/9/30/39 (real irc schema — verified):** The omp `irc` tool exposes exactly two ops: `op:"list"` (returns sibling peer ids visible to caller) and `op:"send"` (sends to a peer id or `"all"`). There is NO `channel` create/open/poll op. Addressing is by peer id (from `op:"list"`), not by channel name. The `irc channel "name"` syntax used in earlier drafts is hallucinated and non-functional. Plain prose messages only — no structured JSON payloads. `irc` is **auto-injected** into every subagent's toolNames — it need NOT appear in any `tools:` frontmatter. Works only among SIBLING subagents spawned in ONE `task` call, within recursion depth 2.

> **Fix 31 (async/concurrency — verified facts):** D7 IRC coordination works only via **in-call parallelism**: `task({agent, tasks:[{...},{...}]})` runs sibling subagents concurrently (maxConcurrency default 32) and irc messages flow between them within that single call. **Async background-job / poll-later is force-disabled for subagents** (`task/executor.ts` hard-forces `async.enabled=false` on each spawned subagent). Recursion depth cap = 2 — all pi-oven roles are depth ≥1, so any role they spawn via `task` is depth 2 (the cap). **Required action:** `pi-oven:setup` MUST write `async.enabled = true` in the orchestrator (main session) settings so the parent `task` call can fan out siblings concurrently. Without it, tasks run sequentially and irc peers never co-exist. Add to §8.3 prerequisites. Add §10 risk entry.

> **Fix 24/35 (spec-and-review fan-out membership):** `codex-reviewer` is NOT a pi-oven role. The actual `spec-and-review` review fan-out dispatches the same `pi-oven:critic` prompt to two model providers via `task(model:"codex")` + `task(model:"zen")` (SKILL.md:81-84). Verifier is not part of this fan-out. The §8.1/Phase 6 step must include an edit to `spec-and-review/SKILL.md` that converts the review step to dispatch `pi-oven:critic` + `pi-oven:code-reviewer` in parallel (if that is the intended fan-out), or preserves the two-provider critic dispatch and adds irc between those two tasks.

> **Fix 22/40 (deep-dive lane topology):** deep-dive lane count = N confirmed hypotheses (not fixed at 3). deep-researcher is NOT a numbered hypothesis lane — it is a pre-Phase-3 sibling dispatch (see §5.1). The data-runner deep-dive dispatch (§5.2) is a conditional post-lane REPL probe, not an additional lane. Do not use "3+1" or "4-lane" framing. Decide: is data-runner a conditional 5th lane, a post-lane REPL probe, or excluded from the parallel fan-out? Resolve in §8.1 deep-dive row and §7.2 so they agree.

**irc** enables live messages between co-resident parallel agents spawned in a **single `task` call** (in-call parallelism only). Background-job / poll-later patterns do NOT work in subagents. Recursion depth cap = 2: pi-oven roles are depth ≥1; any sub-task they spawn is depth 2 (the hard cap). `irc` is auto-injected into every subagent — no frontmatter listing required. Only `op:"send"` and `op:"list"` exist; plain prose messages only (no JSON payloads). Add an `irc-coordination` paragraph to the following skills/roles. **Prerequisite:** `async.enabled = true` must be set by `pi-oven:setup` in the main orchestrator session so the parent `task` call fans out siblings concurrently.

**`spec-and-review` review fan-out (two-provider critic dispatch + `pi-oven:code-reviewer`).**
The orchestrator fans out reviewer tasks in a single `task({agent, tasks:[...]})` call so siblings are co-resident. Each reviewer discovers sibling peer ids via `irc(op:"list")`. When a P0/P1 finding is confirmed, the reviewer broadcasts immediately in plain prose: `irc(op:"send", to:"all", message:"P0 finding confirmed in <file>: <one-sentence summary>", awaitReply:false)`. Other reviewers can adjust scope based on the broadcast. The orchestrator waits for all tasks to complete (not a poll loop) before collecting results.

**`autonomous-loop` parallel executor dispatch.**
When `large-task-delegation` fans out executor agents in a single `task({agent, tasks:[...]})` call (isolated worktrees), each executor discovers sibling peer ids via `irc(op:"list")`. Broadcast on completion or blocker: `irc(op:"send", to:"all", message:"executor done: <task-summary>")` or `irc(op:"send", to:"all", message:"blocker: <description>, pausing")`. Executors use `irc(op:"list")` to check for cancellation signals from siblings.

**`deep-dive` tracer lanes + deep-researcher sibling.**
Each tracer (one per confirmed hypothesis) and the deep-researcher sibling are all co-spawned in one `task({agent, tasks:[...]})` call. Each discovers co-resident peer ids via `irc(op:"list")`. When a lane confirms the root cause, it broadcasts in plain prose: `irc(op:"send", to:"all", message:"root cause confirmed in <component>: <summary>")`. Other lanes can terminate early. deep-researcher broadcasts when prior-art research is complete: `irc(op:"send", to:"all", message:"prior-art research complete: <key finding>")`.

### 7.4 `plugin.json` addition

Add to the `skills` array in `.claude-plugin/plugin.json`:
```json
"./skills/memory-discipline/SKILL.md"
```

Position: first in the array (alwaysApply skills should be registered early).

---

## 8. Part F — Lint / Profiles / plugin.json Edits & Verification Plan

### 8.1 File change inventory

| File | Change | Phase |
|---|---|---|
| `scripts/pi-oven-setup/profiles.ts` | EXPECTED_AGENT_COUNT 22→24; add `deep-researcher` + `data-runner` to ROLES, PROFILE_A, PROFILE_B; update header comment 22→24 (Fix NIT-7) | 1 |
| `tests/scripts/pi-oven-setup/profiles.test.ts` | 4 spots with `.toBe(22)` → `toBe(24)` (prefer `toBe(EXPECTED_AGENT_COUNT)` where applicable; grep to find all 4 lines) (Fix 12/18) | 1 |
| `tests/scripts/pi-oven-setup/apply.test.ts` | Lines 145, 165: `toBe(22)` → `toBe(ROLES.length)` (Fix 13) | 1 |
| `tests/scripts/pi-oven-setup/validate.test.ts` | Line 115: `toBe(22)` → `toBe(ROLES.length)`; line 76 comment 22→24 (Fix 13/18) | 1 |
| `tests/scripts/pi-oven-setup/agent-rewriter.test.ts` | Line 231: `toBe(22)` → `toBe(ROLES.length)` (Fix 13) | 1 |
| `agents/pi-oven-deep-researcher.md` | NEW | 1 |
| `agents/pi-oven-data-runner.md` | NEW | 1 |
| `skills/spec-and-review/SKILL.md` | Add `pi-oven:deep-researcher` bare colon ref (lint coverage) + recall/retain wiring + irc + data-runner ref | 1 (coverage ref); 6 (memory/irc wiring) |
| `skills/autonomous-loop/SKILL.md` | Add `pi-oven:data-runner` bare colon ref (lint coverage) + recall/retain wiring + irc + data-runner step in work order | 1 (coverage ref); 6 (memory/irc wiring) |
| `agents/pi-oven-*.md` (all 22 existing) | frontmatter `tools:`/`blocked_tools:` to omp native names; killer-tool body paragraphs | 2+3 |
| `skills/*/SKILL.md` (all 21) | omp native tool names | 2 |
| `skills/*/references/*.md` (9 files: brainstorming, code-quality-discipline, codebase-survey, large-task-delegation, pre-commit-gate, spec-and-review, subagent-driven-development, tdd-strict, writing-plans) | omp native tool names (Fix 11) | 2 |
| `commands/doctor.md`, `commands/setup.md` | omp native tool names (release.md already clean) (Fix NIT-4) | 2 |
| `agents/pi-oven-oracle.md` | Hybrid rewrite body (B1); frontmatter inherited from Phase 2 | 4 |
| `agents/pi-oven-code-reviewer.md` | Hybrid rewrite body (B2) + `report_finding` + cross-boundary; frontmatter from Phase 2 | 4 |
| `agents/pi-oven-librarian.md` | Hybrid rewrite body (B3); frontmatter from Phase 2 | 4 |
| `agents/pi-oven-explorer.md` | Hybrid rewrite body (B4); frontmatter from Phase 2 | 4 |
| `agents/pi-oven-planner.md` | Hybrid rewrite body (B5a); frontmatter from Phase 2 | 4 |
| `agents/pi-oven-architect.md` | Hybrid rewrite body (B5b); frontmatter from Phase 2 | 4 |
| `agents/pi-oven-designer.md` | Hybrid rewrite body (B6) + anti-slop 14 patterns; frontmatter from Phase 2 | 4 |
| `agents/pi-oven-critic.md` | Add `report_finding`, `recall` to `tools:` (irc auto-injected — do NOT add); `report_finding` absorption body | 5 |
| `agents/pi-oven-verifier.md` | Add `report_finding`, `recall` to `tools:` (irc auto-injected — do NOT add); `report_finding` absorption body | 5 |
| `agents/pi-oven-tracer.md` | No `tools:` change needed (irc auto-injected); cross-boundary protocol body; remove checkpoint/rewind | 5 |
| `skills/memory-discipline/SKILL.md` | NEW (with `trigger:` field containing Korean keyword) | 6 |
| `tests/plugin/skill-count.test.ts` | Line 71: `toBe(21)` → `toBe(22)`; insert `"./skills/memory-discipline/SKILL.md"` into `EXPECTED_SKILLS` at same position as plugin.json (Fix 15) | 6 |
| `skills/deep-dive/SKILL.md` | Recall/retain wiring + irc + deep-researcher pre-Phase-3 sibling + data-runner conditional post-lane REPL probe reference | 6 |
| `skills/improve-codebase-architecture/SKILL.md` | Recall/retain wiring + deep-researcher reference + data-runner reference | 6 |
| `skills/large-task-delegation/SKILL.md` | irc wiring + recall/retain wiring + deep-researcher reference + data-runner reference | 6 |
| `skills/systematic-debugging/SKILL.md` | Recall wiring | 6 |
| `skills/fresh-verifier/SKILL.md` | Recall wiring | 6 |
| `.claude-plugin/plugin.json` | Add `./skills/memory-discipline/SKILL.md` as first entry | 6 |

> **Fix 20/21 (hybrid file single-writer):** For the 7 hybrid-rewrite roles (oracle, code-reviewer, librarian, explorer, planner, architect, designer): Phase 2 converts frontmatter tool names; Phase 4 rewrites ONLY the body prose, inheriting Phase 2's converted frontmatter unchanged. These are two sequential writes to the same 7 files — never parallel. Phase 4 must NOT touch frontmatter (D1: "frontmatter PRESERVED"). Best practice: merge Phase 2 frontmatter conversion and Phase 4 body rewrite into a single per-file edit.

### 8.2 Lint safety

`lint-agents.ts` validates: `model`/`thinkingLevel` frontmatter == PROFILE_A + colon-name invariant. It does NOT validate `tools:`/`blocked_tools:` values → tool name conversion is lint-safe.

`lint-skills.ts` validates: `pi-oven:<role>` refs ∈ ROLES; `/pi-oven:` slash refs excluded (Fix 16); Korean trigger keyword present; `trigger:` field present (hard-fail at line 79). It does NOT validate tool names in skill bodies → tool name conversion in skill bodies is lint-safe.

> **Fix 16 (coverage token form):** The lint-skills role-coverage regex `PI_OVEN_TOKEN = /(?<!\/)pi-oven:([a-z][a-z0-9-]*)/g` explicitly EXCLUDES refs with a leading `/`. All skill body references to `pi-oven:deep-researcher` and `pi-oven:data-runner` MUST use the bare colon form (no leading slash) or they do not count toward coverage. The spec-and-review and autonomous-loop wiring text must use the subagent dispatch form, not the slash-command form.

> **Fix 17/36 (ROLES growth + coverage ref = indivisible unit):** Adding a role to `ROLES` (profiles.ts) without simultaneously adding a `pi-oven:<role>` coverage reference in some skill body leaves `lint:skills` red. ROLES growth and the satisfying skill references are a single atomic commit unit — never split across phases. The Phase 1 commit (§5.3/Fix NIT-8) MUST include: `pi-oven:deep-researcher` ref in `spec-and-review/SKILL.md` AND `pi-oven:data-runner` ref in `autonomous-loop/SKILL.md`. Consequence: the Phase 1 gate runs `bun run lint:skills` (not just `lint:agents`).

> **Fix 5 (new-role coverage fragility):** Each new role's lint coverage hangs on exactly one skill reference. These references are load-bearing — they must not be removed without adding a replacement elsewhere.

`validateAgentRegistry` (`.omp/extensions/pi-oven.ts`): checks model prefix only (`opencode-zen/`, `openai-codex/`, `anthropic/` if already declared). New roles use already-whitelisted prefixes → no extension changes needed.

### 8.3 Verification plan

**Prerequisites (must be true before Phase 1):**
- `memory.backend` configured to `"hindsight"` or `"mnemopi"` in omp settings (Fix 27 — otherwise D6 is inert)
- `async.enabled = true` in omp settings (Fix 31 — otherwise D7 irc fan-out is inert)
- `pi-oven:setup` wizard updated to write both settings (add to setup wizard scope)

Run in this order (each must pass before the next):

```
bun run check              # tsc --noEmit — catches PROFILE_A/B completeness (ProfileMap = Record<Role,ModelEntry>)
bun run lint:agents        # model/thinkingLevel/name frontmatter == PROFILE_A; EXPECTED_AGENT_COUNT == 24
bun run lint:skills        # pi-oven:<role> refs ∈ ROLES (24); deep-researcher + data-runner referenced; trigger fields present
bun run build              # bundle .omp/extensions/pi-oven.ts -> dist/
bun test                   # 545 currently passing; must pass with updated 22→24 literals; see §5.3 for exact test edits
```

**Additional gates (Fix 11/41):**

```bash
# Fix 11: Confirm zero residual Claude Code tool names in skills/ (including references/)
grep -rE '\b(Read|Grep|Glob|WebFetch|Bash|Write|Edit)\b' skills/
# Must return zero matches after Phase 2

# Fix 41: Confirm new-role wiring in entry-point skills
grep -l 'pi-oven:deep-researcher' skills/spec-and-review/SKILL.md skills/autonomous-loop/SKILL.md \
  skills/deep-dive/SKILL.md skills/improve-codebase-architecture/SKILL.md skills/large-task-delegation/SKILL.md
# Must list all 5 files

grep -l 'pi-oven:data-runner' skills/spec-and-review/SKILL.md skills/autonomous-loop/SKILL.md \
  skills/deep-dive/SKILL.md skills/improve-codebase-architecture/SKILL.md skills/large-task-delegation/SKILL.md
# Must list all 5 files

# Fix 41: Confirm report_finding in frontmatter tools: for code-reviewer, critic, verifier
grep -A5 '^tools:' agents/pi-oven-critic.md agents/pi-oven-verifier.md agents/pi-oven-code-reviewer.md | grep report_finding
# Must match all 3 files

# irc is auto-injected into all subagents — no frontmatter tools: check needed
# (verified omp fact: task/executor.ts force-adds irc to every subagent toolNames)
```

**NIT-12 (tool default table):**

| Tool | Default | Setup required? |
|---|---|---|
| `eval` | on (default) | No |
| `debug` | on (default) | No |
| `browser` | on (default) | No |
| `web_search` | on (default) | No |
| `irc` | on (default); auto-injected into every subagent — never needs frontmatter `tools:` listing | No — but `async.enabled=true` required in main session for concurrent sibling co-residency; in-call parallelism only (no background jobs) |
| `retain`/`recall`/`reflect` | **OFF** (`memory.backend = "off"`) | **YES — set `memory.backend = "hindsight"`** |
| `checkpoint`/`rewind` | **OFF** (`checkpoint.enabled = false`) | **YES — but NOT for subagents (unavailable)** |
| `async` fan-out | **OFF** (`async.enabled = false`) | **YES — set `async.enabled = true` for D7** |

Do not run `bun run eval` (needs LLM keys, gated).

---

## 9. Implementation Phases

> **Fix 21 (single-writer constraint):** `scripts/pi-oven-setup/profiles.ts`, `.claude-plugin/plugin.json`, and the two lint scripts are SEQUENTIAL single-writer files. Phase 1 (profiles.ts) must fully land and pass `bun run check` before any other phase begins — every lint/test/extension imports profiles.ts. Per-agent `.md` and per-skill `.md` files are parallel-safe ONLY across disjoint paths; the 7 hybrid files and 15 injection files each have at most one writer per phase; edits to the same path across phases must be serialized (Phase 2 frontmatter before Phase 4 body, never concurrent).

> **Fix 20 (hybrid overlap — Phase 2 + Phase 4):** For the 7 hybrid-rewrite roles, Phase 2 converts frontmatter tool names only; Phase 4 rewrites ONLY the body prose and inherits Phase 2's frontmatter unchanged. Preferred: merge Phase 2 frontmatter conversion and Phase 4 body rewrite into a single per-file edit for each of the 7 hybrid files (one writer, one commit per file).

Phases are ordered by dependency. Phase 1 is NOT independently committable without its coverage refs (see Fix 17/36). All other phases are committable in sequence.

**Phase 1 — profiles.ts + new role files + coverage refs (atomic unit)** _(prerequisite: omp settings memory.backend + async.enabled set by setup wizard)_
- Edit `profiles.ts`: EXPECTED_AGENT_COUNT 22→24, ROLES (append deep-researcher + data-runner), PROFILE_A, PROFILE_B, header comment.
- Create `agents/pi-oven-deep-researcher.md` and `agents/pi-oven-data-runner.md`.
- Update test literals: `profiles.test.ts:26`, `apply.test.ts:145+165`, `validate.test.ts:115+76`, `agent-rewriter.test.ts:231` (see §5.3).
- Add `pi-oven:deep-researcher` bare-colon ref to `skills/spec-and-review/SKILL.md` (lint coverage — MUST be in same commit as ROLES edit).
- Add `pi-oven:data-runner` bare-colon ref to `skills/autonomous-loop/SKILL.md` (lint coverage — MUST be in same commit as ROLES edit).
- Gate: `bun run check` + `bun run lint:agents` + **`bun run lint:skills`** must all pass.

**Phase 2 — tool name conversion (all 22 existing agents + all skills including references/ + 2 commands)** _(depends on Phase 1)_
- Mechanical replacement: Claude Code names → omp native names in all `tools:`/`blocked_tools:` frontmatter and all body references across 22 agent files, 21 skill files + 9 reference sub-files (Fix 11), 2 command files (doctor.md, setup.md).
- For the 7 hybrid roles: convert frontmatter only in this phase; body rewrite deferred to Phase 4.
- Gate: `bun run lint:agents` must pass. `grep -rE '\b(Read|Grep|Glob|WebFetch|Bash|Write|Edit)\b' skills/` must return zero matches.

**Phase 3 — killer-tool injection (15 pure-injection roles)** _(depends on Phase 2)_
- Add killer-tool activation paragraphs to each of the 15 pure-injection roles per §4.2 table (excluding hybrid roles — handled in Phase 4).
- Gate: `bun run lint:agents` must pass (body text does not affect lint).

**Phase 4 — hybrid rewrites (7 roles: oracle, code-reviewer, librarian, explorer, planner, architect, designer)** _(depends on Phase 2; independent of Phase 3)_
- Rewrite BODY ONLY of the 7 hybrid roles (absorb omp patterns per §4.1); frontmatter is inherited verbatim from Phase 2 — do NOT touch frontmatter.
- Gate: `bun run lint:agents` must pass; body correctness is manual review.

**Phase 5 — absorbed patterns (report_finding / cross-boundary)** _(critic/verifier/tracer: depends on Phase 2; designer: already done in Phase 4)_
- Add `report_finding`, `recall` to `tools:` frontmatter for critic + verifier (§6.1; Fix 4/8/29/33). (`irc` is auto-injected — do NOT add to frontmatter.)
- tracer: no frontmatter change needed — irc auto-injected, no other new tools.
- Add cross-boundary protocol to tracer body (§6.2); already absorbed into code-reviewer in Phase 4.
- Gate: `bun run lint:agents` must pass.

**Phase 6 — memory/irc infra** _(depends on Phase 1 for ROLES; otherwise independent; requires prerequisites from §8.3)_
- Verify `memory.backend` and `async.enabled` settings are writable by setup wizard.
- Create `skills/memory-discipline/SKILL.md` (with `trigger:` field containing Korean keyword per §7.1; Fix 14/19/37).
- Add `memory-discipline` to `.claude-plugin/plugin.json` skills array (first entry).
- Update `tests/plugin/skill-count.test.ts`: line 71 `21`→`22`, insert entry into `EXPECTED_SKILLS` at same position (Fix 15).
- Add recall/retain wiring paragraphs to all 5 entry-point skills and additional skills per §7.2.
- Add irc coordination paragraphs (real op/to/message syntax per §7.3) to `spec-and-review`, `autonomous-loop`, `deep-dive`, `large-task-delegation`.
- Add `pi-oven:deep-researcher` + `pi-oven:data-runner` references to all 5 entry-point skills (extending beyond the minimal Phase 1 coverage refs).
- Gate: `bun run lint:skills` must pass; `bun run build` must pass; `tests/plugin/skill-count.test.ts` must pass.

**Phase 7 — full verification** _(depends on all prior phases)_
- Run full §8.3 verification suite: `bun run check` + `bun run lint:agents` + `bun run lint:skills` + `bun run build` + `bun test`.
- Run additional grep gates from §8.3 (CC name residue, new-role wiring, report_finding/irc frontmatter parity).
- Fix any regressions in production code. Note: the `profiles.test.ts`, `apply.test.ts`, `validate.test.ts`, `agent-rewriter.test.ts`, `skill-count.test.ts` literal updates from §5.3/Phase 1/Phase 6 are required spec-alignment edits — they are NOT test hacks and MUST be applied.
- Manual spot-check: read `agents/pi-oven-deep-researcher.md`, `agents/pi-oven-code-reviewer.md`, `skills/memory-discipline/SKILL.md` for correctness.

### Phase dependency graph

```
Phase 1 (profiles + coverage refs + test literals)  [single-writer: profiles.ts]
  └── Phase 2 (tool names — agents + skills/refs + commands)
        ├── Phase 3 (killer-tool injection, 15 pure roles)
        └── Phase 4 (hybrid rewrites, 7 roles, body only) ──── Phase 5 (critic/verifier/tracer patterns)
Phase 1 ──────────────────────────────────────────────────── Phase 6 (memory/irc)  [single-writer: plugin.json]
All phases ───────────────────────────────────────────────── Phase 7 (full verify)
```

> **NIT-13 (graph vs. Phase 5 prose):** Phase 5 has two dependency tracks: critic/verifier/tracer (depends only on Phase 2) and designer anti-slop (depends on Phase 4). The graph reflects this by showing Phase 5 branching from Phase 4 — implementers may start the critic/verifier/tracer sub-track in parallel with Phase 3 once Phase 2 is complete.

---

## 10. Risks & Open Questions

**R1 — PROFILE_B completeness.** `ProfileMap = Record<Role, ModelEntry>` means adding 2 new roles to ROLES without adding them to PROFILE_B causes a TypeScript compile error. The proposed PROFILE_B entries use `anthropic/claude-sonnet-4-6` as a safe placeholder (already in PROFILE_B for other roles). This is consistent with the "PROFILE_B is deferred" policy — the entries exist for type completeness, not as intended routing.

**R2 — lint-skills `trigger:` field requirement (RESOLVED in §7.1).** `lint-skills.ts:79` hard-fails any skill missing a `trigger:` frontmatter field. `memory-discipline` must declare `trigger:` with a Korean keyword (e.g. `trigger: "메모리 규율, 기억 저장, retain 정책, flow start, recall"`). `alwaysApply: true` does NOT exempt from this — only `code-quality-discipline` has a hardcoded exemption. The §7.1 frontmatter spec now includes the required `trigger:` field.

**R3 — `retain`/`recall`/`reflect` param schema (TODO-verify before Phase 6).** The tool `.md` prose does not expose a full parameter schema. Before authoring agent/skill bodies, read the omp tool registration (JTD/zod schema) for `retain`, `recall`, `reflect` to pin exact param names and cardinality. Provisional from prose: `retain` takes a batch of fact items (not positional string); `recall` likely takes a query object; `reflect` takes optional `context`. All call examples in this design are marked TODO-verify. The "one factual sentence" retain format in earlier §7.1 drafts was wrong — retain.md says "batch related facts in a single call."

**R3b — `report_finding` tool availability (RESOLVED in §3.2/§6.1).** omp's `report_finding` is registered at `tools/review.ts:123`, `tools/index.ts:332`. It MUST appear in agent frontmatter `tools:` arrays. §3.2 now explicitly adds it to critic, verifier, code-reviewer. Implementer must verify exact spelling against registry.

**R4 — `deep-researcher` vs. `librarian` scope overlap.** Both roles read external sources. The distinction: `librarian` answers "what does this library/API do?" (source-verified, structured output, git clone for versioned libraries); `deep-researcher` answers "what is the state of the art / what do multiple sources say about X?" (adversarial multi-source, arxiv papers, synthesis). The procedures diverge significantly. If unclear at implementation time, the spec-and-review cross-vendor review step should adjudicate.

**R5 — Agent body length budget.** Hybrid rewrites absorb omp patterns while preserving pi-oven patterns. Some roles (code-reviewer, oracle) risk becoming very long. Implementer should target ≤250 lines per agent file. If exceeded, consider moving the cross-boundary protocol or effort-tag table to a shared rule file: author the shared protocol as a rule file and have the agent `read(path="rule://cross-boundary")` on demand (Fix NIT-10 — this trades prompt length for a runtime tool call; the ≤250-line target is a soft style goal, not a gated requirement).

**R6 — `irc` call syntax (RESOLVED in §7.3).** The omp `irc` tool exposes only `op:"list"` and `op:"send"` (to peer id or `"all"`). No channel-create/open/poll op. Plain prose only — no JSON payloads. §7.3 now uses the real schema. Implementers: before writing any irc paragraphs, confirm against `prompts/tools/irc.md` in the oh-my-pi package.

**R7 — `memory-discipline` `alwaysApply` semantics (TODO-verify before Phase 6).** omp skill frontmatter `alwaysApply: true` injects the skill context into every session. The exact omp mechanism was not verified. Before Phase 6: trace one existing pi-oven plugin skill through `bucketRules`/`discoverTtsrRules` (`sdk.ts:1114-1128`) with a temporary `alwaysApply:true` and confirm its body lands in the injected always-apply set. If plugin skills do NOT auto-inject via `alwaysApply`, do NOT silently fall back to keyword-only trigger — D6 mandates `alwaysApply: true`. The implementation must add omp support for `alwaysApply` if needed (Fix 38 — no silent degradation of a locked decision).

**R8 — `memory.backend` default-off (BLOCKER — Fix 27).** `retain`/`recall`/`reflect` are gated behind `memory.backend` in omp. Default is `"off"`. `pi-oven:setup` MUST write `memory.backend = "hindsight"` (or `"mnemopi"`) to user/project omp settings or D6 ships 100% inert. Add to setup wizard and verify in §8.3.

**R9 — `checkpoint`/`rewind` default-off AND subagent-unavailable (BLOCKER — Fix 2/28).** `checkpoint`/`rewind` are gated behind `checkpoint.enabled` (default: `false`) AND explicitly unavailable in subagents per `tools/checkpoint.md`. All pi-oven roles run as subagents via `task`. Therefore: (a) removed from all subagent allowlists in §3.2; (b) removed from all §4.2 injection paragraphs. Do not re-introduce without addressing both the default-off and subagent-unavailable constraints.

**R10 — `async.enabled` default-off (BLOCKER — Fix 31).** D7 IRC fan-out works only via in-call sibling concurrency (`task({agent, tasks:[...]})` with multiple concurrent entries). `async.enabled` defaults to `false` in the main session; subagents always have it force-set to `false`. Async background-job/poll-later is entirely unavailable for subagents — do not document or rely on it. IRC sibling-to-sibling messaging (within one `task` call) works when the main orchestrator session has `async.enabled = true`. Recursion depth cap = 2 constrains further nesting. `pi-oven:setup` MUST write `async.enabled = true`. Without it, tasks run serially and irc peers never co-exist. Add to setup wizard and §8.3 prerequisites.
