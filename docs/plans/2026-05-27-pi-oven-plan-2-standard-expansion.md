# Plan 2 — Standard Expansion (v0.1.0 → v0.1.0) — SUPERSEDED

Date: 2026-05-27
Status: **SUPERSEDED** (2026-05-28) — replaced by the Spec A / Spec B / Spec C model-routing + subagent-consolidation initiative. v0.1.0 was reached via a different path (agent registry + setup wizard + skill rewrite + 3 new skills + 2 boosts) rather than the "~33 skill expansion" sketched here. Retained as a historical research artifact; do NOT execute. See `docs/specs/2026-05-28-pi-oven-{agent-registry,setup-wizard,skill-rewrite-and-new-skills}.md` for the actual path taken.
Mode: Dogfood (omp + installed pi-oven@pi-oven v0.1.0 driving)

## Executive Summary

Plan 2 transitions from bootstrap to standard expansion, adding ~33 skills to reach the ~45 total target defined in the foundation spec. This is the first cycle running inside omp with the installed plugin as the primary driver (dogfood switch met per `docs/decisions/0001-dogfood-switch.md`).

## Entry Criteria (from survey evidence)

- ✅ Plan 1 complete: 12 core skills shipped, v0.1.0 tagged
- ✅ Dogfood switch accepted: `docs/decisions/0001-dogfood-switch.md`
- ✅ Plugin manifest consistent: `.claude-plugin/plugin.json` lists 12 skills
- ✅ Eval runner real impl: `scripts/run-eval.ts` TDD-tested, 6 tests pass
- ✅ Canary scenario authored: `evals/dogfood/scenarios/v0.1.0-end-to-end.yaml`

## Current Blockers (from survey)

1. **Version drift**: Package/README/extension show v0.1.0 while plugin/catalog show v0.1.0
2. **No-op extension**: `.omp/extensions/pi-oven.ts` is still a stub logger
3. **Stub commands**: All 3 commands (`pi-oven-setup`, `pi-oven-doctor`, `pi-oven-autonomous`) are markdown stubs
4. **Empty agents**: `agents/` directory has only `.gitkeep`, no actual agent profiles
5. **Deferred provider keys**: Eval execution blocked until Plan 4 key bootstrap
6. **Degraded tooling**: CRG unindexed (0 files/nodes), LSP workspace symbols unavailable

## Plan 2 Scope

### Prerequisites (Wave 0 — SoT Sync)
Must complete before skill expansion to establish consistent foundation.

**Files**: `package.json`, `README.md`, `.omp/extensions/pi-oven.ts`, `docs/WORKING-CONTEXT.md`

**Tasks**:
1. Sync all version strings to v0.1.0 (package.json:3, README:27-30, extension:4)
2. Update README status from "Plan 0 scaffold" to "Plan 2 Standard Expansion"
3. Update WORKING-CONTEXT active queues to reflect Plan 2 active status

**Acceptance**: 
- `grep -r "0.1.0" --include="*.json" --include="*.md" --include="*.ts" | wc -l` returns 0
- All user-visible version indicators show v0.1.0

### Wave 1 — Dogfood MVP Infrastructure
Enable minimal dogfood execution before skill expansion.

**Files**: `commands/pi-oven-setup.md`, `commands/pi-oven-doctor.md`, `commands/pi-oven-autonomous.md`, `agents/explore.md`, `agents/executor.md`, `agents/verifier.md`, `.claude-plugin/plugin.json`

**Tasks**:
1. Transform `pi-oven-setup` from stub to preflight wizard:
   - Check omp installation path
   - Detect available provider keys (Codex OAuth / Zen / Anthropic)
   - Verify required MCPs (github, Context7)
   - Initialize docs/ skeleton if missing
2. Transform `pi-oven-doctor` from stub to health check:
   - Plugin install verification
   - Provider connectivity test
   - MCP status check
   - Report blockers with fix guidance
3. Create minimal agent profiles:
   - `agents/explore.md` — codebase survey agent (sonnet)
   - `agents/executor.md` — implementation agent (sonnet/opus routing)
   - `agents/verifier.md` — verification agent (opus)
4. Wire agents in plugin manifest

**Acceptance**:
- `/pi-oven:setup` runs and reports status (even if some checks fail)
- `/pi-oven:doctor` identifies current blockers correctly
- `agents/` has 3 real markdown profiles
- Plugin manifest lists agents in `agents[]` array

### Wave 2 — Core Workflow Skills (11 skills)
Port tier-1 workflow orchestration patterns.

