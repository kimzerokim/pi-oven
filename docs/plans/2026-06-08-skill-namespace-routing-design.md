> Historical; do not copy runtime syntax examples from this document.

# Design — skill:// namespace routing fix + sibling-skill governance

> Status: LOCKED (brainstorming-confirmed). Codex-reviewable.
> Date: 2026-06-09 (cycle 3 — codex cycle-2 incorporated; §3.7 descoped)
> Cycle-1 codex verdict: docs/research/codex-reviews/skill-namespace-routing-critic-review.md
> Cycle-2 codex verdict: docs/research/codex-reviews/skill-namespace-routing-critic-review-2.md
> Required reading: `docs/harness/surveys/2026-06-08-skill-namespace-routing-survey.md`
> Topic: pi-oven brainstorming/spec requests load `superpowers:*` skills instead of
> pi-oven's; subagents dispatched as `kzk:<role>`. Both trace to one root cause +
> two governance gaps.

## 1. Root cause (survey-verified, with evidence)

The omp marketplace (`claude-plugins`) discovery provider **namespaces every plugin
skill** as `<plugin>:<skill>`:

- `node_modules/@oh-my-pi/pi-coding-agent/src/discovery/claude-plugins.ts:121`
  — `if (root.plugin) skill.name = `${root.plugin}:${skill.name}`;`
- `root.plugin` = plugin manifest name (`plugin-dir-roots.ts:23`), always `pi-oven`
  (`.claude-plugin/plugin.json` name). True for marketplace install AND local
  `--plugin-dir`. So pi-oven skills register as **`pi-oven:brainstorming`**.

The injection side emits the **bare** name:
- `skill-keyword-loader.ts:360` -> `skill://${skill.name}` (bare `brainstorming`)
- `pi-oven.ts:495` autonomous reminder -> `skill://${name}` (bare)
- `gate.ts:170` gate "must read" message -> `skill://${name}` (bare)
- `rules-injector.ts:214,220` conduct -> `read("skill://<name>")` (bare)

The `read` tool resolver is **exact-match only** (`internal-urls/skill-protocol.ts`
`SkillProtocolHandler.resolve` -> `skills.find(s => s.name === skillName)`). Bare
`brainstorming` matches no registered skill (all are `pi-oven:*` / `superpowers:*`)
-> throws `Unknown skill` (the mechanical cause: exact-match miss). The model then
improvises from the visible discovery list and loads `superpowers:brainstorming`
(aggressive self-asserting description) — this is the downstream consequence, not
the cause.

Overlapping names affected: brainstorming, systematic-debugging, writing-plans,
subagent-driven-development, receiving-code-review, tdd(-strict).

Note: subagents dispatched as `kzk:<role>` is a **separate** governance/prompting gap
(addressed by §3.3), not explained by the §1 resolution mechanics.

### 1.1 Hidden coupling — the gate read-detector parses on `:`

`gate-handler.ts:87` — `const match = /^skill:\/\/([^/:]+)/.exec(path);` stops at the
first colon. For `skill://pi-oven:brainstorming` it captures `pi-oven`, not
`brainstorming`. Then `gate-handler.ts:103` `requiredSkills.includes("pi-oven")` is
false (requiredSkills holds bare `brainstorming`) -> the read is **never recorded** ->
the autonomous remaining-skills reminder (`pi-oven.ts:493`) loops forever.

**Therefore namespacing the injection MUST be paired with a gate-parser fix** — this
is the non-obvious part of the change.

## 2. Locked decisions (brainstorming)

| # | Decision | Choice |
|---|---|---|
| D1 | Prefix strategy | **Hardcode `pi-oven:`** (root.plugin is always `pi-oven`; no dynamic `getActiveSkills()` lookup) |
| D2 | Internal state keys | **Stay bare** (`brainstorming`) — only injected strings + gate parser change; whitelist keys & `requiredSkills` unchanged |
| D3 | Conduct precedence | **Hard-forbid** same-purpose `superpowers:*`/`oh-my-claudecode:*`/`agentmemory:*`; pi-oven always wins |
| D4 | Sibling suppression | **opt-in** `/pi-oven:setup --suppress-sibling-skills`; default OFF |
| D5 | Suppression default globs | `["superpowers:*","oh-my-claudecode:*"]` — **agentmemory excluded** (non-overlapping memory tools; user-confirmed) |
| D6 | Skill rename | **No** — out of scope (namespaced injection suffices) |
| D7 | isolate change | **No** — suppression is a separate opt-in, isolate semantics unchanged |
| D8 | Skill-body refs | **Fix slash→colon**: 10 SKILL.md bodies use `skill://pi-oven/<name>/...` (broken host) → `skill://pi-oven:<name>/...`; update `lint-skills.ts` to validate the colon form |
| D9 | Eval harness | **Deferred** — live `run-eval` already forwards only the tool name (not `args.path`), so URI-based skill_read detection is a pre-existing latent gap NOT regressed by namespacing; proper fix (forward `tool_execution_start.args.path`) tracked as a follow-up, out of this change's scope |
| D10 | README churn | **Drop** version/badge edits from this change (direct-commit fix, not a release); keep CLAUDE.md invariant + flag doc + setup.md |

