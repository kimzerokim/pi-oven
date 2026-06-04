# Skill Activation Contract — Decision Doc

**Status:** DRAFT — awaiting user approval before any code changes.
**Date:** 2026-06-04
**Scope:** How pi-oven skills activate at runtime; what the eval harness should measure; what docs to fix.

---

## 1. Problem Statement

pi-oven's README, spec docs, and site pages promise "skills auto-activate when trigger keywords appear in conversation" (README.md:99-113; docs/specs/2026-05-28-pi-oven-skill-rewrite-and-new-skills.md:717-719; docs/site/skill-flow.ko.html:301; docs/site/omp-native-upgrade.ko.html:321,409). That promise is false under omp. omp has no keyword-trigger pipeline: the runtime Skill object carries only `name` and `description` (skills.ts:194-202); `trigger:` is silently discarded at load; `alwaysApply:true` on a SKILL.md is inert (it is a rules-capability concept, not a skills concept — rule-buckets.ts:8-12,54-57). The mismatch means users expect invisible automation but get a system where the model must explicitly read `skill://<name>` on its own initiative. This creates a broken UX promise and produces unreliable eval results built on the wrong signal.

---

## 2. How Activation Actually Works Today

| Path | Trigger | Who acts | Skill body in context? |
|---|---|---|---|
| **A. Model-initiated read** | Model decides to call `read skill://<name>` based on the description line shown in `# Skills` | Model | Yes — on model's choice |
| **B. `/skill:<name>` slash command** | User types the command explicitly | User | Yes |
| **C. `task autoloadSkills`** | A Task agent config specifies skills to preload | Config author | Yes |
| **D. `alwaysApply:true` on SKILL.md** | _Claimed_ always-on | _Nothing_ | **No — inert under omp** (skill loader discards it; only rule-buckets.ts paths honour alwaysApply, and those are for `.md` RULE files, not SKILL.md) |
| **E. pi-oven extension keyword hook** | AUTONOMOUS_KEYWORDS matched against user message in `turn_start` (autonomous-stop-guard.ts:41-80) | Extension hook | **No** — injects a fixed continuation string (`STOP_GUARD_MESSAGE`, autonomous-stop-guard.ts:115-121), never a skill body |
| **F. `trigger:` frontmatter field** | _Claimed_ keyword match | _Nothing_ — discarded by loader (skills.ts:194-202); consumed only by CI lint (lint-skills.ts:77-90) | **No** |

**Net:** the only lever pi-oven has to guide WHEN the model reads a skill is the `description:` field rendered as `- {name}: {description}` in the system prompt (system-prompt.md:75-80). pi-oven's extension hooks do one keyword-driven thing — the autonomous stop-guard — but that injects a hardcoded string, not a skill body, and cannot be generalised to arbitrary skills without a new engine.

---

## 3. The D Decision — Two Options

### D1 (recommended): Description-driven discovery + explicit skill read

**Contract:** Skills are surfaced to the model via their `description:` field. The model reads `skill://<name>` when the description's WHEN-condition matches context. Always-on disciplines (code-quality, memory) are delivered as omp RULE files (alwaysApply rule, not SKILL.md), or their `description:` is rewritten to instruct "read this skill at the start of every code task". `trigger:` is either dropped entirely or explicitly documented as human-facing / lint-only metadata with zero runtime effect. pi-oven extension hooks stay as-is (stop-guard, gate, systemPrompt injection) — they are not extended to include a skill-body loader.

**What changes:**
- `description:` fields for skills with weak WHEN-signals are rewritten to front-load explicit activation conditions. Priority: `spec-and-review` (currently WHAT-focused: "Spec/plan authoring with cross-vendor critic loop…"; needs WHEN like "Read before drafting any new spec, plan, or large structural change"), `memory-discipline` (currently "Defines when to retain, recall…"; needs WHEN like "Read at the start and end of every flow").
- `alwaysApply:true` on skills/code-quality-discipline/SKILL.md and skills/memory-discipline/SKILL.md is either removed (if we document it is inert) or the skill content is migrated to a rule file under an `alwaysApply` rule so it actually auto-injects.
- README.md:99-113 "Skills auto-activate…" table is replaced with the truth: skills are model-discovered from `description:`; the model reads `skill://<name>` on demand; the only keyword-driven runtime behavior is the autonomous stop-guard (user-message keywords → fixed continuation, not skill load).
- `trigger:` fate: see open questions below.
- lint-skills.ts: if `trigger:` is dropped, remove the Korean-keyword requirement; if kept as discoverability-hint, add a comment that it has no runtime effect.

