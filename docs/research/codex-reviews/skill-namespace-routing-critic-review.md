# Codex review — skill:// namespace routing design (cycle 1)

> Reviewer: codex-cli 0.136.0 (`model_reasoning_effort=high`, read-only, ephemeral)
> Target: `docs/plans/2026-06-08-skill-namespace-routing-design.md`
> Cycle: 1 · Gate decision: **CONTINUE** (🔴 BLOCKER ≥ 1 + structural scope expansion)

## Synthesis

### 🔴 BLOCKERs

- **B1 — gate parser is incomplete (§3.2).** Capture-to-first-`/` + strip `^pi-oven:`
  works for `skill://pi-oven:brainstorming`, `skill://brainstorming`,
  `skill://pi-oven:foo/refs/x.md`, but FAILS for host-only selector forms like
  `skill://pi-oven:foo:1-5` (capture `pi-oven:foo:1-5` → strip → `foo:1-5` ≠ `foo`)
  and `?`/`#` tails — reintroduces a hidden exact-match miss. Fix: parse host up to
  first `/`/`?`/`#`, strip a leading `pi-oven:` namespace, THEN take the skill name as
  the segment before any remaining `:` (line-range). Test all 4 forms.

- **B2 — shipped skill bodies carry the broken slash form (verified).** 10 SKILL.md
  bodies reference `skill://pi-oven/<name>/references/...` (SLASH `pi-oven/`), which is
  incompatible with namespaced resolution (host `pi-oven` matches no skill). Correct
  form: `skill://pi-oven:<name>/references/...` (colon). `scripts/lint-skills.ts:26`
  + its tests encode/accept the wrong slash form and must move to the colon form.
  Files: tdd-strict, code-quality-discipline, pre-commit-gate, large-task-delegation,
  writing-plans, fresh-verifier, subagent-driven-development, brainstorming,
  spec-and-review, codebase-survey.

- **B3 — eval harness detects skill reads by bare name (verified).**
  `scripts/lib/eval-runner.ts:194` builds `skill://${name}` and `run-eval.ts:236`
  checks `skill_read`; namespaced injected reads (`skill://pi-oven:<name>`) will read
  as false misses. Update detection to the namespaced form (accept namespaced OR bare).

### 🟡 NITs (incorporate, non-blocking)

- **N1 (§1)** root-cause wording: the `Unknown skill` → load-`superpowers` jump is
  downstream model behavior, not the mechanical cause. State the mechanical cause
  (exact-match miss) as the cause; model-improvise as the consequence.
- **N2 (§3.3)** dedup: `@v2` bump is genuinely required under the exact-marker dedup.
  Codex's cleaner alternative = strip any prior `pi-oven:orchestrator-conduct@*` block
  before inject (no future version bumps). Keep `@v2` for minimal change; note the
  alternative. `KEYWORD_SKILL_DEDUP_KEY` is rebuilt per-turn from the current match, so
  no cross-turn stale risk.
- **N3 (§3.4)** `clearPiOvenIgnoredSkills` provenance loss: removing pi-oven-managed
  globs also removes IDENTICAL user-set globs (no provenance tracking) — same inherent
  property as the accepted `disabledProviders` clear. Document the limitation.

### ⚪ PUSH-BACK / scope-trim

- **P1 (§3.5)** README version/badge churn is outside the routing fix and this is a
  direct-commit fix, not a release. Drop README version bump from this change; keep the
  necessary CLAUDE.md invariant + `--suppress-sibling-skills` flag doc + setup.md.

### Accepted-as-is

- §3.1 namespacing completeness: the 4 runtime emitters are the complete runtime set.
- §3.4 union-merge transport: correct (array setting, `omp config set` whole-replace).
- D5 agentmemory exclusion: acknowledged; the §3.3 hard-forbid carries that protection.

## Cycle-2 plan
Revise design to add B1 (robust parse), B2 (skill-body + lint), B3 (eval harness),
trim P1, fold N1–N3. Re-run codex (cycle 2). PASS gate = 0 BLOCKER + no further
structural change → then writing-plans → TDD implementation.