**Skills to add**:
- `ralph` — self-referential loop (from omc)
- `team` — multi-agent coordination (from omc)
- `ultrawork` — parallel execution engine (from omc)
- `autopilot` — full autonomous from idea to code (from omc)
- `ralplan` — consensus planning with gates (from omc)
- `wiki` — persistent knowledge base (from omc)
- `deep-interview` — Socratic requirement gathering (from omc)
- `trace` — evidence-driven debugging (from omc)
- `systematic-debugging` — disciplined debug loop (from superpowers)
- `test-driven-development` — red-green-refactor enforcement (from superpowers)
- `verification-before-completion` — evidence gates (from superpowers)

**Per-skill acceptance** (dogfood migration cycle):
1. Source analysis via explore agent
2. SKILL.md draft with references/
3. Smoke + adversarial scenarios in evals/
4. Manual verification of skill trigger + base flow
5. Commit with version: 0.1.0 frontmatter

### Wave 3 — Domain Skills (11 skills)
Port domain-specific capabilities.

**Skills to add**:
- `to-issues` — plan to issue tracker conversion (from Matt Pocock)
- `to-prd` — conversation to PRD (from Matt Pocock)
- `triage` — issue state machine (from Matt Pocock)
- `diagnose` — bug diagnosis discipline (from Matt Pocock)
- `improve-codebase-architecture` — architecture improvement (from Matt Pocock)
- `frontend-design` — distinctive UI creation (custom)
- `ai-slop-cleaner` — code quality enforcement (from omc)
- `memory-save` — explicit memory persistence (from omc)
- `memory-recall` — memory retrieval (from omc)
- `session-search` — prior session lookup (from omc)
- `project-memory` — project context (from omc)

**Acceptance**: Same per-skill cycle as Wave 2

### Wave 4 — Utility Skills (11 skills)
Port supporting utilities and helpers.

**Skills to add**:
- `configure-notifications` — Telegram/Discord/Slack setup (from omc)
- `omc-setup` — oh-my-claudecode setup helper (from omc)
- `mcp-setup` — MCP server configuration (from omc)
- `skill-creator` — skill authoring helper (custom)
- `write-a-skill` — skill writing discipline (from Matt Pocock)
- `learner` — extract learned skill from conversation (from omc)
- `skillify` — workflow to skill conversion (from omc)
- `cancel` — mode cancellation (from omc)
- `ccg` — Claude-Codex-Gemini orchestration (from omc)
- `ask` — process-first advisor routing (from omc)
- `external-context` — web search coordination (from omc)

**Acceptance**: Same per-skill cycle as Wave 2

### Non-goals for Plan 2

- **NO provider key provisioning** — deferred to Plan 4
- **NO live eval execution** — smoke scenarios authored but not run (missing keys)
- **NO TS extension implementation** — remains no-op (Plan 3 scope)
- **NO hooks/rules implementation** — directories remain empty (Plan 3 scope)
- **NO CRG indexing fix** — accept degraded state, use AST/text search fallback
- **NO marketplace publish** — local dogfood only until Plan 4

## Verification Strategy

Each wave verified by:
1. File count: expected files created/modified
2. Plugin manifest: skills array grows correctly
3. Skill trigger: manual `/oh-my-claudecode:<skill>` invocation succeeds
4. Scenario count: each skill has ≥1 smoke, ≥1 adversarial scenario
5. Version consistency: all new skills have `version: 0.1.0` frontmatter

Final Plan 2 verification:
- 45 total skills in `.claude-plugin/plugin.json`
- 3 agents in `agents/` directory
- 3 commands transformed from stubs
- Dogfood canary can run (even if provider keys missing)

## Exit Criteria

- All 4 waves complete (0 prereq + 3×11 skills)
- Version bumped to v0.1.0 in package.json + plugin.json + marketplace.json
- Tag v0.1.0 created and pushed
- Progress docs updated to reflect Plan 2 complete
- User check-in before Plan 3 (TS extension implementation)

## Risk Mitigations

- **Version drift**: Wave 0 fixes immediately before any skill work
- **Missing agents**: Wave 1 creates minimal set before skill expansion
- **Provider keys**: Accept eval scenarios authored but not executable
- **Degraded tools**: Use AST search when CRG unavailable
- **Dependency drift**: Consider pinning `@oh-my-pi/pi-coding-agent` and `bun-types` versions in Wave 0

## Timeline Estimate

Not applicable (no time comprehension per contract). Work continues until acceptance criteria met.