## 3. Change map (implementation surface)

### 3.1 Namespace injected references (core fix)
- `skill-keyword-loader.ts` — add `export const PI_OVEN_SKILL_NS = "pi-oven";`
  `buildKeywordMatchedSkillsPrompt` emits `skill://${PI_OVEN_SKILL_NS}:${name}` and
  the body text examples follow suit.
- `pi-oven.ts` (reminder builder ~495) — `skill://pi-oven:${name}`.
- `gate.ts:170` — `skill://pi-oven:${name}` (import/reuse the NS const).
- `rules-injector.ts` conduct (both variants) — `read("skill://pi-oven:<name>")`.

### 3.2 Gate parser fix (paired with 3.1) — robust, not another fragile regex
`gate-handler.ts:87` `getSkillReadName` currently does `/^skill:\/\/([^/:]+)/` which
stops at the first colon (captures `pi-oven`, never the skill name). Replace with:
1. Capture the host segment = everything after `skill://` up to the first `/`, `?`, or `#`.
2. Strip a leading `pi-oven:` namespace (one prefix only).
3. Take the skill name = the segment before any remaining `:` (a `:1-5` line-range tail).
This maps ALL of these to the bare `requiredSkills` key:
  - `skill://pi-oven:brainstorming`            → `brainstorming`
  - `skill://brainstorming` (legacy bare)       → `brainstorming`
  - `skill://pi-oven:brainstorming/references/x.md` → `brainstorming`
  - `skill://pi-oven:brainstorming:1-5`         → `brainstorming`
Each of the 4 forms is a mandatory unit-test case in `gate-handler` tests.
Note: a sub-path read (`/references/x.md`) still counts as "skill read" — this matches
current behavior and is intentional (reading any part of the skill satisfies the gate).

### 3.3 Conduct hard rules (`rules-injector.ts buildOrchestratorConductBlock`)
Add to BOTH interactive and autonomous variants (both already carry SKILL-FIRST):
- **Skill precedence**: "pi-oven skills are authoritative. Load `skill://pi-oven:<name>`.
  NEVER load a same-purpose skill from another plugin namespace (`superpowers:*`,
  `oh-my-claudecode:*`, `agentmemory:*`). On any name/purpose overlap, pi-oven wins."
- **Agent-name discipline**: "Dispatch subagents ONLY by their exact registered name
  `pi-oven:<role>` (e.g. `pi-oven:explorer`). NEVER `kzk:<role>` or the marketplace
  id — `kzk` is only the marketplace catalog name."
- Bump `ORCHESTRATOR_CONDUCT_DEDUP_KEY` to `@v2` so a live session re-injects the new
  block (the `@v1` dedup guard would otherwise suppress it).
- Dedup note: the `@v2` bump is required because `applyOrchestratorConduct` dedups on the
  exact marker string, so `@v1` would suppress live re-injection of the revised block.
  (Cleaner future alternative, NOT adopted now: strip any prior
  `pi-oven:orchestrator-conduct@*` block before inject, removing the need for version bumps.)
  `KEYWORD_SKILL_DEDUP_KEY` needs no bump — its block is rebuilt per-turn from the current
  keyword match, so no cross-turn stale-block risk.

### 3.4 opt-in sibling suppression
- `scripts/pi-oven-setup/config-yml.ts` — new `setPiOvenIgnoredSkills` /
  `clearPiOvenIgnoredSkills`, mirroring the `disabledProviders` union-merge transport
  (`omp config get skills.ignoredSkills --json` -> union -> `omp config set`). SoT const
  `PI_OVEN_SIBLING_SKILL_GLOBS = ["superpowers:*","oh-my-claudecode:*"]`. Union add /
  set-difference remove; idempotent; preserves user-set sibling globs.
- `scripts/pi-oven-setup.ts` — flag parse `--suppress-sibling-skills` /
  `--no-suppress-sibling-skills`; `--reset` also clears the pi-oven-managed globs.
  Writes to global `~/.omp/agent/config.yml`. Default unset = no write.
- Setup output line states what was hidden + restart hint, like `runIsolate`.
- Limitation (provenance loss): `clearPiOvenIgnoredSkills` removes the pi-oven-managed
  globs even if the user had set IDENTICAL globs themselves (no provenance tracking) —
  the same inherent property as the existing `disabledProviders` clear. Document this in
  the setup output / flag help.
- Scope: `--suppress-sibling-skills` is GLOBAL-only — it writes `~/.omp/agent/config.yml`
  `skills.ignoredSkills`. Under `--scope project` it is rejected (no-op + message); it never
  writes project `.omp/settings.json` (memory/global infra stays global per the project-scope
  carve-out). `--no-suppress-sibling-skills` / `--reset` clears the pi-oven-managed globs from
  the global file only.
- Test infra: `PI_OVEN_MOCK_SPAWN` and the setup CLI's array-key handling
  (`scripts/pi-oven-setup.ts:78` neighborhood) must treat `skills.ignoredSkills` as an ARRAY
  key, same as `disabledProviders`, so mock-backed CLI tests exercise the union-merge.

