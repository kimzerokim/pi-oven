> Historical; do not copy runtime syntax examples from this document.

# Implementation Plan: pi-oven omp-Native Agent Upgrade

> Status: READY for executor dispatch (TDD-strict).
> Branch: `feat/skill-agent-upgrade`. Worktree: `/Users/kimzerokim/work/personal/pi-oven/.claude/worktrees/feat+agent-upgrade`.
> Source spec (LOCKED, codex-verified): `docs/plans/2026-06-04-agents-omp-native-upgrade-design.md`.
> Format: kzk-large-task-delegation. Each task = one atomic commit. Sonnet-executor granularity.
>
> Commit-subject rule (CLAUDE.md): what/why only. NO "Plan N"/"Task N"/"Phase N" progress markers in subjects. Per-spec semantic commits.
> `git push` requires explicit user confirmation — never auto-push.

---

## Authoritative facts (embedded — do not re-derive)

**MEMORY backend = mnemopi** (not hindsight; verified from omp source).
- Self-contained local SQLite at `<agentDir>/memories/mnemopi/mnemopi.db`. Zero external infra, works offline.
- `pi-oven:setup` MUST run `omp config set memory.backend mnemopi` (writes `~/.omp/agent/config.yml` `memory.backend`). Also recommend `mnemopi.noEmbeddings=true` + `mnemopi.llmMode=none` for zero-network operation.
- Tool schemas (exact — use these, supersedes "provisional/TODO-verify" notes in the design §7.1/§7.2/R3):
  - `retain({items:[{content:string, context?:string}]})` — min 1 item.
  - `recall({query:string})`.
  - `reflect({query:string, context?:string})`.
  - `memory_edit({op:"update"|"forget"|"invalidate", id:string, content?, importance?, replacement_id?})` — mnemopi-only.
- `retain`/`recall`/`reflect` are AUTO-INJECTED into subagent `toolNames` when `memory.backend` is on. Listing them in `tools:` is harmless but unnecessary; when `backend='off'` they are silently dropped.
- **Subagent inheritance CONFIRMED:** a subagent at taskDepth>0 gets an alias to the parent's memory bank → `retain` inside any pi-oven subagent persists to the SAME SQLite bank the main agent + future sessions read. Auto-recall lifecycle runs on the parent only (subagents skip it), but tool-initiated `retain`/`recall` work through the alias.

**R7 RESOLVED — `alwaysApply:true` is real and precedented.** The existing pi-oven skill `code-quality-discipline` already uses `alwaysApply:true` (working precedent). `lint-skills` exempts `code-quality-discipline` from the Korean-trigger requirement (line 70-72). `memory-discipline` uses `alwaysApply:true` AND still includes a Korean `trigger:` keyword (safe for lint at line 79 + discoverable). Do NOT degrade to keyword-only.

**`memory.backend` substitution:** Everywhere the design says `hindsight` (e.g. §7.1, §8.3 prerequisites, R8), read **`mnemopi`**. Memory tool call examples use the exact schemas above, NOT the design's provisional `retain([{fact:...}])` / `recall({query})` placeholder syntax. Concretely: `retain({items:[{content:"…"}]})`, `recall({query:"…"})`, `reflect({query:"…"})`.

