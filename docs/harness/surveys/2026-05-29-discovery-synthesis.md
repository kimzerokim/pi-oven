# Discovery Synthesis — 2026-05-29

> Read-only discovery run `wf_74c81aad-c7b` (15 survey agents). Raw structured results: `2026-05-29-discovery-harvest.jsonl` (jq-readable, 14 result objects). This doc is the de-duplicated, pi-oven-aware synthesis + execution plan. Three tracks: (1) per-model agent optimization, (2) external_harness import shortlist, (3) Plan 3 omp-runtime feasibility.

## Track 1 — Per-model agent optimization (msg 3: heterogeneous models)

23 agents run across 8 model families. Survey audited each agent body's model-fit (1-5) vs its assigned model and produced a reusable per-model "execution-context injection block" (in harvest `.injectionBlock`) + per-role tuning (`.perRole[].tuning`).

**Rewrite priority (lowest fit first):**

| fit | agents (model) | core gap |
|---|---|---|
| **2** | executor, debugger, test-engineer⁽³⁾ (gpt-5.3-codex); architect, scientist (gpt-5.4); designer (glm-5.1); qa-tester (gemini-3.5-flash) | over-prescribed numbered ceremony (Codex adheres to ceremony over intent → slow time-to-first-action); pure-prose hard rules (GPT-5 down-weights non-XML rules); generic body w/ zero model-specific framing; GLM crowded by motivational narrative |
| **3** | code-simplifier, verifier (kimi); explorer, writer (gemini-3-flash); metis (gpt-5.4) | thinkingLevel/body mismatch (xhigh+write = risk; medium body expects deep deliberation); hedging prose ("should"/"when relevant") Flash needs crisp; markdown rules not bound |
| **4** | analyst, code-reviewer, tracer, librarian (kimi); critic, planner, security-reviewer (opus); document-specialist, multimodal-looker (gemini-3-flash) | already good fit; light targeting only |
| **5** | oracle (opus) | best-tuned already (verbosity caps, no-preamble, dense-output) |