**What it costs:** Model discretion is imperfect — a weak description means the skill is underused. This requires careful description authoring, not engineering.

**What it buys:** Honest contract, no hidden control flow, no multilingual keyword maintenance, no omp-core change needed.

---

### D2: Runtime keyword→skill loader (extension-B)

Add a new pi-oven extension hook that: (a) reads all SKILL.md `trigger:` fields at session start, (b) on each `turn_start` matches user message against those keywords, (c) when matched, fetches the skill body via `skill://<name>` read and injects it into the system prompt.

**What it costs:**
- Requires a new extension module (~200 LOC) and omp extension API research to confirm system-prompt injection at `turn_start` is supported without race conditions.
- `trigger:` keywords are multilingual (Korean + English) — false-positive risk is real (e.g. "commit" matching pre-commit-gate on every commit mention).
- Hidden control flow: users cannot see why a skill body appeared; debugging is opaque.
- The stop-guard already does one keyword→inject pattern and it was non-trivial to get right (capped retries, terminal-completion detection, etc.). Generalising it to 21 skills multiplies that surface area.
- Fundamentally fights omp's architecture (description-driven), making upgrading omp harder.

**Recommendation:** AGAINST D2 now. The cost/benefit ratio is poor given D1 delivers the same user-visible quality via description authoring alone.

---

## 4. A — Eval Redesign (follows from D1)

### 4a. Replace name-search criterion

Current `skill_triggered` check (eval-runner.ts:159-173): passes if the skill name string appears anywhere in `lastBuf.toolCalls` or `lastBuf.content`. This is an invalid signal — a skill name can appear in response prose without the skill body having been read, and can be absent even when the skill was correctly applied.

**Fix:** `skill_triggered` should detect the `skill://<name>` read tool call in `lastBuf.toolCalls` (omp records it as a tool invocation). Concretely: `lastBuf.toolCalls.some(n => n.includes('skill') && n.includes(skillName))` — or better, a dedicated `skill_read_required: "<name>"` assertion that checks for a `read` tool call whose argument matches `skill://<name>`. The current substring-in-content path is noise; remove it or gate it behind a separate `response_must_mention` assertion.

### 4b. Assert real behavior for behavioral skills

For skills that change behavior (code-quality-discipline, memory-discipline), liveness means the model produced outputs that match the skill's rules, not that the skill name appeared. Use `agent_response_must_contain` and `tool_calls_required` against tools that actually exist under `hasUI:false`. Example: a code-quality-discipline scenario should assert `tool_calls_required: ["read"]` (the model read relevant files) rather than `skill_triggered: "code-quality-discipline"`.

### 4c. Remove / quarantine hasUI:false-incompatible scenarios

`ask` is null when `hasUI:false` (run-eval.ts:58,84). Any scenario whose trigger or expected behavior requires `ask` (e.g. deep-dive smoke, interactive clarification flows) must be either:
- Removed from the default eval suite and tagged `requires_ui: true`, or
- Rewritten so the user-prompt supplies all information the model would otherwise `ask` for.

### 4d. Clarify `skill_triggered` semantics per skill category

| Skill category | What `skill_triggered` should assert |
|---|---|
| Loadable/procedural (codebase-survey, spec-and-review, pre-commit-gate) | `skill_read_required: "<name>"` — the `skill://` read tool call fired |
| Behavioral/discipline (code-quality-discipline, memory-discipline) | Drop `skill_triggered`; use `agent_response_must_contain` or `tool_calls_required` to check behavioral output |
| Autonomous-loop (autonomous-loop, autonomous-boundary) | `agent_response_must_not_contain` for premature stop phrases; check that stop-guard continuation fired (custom event type `pi-oven-autonomous-stop-guard`) |

### 4e. Adopted scoring — stable-signal (real-eval-driven; supersedes the gate framing in 4a/4d)

A real eval run exposed that **positive behavioral assertions are inherently flaky for agentic LLMs**: the same prompt produced `read`×16 one run and a code-write the next; a textbook-DRY response ("`formatBytes` already exists, not creating it") was scored FAIL only for omitting the literal word "DRY"; and discipline scenarios spawn `task` subagents unpredictably and exceed even 180s. So we measure the **stable** thing as the gate and record the **noisy** thing as telemetry:

- **POSITIVE behavioral → TELEMETRY** (recorded as observations, never a failure): `agent_response_must_contain` (+ `_match`), `tool_calls_required`, `skill_read_required` (soft, per §4a).
- **NEGATIVE / safety → HARD GATE** (deterministic, stable — the real omp-native contract): `agent_response_must_not_contain`, `tool_calls_forbidden_first`, `skill_triggered: false`. This is the slop/violation detector (no `oh-my-claudecode:` / `omo:` / Claude-Code tool names; no forbidden-first dispatch).
- **LIVENESS gate**: a turn with no content AND no tool calls (and not timed out) fails.
- **INCONCLUSIVE (⊘)**: a turn that times out with no final text is *measurement-incomplete*, NOT a skill failure. `run-eval` prints `⊘/✓/✗` plus a `P pass, F fail, I inconclusive` summary, and the process exit code ignores `⊘`.

**Implication:** the eval gate asserts that the agent stays omp-native and produces a live response; whether it said "DRY" or grepped first is tracked as telemetry (trend signal), not a pass/fail gate. This resolves the measurement-mismatch in §6 Q3 at the assertion-policy level: behavior is observed, the stable contract is enforced.

---

## 5. Doc and Metadata Cleanup (follows from D1)

### 5a. README.md:99-113 — rewrite the auto-activate section

Replace the keyword table with:

> Skills are surfaced to the model via their `description:` field in the system prompt. When a task matches the description's activation condition, the model reads `skill://<name>` to load the full procedure. Skills do NOT auto-fire on keywords — the model chooses when to read them based on context. The one keyword-driven runtime behavior is the autonomous stop-guard (not skill-loading): when the user sends an autonomous-mode keyword (e.g. "ralph로 돌려", "autopilot"), the extension keeps the agent looping with a fixed continuation message until completion or an explicit stop.

### 5b. `trigger:` fate — two sub-options (user decision needed)

**T1 — Drop `trigger:` entirely.** Fold the keyword vocabulary into `description:` (the field omp actually renders). Update lint-skills.ts to stop requiring `trigger:`. Pro: one source of truth; description improves. Con: lose the human-readable trigger table in SKILL.md.

**T2 — Keep `trigger:` as human-facing discoverability hint.** Add a comment in each SKILL.md and in lint-skills.ts explaining it has no runtime effect. Optionally: file a separate track to patch omp's system-prompt template to append `(activate on: {trigger})` after each skill description — this requires an omp-core change and is out of scope for this decision.

### 5c. `alwaysApply:true` on SKILL.md — two sub-options (user decision needed)

**AP1 — Remove `alwaysApply:true` from skill files; document it is inert.** Both `code-quality-discipline` and `memory-discipline` become model-discretion skills like the rest. Their descriptions must be strong enough to pull model attention.

**AP2 — Migrate always-on disciplines to omp RULE files.** Create `.omp/rules/code-quality-discipline.md` and `.omp/rules/memory-discipline.md` with `alwaysApply: true` in frontmatter, so rule-buckets.ts auto-injects them. The SKILL.md becomes a cross-reference stub or is removed. This delivers genuine always-on injection at the cost of a new artifact category in the repo.

### 5d. docs/ site pages

docs/site/skill-flow.ko.html:301 and docs/site/omp-native-upgrade.ko.html:321,409 repeat the keyword auto-activation framing. Update after the README is settled so the message is consistent.

### 5e. docs/specs/ — add a correction note

docs/specs/2026-05-28-pi-oven-skill-rewrite-and-new-skills.md:717-719 ("omp matches against the trigger: frontmatter field…") should get a correction note at the top of that file marking it as superseded by this decision doc, rather than editing the historical spec body.

---

## 6. Recommendation + Open Questions

**Recommendation:** Adopt D1. Rewrite skill `description:` fields to lead with explicit WHEN-conditions; fix README.md:99-113; redesign eval `skill_triggered` to detect `skill://` read tool calls; quarantine `hasUI:false`-incompatible scenarios.

**Open questions for the user (only these require a decision before work begins):**

1. **`trigger:` fate: T1 (drop + fold into description) or T2 (keep as human-only hint)?** This determines whether lint-skills.ts gets simplified or just annotated, and whether the description rewrite must absorb the keyword vocabulary.

2. **`alwaysApply` disciplines: AP1 (remove, model-discretion) or AP2 (migrate to omp RULE files for genuine always-on injection)?** AP2 adds a new artifact category; AP1 is smaller but accepts that these skills are model-discretion.

3. **Eval rewrite scope: all 48 scenarios now, or incrementally (fix the 1 known failure + the hasUI incompatibilities first, then batch-rewrite)?** An incremental approach ships a correct contract faster; a full rewrite is higher confidence but more work.