**Verified line numbers (grep-confirmed 2026-06-04):**
- `tests/scripts/pi-oven-setup/profiles.test.ts:26` — `expect(EXPECTED_AGENT_COUNT).toBe(22)` (ONE occurrence on this assertion; the design's "4 spots" refers to all `.toBe(22)` checks but grep finds only line 26 on EXPECTED_AGENT_COUNT — re-grep at impl time for any others added since).
- `tests/scripts/pi-oven-setup/apply.test.ts:145` and `:165` — `expect(entries.length).toBe(22)`.
- `tests/scripts/pi-oven-setup/validate.test.ts:115` — `expect(pingedModels.length).toBe(22)`; `:76` comment `// Full mode would issue 22`.
- `tests/scripts/pi-oven-setup/agent-rewriter.test.ts:231` — `expect(rewritten.length).toBe(22)`.
- `tests/plugin/skill-count.test.ts:7` — `EXPECTED_SKILLS` array start; `:65` `toEqual(EXPECTED_SKILLS)`; `:71` `expect(plugin.skills.length).toBe(21)`.
- Current counts: 22 agent files, 21 skill dirs, 21 SKILL.md refs in plugin.json.

**CC-name residue scope (grep-confirmed — BROADER than design §3.1 Fix 11 list):** `grep -rlE '\b(Read|Grep|Glob|WebFetch|Bash|Write|Edit)\b' skills/` matches the design's 9 reference files PLUS additional SKILL.md bodies and other reference files (e.g. `html-research-orchestrator`, `cloudflare`, `deep-init`, `bitbucket-pipeline`, `aws`, `code-quality-discipline/references/principles.md`, `tdd-strict/references/anti-patterns.md`, etc.). **The Phase-2 grep gate (`zero matches`) governs scope, not the design's hand-enumerated 9-file list.** Convert every match the gate reports. See Task 2.x DEFERRED note for whitespace-token false-positives.

---

## Dependencies

```
T1.1 profiles.ts + 2 new agent files + 4 test-literal files + 2 coverage refs  [ATOMIC — single-writer profiles.ts]
  │   gate: bun run check && lint:agents && lint:skills
  ├── T2.* tool-name conversion (agents non-hybrid + skills + refs + commands)  [single-writer per file]
  │     gate: lint:agents && zero-CC-residue grep
  │     ├── T3.* killer-tool injection (14 body roles; git-master no-op)        [single-writer per agent body]
  │     └── T4.* hybrid rewrites (7 roles: oracle code-reviewer librarian       [MERGED frontmatter+body, single-writer]
  │           explorer planner architect designer) — frontmatter conv + body
  │           rewrite in ONE task per role (avoids Phase2/Phase4 double-edit)
  │           └── T5.* absorbed patterns (critic verifier tracer)              [single-writer per agent]
  └── T6.* memory/irc infra (memory-discipline skill, plugin.json,             [single-writer plugin.json + skill-count test]
        skill-count test, 5 entry-point wiring, irc fan-out)
T7.* full verification (check/lint/build/test, eval, fresh-verifier)           [read-mostly; fix regressions]
```

**Design Decisions D1–D7 register** (one-line each; full rationale in design doc):

| ID | Decision | Owning task(s) |
|---|---|---|
| D1 | omp-native tool names only — no CC names in agent frontmatter/bodies | T2.1, T4.1–T4.7, T5.1–T5.3 |
| D2 | 7 hybrid roles merged into single per-role task (no double-edit) | T4.1–T4.7 |
| D3 | `report_finding` structured output for code-reviewer/critic/verifier; `priority` as NUMBER | T4.2, T5.1, T5.2 |
| D4 | `memory-discipline` skill is `alwaysApply:true` with Korean trigger (R7 resolved) | T6.1 |
| D5 | mnemopi backend (not hindsight); exact schemas `retain({items:[…]})` etc. | T0.1, T6.1, T3.2–T3.3 |
| D6 | Setup wizard writes `memory.backend=mnemopi` + `async.enabled=true` (BLOCKER for retain/irc) | T0.1 |
| D7 | irc auto-injected — never listed in `tools:` frontmatter; `async.enabled=true` in main session only | T6.2–T6.6 |

**SINGLE-WRITER files (NEVER touched by two parallel tasks):**
- `scripts/pi-oven-setup/profiles.ts` — T1.1 only.
- `.claude-plugin/plugin.json` — T6.1 only.
- `tests/scripts/pi-oven-setup/{profiles,apply,validate,agent-rewriter}.test.ts` — T1.1 only.
- `tests/plugin/skill-count.test.ts` — T6.1 only.
- `scripts/lint-agents.ts`, `scripts/lint-skills.ts` — NOT edited by any task (read-only reference; design confirms no lint changes needed).
- Each `agents/pi-oven-<role>.md` — exactly one owning task across the whole plan (hybrid roles merge frontmatter+body into one task; never split).
- Each `skills/<name>/SKILL.md` — coverage-ref edits (T1.1) and wiring edits (T6.x) to the SAME file are serialized: T1.1 lands first, T6.x edits after. `spec-and-review` and `autonomous-loop` are touched by both T1.1 (bare-colon ref) and T6.x (full wiring) — serialize, never parallel.

**The 7 hybrid roles are MERGED** (design Fix 20/21): one task per role does frontmatter tool-name conversion AND body rewrite together, so the file has exactly one writer. They are therefore EXCLUDED from the T2 mechanical-conversion task list.

---

## Execution waves

| Wave | Tasks | Parallel-safe? | Gate before next wave |
|---|---|---|---|
| **W0 (prereq)** | T0.1 setup wizard writes mnemopi + async.enabled | sequential (touches setup code + its tests) | `bun test` setup suite green |
| **W1 (foundation)** | T1.1 (atomic single-writer) | NO — solo | `check` + `lint:agents` + `lint:skills` |
| **W2 (mechanical conv)** | T2.1 (non-hybrid agent frontmatter), T2.2 (skills+refs+commands bodies) | YES — disjoint paths (T2.1=agents, T2.2=skills/commands) | `lint:agents` + zero-CC-residue grep |
| **W3 (bodies)** | T3.1–T3.4 (injection, batched by disjoint agents), T4.1–T4.7 (7 hybrids, each solo on its file), T5.1–T5.3 (critic/verifier/tracer) | YES — all disjoint agent files; T5 depends only on T2.1, may start once T2.1 done | `lint:agents` |
| **W4 (infra)** | T6.1 (plugin.json + skill-count test + memory-discipline skill), T6.2–T6.6 (per-entry-point wiring) | T6.1 solo first; T6.2–T6.6 parallel after (disjoint SKILL.md, but serialized vs T1.1 on shared files) — **W4 depends on T2.2 completing first** (T6.2–T6.6 edit the same SKILL.md files that T2.2 bulk-converts; running them concurrently is a same-file write race) | `lint:skills` + `build` + skill-count test |
| **W5 (verify)** | T7.1 full suite, T7.2 eval, T7.3 fresh-verifier | sequential | all green |

W2 depends on W1. W3 depends on W2 (T3/T4 need T2.1 frontmatter; T5 needs T2.1). W4 depends on W1 (ROLES) AND on T2.2 completing — T6.2–T6.6 edit the same SKILL.md files that T2.2 bulk-converts, so they MUST run after T2.2, not concurrently. (T6.1 plugin.json + memory-discipline NEW file are safe to run after W1 since they don't overlap T2.2 targets — T6.1 may start after W1 gate, but T6.2–T6.6 must wait for T2.2.) W5 last.

---

## TDD RED targets (every test assertion that must change)

These are spec-alignment literal updates, NOT test hacks (design Fix 12/13/18, Phase-7 note). Apply in the same commit as the production change that makes them necessary.

| RED target (file:line) | Current | New | Owning task |
|---|---|---|---|
| `tests/scripts/pi-oven-setup/profiles.test.ts:26` | `.toBe(22)` | `.toBe(24)` (prefer asserting on `EXPECTED_AGENT_COUNT` directly so future bumps don't re-break) | T1.1 |
| `tests/scripts/pi-oven-setup/apply.test.ts:145` | `.toBe(22)` | `.toBe(ROLES.length)` | T1.1 |
| `tests/scripts/pi-oven-setup/apply.test.ts:165` | `.toBe(22)` | `.toBe(ROLES.length)` | T1.1 |
| `tests/scripts/pi-oven-setup/validate.test.ts:115` | `.toBe(22)` | `.toBe(ROLES.length)` | T1.1 |
| `tests/scripts/pi-oven-setup/validate.test.ts:76` | comment `would issue 22` | `would issue 24` | T1.1 |
| `tests/scripts/pi-oven-setup/agent-rewriter.test.ts:231` | `.toBe(22)` | `.toBe(ROLES.length)` | T1.1 |
| `tests/plugin/skill-count.test.ts:71` | `.toBe(21)` | `.toBe(22)` | T6.1 |
| `tests/plugin/skill-count.test.ts:7-...` (`EXPECTED_SKILLS`) | 21 entries | insert `"./skills/memory-discipline/SKILL.md"` at SAME index as in plugin.json (first) | T6.1 |
| setup-wizard test (W0) | n/a | NEW RED: assert setup writes `memory.backend=mnemopi`, `mnemopi.noEmbeddings=true`, `mnemopi.llmMode=none`, `async.enabled=true` | T0.1 |

> **Re-grep at impl time** (`grep -n 'toBe(22)' tests/scripts/pi-oven-setup/*.test.ts`) to catch any literal added since 2026-06-04. The gate is "zero `toBe(22)` referencing agent count after T1.1".

**Doc-only `.md` edits (agent bodies, skill bodies, commands) are NOT TDD-gated** — they have no unit test. They are gated by `lint:agents` / `lint:skills` + the zero-CC-residue grep + manual review.

---

## Tasks

### W0 — Prerequisite: setup wizard

#### T0.1 — setup writes mnemopi memory backend + async.enabled  (TDD)
- **Files:** `scripts/pi-oven-setup/config-yml.ts` (new helper) + `scripts/pi-oven-setup/apply.ts` (invocation site) + the existing test at `tests/scripts/pi-oven-setup/` (add/extend a config-write test file or section).
- **Infrastructure gap (BLOCKER prerequisite — do NOT skip):** `config-yml.ts` currently has NO generic config-key setter. Every existing path (`setAgentModelOverride`, `setModelRoles`, `setPiOvenDisabledProviders`, `resetConfigKey`) is key-specific, and `setAgentModelOverride` throws if the key does not start with `pi-oven:`. `apply.ts` is frozen to `modelRoles` writes only (Spec E). You MUST author a new helper before writing the RED test.
  - **New helper to author:** `setMemoryAndAsyncConfig()` in `scripts/pi-oven-setup/config-yml.ts`. Follow the `setModelRoles` pattern: read existing `~/.omp/agent/config.yml` with strict mode, merge the four keys, write back. Use `omp config set <dotted.key> <value>` CLI form (one call per key) OR direct YAML merge — verify the correct CLI form against omp source before authoring. Keys to write: `memory.backend=mnemopi`, `mnemopi.noEmbeddings=true`, `mnemopi.llmMode=none`, `async.enabled=true`. Scope: user-global `~/.omp/agent/config.yml` (same scope as `setModelRoles`).
  - **Invocation site:** call `setMemoryAndAsyncConfig()` from `apply.ts` in the apply path. This is an INTENTIONAL extension of apply.ts's write contract — it does NOT touch `task.agentModelOverrides`, so Spec E is preserved. Note this explicitly in the apply.ts call-site comment.
- **RED first:** add a test asserting that after `apply()` runs, `memory.backend`, `mnemopi.noEmbeddings`, `mnemopi.llmMode`, and `async.enabled` are present with correct values in the produced/written config. Assert via the same read-back or mock-capture pattern used by adjacent apply tests.
- **GREEN:** implement `setMemoryAndAsyncConfig()` and wire it into apply.ts. `memory.backend=mnemopi` is the BLOCKER fix (design R8) — without it all `retain/recall/reflect` are inert. `async.enabled=true` (design R10) enables in-call irc sibling fan-out in the main session.
- **Confirm before authoring RED:** verify `omp config set memory.backend mnemopi` is the correct CLI form (check `scripts/pi-oven-setup/config-yml.ts` for existing `omp config set` usage pattern before writing new code).
- **DO NOT:** write `async.enabled` for subagents (force-false, design R10). Do NOT write `checkpoint.enabled` (subagent-unavailable, design R9). Do NOT touch `task.agentModelOverrides` (that's the `--override` path, out of scope). Do NOT expand apply.ts to write any key that touches `task.agentModelOverrides` (Spec E boundary).
- **Commit:** `feat(setup): write mnemopi memory backend + async.enabled for native memory/irc`.

### W1 — Foundation (atomic single-writer)

#### T1.1 — profiles.ts 22→24 + 2 new agent files + test literals + coverage refs  (TDD, ATOMIC)
One indivisible commit (design Fix NIT-8 / Fix 17/36). Partial application leaves `tsc` or `lint:skills` red.
- **Files (all in ONE commit):**
  1. `scripts/pi-oven-setup/profiles.ts`:
     - `EXPECTED_AGENT_COUNT: 22 → 24`.
     - `ROLES`: append `"deep-researcher"`, `"data-runner"` before `] as const`.
     - `PROFILE_A`: add `deep-researcher` (`primary:"opencode-zen/gemini-3-flash"`, `registry_alternate:"opencode-zen/claude-sonnet-4-6"`, `thinkingLevel:"high"`) and `data-runner` (`primary:"openai-codex/gpt-5.4"`, `registry_alternate:"opencode-zen/gpt-5.4"`, `thinkingLevel:"high"`).
     - `PROFILE_B`: add both with `primary:"anthropic/claude-sonnet-4-6"`, `registry_alternate:"opencode-zen/claude-sonnet-4-6"`, `thinkingLevel:"high"` (type-completeness only — PROFILE_B deferred; design R1).
     - Header docstring lines 1-3 + 170-186: "22 roles" → "24 roles".
  2. `agents/pi-oven-deep-researcher.md` — NEW. Frontmatter shape per `agents/pi-oven-explorer.md`: `name: pi-oven:deep-researcher`, `model:` array = `[opencode-zen/gemini-3-flash, opencode-zen/claude-sonnet-4-6]` (matches PROFILE_A primary+alternate, lint-agents enforces equality), `thinkingLevel: high`, `mode: subagent`, `tools: [read, search, find, web_search, retain, recall, reflect]` (omp native names; irc auto-injected — do NOT list). Body per design §5.1 (recall-first → web_search fan-out → read(url) per source → adversarial contradiction check → reflect → retain). Use exact memory schemas above.
  3. `agents/pi-oven-data-runner.md` — NEW. `name: pi-oven:data-runner`, `model:` = `[openai-codex/gpt-5.4, opencode-zen/gpt-5.4]`, `thinkingLevel: high`, `mode: subagent`, `tools: [bash, eval, read, write, retain]`. Body per design §5.2 (eval REPL load/explore/transform/chart → retain insight; never modifies project files).
  4. Test literals: `profiles.test.ts:26`, `apply.test.ts:145,165`, `validate.test.ts:115,76`, `agent-rewriter.test.ts:231` per RED-targets table.
  5. `skills/spec-and-review/SKILL.md`: add ONE bare-colon `pi-oven:deep-researcher` ref (lint coverage; bare colon NOT `/pi-oven:` — design Fix 16). Minimal sentence in the Agent Dispatch block; full wiring is T6.x.
  6. `skills/autonomous-loop/SKILL.md`: add ONE bare-colon `pi-oven:data-runner` ref (lint coverage). Minimal; full wiring T6.x.
- **DO NOT:** write any agent body using Claude Code tool names — new files are born omp-native. Do NOT add `irc` to either new agent's `tools:`. Do NOT split this commit.
- **GATE:** `bun run check` (catches PROFILE_A/B Record completeness) + `bun run lint:agents` (new files match PROFILE_A; colon-name invariant) + `bun run lint:skills` (24 roles covered; new refs present) — all green.
- **Commit:** `feat(agents): add deep-researcher + data-runner roles (24-role taxonomy)`.

### W2 — Mechanical tool-name conversion

Name map (design §3.1): `Read→read`, `Grep→search`, `Glob→find`, `Bash→bash`, `WebFetch→read` (URL path), `WebSearch→web_search`, `Write→write`, `Edit→edit`. Keep `apply_patch`, `task` as-is.

#### T2.1 — convert tool names in 15 non-hybrid agent frontmatter + bodies
- **Files:** the 22 existing `agents/pi-oven-*.md` MINUS the 7 hybrid roles (oracle, code-reviewer, librarian, explorer, planner, architect, designer — owned by T4.*). i.e. the 15: executor, verifier, critic, debugger, test-engineer, security-reviewer, writer, code-simplifier, qa-tester, git-master, document-specialist, tracer, analyst, multimodal-looker, metis. (New files from T1.1 are already native.)
- **Change:** in `tools:`/`blocked_tools:` arrays ONLY, replace CC names per the map. `["*"]` stays `["*"]`. Net tool-array deltas (the `Add to tools:` column of design §3.2) are NOT applied here — they are applied in T3/T5 alongside the body injection that uses them, EXCEPT `report_finding`+`recall` for critic/verifier (T5).
- **Scope rule (HARD — same classification as T2.2 trigger fields):** Convert ONLY frontmatter `tools:`/`blocked_tools:` array values and genuine backtick-quoted body tool-call examples (e.g. `` `Bash(...)` `` → `` `bash(...)` ``). PRESERVE verbatim: (a) English-verb prose (`Read-only exploration`, `Write or update tests first`), (b) blocked-tool description sentences (`Write, Edit, apply_patch, and task are blocked`) — these describe capitalized frontmatter keys and lowercasing corrupts their meaning. **Do NOT mass-lowercase agent body prose.**
- **DO NOT:** touch the 7 hybrid files. Do NOT add killer tools yet (T3/T5). Do NOT add `irc` (auto-injected). Do NOT rewrite bodies beyond the backtick-quoted tool-call examples scope above.
- **GATE:** `bun run lint:agents` green.
- **Commit:** `refactor(agents): convert non-hybrid agent tool names to omp-native`.

#### T2.2 — convert tool names in all skill bodies + reference sub-files + 2 commands
- **Files:** every `skills/*/SKILL.md` and `skills/*/references/*.md` that the residue grep reports, plus `commands/doctor.md`, `commands/setup.md` (`commands/release.md` already clean — design Fix NIT-4).
- **Change:** replace CC tool names with omp native names in instruction prose. `WebFetch` → `read(path="https://…")` phrasing.
- **DO-NOT-CONVERT allowlist (HARD — these lines MUST be preserved verbatim):**
  1. Every `trigger:` frontmatter field in every SKILL.md — these are Claude Code hook-event identifiers, NOT instruction prose. Specifically:
     - `skills/tdd-strict/SKILL.md`: the `trigger:` line containing `Edit|Write|MultiEdit` — these are CC tool-call event names that fire the hook; converting them silently breaks the hook with no lint warning.
     - `skills/code-quality-discipline/SKILL.md`: the `trigger:` line containing `Edit, Write, MultiEdit, NotebookEdit, ast_grep_replace` — same reason.
  2. All `trigger:` lines in any other SKILL.md that reference tool-call event names.
  3. Any prose that references `MultiEdit`, `NotebookEdit`, or `ast_grep_replace` as event identifiers — these have NO omp-native rename and must be left as-is.
  4. Natural-language English verbs that happen to share a CC tool name ("Read the spec", "Write the test", "Read-only operations", "Write to OS temp dir", etc.) — context determines tool-name vs. English verb; when ambiguous, preserve as-is.
  5. Shell/code-fence labels where `Bash` is a language identifier (e.g. ` ```Bash `).
- **Gate definition (revised):** The gate is NOT "zero raw regex matches". The gate is: `grep -rE '\b(Read|Grep|Glob|WebFetch|Bash|Write|Edit)\b' skills/ commands/ | grep -vFf .cc-residue-allowlist.txt` returns zero lines. Before running the gate, author `.cc-residue-allowlist.txt` at repo root containing one grep-output prefix per non-convertible line (e.g. `skills/tdd-strict/SKILL.md:5:`, each `trigger:` line, each confirmed natural-language-verb line). Pre-enumerate by running the raw grep first and classifying every match as CONVERT or PRESERVE before touching any file.
- **DO NOT:** edit agent files (T2.1). Do NOT change skill `trigger:` fields or role refs. Do NOT convert `MultiEdit`/`NotebookEdit`/`ast_grep_replace` anywhere. Do NOT mangle English prose to force a zero raw count.
- **GATE:** `grep -rE '\b(Read|Grep|Glob|WebFetch|Bash|Write|Edit)\b' skills/ commands/ | grep -vFf .cc-residue-allowlist.txt` → zero lines; `bun run lint:skills` green.
- **Commit:** `refactor(skills): convert tool names to omp-native in skills, refs, commands`.

### W3 — Agent bodies (all depend on T2.1; T4 also independent of T3)

#### T3.1 — killer-tool injection: executor + debugger + test-engineer
- **Files:** `agents/pi-oven-executor.md`, `agents/pi-oven-debugger.md`, `agents/pi-oven-test-engineer.md`.
- **Change:** add a "Killer Tool Activation" body paragraph per design §4.2 table. Concrete injection text:
  - executor: `eval(cells=[{language:"py", code:"import subprocess; r=subprocess.run(['bun','test'],capture_output=True); print(r.stdout.decode())"}])` for REPL verification; `debug(action:"launch", adapter:"debugpy", program:"./dist/app")` → `set_breakpoint` → `continue` for runtime assertions. `["*"]` already grants these — body only.
  - debugger: full DAP loop `debug(action:"launch"…)` → `set_breakpoint` → `continue` → `stack_trace`/`variables`/`evaluate(expression, context:"repl")`.
  - test-engineer: `eval` (pytest), `debug` (debugpy), `browser(action:"open", name:"main", url:…)` for live test execution.
- **DO NOT:** add `checkpoint`/`rewind` (subagent-unavailable, design R9). Do NOT change frontmatter (these are `["*"]`).
- **GATE:** `lint:agents` green. **Commit:** `feat(agents): activate eval/debug/browser killer tools for execution roles`.

#### T3.2 — killer-tool injection: analyst + writer + document-specialist
- **Files:** `agents/pi-oven-analyst.md`, `agents/pi-oven-writer.md`, `agents/pi-oven-document-specialist.md`.
- **Change + frontmatter delta (design §3.2):**
  - analyst: add `eval`, `recall` to `tools:`; body: `eval(cells=[{language:"py", code:"import pandas as pd; df=pd.read_csv('metrics.csv'); display(df.describe())"}])`; `recall({query:"prior requirements decisions"})`.
  - writer: add `web_search` to `tools:`; body: `web_search(query="…")` → top URL → `read(path=url)` for source-verified writing.
  - document-specialist: add `recall` to `tools:`; body: `web_search` → `read(path=url)`; `recall({query:"prior doc research"})`.
- **DO NOT:** add `irc`. **GATE:** `lint:agents`. **Commit:** `feat(agents): activate eval/web_search/recall for analyst, writer, doc-specialist`.

#### T3.3 — killer-tool injection: qa-tester + multimodal-looker + security-reviewer + metis
- **Files:** `agents/pi-oven-qa-tester.md`, `agents/pi-oven-multimodal-looker.md`, `agents/pi-oven-security-reviewer.md`, `agents/pi-oven-metis.md`.
- **Change + frontmatter delta:**
  - qa-tester (`["*"]`): body only — `browser(action:"open", name:"main", url:"http://localhost:3000")` → `browser(action:"run", code:"document.querySelector('h1').innerText")`. Native browser, NOT Playwright-MCP.
  - multimodal-looker: add `inspect_image` to `tools:`; body: `read(path="https://arxiv.org/pdf/…")` for PDF full-text; `inspect_image(path="img.png", question="…")` for visual.
  - security-reviewer: add `recall` to `tools:`; body: `web_search(query="CVE OWASP …")`; `recall({query:"security findings"})`.
  - metis: add `recall` to `tools:`; body: `recall({query:"prior requirements decisions for this feature"})` before interview.
- **DO NOT:** add `irc`. **GATE:** `lint:agents`. **Commit:** `feat(agents): activate browser/inspect_image/recall for qa, looker, security, metis`.

#### T3.4 — git-master no-op confirmation (no commit if truly no change)
- **Files:** `agents/pi-oven-git-master.md`.
- **Change:** design §4.2 marks git-master no-op. T2.1 already converted its `[read,bash]` frontmatter (already native — verify). NO killer-tool injection. If T2.1 left nothing to do, this task is a verification-only no-op — do NOT create an empty commit. Fold any stray fix into T2.1's commit if discovered before it lands.
- **GATE:** `lint:agents`. **No commit** unless a real change surfaces.

#### T4.1–T4.7 — hybrid rewrites (MERGED frontmatter conv + body rewrite, one task per role)
Each is a single-writer task on its one file: convert frontmatter tool names (T2-style) AND rewrite the body (absorb omp patterns per design §4.1) in ONE commit. This MERGE avoids the Phase2/Phase4 double-edit BLOCKER. Target ≤250 lines/file (soft; design R5).

**Applies to ALL T4.1–T4.7 (and T5.1 critic / T5.2 verifier):** Also convert any `blocked_tools:` CC names → omp native in the same commit: `Write`→`write`, `Edit`→`edit`, `Bash`→`bash`, `Read`→`read`, `Grep`→`search`, `Glob`→`find`, `WebFetch`→`read`. Keep `apply_patch` and `task` as-is.

- **T4.1 oracle** (`agents/pi-oven-oracle.md`, `["*"]`): absorb dual-mode Consult/Delegate header, pragmatic-minimalism + effort tags (Quick/Short/Medium/Large), scope discipline ("do ONLY what was asked; ≤2 optional future considerations"), 2-3 hypotheses → parallel evidence → eliminate, "keep going until solved". Preserve opus-4-8/xhigh, "last-resort after 2+ failures", recall-first paragraph: `recall({query:"prior decisions for <feature>"})` before consulting, `retain({items:[{content:"…"}]})` on resolution. Commit: `feat(agents): rewrite oracle on omp consult/delegate foundation`.
- **T4.2 code-reviewer** (`agents/pi-oven-code-reviewer.md`): convert frontmatter `[read,search,find,bash]` + ADD `report_finding`, `web_search`, `recall`, `lsp`, `ast_grep` to `tools:` (do NOT add irc). Body: `report_finding` structured output (title ≤80 imperative; body one paragraph bug/trigger/impact; priority P0-P3; confidence 0.0-1.0; file_path/line_start/line_end ≤10-line range overlapping diff); final `yield` `overall_correctness`/`explanation`/`confidence`; cross-boundary protocol (design §6.2 full text); criteria provable+actionable+unintentional+in-patch. `output:` frontmatter MUST declare optional `findings[]` with `priority` as NUMBER (omp coerces P0-P3 → 0-3 on merge; string blocks auto-merge — design §6.1 verified fact). `recall({query:"prior critique context for this area"})`. Preserve glm-5.1/high, 2-phase (spec then code), severity×confidence. Commit: `feat(agents): rewrite code-reviewer with report_finding + cross-boundary`.
- **T4.3 librarian** (`agents/pi-oven-librarian.md`): convert frontmatter + ADD `recall`. Body: source-direct hierarchy (local node_modules/vendor → `git clone --depth 1` → `web_search` for repo URL → `read(path="https://…")` for arxiv/PDF/SO), "source is truth…" verbatim excerpts, structured `yield` (answer/sources[]/api[]/version/breaking_changes[]/caveats[]), fallback ladder (2 alternates before "nothing exists"), `recall({query:"prior library research"})`. Preserve glm-5.1/medium, document-specialist handoff. Commit: `feat(agents): rewrite librarian on omp source-direct foundation`.
- **T4.4 explorer** (`agents/pi-oven-explorer.md`): convert frontmatter `[read,search,find,bash]` + ADD `web_search`. Body: typed output (summary/files[]/architecture), thoroughness inference (Quick/Medium/Thorough), web_search first-class, "keep going until complete" read-only. Preserve 8-step survey, gemini-3-flash/medium, parallel-search discipline, 600-word cap, context budget. Commit: `feat(agents): rewrite explorer with typed output + web_search`.
- **T4.5 planner** (`agents/pi-oven-planner.md`): convert frontmatter `[read,search,find,bash,task]` + ADD `recall`, `retain` (NO checkpoint — subagent). Body: spawn `pi-oven:explorer` in parallel + synthesize; plan structure Summary/Changes(paths+lines)/Sequence/Edge Cases/Verification/Critical Files; "executable without re-exploration". Preserve opus-4-8/high, 1-question-per-turn interview, recall-first: `recall({query:"open questions from last session"})`. Commit: `feat(agents): rewrite planner on omp plan foundation`.
- **T4.6 architect** (`agents/pi-oven-architect.md`, `["*"]`): body: Phase1 Understand (parse reqs, list ambiguities, state assumptions), Phase3 Design (alternatives, justify, pitfalls), `recall({query:"prior ADRs"})`. Preserve gpt-5.4/xhigh, ADR/coupling-cohesion/migration focus. NO checkpoint. Commit: `feat(agents): rewrite architect with understand/design phases`.
- **T4.7 designer** (`agents/pi-oven-designer.md`, `["*"]`): body: anti-slop 14 forbidden patterns verbatim (design §4.1 B6) in `<avoid>`; UX anti-patterns (missing states, every-button-primary, "nothing here" empties); `<critical>` directive "how was this made? not which AI made this?"; explicit states (loading/empty/error/disabled/hover/focus); a11y (contrast/focus-rings/semantic HTML); reuse-before-invent; `browser` native + `inspect_image`. Preserve glm-5.1/high, WCAG, multimodal-looker delegation. Commit: `feat(agents): rewrite designer with anti-slop discipline + browser`.

#### T5.1 — critic: report_finding + recall  (depends on T2.1)
- **Files:** `agents/pi-oven-critic.md`. Frontmatter is `["Read","Grep","Glob"]` (restrictive, NOT `["*"]` — design Fix 10). Convert to `[read,search,find]` + ADD `report_finding`, `recall` (do NOT add irc — auto-injected; design Fix 34).
- **Body:** `report_finding` per-finding (title/body/priority P0-P3/confidence/file_path/line_start/line_end — range constraint RELAXED, critic reviews plans not diffs; design Fix 5); `recall({query:"prior critique context for this area"})`. Define critic's OWN `output:` frontmatter (e.g. `verdict: sound/flawed/partial`) — do NOT reuse reviewer's `overall_correctness` verbatim. `findings[]` in `output:` with `priority` as NUMBER.
- **DO NOT:** add irc; reuse reviewer output schema. **GATE:** `lint:agents`; `grep -A5 '^tools:' agents/pi-oven-critic.md | grep report_finding` matches. **Commit:** `feat(agents): add report_finding + recall to critic`.

#### T5.2 — verifier: report_finding + recall  (depends on T2.1)
- **Files:** `agents/pi-oven-verifier.md`. Frontmatter `["Read","Grep","Glob","Bash","task"]` → `[read,search,find,bash,task]` + ADD `report_finding`, `recall` (NO irc).
- **Body:** `recall({query:"prior verification failures for this module"})` before sub-checks; `report_finding(...)` per finding (fields refer to code path under verification). Own `output:` frontmatter with pass/fail evidence schema (NOT reviewer's verbatim). `findings[]` priority NUMBER.
- **GATE:** `lint:agents`; report_finding grep matches. **Commit:** `feat(agents): add report_finding + recall to verifier`.

#### T5.3 — tracer: cross-boundary protocol  (depends on T2.1)
- **Files:** `agents/pi-oven-tracer.md`. Frontmatter `[read,search,find,bash]` — NO tool change (irc auto-injected; no checkpoint/rewind — subagent; design §3.2).
- **Body:** add cross-boundary tracing protocol (design §6.2: locate dispatch point on consuming side; confirm explicit branch or correct catch-all; silent-drop → P0/P1). Add irc cross-lane signalling note: `irc(op:"send", to:"all", message:"hypothesis confirmed: <component> is root cause")`, `irc(op:"list")` to discover peers. NO checkpoint.
- **GATE:** `lint:agents`. **Commit:** `feat(agents): add cross-boundary tracing protocol to tracer`.

### W4 — Memory & IRC infra (depends on T1.1 for ROLES)

#### T6.1 — memory-discipline skill + plugin.json + skill-count test  (TDD, single-writer plugin.json)
- **Files (ONE commit):**
  1. `skills/memory-discipline/SKILL.md` — NEW. Frontmatter: `name: memory-discipline`, `description: …`, `alwaysApply: true`, `trigger: "메모리 규율, 기억 저장, retain 정책, flow start, recall, cycle end"` (Korean keyword REQUIRED — lint-skills:79; design Fix 14/19/37). Body per design §7.1 with EXACT mnemopi schemas: prerequisite check (if `memory.backend` not mnemopi → warn + skip gracefully); when-to-recall (planner/oracle/architect/critic/deep-researcher recall before first tool call — `recall({query:"prior decisions for <feature>"})`); when-to-retain (`retain({items:[{content:"…", context:"…"}]})` after plan finalised / decision / disproof / root cause / security finding / synthesis); when-to-reflect (`reflect({query:"…"})` after ≥3 related items); when-NOT-to-retain (intermediate results, WIP, file contents).
  2. `.claude-plugin/plugin.json` — insert `"./skills/memory-discipline/SKILL.md"` as FIRST entry in `skills` array (alwaysApply registered early).
  3. `tests/plugin/skill-count.test.ts` — RED: line 71 `21→22`; insert `"./skills/memory-discipline/SKILL.md"` into `EXPECTED_SKILLS` (line 7+) at the SAME index (first) as plugin.json so `toEqual` (line 65) passes.
- **DO NOT:** degrade `alwaysApply` to keyword-only (R7 resolved — it's precedented). Do NOT omit the Korean trigger. Do NOT use provisional `retain([{fact}])` syntax.
- **Load-time proof (add to this commit's test):** extend `tests/plugin/skill-count.test.ts` (or a dedicated `tests/plugin/always-apply.test.ts`) to assert that the plugin.json entry for `memory-discipline` has `alwaysApply: true` and that it appears as the first skill in the `skills` array. This proves the load-time registration path, not merely file presence. If the extension load-time injection path (`.omp/extensions/pi-oven.ts` `session_start` hook) is relevant, add a note confirming it is covered or flag it as requiring a separate integration task.
- **GATE:** `bun run lint:skills` + `bun run build` + `bun test tests/plugin/skill-count.test.ts` (or `always-apply.test.ts`) green.
- **Commit:** `feat(skills): add always-on memory-discipline skill (mnemopi)`.

#### T6.2 — spec-and-review wiring (memory + irc + new roles)  (serialized after T1.1)
- **Files:** `skills/spec-and-review/SKILL.md`.
- **Change:** in `Agent Dispatch (omp)` block — `recall` prior specs/decisions before brainstorm; `retain` after plan approval. Add `pi-oven:deep-researcher` (novel domains/papers/SOTA — sibling to librarian; do NOT call it "Step 0 research" — that's codebase-survey; design Fix 23) and `pi-oven:data-runner` (empirical validation of metric/perf spec claims). irc fan-out at the two-provider critic dispatch (design Fix 24/35): reviewers `irc(op:"list")` for peers, broadcast P0/P1 via `irc(op:"send", to:"all", message:"P0 finding confirmed in <file>: <summary>", awaitReply:false)`; orchestrator awaits all (not poll).
- **DO NOT:** use `/pi-oven:` slash form for role refs (breaks coverage). Do NOT invent irc channel ops (only list/send exist; design Fix 1/9/30/39).
- **GATE:** `lint:skills`. **Commit:** `feat(skills): wire memory/irc/new-roles into spec-and-review`.

#### T6.3 — autonomous-loop wiring  (serialized after T1.1)
- **Files:** `skills/autonomous-loop/SKILL.md`.
- **Change:** pre-loop ASK-FIRST — `recall` prior cycle failures at loop entry; `retain` at each confirmed MILESTONE; `reflect` at loop exit. `pi-oven:deep-researcher` dispatch at pre-loop clarification when external knowledge needed. `pi-oven:data-runner` step in per-cycle work order between tdd-strict (step 8) and pre-commit-gate (step 9): conditional dispatch when cycle touches metrics/performance (design Fix 26), and after `pi-oven:test-engineer` in autopilot Phase 3 QA (design §5.2). irc: parallel executor dispatch `irc(op:"list")` + broadcast on done/blocker.
- **GATE:** `lint:skills`. **Commit:** `feat(skills): wire memory/irc/new-roles into autonomous-loop`.

#### T6.4 — deep-dive wiring  (parallel — disjoint file)
- **Files:** `skills/deep-dive/SKILL.md`.
- **Change:** before tracer fan-out (Phase 2) — `recall` prior investigation of component; `retain` confirmed root cause on exit. `pi-oven:deep-researcher` as ONE additional co-spawned sibling in the same `task` call as the tracer fan-out — NOT a numbered hypothesis lane; feeds Phase-4 Injection-2 (design Fix 22/40). deep-dive currently fans out exactly 3 tracer lanes (SKILL.md lines 4/13/68); add `pi-oven:deep-researcher` as ONE co-spawned sibling WITHOUT renumbering or altering the 3-lane tracer framing. `pi-oven:data-runner` conditional post-lane REPL probe for log/trace analysis (design Fix 25). irc: each tracer + deep-researcher co-spawned in one `task` call, `irc(op:"list")`, broadcast root cause / prior-art-complete.
- **GATE:** `lint:skills`. **Commit:** `feat(skills): wire memory/irc/new-roles into deep-dive`.

#### T6.5 — improve-codebase-architecture wiring  (parallel — disjoint file)
- **Files:** `skills/improve-codebase-architecture/SKILL.md`.
- **Change:** before `pi-oven:explorer` dispatch (Step 1 Survey) — `recall` prior architecture decisions/ADRs; `retain` accepted architecture change. `pi-oven:deep-researcher` pre-survey research on architecture patterns (before explorer; design Fix NIT-9). `pi-oven:data-runner` after survey to run benchmark/perf baseline in REPL before recommending changes.
- **GATE:** `lint:skills`. **Commit:** `feat(skills): wire memory/new-roles into improve-codebase-architecture`.

#### T6.6 — large-task-delegation wiring + systematic-debugging + fresh-verifier recall  (parallel — disjoint files)
- **Files:** `skills/large-task-delegation/SKILL.md`, `skills/systematic-debugging/SKILL.md`, `skills/fresh-verifier/SKILL.md`.
- **Change:** large-task-delegation — before dispatch anatomy: `recall` prior delegation outcomes; `retain` delegation result/lessons; `pi-oven:deep-researcher` + `pi-oven:data-runner` refs in dispatch anatomy; irc parallel-executor coordination paragraph. systematic-debugging — `recall` prior failure modes. fresh-verifier — `recall` prior verification failures.
- **GATE:** `lint:skills`. **Commit:** `feat(skills): wire memory/irc into delegation, debugging, verifier flows`.

### W5 — Verification

#### T7.1 — full static suite
Run in order (each must pass before next; design §8.3):
```
bun run check
bun run lint:agents
bun run lint:skills
bun run build
bun test
```
Plus grep gates:
```
grep -rE '\b(Read|Grep|Glob|WebFetch|Bash|Write|Edit)\b' skills/ commands/ | grep -vFf .cc-residue-allowlist.txt   # zero tool-name matches (allowlist excludes trigger: fields and natural-language verbs)
grep -nE '^(tools|blocked_tools):.*\b(Read|Grep|Glob|WebFetch|Bash|Write|Edit)\b' agents/*.md   # zero matches (frontmatter arrays only; same scope as T2.1 rule — body prose and blocked-tool description sentences are preserved verbatim, not gated here)
grep -lE 'blocked_tools.*\b(Read|Grep|Glob|Write|Edit|Bash|WebFetch)\b' agents/*.md   # zero files (no CC names in blocked_tools)
grep -l 'pi-oven:deep-researcher' skills/{spec-and-review,autonomous-loop,deep-dive,improve-codebase-architecture,large-task-delegation}/SKILL.md   # all 5
grep -l 'pi-oven:data-runner'    skills/{spec-and-review,autonomous-loop,deep-dive,improve-codebase-architecture,large-task-delegation}/SKILL.md   # all 5
grep -A8 '^tools:' agents/pi-oven-{critic,verifier,code-reviewer}.md | grep report_finding   # all 3
```
Plus schema validation (numeric priority — BLOCKER for auto-merge):
```
# Assert output.findings[].priority is declared as a NUMBER (not string) in each of the 3 files.
# Parse the output: frontmatter block of each file and confirm the priority field type.
# Failing this silently ships broken auto-merge. Use a bun one-liner or dedicated test:
bun -e "
const fs = require('fs');
['agents/pi-oven-code-reviewer.md','agents/pi-oven-critic.md','agents/pi-oven-verifier.md'].forEach(f => {
  const src = fs.readFileSync(f,'utf8');
  const m = src.match(/output:([\s\S]*?)^---/m) || src.match(/output:([\s\S]*?)^\w/m);
  if (!m || !/priority.*number/i.test(m[0])) throw new Error(f + ': output.findings[].priority must be declared as number type');
});
console.log('priority schema: OK');
"
```
Fix any regression in production code (test-literal updates are required, not regressions). NO commit unless a fix is needed.

#### T7.2 — eval (gated)
`bun run eval` runs real omp sessions (needs LLM keys; per CLAUDE.md Status it is gated). Run ONLY if keys are present and user authorizes — otherwise SKIP and record in open-questions. Do NOT block the plan on eval. (Design §8.3 says do not run `bun run eval` in CI; treat as opt-in smoke.)

#### T7.3 — fresh-verifier
Dispatch a fresh `pi-oven:verifier` (clean context) to confirm: all gates green, 24 agents present, memory-discipline registered, new-role wiring in all 5 entry points, no CC-name residue, mnemopi config write present in setup. Main session does NOT self-declare PASS (kzk-autonomous-boundary). Collect verifier evidence before claiming completion.

**Runtime wiring verification (REQUIRED — not just config persistence):** After setup writes `memory.backend=mnemopi`, spawn a test subagent and assert that `retain`, `recall`, and `reflect` are present in its available `toolNames`. This confirms the end-to-end wiring outcome, not just that the config key was written. Implement as one of:
  - A dedicated `tests/integration/memory-wiring.test.ts` that calls `apply()` against a temp config, then invokes a minimal subagent and inspects its tool manifest.
  - OR an explicit verifier checklist item in T7.3: "spawn `pi-oven:data-runner` post-setup and assert tool manifest contains retain/recall/reflect" — evidence collected as verifier output, not silent assumption.
  Flag as SKIPPED (not FAILED) if the omp test harness does not support subagent tool-manifest inspection headlessly — but the skip must be explicit and recorded, not silently omitted.

---

## Guardrails

**Must have:** every commit passes its gate; new agent files match PROFILE_A (lint-agents enforces); memory-discipline has both `alwaysApply:true` AND Korean `trigger:`; exact mnemopi schemas (`retain({items:[…]})` etc.); `report_finding` in critic/verifier/code-reviewer `tools:` with `output.findings[].priority` as NUMBER; new roles referenced bare-colon in all 5 entry points.

**Must NOT have:** `irc` in any `tools:` frontmatter (auto-injected); `checkpoint`/`rewind` anywhere (subagent-unavailable); `/pi-oven:` slash form for role coverage refs; `hindsight` backend (it's `mnemopi`); provisional `retain([{fact}])` syntax; "Plan N"/"Task N" in commit subjects; auto-push; PROFILE_B id changes (deferred); orchestrator-model changes (out of scope); empty no-op commits (T3.4).

---

## Open questions (also append to `.omc/plans/open-questions.md`)

1. **CC-residue grep vs natural-language verbs (T2.2) — RESOLVED:** gate redefined as allowlist-filtered zero (not raw zero). Executor pre-enumerates all matches, classifies each as CONVERT or PRESERVE, commits `.cc-residue-allowlist.txt` with all PRESERVE lines, then converts only TOOL-NAME references. `trigger:` fields and `MultiEdit`/`NotebookEdit`/`ast_grep_replace` tokens are PRESERVE by definition. No escalation needed unless a line is genuinely ambiguous after classification.
2. **`bun run eval` execution (T7.2):** gated on LLM keys + user authorization. Skipped by default. — Affects depth of runtime verification.
3. **`report_finding` exact param schema:** design says confirm spelling/params against omp tool registry (`tools/review.ts:123`) before authoring T4.2/T5.1/T5.2 bodies. — Affects field names in finding calls.
4. **`output.findings[].priority` NUMBER coercion:** design states omp coerces P0-P3→0-3 on merge and string-typed priority blocks auto-merge. Verify against live omp before shipping critic/verifier `output:` schemas. — Affects auto-merge of structured findings.