**Per-family injection-block themes** (full text in harvest):
- **Codex (gpt-5.3-codex)** — bias-to-action, no preamble/aloud-plan, `apply_patch` diff fluency, AGENTS.md hierarchy, drop numbered ceremony; reason internally (effort already high).
- **GPT-5.4 (frontier)** — bind load-bearing rules in XML/tags (not prose lines); GPT-5 down-weights prose constraints; literal instruction-following.
- **Gemini-3-flash (fast/long-ctx)** — crisp directive framing, remove hedging, explicit output schema, exploit 1M context, anti-fabrication.
- **Gemini-3.5-flash (vision)** — Flash-specific + vision-grounding ("describe only what is visible").
- **Kimi-k2.6 (reasoning/long-ctx)** — machine-parseable marker conventions ([OBJECTIVE]/[FINDING] etc.), match thinkingLevel to task, regression rails for xhigh+write (code-simplifier).
- **GLM-5.1 (agentic)** — strip motivational narrative, concrete tool-use framing, structured steps.
- **gpt-5-nano (minimal)** — ultra-terse mechanical, NO reasoning scaffold, single-purpose (git-master). *(derived — survey agent's StructuredOutput failed; see execution note.)*
- **Opus-4-8 (frontier, XML-friendly)** — already strong; light targeting (rich negative constraints, stakes framing fit Opus).

**Safety:** agent BODY edits are non-destructive to SoT — `agent-rewriter.ts` preserves the body verbatim; only frontmatter `model:`+`thinkingLevel` is lint-locked to `profiles.ts`. So bodies can be rewritten freely; lint/`--apply` won't clobber.

## Track 2 — External import shortlist (de-duped vs pi-oven's real 15 skills/23 agents)

Survey returned 82 candidates (ECC 11 / omc 14 / omo 13 / Pocock 31 / superpowers 13). Many were **false positives** (already in pi-oven). After dedup:

**DROP (already in pi-oven):** `subagent-driven-development` (is a pi-oven skill), `verification-before-completion` (absorbed into fresh-verifier), `team`/`deep-init`/`deep-dive` variants, most `ultrawork`/`dispatching-parallel-agents`/`executing-plans` (in autonomous-loop + large-task-delegation).

**Genuine shortlist:**

| Pri | Item | Source | pi-oven mapping | Note |
|---|---|---|---|---|
| **P0** | **rules-injector + multi-hook coordination** | omo, ECC | `.omp/extensions/pi-oven.ts` hooks + `.omp/hooks/` | **= Track 3.** Persistent rule/discipline injection; pi-oven ext has only 2 hooks. omp-native. |
| **P0** | **systematic-debugging** (skill) | superpowers | `skills/systematic-debugging/` (process skill; pi-oven has debugger *agent*, no process skill) | battle-tested phase loop |
| P1 | **improve-codebase-architecture** | Pocock | `skills/` + architect dispatch | deepening beyond linting |
| P1 | **receiving-code-review** | superpowers | `skills/` (pi-oven has requesting side via spec-and-review) | how to act on review |
| P1 | **using-git-worktrees + finishing-a-development-branch** | superpowers | `skills/` | isolation + branch-finish discipline |
| P1 | **caveman / token-efficiency** | ECC | `skills/` or context mode | relevant to heterogeneous + long sessions |
| P1 | **compaction/memory-persistence hooks** | ECC | `.omp/extensions/` | long-session context mgmt → also Track 3 |
| P2 | council / santa-method / prompt-optimizer (multi-model decision) | ECC | `skills/` | interesting for heterogeneous models; ceremony risk — vet |
| P2 | continuous-learning / self-improve / learner | ECC, omc | `skills/` + hooks | learning loop; slop risk — vet hard |
| Defer | Pocock issue-tracker cluster (triage/to-prd/to-issues/setup) | Pocock | requires issue tracker | out of omp-native scope unless user wants |

## Track 3 — Plan 3 omp-runtime feasibility (user prefers TS runtime)

Survey read omp source + bundled types with file:line evidence. Verdict: **FEASIBLE as a hybrid "soft-deterministic" runtime, NOT a true hard FSM.**

**What omp CAN hard-enforce:**
- ✅ **Gate state machine** via the `tool_call` block hook (the ONLY hard lever; `shared-events.ts:265-270` `{block, reason}`). Hard-block `git commit` until Gate 0-5 PASS; inspect/block `task`-tool dispatch of disallowed agents.

**What omp CANNOT do (with workaround):**
- ❌ per-agent `disallowedTools` — omp has only a positive allowlist `agent.tools` (`executor.ts:621-633`). Express deny as narrower allowlist.
- ❌ block "until verifier dispatched" — `agent_start/end`, `turn_*` are observe-only (`shared-events.ts:174-197`). Workaround: force a continuation turn via `sendMessage(deliverAs:nextTurn, triggerTurn:true)`.
- ❌ per-call model/thinkingLevel override — no dispatch hook (confirms ADR 0001:79). `task` resolves model statically (`agentModelOverrides > frontmatter > parent`). **The only path to true per-call model selection = register a custom orchestration tool via `pi.registerTool` that drives subagents through the omp SDK with an extension-chosen model.**

**Recommended architecture (4 layers):**
1. Gate state machine — persisted `.pi-oven/state/autonomous.json`, enforced at `tool_call` (hard-blocks commit/dispatch/forbidden commands).
2. Per-dispatch model control — keep static (`agentModelOverrides`/frontmatter) OR build a `pi.registerTool` `pi-oven_dispatch` for true per-call (cost: reimplement dispatch/worktree/merge).
3. Per-agent tool restriction — native allowlist `tools:`.
4. Reminder/steering (soft) — `before_agent_start.systemPrompt` + `context.messages` + `sendMessage(nextTurn)` re-ground FSM phase every turn.

**Reconciliation:** foundation-design.md:121 ("gate state machine + per-agent disallowedTools") is partly infeasible as literally specced. ADR needed: redefine Plan 3 as the hybrid runtime above. The user's instinct (TS runtime reduces model-performance dependence) is **correct at the tool-action boundary** (commits/dispatch/forbidden-commands become non-bypassable) but the high-level flow ordering stays soft (reminder-driven). **Risks:** 30s extension-handler timeout (thrown/timeout auto-blocks); `setModel`/`setActiveTools` are session-global (race risk); `ctx.getModel()` needs `as any`.

> **Convergence:** Track 3 (TS runtime) and the Track 2 P0 hook mechanisms (rules-injector, multi-hook coordination, gate hooks) are the SAME initiative — an omp-native runtime/hook layer. Build them together.

## Execution plan

1. **Per-model optimization** (Track 1) — execute now (low-risk, explicitly requested). Dispatch per model family; integrate injection block + per-role tuning into bodies; preserve frontmatter; verify lint/test/build green; critic review before commit.
2. **omp-runtime layer** (Track 2 P0 ⊕ Track 3) — needs spec-and-review (codex) before code (novel, hook-level, ADR for Plan 3). Bigger effort.
3. **Skill imports** (Track 2 P1) — systematic-debugging, improve-codebase-architecture, receiving-code-review, worktrees/branch-finish, caveman. Author as pi-oven skills (English bodies, pi-oven:<role> dispatch); vet P2 for slop.
4. Bundle all improvement commits on `ec2397a` → push all together as **0.1.0** (push gated on explicit consent).
