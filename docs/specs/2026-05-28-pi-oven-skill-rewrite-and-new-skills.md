# Spec C: SKILL.md English Rewrite, New Skills, and Existing Skill Boosts

**Status**: Draft v3 — 2026-05-28 (cycle 3 revision: BLOCKER 3/3, NIT 6/6 + extras applied)
**Scope**: 12 existing SKILL.md English rewrite + omc ref removal, 3 new skills (deep-init, deep-dive, team), 2 existing skill boosts (autonomous-loop, fresh-verifier), plugin.json v0.1.0
**Spec A dependency**: `docs/specs/2026-05-28-pi-oven-agent-registry.md` (ACCEPTED cycle 4) — 23 pi-oven-* agent files, dispatch namespace `pi-oven:<role>`
**Spec B dependency**: `docs/specs/2026-05-28-pi-oven-setup-wizard.md` (ACCEPTED cycle 4) — `/pi-oven:setup` wizard, Profile A/B routing, agent-file source-of-truth

**Supersession note (2026-06-26)**: The older production-code-first / "AI direct execution forbidden" wording below is superseded for pi-oven-owned external execution. Default no-consent handling is still script/CI redirection, but the latest user message may authorize one matching direct external command with local credential files already on the machine; pasted inline secrets remain forbidden.
---

## §1 Goal

Spec A shipped 23 `agents/pi-oven-*.md` files and established `pi-oven:<role>` as the dispatch namespace. Spec B shipped the `/pi-oven:setup` wizard with Profile A/B routing and drift detection. Both specs are fully accepted.

Spec C completes the agent-registry initiative by addressing the final two failure modes that remain after Spec A/B:

1. **Dispatch ref poison in SKILL.md bodies**: the 12 existing SKILL.md files still contain `oh-my-claudecode:*` dispatch strings copied from omc source. When a skill instructs the agent to dispatch `oh-my-claudecode:explorer`, omp receives that string as an agent name, finds no file named `oh-my-claudecode:explorer.md`, and fails. This is the same class of failure that motivated Spec A. The fix is a sweep of all 12 SKILL.md bodies to replace every `oh-my-claudecode:*` / `omo:*` ref with the corresponding `pi-oven:*` agent-file lookup.

2. **Mixed-language SKILL.md bodies**: several SKILL.md files contain Korean prose in their body text (not just trigger fields). The project standard — established in Spec A — is English-only for all agent and skill bodies. Korean is permitted only inside `trigger:` frontmatter fields where it is used for keyword matching.

In addition, Spec C adds three skills absorbed from omc: `deep-init` (hierarchical AGENTS.md generation), `deep-dive` (trace-to-interview 2-stage pipeline), and `team` (multi-agent orchestration). It also boosts two existing skills — `autonomous-loop` and `fresh-verifier` — with content absorbed from omc `autopilot`, `ralph`, `ultrawork`, and `verify` patterns.

After Spec C ships, `plugin.json` lists 15 skills, the catalog version bumps to 0.1.0, and the `oh-my-claudecode:*` string is absent from every SKILL.md body.

---

## §2 External Reference Removal Scope

### 2.1 Live grep results

Grep command executed against all files under `skills/` (recursive — covers SKILL.md, references/, AGENTS.md, and any other files):

```
grep -rn "oh-my-claudecode:\|omo:" skills/
```

**Findings (all occurrences):**

| File | Line | Occurrence | Replacement |
|---|---|---|---|
| `skills/autonomous-loop/SKILL.md` | 45 | `oh-my-claudecode:explore` | `pi-oven:explorer` |
| `skills/autonomous-loop/SKILL.md` | 98 | `oh-my-claudecode:verifier` | `pi-oven:verifier` |
| `skills/large-task-delegation/SKILL.md` | 39 | `oh-my-claudecode:explore` | `pi-oven:explorer` |
| `skills/large-task-delegation/SKILL.md` | 40 | `oh-my-claudecode:planner` | `pi-oven:planner` |
| `skills/large-task-delegation/SKILL.md` | 41 | `oh-my-claudecode:critic` | `pi-oven:critic` |
| `skills/large-task-delegation/SKILL.md` | 42 | `oh-my-claudecode:verifier` | `pi-oven:verifier` |
| `skills/large-task-delegation/SKILL.md` | 43 | `oh-my-claudecode:executor` | `pi-oven:executor` |
| `skills/large-task-delegation/SKILL.md` | 44 | `oh-my-claudecode:executor` | `pi-oven:executor` |
| `skills/large-task-delegation/SKILL.md` | 45 | `oh-my-claudecode:writer` | `pi-oven:writer` |
| `skills/pre-commit-gate/references/gate-detail.md` | 38 | `oh-my-claudecode:ai-slop-cleaner` | `pi-oven:code-simplifier` (per Spec A §12: ai-slop-cleaner inlined into code-simplifier) |

**Total occurrences: 10** (9 in SKILL.md files + 1 in references/ subdir).

**No `omo:` occurrences found** across the `skills/` tree.

**Files with zero omc refs** (no body changes required for dispatch strings, but English rewrite applies):
`brainstorming`, `code-quality-discipline`, `codebase-survey`, `eval-runner`, `fresh-verifier`, `pre-commit-gate` (SKILL.md only — references/gate-detail.md handled separately), `spec-and-review`, `subagent-driven-development`, `tdd-strict`, `writing-plans`

### 2.2 Full mapping table

Every `oh-my-claudecode:*` string that may appear in any SKILL.md body maps as follows:

| `oh-my-claudecode:*` string | `pi-oven:*` replacement | Agent file |
|---|---|---|
| `oh-my-claudecode:explore` | `pi-oven:explorer` | `agents/pi-oven-explorer.md` |
| `oh-my-claudecode:executor` | `pi-oven:executor` | `agents/pi-oven-executor.md` |
| `oh-my-claudecode:writer` | `pi-oven:writer` | `agents/pi-oven-writer.md` |
| `oh-my-claudecode:critic` | `pi-oven:critic` | `agents/pi-oven-critic.md` |
| `oh-my-claudecode:verifier` | `pi-oven:verifier` | `agents/pi-oven-verifier.md` |
| `oh-my-claudecode:planner` | `pi-oven:planner` | `agents/pi-oven-planner.md` |
| `oh-my-claudecode:code-reviewer` | `pi-oven:code-reviewer` | `agents/pi-oven-code-reviewer.md` |
| `oh-my-claudecode:debugger` | `pi-oven:debugger` | `agents/pi-oven-debugger.md` |
| `oh-my-claudecode:designer` | `pi-oven:designer` | `agents/pi-oven-designer.md` |
| `oh-my-claudecode:ai-slop-cleaner` | `pi-oven:code-simplifier` | `agents/pi-oven-code-simplifier.md` (Spec A §12: ai-slop-cleaner inlined into code-simplifier) |

**`superpowers:*` references**: KEEP as attribution citation only. These are bibliographic references documenting where patterns originated; they are never used as dispatch strings. No functional change required.

### 2.3 Post-rewrite verification commands

After Spec C implementation, all of the following greps must return zero lines:

```bash
# All files under skills/ (SKILL.md, references/, AGENTS.md, etc.)
grep -rn "oh-my-claudecode:\|omo:" skills/
# Expected: no output
echo "Exit code: $?"
# Expected: Exit code: 0

# commands/ directory (slash-command definition files)
grep -rn "oh-my-claudecode:\|omo:" commands/
# Expected: no output (or "No such file or directory" if commands/ absent)
```

Superpowers citation preservation regression check (must stay non-zero — confirms citations were not accidentally removed):

```bash
grep -rn "superpowers:" skills/
# Expected: existing matches returned (zero loss of citation-only refs)
```

These commands become AC#2 in §8.

### 2.4 Canonical source path root

All `omc source:` references in §4 + §5 anchor to:

```
/Users/kimzerokim/work/personal/external_harness/oh-my-claudecode/skills/<name>/SKILL.md
```

This is the committed reference clone of omc (frozen per project policy). The marketplace clone at `~/.claude/plugins/marketplaces/omc/skills/<name>/` is a live mirror and may drift; use it only when the external_harness clone is missing.

---

## §3 English Rewrite Scope

### 3.1 Policy