### 3.5 Regression guard + docs
- Tests (TDD-strict, touched files 100% line+branch):
  - keyword-loader: `buildKeywordMatchedSkillsPrompt` emits `skill://pi-oven:<name>`.
    (`tests/extensions/pi-oven-runtime/skill-keyword-loader.test.ts` — update namespaced-emit assertions)
  - gate-handler: a `read` of `skill://pi-oven:brainstorming` records bare
    `brainstorming` into `skillReads`; legacy bare form still works; all 4 URI forms
    from §3.2 are mandatory unit-test cases.
  - rules-injector: conduct (both variants) contains the precedence + agent-name rules
    and the `skill://pi-oven:` form; dedup key is `@v2`.
    (`tests/extensions/pi-oven-runtime/rules-injector.test.ts` — namespaced-emitter assertions)
  - wiring: update assertions for namespaced skill URIs.
    (`tests/extensions/pi-oven-runtime/wiring.test.ts`)
  - lint-skills: colon form (`skill://pi-oven:<name>`) accepted; slash form
    (`skill://pi-oven/<name>`) rejected.
    (`tests/scripts/lint-skills.test.ts`)
  - gate-handler: all 4 URI forms from §3.2 covered (gate-handler tests).
  - config-yml: ignoredSkills union add / clear / idempotency / sibling-preservation,
    mirroring the existing disabledProviders test shape.
- Docs: CLAUDE.md (namespaced-injection invariant in the skill-discovery section, new
  `--suppress-sibling-skills` flag), `commands/setup.md` (flag). CLAUDE.md Status: note
  the skill-routing fix + flag (no release/version bump in this change — direct-commit fix).
- `bun run build` to bundle `.omp/extensions/pi-oven.ts` -> `dist/`.

### 3.6 Shipped skill-body refs + lint (B2 — necessary follow-through)
10 SKILL.md bodies reference the BROKEN slash form `skill://pi-oven/<name>/references/...`
(host `pi-oven` matches no registered skill). Change each to the colon form
`skill://pi-oven:<name>/references/...`:
  tdd-strict, code-quality-discipline, pre-commit-gate, large-task-delegation,
  writing-plans, fresh-verifier, subagent-driven-development, brainstorming,
  spec-and-review, codebase-survey.
`scripts/lint-skills.ts` (the `skill://` reference validator, ~line 26 regex + comment)
and its tests currently accept/encode the slash form `skill://pi-oven/<name>` — update
them to validate the colon form `skill://pi-oven:<name>` (and bare `skill://<name>`),
and to REJECT the old slash form so it cannot regress.
Also fix the one non-live teaching reference that still shows the slash form:
`docs/specs/2026-05-27-pi-oven-foundation-design.md:63` (single-line factual correction — slash → colon).

### 3.7 Eval harness skill_read detection — DEFERRED (out of scope)
Cycle-2 codex flagged that namespaced reads would false-miss in evals. Verification of
`scripts/run-eval.ts:168-170` + `scripts/lib/eval-runner.ts:195` shows the URI-based
skill_read detection is ALREADY non-functional in live sessions: run-eval forwards only
`toolName:"read"` (the tool name, no `args.path`) on `tool_execution_start`, so
`lastBuf.toolCalls.some(n => n.includes("skill://<name>"))` never matches a URI in a real
session today. Namespacing therefore does NOT regress eval behavior. The unit tests in
`tests/scripts/eval-runner.test.ts` assert a combined-string MOCK model and stay green
because `eval-runner.ts` is left UNTOUCHED by this change.
Proper fix (separate follow-up, logged in `docs/harness/user-queue.md`): forward
`tool_execution_start.args.path` through run-eval → eval-runner so skill_read matches the
real read URI, then update the eval-runner unit tests. NOT in this change's scope.

## 4. Risks / non-goals
- **Risk**: a future omp load path that registers pi-oven skills bare would make the
  namespaced ref 404. Mitigation: gate parser + resolver already degrade to "unknown
  skill" (same as today, no worse); the keyword-loader test pins the contract.
- **Non-goal**: changing isolate, renaming skills, dynamic namespace discovery.
- B2/B3 are same-bug-class follow-through, not scope creep — leaving them unfixed means
  in-body skill refs and eval skill_read detection stay broken after the runtime fix.
- The line-range/selector suffix edge case is fully covered by §3.2's robust parse spec
  and its 4 mandatory unit-test cases.

## 5. Test / verification plan
1. `bun run check` (tsc), `bun test` (existing 643 + new), `bun run lint:agents`,
   `bun run lint:skills`, `bun run build`.
2. Manual: confirm `gate-handler` records the read for the namespaced form via unit
   test (no live omp session needed).
3. Fresh-verifier pass before completion (pre-commit-gate Gate 5).

## 6. Follow-up sequence
Cycle 1 + cycle 2 codex review done (verdicts in docs/research/codex-reviews/).
Cycle-3 = §3.7 descope + NIT folds (no new structure). PASS gate met (0 BLOCKER). Next:
writing-plans -> TDD-strict implementation -> pre-commit-gate.
