# pi-oven-setup option-C plan — Critic Review (cycle 1)

**Date**: 2026-05-29
**Plan**: `docs/plans/2026-05-29-pi-oven-setup-option-c-plan.md`
**Source**: codex `gpt-5.3-codex` (read-only, high) — raw `/tmp/codex-out-plan.txt`.
**Gate**: **CONTINUE** — codex "BLOCKER count: 8". Plan revise (FAIL 1/2; 2 consecutive FAIL → halt). No fundamental design flaw — executor-readiness + transport precision.

---

## Resolutions (categorized, for plan revise)

### Transport — switch to omp-delegated write (resolves Bc-4, Bc-8, PB §3.1(d))
codex: custom lock may not coordinate with omp writers (Bc-4); temp+rename dir not pinned (Bc-transport); spec said omp-provided lock, plan said custom (PB); comment churn (NIT).
**Decision**: drop direct-YAML + custom file-lock + temp+rename. Use **omp-delegated read-merge-set-whole-record**:
1. `omp config get task.agentModelOverrides` → parse current record (JSON).
2. pi-oven merges the single `pi-oven:<role>` key (or deletes for `--reset`).
3. `omp config set task.agentModelOverrides '<whole-merged-json>'` → omp writes config.yml via its own path (atomicity/serialization/lock = omp's, coordinates with omp writers, no comment churn).
- whole-record set is accepted (declared schema key; dotted was rejected — planner verified). sibling keys preserved by pi-oven's merge (step 2).
- get→set race window: acceptable for personal single-user CLI (same window as omp's own agent-dashboard writer); document it. No custom lock.
- Plan revise: verify `omp config get task.agentModelOverrides` returns parseable output (read-only); reason `omp config set` whole-record from config-cli.ts (do NOT mutate real config.yml).

### Bc-1 — Task 2.1 malformed `--override` undecided
**Decision**: malformed `--override` entry → **error + exit 1** (not skip). Pin in Task 2.1 + spec §3.3 already says error-recommended; make it definite. Add test: malformed `--override "critic"` (no `=`) → exit 1, config.yml unchanged.

### Bc-2 — validator test seam unspecified
**Decision**: split the validator into a PURE parser fn (input: raw `omp --list-models` text → string[] of canonical ids) unit-tested directly with fixture strings (no subprocess), + a thin CLI-invoking wrapper. Tests target the pure fn. If a subprocess test is needed, inject via env var `PI_OVEN_LIST_MODELS_FIXTURE=<path>` read by the wrapper. Pin this seam in Task 1.2.

### Bc-3 / Bc-8 / PB Wave4.2 — line-by-line live-vs-historical judgment (open Q #2/#3)
**Decision**: resolve NOW — the plan revise MUST read `README.md`, `agents/pi-oven-critic.md`, `OPTIMIZED-MODEL.md`, `setup-wizard.md`, `agent-registry.md` and produce **explicit per-line directives** (exact line + old→new or "leave (PROFILE_B/historical)") for Wave 4.2/4.3. No "executor judges" language. PROFILE_B lines (profiles.ts:197-292, README:208, harness-flow-progress.md:34) = leave (deferred). Remove open-questions #2/#3 (resolved into explicit lists).

### Bc-5 — confirmAuthViaPing removal breaks auth-detect.test.ts
**Decision**: Task 2.6 must explicitly delete/update the `confirmAuthViaPing` cases in `tests/scripts/pi-oven-setup/auth-detect.test.ts`. Add to the task's file list + "DO NOT leave dangling test imports".

### Bc-7 — AC#1 "git tree clean" fragile in dirty workspace
**Decision**: scope the assertion — assert `git status --short -- agents/ scripts/` shows NO modification to tracked baseline files (not whole-tree clean), AND the override landed in `~/.omp/agent/config.yml` (outside repo). Plugin-lock unchanged → before/after checksum of `~/.omp/plugins/omp-plugins.lock.json` (or assert absent/untouched). Pin in AC#1 test + §AC.

### PB §3.4 / NIT — `--override + --validate` no test
**Decision**: add a test for `--override + --validate` combination (write then validate) alongside the existing `--override + --status`.

### NIT (accept/note)
- validator parser brittleness: mitigate via the pure-fn + a test that fails loudly if the "Canonical models" section/header is absent (defensive parse, throw on unexpected format). 
- Deferral #1 (pi-oven-session-model.json) — safe, keep.

---

## Re-review
Plan revise (planner SendMessage) → codex plan-review cycle 2 → freeze on BLOCKER 0.

## 부록 — codex 원문
`/tmp/codex-out-plan.txt` (5247 bytes), "BLOCKER count: 8".