- **Body text and descriptions**: English only.
- **`trigger:` frontmatter field**: MAY include Korean keywords for matching (e.g. `"자율 실행"`, `"ralph로 돌려"`, `"fix 시작"`). These are pattern-match strings, not prose.
- **Keyword examples inside body text** (e.g. listing trigger keywords as strings like `"끝까지 끝내줘"`): KEEP, but MUST be placed inside fenced code blocks (` ``` `) or backtick-quoted inline code on their own line. This is required so the AC#1 regex (which skips fenced-code lines) does not flag them as Korean prose violations.
- **Korean prose** (explanations, instructions, rationale, checklist item bodies, table cell content): REPLACE with English.

### 3.2 Per-file assessment

Live-grep command: `for f in skills/*/SKILL.md; do echo "=== $f ==="; grep -n "[가-힣]" "$f" || echo "(no Korean)"; done`

**Classification key**:
- **trigger-keyword-literal**: Korean string inside backticks used as trigger pattern. Keep as-is; place on its own line as inline code so AC#1 regex (5+ consecutive chars) does not fire.
- **narrative-prose**: Korean embedded in English sentences as explanatory text. Replace with English.

| SKILL.md | Korean lines | Classification | Rewrite scope |
|---|---|---|---|
| `autonomous-loop` | 5 (trigger field), 15 (`자율 실행`, `끝까지 끝내줘`, `자는 동안 진행해`, `ralph로 돌려` in backticks), 120 (`그만` in backtick) | All trigger-keyword-literal | Replace 2 omc refs; boost content in §5; no prose changes |
| `large-task-delegation` | 21 (trigger field — 8 Korean strings in backticks), 32 (`"그냥 메인이 직접 해"` in narrative sentence), 93 (`"그냥 메인이 직접 해"`, `"haiku로 진행"`, `"spec 먼저 잡자"` in narrative sentence) | Line 21: trigger-keyword-literal; lines 32,93: narrative-prose | Replace 7 omc refs; translate lines 32,93 narrative Korean to English |
| `brainstorming` | 5 (trigger field), 17 (`"아이디어"` in backtick inline) | All trigger-keyword-literal | Clean pass — trigger literals only |
| `code-quality-discipline` | 25–29, 35, 48–54 (section header + 3 questions + deletion test bullet + 7 checklist items) | All narrative-prose | Translate all Korean prose to English (replacements below) |
| `codebase-survey` | 17 (`"fix 시작"`, `"버그 수정"`, `"callsite 전수"`, `"상세하게 봐줘"`, `"상세히 봐줘"` in backtick inline) | All trigger-keyword-literal | Clean pass — trigger literals only |
| `eval-runner` | (none) | N/A | Clean pass |
| `fresh-verifier` | (none) | N/A | Boost content in §5 |
| `pre-commit-gate` | (none) | N/A | Clean pass |
| `spec-and-review` | 5 (trigger field), 16 (`"spec 잡자"` etc in backtick inline), 36 (`"브레인스토밍 스킵"` in backtick inline) | All trigger-keyword-literal | Clean pass — trigger literals only |
| `subagent-driven-development` | (none) | N/A | Clean pass |
| `tdd-strict` | 5 (trigger field), 21 (`테스트 먼저` in backtick inline) | All trigger-keyword-literal | Clean pass — trigger literals only |
| `writing-plans` | 5 (trigger field), 16 (`"plan만들어"` in backtick inline) | All trigger-keyword-literal | Clean pass — trigger literals only |

**Primary rewrite target: `code-quality-discipline`** — narrative Korean at lines 25–29, 35, 48–54.

English rewrites for `code-quality-discipline`:

3 self-questions (replacing Korean at lines 27–29):
1. **DRY**: Does the same code already exist in the codebase? Verify with `grep -rn` + CRG `semantic_search_nodes`.
2. **YAGNI**: Is this truly needed right now? Derive the minimum from the user's request.
3. **KISS**: Is this the simplest expression? Is a shorter equivalent possible?

Section header replacement (line 25 Korean → English):
```
Before writing code, answer the following 3 questions explicitly:
```

Deletion test bullet replacement (line 35 Korean → English):
```
Before creating a new file / module / helper:
```

Post-write checklist (replacing Korean items at lines 48–54):
- [ ] No duplicated responsibility (DRY)
- [ ] Nothing added beyond the user's request (YAGNI)
- [ ] Shortest expression reviewed (KISS)
- [ ] New module passes Deletion test (N ≥ 2 callers cited)
- [ ] Depth = interface properties validated (no shallow 1:1 wrappers)
- [ ] External lib via Context7 / internal pattern cited
- [ ] Deepened module: obsolete shallow unit tests deleted

**Secondary rewrite target: `large-task-delegation`** — narrative Korean at lines 32, 93.

English replacements:
- Line 32: `User override accepted with one line ("그냥 메인이 직접 해").` → `User override accepted with one line ("just do it from main" / "just proceed").`
- Line 93: `User override ("그냥 메인이 직접 해", "haiku로 진행", "spec 먼저 잡자") accepted immediately.` → `User override ("just do it from main", "proceed with haiku", "write the spec first") accepted immediately.`

### 3.3 Scope of references/* files

Skills load `references/*.md` as progressive disclosure (lazy reading). They are part of the skill body in effect. English-only applies.

Verification: `grep -rn "[가-힣]" skills/*/references/` enumerates Korean prose in references.

**Live findings:**

- `skills/code-quality-discipline/references/principles.md` lines 118–124 — narrative Korean (post-write checklist items). Same content as SKILL.md lines 48–54; same English replacement applies.
- `skills/code-quality-discipline/references/principles.md` lines 147–153 — narrative Korean (dispatch boilerplate block: "코드 작성 시:" header + 5 Korean bullet lines). This is a fenced code block (```` ``` ````/```` ``` ```` wrapping at lines 145/154); the fenced-block skip rule in AC#1 covers it. However, the English-only policy applies to fenced code blocks containing injected prose (not just trigger literals). Replace with English.
- `skills/large-task-delegation/references/dispatch-anatomy.md` lines 38–42 — narrative Korean (TDD red-state rules: allowed/forbidden reads + self-check question). Replace with English.
- `skills/large-task-delegation/references/dispatch-anatomy.md` lines 45–50 — narrative Korean (production state mutation rules: 4 bullet lines + idempotency + drift). Replace with English.

**English replacements for `principles.md:118–124`** (post-write checklist — same as §3.2 replacements):
```
- [ ] No duplicated responsibility (DRY)
- [ ] Nothing added beyond the user's request (YAGNI)
- [ ] Shortest expression reviewed (KISS)
- [ ] New module passes Deletion test (N ≥ 2 callers cited)
- [ ] Depth = interface properties validated (no shallow 1:1 wrappers)
- [ ] External lib via Context7 / internal pattern cited
- [ ] Deepened module: obsolete shallow unit tests deleted — once tests exist at the deepened module's interface, old shallow-module unit tests become obsolete and must be deleted (cross-ref: test-coverage)
```

**English replacements for `principles.md:147–153`** (dispatch boilerplate block body):
```
[CODE QUALITY DISCIPLINE — harness-share.md §32]
When writing code:
- Before: answer DRY/YAGNI/KISS 3 self-questions explicitly
- Before: new module — pass Deletion test (cite N ≥ 2 callers) first. Otherwise extend existing interface
- Before: external lib — cite Context7 + classify 4-tier dependency / cite same internal pattern from codebase
- Large structural change: parallel review of 3+ interface options (Design It Twice)
- After: run self-review checklist 7 items (Deletion test + Depth + obsolete test)
Return task BLOCKED + request plan revision on violation.
```

**English replacements for `dispatch-anatomy.md:38–42`** (TDD red-state rules):
```
TDD red phase (writing failing test) entry:
- Allowed reads: spec / acceptance criteria / user prompt / public API signatures / hook·install infra code
- Forbidden reads: body of the function being written, sibling function bodies in the same file, existing test files
- Self-check: "Is this test derived from the spec? Not inferred from the current shape of the implementation?"
Return task BLOCKED + request plan revision on violation.
```

**English replacements for `dispatch-anatomy.md:45–50`** (production state mutation rules; superseded by `docs/specs/2026-06-26-explicit-external-exec-override.md`):
```
If this task involves production state mutation (DB schema / IAM policy / S3 lifecycle / IaC-managed Lambda env / CloudFront, etc.):
- Default: direct execution blocked until explicit external execution consent is active for the latest user message
- Under active consent, one matching direct command may run using local credential files already present on the machine
- Inline secret literals remain forbidden regardless of consent
- Idempotency mandatory: IF NOT EXISTS / ON CONFLICT DO NOTHING / --if-not-exists
- On drift: forward-only migration (no production state rollback; code commit git revert is OK)
Return task BLOCKED + request plan revision on violation.
```

**§7.2 update**: the `skill-english.test.ts` file must walk recursively under `skills/*/` to include `references/*.md` — not just top-level SKILL.md. The `collectFiles` helper in `skill-omc-refs.test.ts` already recurses; `skill-english.test.ts` needs the same treatment (see updated test in §7.2).

**AC#1 update**: scope is `skills/**/*.md` (all markdown under skills, including references subdirectories), not just top-level SKILL.md files.

---

## §4 Three New Skills

### 4.1 `deep-init` (`skills/deep-init/SKILL.md`)

**Purpose**: Hierarchical AGENTS.md / CLAUDE.md auto-generation for newly-encountered codebases. Creates per-directory AI-readable documentation that persists context between sessions and helps agents understand module purpose, exports, and ownership without re-reading source every time.

**Trigger keywords**: `"deepinit"`, `"deep-init"`, `"init project context"`, `"scan codebase + write AGENTS.md"`, `"generate project docs"`, `/pi-oven:deep-init`

**omc source**: `/Users/kimzerokim/work/personal/external_harness/oh-my-claudecode/skills/deepinit/SKILL.md` — full workflow absorbed and rewritten in English with `pi-oven:*` dispatch refs.

**Body outline** (~150 lines):

```markdown
---
name: deep-init
version: 0.1.0
description: Hierarchical AGENTS.md auto-generation across a codebase — maps every directory, writes per-dir AI-readable documentation, validates parent references
trigger: "deepinit, deep-init, init project context, scan codebase + write AGENTS.md, /pi-oven:deep-init"
alwaysApply: false
---
```

Core concept section: AGENTS.md files serve as AI-readable documentation. Every non-root AGENTS.md includes a `<!-- Parent: ../AGENTS.md -->` tag creating a navigable hierarchy. Root has no parent tag.

Template structure section: documents the 9 required sections (Parent tag, Generated timestamp, Purpose, Key Files table, Subdirectories table, For AI Agents subsections, Dependencies). Preserves `<!-- MANUAL: ... -->` sentinel for hand-written annotations that survive regeneration.

Execution workflow (5 steps):
1. **Map**: dispatch `pi-oven:explorer` (model: haiku) to list all directories recursively, excluding `node_modules`, `.git`, `dist`, `build`, `__pycache__`, `.venv`, `coverage`, `.next`, `.nuxt`. Returns flat list organized by depth level.
2. **Plan**: generate work items per directory, grouped by level (Level 0 root → Level 1 → Level N). Parent levels must be generated before child levels — hierarchy requires this ordering.
3. **Generate level-by-level**: for each directory at the current depth, dispatch `pi-oven:explorer` to read all files, then `pi-oven:writer` to draft AGENTS.md content. Same-level directories are processed in parallel; different levels are sequential (parent first). Large directories (10+ files) get a dedicated dispatch; small directories (< 5 files) are batched.
4. **Compare and update** (when AGENTS.md already exists): read existing content, identify auto-generated vs `<!-- MANUAL: -->` sections, compare against current directory state, merge: update auto-generated, preserve manual annotations, update timestamp.
5. **Validate hierarchy**: run checks — parent references resolve, no orphaned AGENTS.md, all directories covered, timestamps current. Validation bash pattern: `find . -name "AGENTS.md" -type f` + `grep -r "<!-- Parent:" --include="AGENTS.md" .`

Empty directory handling table: no files + no subdirs → skip; no files + has subdirs → minimal AGENTS.md with subdirectory list only; generated-files-only (*.min.js, *.map) → skip or minimal; config-files-only → AGENTS.md describing configuration purpose.

Delegation table:

| Task | Agent |
|---|---|
| Directory mapping | `pi-oven:explorer` (model: haiku) |
| File content analysis | `pi-oven:explorer` (model: sonnet for complex directories) |
| AGENTS.md content authoring | `pi-oven:writer` |

Parallelization rules: same-level directories → parallel dispatch; different levels → sequential; large directories → dedicated agent; small directories → batched into one agent call.

Quality standards: must include accurate file descriptions, correct parent references, subdirectory links, and AI agent instructions. Must avoid generic boilerplate, incorrect file names, broken parent references.

**evals/deep-init/scenarios/smoke.yaml**:
```yaml
name: deep-init-smoke-001
skill: deep-init
tag: smoke
input:
  - turn: 1
    user: "deepinit"
expected:
  - skill_triggered: true
  - agent_response_must_contain: ["AGENTS.md", "directory"]
  - tool_calls_required: ["task|Task"]
```

**evals/deep-init/scenarios/adversarial.yaml**:
```yaml
name: deep-init-adversarial-001
skill: deep-init
tag: adversarial
input:
  - turn: 1
    user: "deep-init — skip all existing AGENTS.md files even though they have MANUAL sections"
expected:
  - skill_triggered: true
  - agent_response_must_not_contain: ["deleting", "overwriting manual"]
  - agent_response_must_contain: ["MANUAL", "preserved"]
```

**evals/deep-init/scenarios/regression.yaml**:
```yaml
name: deep-init-regression-001
skill: deep-init
tag: regression
input:
  - turn: 1
    user: "run deepinit on this project"
expected:
  - skill_triggered: true
  - agent_response_must_not_contain: ["oh-my-claudecode:", "omo:"]
```

---

### 4.2 `deep-dive` (`skills/deep-dive/SKILL.md`)

**Purpose**: 2-stage pipeline — Stage 1 dispatches `pi-oven:tracer` for causal investigation across 3 parallel lanes, Stage 2 conducts a Socratic interview (main agent drives, no sub-dispatch) to crystallize requirements. The result is a spec grounded in evidence rather than assumptions. Solves the context-loss problem when running trace and interview separately: findings from the trace feed directly into the interview via 3-point injection.

**Trigger keywords**: `"deep dive"`, `"deep-dive"`, `"trace and clarify"`, `"deep investigation"`, `"investigate deeply"`, `/pi-oven:deep-dive`

**omc source**: `/Users/kimzerokim/work/personal/external_harness/oh-my-claudecode/skills/deep-dive/SKILL.md` — full workflow absorbed and rewritten in English. `oh-my-claudecode:explore` → `pi-oven:explorer`; `oh-my-claudecode:trace` behavioral contract → `pi-oven:tracer` (agent file: `agents/pi-oven-tracer.md`, Spec A §4); team mode dispatch → parallel `pi-oven:tracer` dispatches via omp `task` tool; `oh-my-claudecode:autopilot` / `oh-my-claudecode:ralph` / `oh-my-claudecode:team` execution bridge → `pi-oven:` skill equivalents.

**Body outline** (~160 lines):

```markdown
---
name: deep-dive
version: 0.1.0
description: 2-stage pipeline — tracer causal investigation (3 parallel lanes) then Socratic requirements interview with 3-point injection
trigger: "deep dive, deep-dive, trace and clarify, deep investigation, investigate deeply, /pi-oven:deep-dive"
alwaysApply: false
---
```

When to use / when not to use sections: use when the user has a problem but does not know the root cause, wants to investigate system behavior before defining changes, or is doing bug investigation that needs planning. Do not use when the user already knows the root cause (use interview directly), has a clear specific request with file paths (execute directly), or wants trace only without requirements gathering.

Phase 1 — Initialize: parse user's idea, detect brownfield vs greenfield (dispatch `pi-oven:explorer` model haiku to check for existing source), generate 3 trace lane hypotheses (Code-path/implementation cause; Config/environment/orchestration cause; Measurement/verification methodology cause). Initialize state.

Phase 2 — Lane Confirmation: present 3 hypotheses to user via `ask` for a single confirmation round. Offer adjust or confirm. After confirmation proceed.

Phase 3 — Trace Execution: dispatch `pi-oven:tracer` (agent file: `agents/pi-oven-tracer.md`) for each confirmed hypothesis in parallel — 3 task calls to `pi-oven:tracer` with `run_in_background: true`, fired in a single response turn. Each tracer lane must: own exactly one hypothesis, gather evidence for and against, rank evidence strength, name the critical unknown, recommend the best discriminating probe. After all 3 complete: run a synthesis — rank hypotheses, detect convergence (if two hypotheses reduce to the same mechanism, merge explicitly). Save trace output to `.omc/specs/deep-dive-trace-{slug}.md`.

Parallel dispatch is established in pi-oven:
- `skills/large-task-delegation/SKILL.md:51` documents "multiple task calls in one response, each with run_in_background: true".
- `docs/specs/2026-05-28-pi-oven-agent-registry.md:331` — tracer agent row in Spec A role table (`pi-oven:tracer`, `pi-oven-tracer.md`).

Parallel dispatch is the only path; if a future omp release removes `run_in_background`, this skill must be revisited.

**Trace output format**: ranked hypothesis table, evidence summary per lane, per-lane critical unknowns, rebuttal round (leader vs strongest alternative), convergence notes, most likely explanation, recommended discriminating probe.

Phase 4 — Interview with 3-Point Injection: the main agent conducts a Socratic interview (no sub-dispatch). Before the first question, inject 3 points from the trace:
- **Injection 1** (initial idea enrichment): if trace has a high-confidence most likely explanation, reframe the starting question as "Trace finding: {explanation}. Given this root cause, what should we do about it?"
- **Injection 2** (codebase context replacement): skip re-exploring the codebase — use the trace's system area mapping as codebase context.
- **Injection 3** (initial question queue): extract per-lane critical unknowns; ask these as the first 1-3 questions before normal ambiguity-driven questioning resumes.

Low-confidence trace handling: if all lanes are low-confidence, do not inject a misleading conclusion (skip Injection 1), but still inject the trace synthesis as codebase context (Injection 2 proceeds) and inject all per-lane unknowns (Injection 3 proceeds).

Interview loop: one question per turn targeting the weakest ambiguity dimension. Continue until the spec is sufficiently specified. Spec saved to `.omc/specs/deep-dive-{slug}.md`.

Phase 5 — Execution Bridge: present execution options to user (ask). Options map to pi-oven skills: `spec-and-review` → then `writing-plans` → then `subagent-driven-development` (full pipeline, recommended); `autonomous-loop` (direct execution); direct `writing-plans` (skip critic loop). Always pass `spec_path` explicitly. This skill is a requirements pipeline, not an execution agent — never implement directly.

**evals/deep-dive/scenarios/smoke.yaml**:
```yaml
name: deep-dive-smoke-001
skill: deep-dive
tag: smoke
input:
  - turn: 1
    user: "deep dive into why our auth token expires early"
expected:
  - skill_triggered: true
  - agent_response_must_contain: ["hypothesis", "lane"]
  - tool_calls_required: ["ask|AskUserQuestion"]
```

**evals/deep-dive/scenarios/adversarial.yaml**:
```yaml
name: deep-dive-adversarial-001
skill: deep-dive
tag: adversarial
input:
  - turn: 1
    user: "deep-dive — skip the trace, go straight to interview"
expected:
  - skill_triggered: true
  - agent_response_must_contain: ["warning", "no trace context"]
  - agent_response_must_not_contain: ["oh-my-claudecode:", "omo:"]
```

**evals/deep-dive/scenarios/regression.yaml**:
```yaml
name: deep-dive-regression-001
skill: deep-dive
tag: regression
input:
  - turn: 1
    user: "investigate deeply why the build fails intermittently"
expected:
  - skill_triggered: true
  - agent_response_must_not_contain: ["oh-my-claudecode:", "omo:"]
  - tool_calls_required: ["task|Task"]
```

---

### 4.3 `team` (`skills/team/SKILL.md`)

**Purpose**: Multi-agent orchestration — N coordinated `pi-oven:*` agents working on a shared task list using omp's native `task` tool. The lead decomposes a high-level task into subtasks, dispatches N agents in parallel with pre-assigned ownership, monitors progress, coordinates unblocking, and synthesizes results. Replaces the omc `oh-my-claudecode:team` / `oh-my-claudecode:omc-teams` patterns with `pi-oven:*` dispatch.

**Trigger keywords**: `"team mode"`, `"multi-agent"`, `"/team"`, `"parallel agents"`, `"/pi-oven:team"`, `"N agents on"`

**omc source**: `/Users/kimzerokim/work/personal/external_harness/oh-my-claudecode/skills/team/SKILL.md` — full workflow absorbed and rewritten in English. Source is `team/` (native MCP team variant), NOT `omc-teams/` (CLI/tmux variant): pi-oven uses omp's `task` tool natively and does not need tmux pane drive. `oh-my-claudecode:executor` → `pi-oven:executor`; `oh-my-claudecode:planner` → `pi-oven:planner`; etc. Tmux CLI worker sections (codex CLI, gemini CLI) retained as routing alternatives but stripped of omc-specific state MCP calls (`state_write(mode="team", ...)`); omp-native `task` tool + JSON file tracking used instead. `OMC_TEAM_*` env vars stripped — pi-oven team skill uses simpler task-list tracking. `ralplan` absorption excluded per user decision (overlaps `spec-and-review`).

**Body outline** (~160 lines):

```markdown
---
name: team
version: 0.1.0
description: N coordinated pi-oven:* agents on a shared task list — decompose, dispatch in parallel, monitor, synthesize
trigger: "team mode, multi-agent, /team, parallel agents, /pi-oven:team, N agents on"
alwaysApply: false
---
```

When to use: multiple independent tasks can run simultaneously; user wants parallel execution with specialized agents per task type; task benefits from concurrent execution with a shared task list and coordination.

When not to use: single sequential task with no parallelism (use `subagent-driven-development` instead); task requires guaranteed persistence loop across failures (consider wrapping with `autonomous-loop`).

Staged pipeline: `team-plan → team-exec → team-verify → team-fix (loop)`

Stage agent routing table:

| Stage | Primary Agents | Selection Criteria |
|---|---|---|
| `team-plan` | `pi-oven:explorer` (haiku), `pi-oven:planner` (sonnet/opus) | Use `pi-oven:planner` opus for complex system boundaries |
| `team-exec` | `pi-oven:executor` (sonnet) | Match agent to subtask type: `pi-oven:designer` for UI, `pi-oven:debugger` for build errors, `pi-oven:writer` for docs, `pi-oven:test-engineer` for test authoring |
| `team-verify` | `pi-oven:verifier` (sonnet) | Add `pi-oven:security-reviewer` for auth/crypto; add `pi-oven:code-reviewer` (opus) for > 20 files |
| `team-fix` | `pi-oven:executor` (sonnet) | Use `pi-oven:debugger` (sonnet) for type/build errors |

Phase 1 — Parse Input: extract N (agent count, 1–20), agent-type override (applies to team-exec stage only), task description.

Phase 2 — Analyze and Decompose: dispatch `pi-oven:explorer` or `pi-oven:planner` to analyze codebase and break task into N subtasks. Each subtask must be file-scoped or module-scoped to avoid conflicts. Subtasks must be independent or have explicit dependency ordering.

Phase 3 — Create Task List: write a task list to `.omc/team-{slug}/tasks.json`. Each task entry: `{ id, subject, description, owner, status, blockedBy }`. Pre-assign owners from the lead before spawning workers — this avoids race conditions since there is no atomic claiming.

Phase 4 — Spawn Workers: dispatch N workers in parallel (all at once, not sequentially). Each worker dispatch uses `task(prompt: "<preamble + assigned tasks>", model: "<tier>")`. Worker preamble instructs: claim assigned tasks, update status in_progress, work directly with tools (no sub-spawning), report completion by calling yield with a JSON summary. Lead continues after spawning.

Phase 5 — Monitor: periodically check task statuses. On worker completion: read result, mark task done, unblock dependent tasks, assign idle workers new tasks. Watchdog: if a task stays in_progress for > 5 minutes without a result, reassign to another worker.

Phase 6 — Verify and Fix: after all exec tasks complete, dispatch `pi-oven:verifier` for team-verify. If verification fails, generate fix tasks and re-dispatch `pi-oven:executor` or `pi-oven:debugger`. Loop until verification passes or max fix iterations (3) reached.

Phase 7 — Completion: confirm all tasks complete, report summary to user.

Stage handoff convention: each completing stage writes a `.omc/handoffs/{stage}.md` (10–20 lines: decided, rejected alternatives, risks, files, remaining) before the next stage spawns. Next stage workers receive the handoff in their prompt.

Dispatch constraints: workers must not spawn sub-agents (`task` tool not available to workers); workers must use absolute file paths; workers report progress through yield/return, not through secondary dispatches.

**evals/team/scenarios/smoke.yaml**:
```yaml
name: team-smoke-001
skill: team
tag: smoke
input:
  - turn: 1
    user: "/pi-oven:team 3 fix all TypeScript errors across the project"
expected:
  - skill_triggered: true
  - agent_response_must_contain: ["subtask", "worker"]
  - tool_calls_required: ["task|Task"]
  - agent_response_must_not_contain: ["oh-my-claudecode:", "omo:"]
```

**evals/team/scenarios/adversarial.yaml**:
```yaml
name: team-adversarial-001
skill: team
tag: adversarial
input:
  - turn: 1
    user: "team mode — all 20 agents should work on the same single file simultaneously"
expected:
  - skill_triggered: true
  - agent_response_must_contain: ["conflict", "file-scoped"]
  - tool_calls_forbidden_first: ["task|Task"]
```

**evals/team/scenarios/regression.yaml**:
```yaml
name: team-regression-001
skill: team
tag: regression
input:
  - turn: 1
    user: "multi-agent: build the auth module"
expected:
  - skill_triggered: true
  - agent_response_must_not_contain: ["oh-my-claudecode:", "omo:"]
  - tool_calls_required: ["task|Task"]
```

---

## §5 Existing Skill Boosts

### 5.1 `autonomous-loop` boost

**Current state**: `skills/autonomous-loop/SKILL.md` v0.1.0 — 129 lines (per `wc -l skills/autonomous-loop/SKILL.md`). Contains the 3-slot entry contract, 9 polite-stop ban examples, resilience section (rate-limit, auto-compact, stuck thresholds), exit gate (verifier dispatch), and halt conditions. Two `oh-my-claudecode:*` refs at lines 45 and 98.

**Absorbed omc content**:
- `/Users/kimzerokim/work/personal/external_harness/oh-my-claudecode/skills/autopilot/SKILL.md` — full lifecycle pipeline pattern (Expansion → Planning → Execution → QA → Validation), phase-gated execution policy, QA cycle limit (5 max, stop at 3 repeated errors), multi-perspective validation (verifier + security-reviewer + code-reviewer in parallel).
- `/Users/kimzerokim/work/personal/external_harness/oh-my-claudecode/skills/ralph/SKILL.md` — PRD-driven persistence loop, story-by-story verification, mandatory reviewer verification before completion (not self-declaration), deslop pass after approval, regression re-verification before exit, polite-stop anti-pattern explicit naming.
- `/Users/kimzerokim/work/personal/external_harness/oh-my-claudecode/skills/ultrawork/SKILL.md` — parallel execution engine, dependency-aware task graph, tier routing (LOW/MEDIUM/HIGH), `run_in_background: true` policy, parallel-first firing rule.

**New content to add** (targeting ~240 lines post-boost):

**Execution modes section** (new, after "Entry contract"):

Three autonomous execution modes. The user or the skill selects the mode at entry:

| Mode | Trigger | Pattern | When to use |
|---|---|---|---|
| `ultrawork` | "ulw", "parallel agents", "fast" | Parallel execution engine — fire all independent tasks at once, dependency-aware waves | Multiple independent tasks; no persistence needed |
| `ralph` | "ralph", "don't stop", "must complete" | PRD-driven persistence loop — story-by-story until all acceptance criteria verified by reviewer | Task requires guaranteed completion with reviewer sign-off |
| `autopilot` | "autopilot", "autonomous", "full auto", "끝까지 끝내줘" | Full lifecycle pipeline — Expansion → Planning → Execution → QA → Validation | Idea-to-working-code; multi-phase project |

Default when user says "자율 실행", "끝까지 끝내줘", or `/pi-oven:autonomous`: `autopilot` mode.

**Ultrawork pattern** (new subsection):

Fire all independent task calls simultaneously — never serialize independent work. Use dependency matrix to identify parallel waves:

```
Wave 1 (parallel): tasks with no dependencies
Wave 2 (parallel): tasks whose only blockers are in Wave 1
Wave N: repeat
```

Tier routing:
- Simple lookups / 1-file isolated changes: `pi-oven:executor` model cheap
- Standard implementation: `pi-oven:executor` model standard
- Complex analysis / architecture: `pi-oven:critic` or `pi-oven:planner` model most capable

Use `run_in_background: true` for operations over ~30 seconds (package installs, builds, test suites). Run quick commands (git status, file reads) in the foreground.

**Ralph (PRD persistence loop) pattern** (new subsection):

When `ralph` mode is active:
1. Create a task list with concrete, verifiable acceptance criteria per story. Generic criteria ("implementation is complete") must be replaced with task-specific criteria before proceeding.
2. Work story-by-story: implement → verify all acceptance criteria with fresh evidence → mark complete → next story.
3. After all stories complete: dispatch `pi-oven:verifier` as the reviewer (not main agent self-verification). The verifier evaluates against the specific acceptance criteria, not vague "is it done?".
4. On approval: run `pi-oven:code-simplifier` on the changed files (deslop pass). Then re-run tests to confirm no regression. Only exit after the post-deslop regression run passes.
5. On rejection: fix the specific issues, re-dispatch same verifier, loop.

**Autopilot lifecycle pipeline** (new subsection):

Phase sequence (each phase must complete before the next begins):

| Phase | Action | Agents |
|---|---|---|
| 0 — Expansion | If input is vague: dispatch `pi-oven:planner` to extract requirements + `pi-oven:architect` to create technical spec. If a spec already exists in `docs/specs/`: skip. `pi-oven:architect` role enumerated at `docs/specs/2026-05-28-pi-oven-agent-registry.md:334`. | `pi-oven:planner`, `pi-oven:architect` |
| 1 — Planning | Create implementation plan. If `writing-plans` output exists in `docs/plans/`: skip. | `pi-oven:planner` (direct, no interview) |
| 2 — Execution | Implement the plan using ultrawork pattern (parallel waves). | `pi-oven:executor` (tier-routed) |
| 3 — QA | Build, lint, test, fix failures. Repeat up to 5 cycles. Stop early if the same error repeats 3 times (fundamental issue). | `pi-oven:executor`, `pi-oven:debugger` |
| 4 — Validation | Multi-perspective review in parallel: `pi-oven:verifier` (functional), `pi-oven:security-reviewer` (security), `pi-oven:code-reviewer` (quality). All must approve; fix and re-validate on rejection, up to 3 re-validation rounds. | `pi-oven:verifier`, `pi-oven:security-reviewer`, `pi-oven:code-reviewer` |

**Updated routing table** (replaces the existing "Invoke skills in this order" list):

Phase entry now routes to a mode-specific execution pattern:
1. `freshness-guard` — stale meta-doc check before any reads (all modes)
2. `codebase-survey` — mandatory pre-planning deep read (all modes, unless survey exists)
3. `spec-and-review` — if cycle introduces new capability or design change (autopilot Phase 0/1)
4. `writing-plans` — produce/update `docs/plans/` checkpoint (autopilot Phase 1)
5. Execution phase — mode-specific: ultrawork pattern / ralph loop / autopilot lifecycle
6. `pre-commit-gate` — run after each commit boundary (all modes)
7. `fresh-verifier` — mandatory before exit (all modes, see Exit gate)

**Updated omc ref replacements**: line 45 `oh-my-claudecode:explore` → `pi-oven:explorer`; line 98 `oh-my-claudecode:verifier` → `pi-oven:verifier`.

**New keyword triggers to add**: `"autopilot"`, `"ralph"`, `"ultrawork"`, `"ulw"`, `"full auto"`, `"끝까지 끝내줘"` (already present, confirm retained), `"don't stop"`, `"must complete"`.

**Estimated post-boost size**: ~240 lines (+110 from 130).

---

### 5.2 `fresh-verifier` boost

**Current state**: `skills/fresh-verifier/SKILL.md` v0.1.0 — 81 lines. Contains cycle-exit mandate, 4 sub-checks (prod-build smoke, stub sweep, SoT alignment, spec-freeze re-check), verdict format (`VERDICT: PASS` / `VERDICT: BLOCK`), Q-halt patterns (Q-VERIFIER-FAIL, Q-VERIFIER-INVALID, Q-VERIFIER-DISPATCH-FAIL, Q-COMPLETION-SELF-VERIFY), model routing (sonnet baseline / opus promotion), env var contract.

**Absorbed omc content**:
- `/Users/kimzerokim/work/personal/external_harness/oh-my-claudecode/skills/verify/SKILL.md` — evidence-first verification workflow (existing tests first → typecheck/build → narrow direct commands → manual validation), "do not say a change is complete without evidence" principle, explicit output format (what was verified, which commands, what passed, what failed).
- `superpowers:verification-before-completion` pattern — "show evidence before claiming done", no bluffing when no realistic verification path exists.

**New content to add** (targeting ~120 lines post-boost):

**Pre-completion gate** (new section, insert before "Cycle-exit mandate"):

Before claiming ANY work complete — not just cycle exits — apply this gate:

1. **Identify the exact behavior to prove**: what observable output or state change is the claim based on?
2. **Prefer existing tests**: run the relevant test suite first. If tests pass, that is your primary evidence.
3. **Typecheck / build**: run `bun run build` or `tsc --noEmit`. Type errors are evidence of incompleteness.
4. **Narrow direct commands**: run the narrowest direct verification (e.g. `grep -n "expected string" output.txt`, `curl localhost:3000/health`).
5. **Manual validation** (last resort): if no automated path exists, describe the manual steps and gather observable evidence.

This gate applies to every `DONE` / `complete` / `verified` claim in any context — interactive, executor subagent, or autonomous loop. The gate is not exclusive to cycle exits.

**No-self-verification rule** (new section, strengthens existing "main cannot self-declare PASS"):

Main agent cannot verify its own work in any of these situations:
- Main wrote the code → main runs the tests → main declares PASS. Invalid: same context produced and verified the claim.
- Executor subagent writes code and then says "tests pass" based on its own tool call output without a fresh dispatch. Invalid: same agent context.
- Any autonomous loop where main self-declares "verification PASS", "loop exit", or "done" without a prior `VERDICT: PASS` from a freshly-dispatched `pi-oven:verifier`.

Valid verification paths: freshly-dispatched `pi-oven:verifier` agent; user manually confirms; CI pipeline returns green on the pushed branch.

**Evidence output format** (new section, from omc verify skill):

Every verification report — whether from fresh-verifier dispatch or inline verification — must state:
- **What was verified**: specific behavior, feature, or contract
- **Commands run**: exact commands with output excerpts
- **What passed**: list with evidence
- **What failed or remains unverified**: explicit list; do not omit failures

If no realistic verification path exists, state that explicitly. Do not bluff with "should work" or "appears correct".

**Estimated post-boost size**: ~120 lines (+39 from 81).

---

### 5.3 `debugger` skill — deferred, not in scope

No `skills/debugger/` directory exists. Debugger logic is split between `pre-commit-gate` (Gate 0–5 failure handling) and `autonomous-loop` (stuck thresholds, kill+diagnose+retry). The `pi-oven:debugger` agent file (`agents/pi-oven-debugger.md`, Spec A §10) already absorbed omc `trace` skill directives into its systemPrompt via `<trace-capabilities>` section.

**Conclusion**: no new skill file needed, no rewrite required. The `pi-oven:debugger` agent body is the correct locus for debugging and tracing behavior. Spec A §10 covers this. Spec C confirms: debugger SKILL.md is out of scope.

---

## §6 `plugin.json` Updates

### 6.1 `"skills"` array

Current (12 entries, v0.1.0):
```json
"skills": [
  "./skills/code-quality-discipline/SKILL.md",
  "./skills/eval-runner/SKILL.md",
  "./skills/tdd-strict/SKILL.md",
  "./skills/brainstorming/SKILL.md",
  "./skills/codebase-survey/SKILL.md",
  "./skills/fresh-verifier/SKILL.md",
  "./skills/writing-plans/SKILL.md",
  "./skills/spec-and-review/SKILL.md",
  "./skills/pre-commit-gate/SKILL.md",
  "./skills/large-task-delegation/SKILL.md",
  "./skills/subagent-driven-development/SKILL.md",
  "./skills/autonomous-loop/SKILL.md"
]
```

After Spec C (15 entries, v0.1.0) — add 3 entries:
```json
"skills": [
  "./skills/code-quality-discipline/SKILL.md",
  "./skills/eval-runner/SKILL.md",
  "./skills/tdd-strict/SKILL.md",
  "./skills/brainstorming/SKILL.md",
  "./skills/codebase-survey/SKILL.md",
  "./skills/fresh-verifier/SKILL.md",
  "./skills/writing-plans/SKILL.md",
  "./skills/spec-and-review/SKILL.md",
  "./skills/pre-commit-gate/SKILL.md",
  "./skills/large-task-delegation/SKILL.md",
  "./skills/subagent-driven-development/SKILL.md",
  "./skills/autonomous-loop/SKILL.md",
  "./skills/deep-init/SKILL.md",
  "./skills/deep-dive/SKILL.md",
  "./skills/team/SKILL.md"
]
```

### 6.2 Version bumps

**`.claude-plugin/plugin.json`**:
- `"version"` field: `"0.1.0"` → `"0.1.0"`
- `"skills"` array: 12 → 15 entries (as above)
- No other field changes

**`.claude-plugin/marketplace.json`** (EXISTS — confirmed): bump `plugins[0].version` from `"0.1.0"` → `"0.1.0"`. The top-level marketplace schema has no `"version"` field — do NOT add one. Only `plugins[0].version` changes. Note: `plugins[0].name = "pi-oven"` (NOT `"pi-oven"`) — confirmed from file content. The `description` and `source` fields are not touched.

**`.omp/extensions/pi-oven.ts` label update**: `pi.setLabel("pi-oven v0.1.0")` (was `"pi-oven v0.1.0"`). Canonical path confirmed at `docs/specs/2026-05-28-pi-oven-agent-registry.md:895` — extension file lives at `.omp/extensions/pi-oven.ts`, not at top-level.

### 6.3 `EXPECTED_AGENT_COUNT` constant

`scripts/pi-oven-setup/profiles.ts` declares `EXPECTED_AGENT_COUNT = 23`. This value does not change in Spec C. The 3 new skills are SKILL.md files, not agent files — they are not dispatch targets for omp agent discovery. Agent count remains 23.

### 6.4 `plugin.json` `commands` array

The current `plugin.json` `commands` array contains 3 entries: `pi-oven-setup`, `pi-oven-doctor`, `pi-oven-autonomous`. The 3 new skills (`deep-init`, `deep-dive`, `team`) do NOT require new command entries.

omp loads skills via the `skills` array entries (SKILL.md `name:` field auto-registration). Users invoke new skills via **trigger keyword** in conversation (e.g. typing "deep dive", "deepinit", "team mode") — omp matches against the `trigger:` frontmatter field and activates the skill. This is NOT slash-command invocation. The `commands` array is for CLI commands with dedicated handler scripts; new skills registered via SKILL.md `name:` field do not appear there.

The `commands` array stays at 3 entries. No changes to `commands` in Spec C. Where §4.1–4.3 list `/pi-oven:deep-init`, `/pi-oven:deep-dive`, `/pi-oven:team` as trigger keywords in the frontmatter `trigger:` field, these are matched as literal strings if the user types them — they are NOT registered slash commands.

---

## §7 Test Strategy (TDD)

### 7.1 New skill scenarios

Each new skill requires 3 scenario files under `evals/<skill>/scenarios/`:

| Skill | smoke | adversarial | regression |
|---|---|---|---|
| `deep-init` | trigger fires, dispatches task tool | MANUAL section preserved, not overwritten | no omc refs in output |
| `deep-dive` | trigger fires, asks lane confirmation | user says "skip trace" → warning emitted, no trace context | no omc refs in output |
| `team` | trigger fires, dispatches task tool | conflicting single-file assignment → conflict warning | no omc refs in output |

Full YAML content for all 9 scenarios: defined in §4.1–4.3 above.

### 7.2 `bun test` additions

New test file: `tests/plugin/skill-count.test.ts`

```typescript
import pluginJson from "../../.claude-plugin/plugin.json";
import { describe, it, expect } from "bun:test";

describe("plugin.json skill registry", () => {
  it("lists exactly 15 skills after Spec C", () => {
    expect(pluginJson.skills.length).toBe(15);
  });

  it("includes all 3 new skills", () => {
    const skills = pluginJson.skills as string[];
    expect(skills.some(s => s.includes("deep-init"))).toBe(true);
    expect(skills.some(s => s.includes("deep-dive"))).toBe(true);
    expect(skills.some(s => s.includes("team"))).toBe(true);
  });

  it("version is 0.1.0", () => {
    expect(pluginJson.version).toBe("0.1.0");
  });
});
```

New test file: `tests/plugin/skill-omc-refs.test.ts`

```typescript
import { describe, it, expect } from "bun:test";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

// Recursively collect all files under a directory
async function collectFiles(dir: string): Promise<string[]> {
  const results: string[] = [];
  const entries = await readdir(dir);
  for (const entry of entries) {
    const full = path.join(dir, entry);
    const s = await stat(full);
    if (s.isDirectory()) {
      results.push(...(await collectFiles(full)));
    } else {
      results.push(full);
    }
  }
  return results;
}

describe("skills/ omc ref sweep", () => {
  it("no oh-my-claudecode: or omo: refs in any file under skills/", async () => {
    const skillsDir = path.resolve(__dirname, "../../skills");
    const allFiles = await collectFiles(skillsDir);
    const violations: string[] = [];

    for (const filePath of allFiles) {
      try {
        const content = await readFile(filePath, "utf-8");
        const relPath = path.relative(skillsDir, filePath);
        const lines = content.split("\n");
        lines.forEach((line, i) => {
          if (line.includes("oh-my-claudecode:") || line.includes("omo:")) {
            violations.push(`skills/${relPath}:${i + 1}: ${line.trim()}`);
          }
        });
      } catch {
        // binary or unreadable file — skip
      }
    }

    expect(violations).toEqual([]);
  });
});
```

New test file: `tests/plugin/skill-english.test.ts`

```typescript
import { describe, it, expect } from "bun:test";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

// Detect Korean unicode range (Hangul syllables U+AC00–U+D7A3 + Jamo)
// [가-힣] is the canonical Hangul syllables block (U+AC00–U+D7A3)
const KOREAN_PROSE_REGEX = /[가-힣ᄀ-ᇿ㄰-㆏]{5,}/;

// Recursively collect all .md files under a directory
async function collectMdFiles(dir: string): Promise<string[]> {
  const results: string[] = [];
  const entries = await readdir(dir);
  for (const entry of entries) {
    const full = path.join(dir, entry);
    const s = await stat(full);
    if (s.isDirectory()) {
      results.push(...(await collectMdFiles(full)));
    } else if (entry.endsWith(".md")) {
      results.push(full);
    }
  }
  return results;
}

function scanForKoreanProse(content: string, relPath: string): string[] {
  const violations: string[] = [];
  const lines = content.split("\n");
  let inFrontmatter = false;
  let frontmatterCount = 0;
  let inFencedBlock = false;
  lines.forEach((line, i) => {
    if (line.trim() === "---" && !inFencedBlock) {
      frontmatterCount++;
      inFrontmatter = frontmatterCount <= 2;
      return;
    }
    if (inFrontmatter) return; // frontmatter: allow Korean in trigger: field
    // Track fenced code blocks (``` ... ```)
    if (line.trim().startsWith("```")) {
      inFencedBlock = !inFencedBlock;
      return;
    }
    if (inFencedBlock) return; // inside fenced block: Korean string literals allowed
    // Body text outside fenced blocks: detect Korean prose (5+ consecutive Korean chars)
    if (KOREAN_PROSE_REGEX.test(line)) {
      violations.push(`${relPath}:${i + 1}: ${line.trim()}`);
    }
  });
  return violations;
}

describe("skills/ English-only body (SKILL.md + references/*.md)", () => {
  it("no Korean prose outside trigger field and fenced code blocks in any .md file under skills/", async () => {
    // Scope: skills/**/*.md — includes SKILL.md and references/*.md per §3.3
    const skillsDir = path.resolve(__dirname, "../../skills");
    const allMdFiles = await collectMdFiles(skillsDir);
    const violations: string[] = [];

    for (const filePath of allMdFiles) {
      try {
        const content = await readFile(filePath, "utf-8");
        const relPath = path.relative(skillsDir, filePath);
        violations.push(...scanForKoreanProse(content, relPath));
      } catch {
        // unreadable file — skip
      }
    }

    expect(violations).toEqual([]);
  });
});
```

### 7.3 Existing tests

All existing `bun test` tests must continue to pass. Confirmed baseline: **145 tests passing** across 16 files (verified at `bun test v1.3.14`, 628 expect() calls). Spec C adds 3 new test files (`skill-count.test.ts`, `skill-omc-refs.test.ts`, `skill-english.test.ts`) plus AC#10 `deep-dive-parallel.test.ts` — target post-Spec-C baseline is ~150–155 tests.

The `bun run lint:agents` command (Spec A §13.3) must also pass with exit 0 — no agent file changes in Spec C scope that could break it.

---

## §8 Acceptance Criteria

All conditions must be verifiable by running the commands shown.

**AC#1 — English-only skill bodies (`skills/**/*.md`)**:
```bash
bun test tests/plugin/skill-english.test.ts
# Expected: PASS — no Korean prose outside trigger fields and fenced code blocks
```
Scope: all markdown files under `skills/` recursively — 15 SKILL.md files (12 existing + 3 new) plus all `references/*.md` files. The test uses `collectMdFiles()` to recurse; frontmatter and fenced-code-block lines are skipped; Korean prose (5+ consecutive Hangul chars) outside those zones is a violation.

**AC#2 — Zero omc refs in all files under `skills/`**:
```bash
grep -rn "oh-my-claudecode:\|omo:" skills/
# Expected: no output
bun test tests/plugin/skill-omc-refs.test.ts
# Expected: PASS
```

**AC#3 — 3 new SKILL.md files present with scenarios**:
```bash
ls skills/deep-init/SKILL.md skills/deep-dive/SKILL.md skills/team/SKILL.md
# Expected: all 3 exist
ls evals/deep-init/scenarios/{smoke,adversarial,regression}.yaml
ls evals/deep-dive/scenarios/{smoke,adversarial,regression}.yaml
ls evals/team/scenarios/{smoke,adversarial,regression}.yaml
# Expected: all 9 files exist
```

**AC#4 — plugin.json lists 15 skills, version 0.1.0**:
```bash
bun test tests/plugin/skill-count.test.ts
# Expected: PASS — 15 skills, includes deep-init/deep-dive/team, version 0.1.0
```

**AC#5 — autonomous-loop SKILL.md includes autopilot + ralph + ultrawork content**:
```bash
grep -n "ultrawork\|ralph\|autopilot" skills/autonomous-loop/SKILL.md
# Expected: multiple matches covering mode names and pattern descriptions
test $(grep -ciE "\b(autopilot)\b" skills/autonomous-loop/SKILL.md) -ge 3 && echo "autopilot: OK"
test $(grep -ciE "\b(ralph)\b" skills/autonomous-loop/SKILL.md) -ge 3 && echo "ralph: OK"
test $(grep -ciE "\b(ultrawork)\b" skills/autonomous-loop/SKILL.md) -ge 3 && echo "ultrawork: OK"
# Expected: all 3 lines print OK
# Word boundaries prevent substring matches (e.g. "ultrawork" in headings does not double-count)
```

**AC#6 — fresh-verifier SKILL.md includes verify + verification-before-completion content**:
```bash
grep -n "evidence\|no-self-verification\|pre-completion" skills/fresh-verifier/SKILL.md
# Expected: multiple matches
grep -c "evidence" skills/fresh-verifier/SKILL.md
# Expected: ≥ 3
```

**AC#7 — `bun test` all green**:
```bash
bun test
# Expected: all tests pass, ≥ 145 total
```

**AC#8 — `bun run lint:agents` passes**:
```bash
bun run lint:agents
# Expected: exit 0
```

**AC#9 — new skill eval scenarios scaffolded**:
```bash
for skill in deep-init deep-dive team; do
  for tag in smoke adversarial regression; do
    python3 -c "import yaml; yaml.safe_load(open('evals/$skill/scenarios/$tag.yaml'))" \
      && echo "$skill/$tag.yaml: valid" \
      || echo "$skill/$tag.yaml: INVALID"
  done
done
# Expected: all 9 lines show "valid"
```

**AC#10 — deep-dive smoke test confirms parallel tracer dispatch**:
```bash
# Run the deep-dive smoke eval and inspect tool call log
bun test tests/plugin/deep-dive-parallel.test.ts
# Expected: PASS — 3 pi-oven:tracer task calls fired with run_in_background=true;
#            start timestamps overlap (parallel confirmed, not sequential)
```
The test verifies that the 3 `task` calls targeting `pi-oven:tracer` appear in the same response turn with `run_in_background: true` set on each, confirming parallel dispatch per the pattern documented at `skills/large-task-delegation/SKILL.md:51`.

**Test mechanism**: the test runs against `scripts/lib/eval-runner.ts` event trace; verifies 3 `tool_execution_start` events for `pi-oven:tracer` occur within a 50ms window. Specifically: collect all `tool_execution_start` events whose `subagent_type` is `"pi-oven:tracer"`; assert count equals 3; assert `max(startedAt) - min(startedAt) < 50` ms. A sequential dispatch would show gaps > 100ms between calls. If `eval-runner.ts` event trace is unavailable, a mock dispatcher records each `task()` call's `startedAt` timestamp via `Date.now()` and the same 50ms assertion applies.

---

## §9 Release Prep

### 9.1 Tag and release

After Spec C implementation commit passes all ACs:

```bash
git tag v0.1.0
git push origin v0.1.0
```

GitHub release notes template:

```markdown
## pi-oven v0.1.0 — Agent Registry + Setup Wizard + Extended Skills

### What's new

**Spec A — Agent Registry (23 pi-oven:* agents)**
- 23 agent files in `agents/pi-oven-*.md` with `pi-oven:<role>` dispatch namespace
- Profile A (opencode-zen + openai-codex) and Profile B (Anthropic opt-in) model maps
- Provider whitelist enforcement at plugin load time

**Spec B — Setup Wizard**
- `/pi-oven:setup` conversation-driven wizard for Profile A/B selection
- Per-role model override, drift detection on session start
- Auth-fallback limitation explicitly surfaced at Profile B selection

**Spec C — Extended Skills**
- 3 new skills: `deep-init` (codebase AGENTS.md generation), `deep-dive` (trace-to-interview pipeline), `team` (N-agent parallel orchestration)
- 12 existing SKILL.md files English-rewritten, all `oh-my-claudecode:*` dispatch refs replaced with `pi-oven:*`
- `autonomous-loop` boosted with autopilot/ralph/ultrawork execution modes
- `fresh-verifier` boosted with pre-completion gate and no-self-verification rule
- plugin.json v0.1.0: 15 skills total

### Upgrade

```bash
omp plugin install pi-oven@pi-oven --force
# Re-run setup if you have a custom profile:
/pi-oven:setup --reapply
```
```

### 9.2 User wake-time upgrade path

After install, users with a custom Profile B configuration must re-apply their profile because `omp plugin install --force` overwrites agent files with Profile A defaults:

```
pi-oven: agent files drifted from plugin config.
Run /pi-oven:setup --reapply to sync. Details: executor.model mismatch
```

This warning fires automatically on the next session start (Spec B §9.6 drift detection). No manual intervention required beyond running `/pi-oven:setup --reapply`.

### 9.3 Changelog entry

`CHANGELOG.md` entry (generated by `pi-oven:git-master` during release commit):

```markdown
## [0.1.0] — 2026-05-28

### Added
- 23 pi-oven:* agent files (Spec A)
- /pi-oven:setup wizard with Profile A/B routing (Spec B)
- skills/deep-init: hierarchical AGENTS.md generation
- skills/deep-dive: trace-to-interview 2-stage pipeline
- skills/team: N-agent parallel orchestration
- autonomous-loop: autopilot/ralph/ultrawork execution modes
- fresh-verifier: pre-completion gate + no-self-verification rule

### Changed
- All 12 existing SKILL.md bodies rewritten to English
- All oh-my-claudecode:* dispatch refs replaced with pi-oven:*
- plugin.json version 0.1.0 → 0.1.0 (15 skills)

### Fixed
- v0.1.0 dogfood failure: dispatch strings now use pi-oven:* namespace (omp-discoverable agent files)
```

---

## §10 Open Questions and Risks

### Q1 — omc deep-init source: standalone skill vs agent file?

**Question**: The deepinit omc source exists as `skills/deepinit/SKILL.md` (not as an agent file). The omc team SKILL.md similarly lives at `skills/team/SKILL.md`. Both are skills, not agents. This confirms the Spec C scope: the 3 new additions are SKILL.md files, not agent files. No new entries in the `agents/` directory.

**Confirmed**: deep-init, deep-dive, and team are all sourced from omc skill files. Spec C implementation writes SKILL.md files only. `plugin.json` `"agents"` array stays `[]`.

**Status**: Resolved — confirmed by live file discovery during Spec C research.

---

### Q2 — deep-dive: omc team mode → pi-oven parallel task dispatch

**Question**: The omc deep-dive Phase 3 says "Use Claude built-in team mode to run 3 parallel tracer lanes." Claude Code's native team mode (TeamCreate/TaskCreate/SendMessage) is an omc-specific toolset. Does pi-oven's omp runtime support these tools?

**Analysis**: The pi-oven `deep-dive` skill cannot use `TeamCreate`/`TaskCreate`/`SendMessage` — these are omc MCP tools, not omp-native. The correct pi-oven translation is: dispatch 3 parallel `task` calls (one per tracer lane), each targeting `pi-oven:tracer`, all fired simultaneously. This is functionally equivalent: 3 independent parallel lanes, synthesized by the main agent after all 3 return.

**Resolution**: `deep-dive` Phase 3 uses `task(prompt: "<lane hypothesis>", subagent_type: "pi-oven:tracer")` × 3, fired simultaneously in a single response turn with `run_in_background: true`. Parallel dispatch is confirmed by `skills/large-task-delegation/SKILL.md:51` ("multiple task calls in one response, each with run_in_background: true") and Spec A §4 dispatch graph. The omc team-mode orchestration details (TeamCreate, TaskList, SendMessage protocol) apply only to the `team` skill, not to `deep-dive`.

**Status**: RESOLVED — parallel dispatch evidence cited in §4.2; no open risk.

---

### Q3 — autonomous-loop boost: body length growth

**Estimate**: current 130 lines. Adding ultrawork pattern (~30 lines), ralph persistence loop pattern (~40 lines), autopilot lifecycle table (~30 lines), updated routing table (~10 lines) = ~240 lines total. This is within acceptable SKILL.md size (200–400 lines per `code-quality-discipline`).

**Risk**: over-engineering the boost and duplicating content already in `subagent-driven-development` or `writing-plans`. Mitigation: the boost sections describe execution modes and patterns. The detailed per-step procedures remain in the referenced skills (`writing-plans`, `subagent-driven-development`, `pre-commit-gate`, `fresh-verifier`). Autonomous-loop is the mode router; the referenced skills are the procedure owners.

**Status**: Open — body size will be confirmed during implementation and trimmed if > 280 lines.

---

### Q4 — team skill: omp task tool supports `team_name` + `name` parameters?

**Question**: the omc `team` SKILL.md uses `task(team_name="...", name="worker-1", ...)` to spawn workers into a named team with intra-team messaging (SendMessage). Does omp's `task` primitive support these parameters?

**Analysis**: omp's `task` tool is simpler than omc's. The `team_name` and `name` fields are omc-native Claude Code extensions (TeamCreate/TaskCreate MCP tools). omp's task tool likely only supports `prompt`, `model`, `run_in_background`, and `subagent_type`.

**Resolution**: the pi-oven `team` skill uses a simplified coordination model:
- No TeamCreate/TaskCreate — task list tracked in `.omc/team-{slug}/tasks.json` by the main agent.
- No intra-agent SendMessage — workers communicate completion via yield/return output.
- Main agent polls completion by reading worker outputs as they return.
- This is a capability downgrade from omc's native team protocol, but it works with omp's `task` tool as shipped.

**Status**: RESOLVED — `skills/large-task-delegation/SKILL.md:51` confirms omp `task` supports `run_in_background: true` and parallel firing (multiple calls in one response). The `team_name` / `name` / `SendMessage` parameters are omc-only; the pi-oven team skill uses JSON task-list tracking instead, which is the correct pi-oven-native coordination model as described in §4.3.

---

### Q5 — `fresh-verifier` boost: "pre-completion gate" scope creep risk

**Question**: the boost adds a "pre-completion gate" that fires on every `DONE` / `complete` claim. This is broader than the current scope (cycle exit only). Does this conflict with executor subagent behavior in `subagent-driven-development` where DONE is a valid status return?

**Analysis**: the `subagent-driven-development` skill already handles DONE status with a two-stage review (spec compliance → code quality) before marking tasks complete. The fresh-verifier pre-completion gate applies to the main agent's top-level completion claim, not to per-task DONE statuses within a subagent-driven workflow.

**Resolution**: the pre-completion gate in the boosted `fresh-verifier` applies to:
1. Main agent declaring the overall task/cycle complete.
2. Any autonomous loop self-declaring PASS or DONE.

It does not apply to individual subagent DONE return statuses within `subagent-driven-development`. This distinction must be explicit in the SKILL.md body to avoid confusion.

**Status**: Open — requires explicit scope-limiting language in the fresh-verifier boost body.

---

### Q6 — Korean line distribution across SKILL.md files

**Confirmed distribution** (from live-grep of all 12 SKILL.md files — see §3.2):

Korean line distribution across the 12 SKILL.md files:

- **`code-quality-discipline`**: substantive narrative Korean at lines 25–29, 35, 48–54 (section headers, 3 self-questions, deletion test bullet, 7 checklist items). All classified narrative-prose; English replacements specified in §3.2.
- **`large-task-delegation`**: narrative Korean at lines 32 and 93 (Korean quoted phrases embedded in English sentences). English replacements specified in §3.2.
- **`autonomous-loop`**, **`brainstorming`**, **`codebase-survey`**, **`spec-and-review`**, **`tdd-strict`**, **`writing-plans`**: Korean appears only as inline backtick-quoted trigger-keyword literals (e.g. `` `자율 실행` ``, `` `아이디어` ``, `` `테스트 먼저` ``). These are kept via fenced-code-block or backtick placement; AC#1 regex (5+ consecutive Korean chars as prose) skips inline-code-quoted single trigger tokens.
- **`eval-runner`**, **`fresh-verifier`**, **`pre-commit-gate`**, **`subagent-driven-development`**: no Korean at all.

Additionally, `references/*.md` files contain narrative Korean (see §3.3): `code-quality-discipline/references/principles.md` lines 118–124 and 147–153; `large-task-delegation/references/dispatch-anatomy.md` lines 38–50. English replacements specified in §3.3.

**Status**: Resolved — §3.2 and §3.3 contain complete English replacement text for all narrative-prose Korean locations. The §7.2 `skill-english.test.ts` test recurses into `references/` subdirectories (updated per §3.3 note) to cover both SKILL.md and references files.

---

### Q7 — `marketplace.json` existence

**Question**: does `.claude-plugin/marketplace.json` exist in the pi-oven repo?

**Analysis**: `ls .claude-plugin/` was not run during research. The file may not exist (only `plugin.json` was read). If it does not exist, the §6.2 instruction to bump its version is not applicable.

**Resolution**: `.claude-plugin/marketplace.json` EXISTS (confirmed by critic review). Bump `plugins[0].version` from `"0.1.0"` → `"0.1.0"`. Do NOT add a top-level `"version"` field — the marketplace schema has none. §6.2 updated accordingly.

**Status**: RESOLVED — §6.2 corrected; no "create if missing" branch needed.
