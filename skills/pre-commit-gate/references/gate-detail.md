# Gate Detail — pre-commit-gate

Per-gate procedure, failure protocol, and skill integration map.


## Runtime gate decision (hook layer)

For `git commit` under ACTIVE gate (`state.kind=OK` + `state.active=true`), runtime allow requires:

- `gateCache.commit === "PASS"`
- and, **only when the verifier risk matrix selected the heavy path for this commit**, `gateCache.regression === "PASS"`

Targeted implementation-stage verifier passes may leave `gateCache.regression` unset. Any present non-`PASS` regression value blocks the commit.

Preserved invariants:
- Forbidden floor is always-on (independent of gate state / bypass).
- Push consent flow is unchanged (env/file single-use behavior).
- ABSENT state is non-blocking.
- CORRUPT state is fail-closed for commit/push.
## Gate 0 — AGENTS.md sync

**Trigger**: `git diff --cached --name-status` returns any `A` (added) or `D` (deleted) entry.

**Procedure**:
- New file at `path/to/dir/<file>` → update `path/to/dir/AGENTS.md` Key Files table to include the new row.
- New directory under a tracked source root → author a new `AGENTS.md` for that directory; update the parent's Subdirectories table; add `<!-- Parent: ../AGENTS.md -->` tag.
- Deleted file → remove the corresponding row from the relevant `AGENTS.md`.
- Pure modification (no add/delete/rename) → skip Gate 0.
- Test-only adds (`*.test.{ts,tsx}` co-located with the implementation) → may share one row; explicit row optional.

**Failure**: unstage, fix `AGENTS.md`, re-stage, new commit.

**Plan 1 vs Plan 3**: skill-layer rule in both plans. No hard intercept needed; AGENTS.md is a markdown artifact, not a runtime dependency.

## Gate 0.5 — Freshness guard

**Trigger**: every commit.

**Procedure**: inline — staged files → CRG symbol reverse-refs → stale meta-doc detection → auto-fix dispatch → re-stage.

**CRG absent**: degraded grep mode + WARN. Silent skip is forbidden.

**Bypass**: `PI_OVEN_GATE05_SKIP=1` → log `Q-GATE-05-STALE` to `docs/harness/user-queue.md`, proceed.

**Detection**: Gate 0.5 owns the inline stale-meta-doc detection logic and enforces FAIL-on-stale (no separate skill).

**Plan 1 vs Plan 3**: skill-layer in Plan 1. Plan 3 hook can re-run the grep inline before the Bash call completes.

## Gate 1 — ai-slop-cleaner

**Trigger**: every commit. Skip if the diff is a trivial 1-line flag change (must state `ai-slop-cleaner skipped (trivial)` in commit body).

**Procedure**: invoke `pov:code-simplifier` on the changed files. Removes dead code, duplicate logic, needless abstraction, and boundary leaks.

**Failure**: apply cleaner output, re-stage, new commit.

**Plan 1 vs Plan 3**: skill-layer in both. The cleaner is a model call; no runtime intercept adds value here.

## Gate 1.5 — Secrets scan

**Trigger**: every commit, no exceptions.

**Procedure**:

```bash
git diff --cached | grep -iE "(password|secret|api_key|aws_secret|private_key|token)\s*[:=]\s*['\"]?[A-Za-z0-9+/]{8,}" || true
```

Also grep for `AKIA` and `ASIA` prefixes (AWS key patterns).

**Failure**: unstage the file, remove the secret, re-stage. Never commit secrets even in test fixtures.

**False positive handling**: commit body must state `secrets-scan: false positive — <reason>`.

**Plan 1 vs Plan 3**: skill-layer in Plan 1. Plan 3 hook runs the grep inline as a pre-Bash-call check, blocking the tool call if a match is found.

## Gate 1.6 — Prod code-first

**Trigger**: staged path matches `migrations/`, `infra/`, `scripts/prod/`, `terraform/`, `cloudformation/`, `cdk/`, or `serverless.yml`.

**FAIL patterns** (direct execution traces in staged diff `+` lines):
- `psql` with `ALTER TABLE`, `DROP TABLE`, or `CREATE INDEX` shell-command traces
- `aws iam create-policy` / `put-policy` / `attach-role-policy` shell traces
- `aws s3api put-bucket-lifecycle-configuration` / `put-bucket-policy` shell traces
- `aws lambda update-function-configuration` shell traces (IaC-managed Lambda only)

Heredoc / `psql -f migration.sql` style script-driven calls are not FAIL.

**WARN patterns**: new `*.sql` file missing `IF NOT EXISTS` / `IF EXISTS` / `ON CONFLICT` keywords. Does not block.

**On FAIL**: halt + output "Gate 1.6 — direct execution trace detected. Replace with migration / IaC." + append `Q-PROD-CODE-FIRST-<COMMIT-HASH>` to user-queue.

**Skill integration**: `production-access` §Production state changes is the SoT for pattern definitions.

**Plan 1 vs Plan 3**: skill-layer in Plan 1. Plan 3 can run the grep inline.

## Gate 2 — Build green

**Trigger**: every commit except doc-only.

**Procedure**: run the repo's build command (`npm run build` or equivalent). Verify the dist artifact exists. Exit code must be 0.

**Failure**: fix the build error, re-stage, new commit.

**Plan 1 vs Plan 3**: skill-layer in Plan 1. Plan 3 hook runs `npm run build` inline before allowing the `git commit` Bash call to proceed.

## Gate 3 — Module tests

**Trigger**: every commit except doc-only.

**Procedure**: `npm test` scoped to the changed area. Full regression at PR time.

**Failure**: fix the failing test, re-stage, new commit.

**Skill integration**: `tdd-strict` owns the test discipline; Gate 3 runs the same command.

**Plan 1 vs Plan 3**: skill-layer in Plan 1. Plan 3 hook runs the test suite inline.

## Gate 3.5 — Docker compose smoke

**Trigger**: staged path touches `docker-compose*.yml`, `Dockerfile*`, or container infra files.

**Procedure**: `docker compose up --wait` (or equivalent health-check command). All services must reach `healthy` status. Tear down after pass.

**Bypass**:
- `PI_OVEN_GATE35_SKIP=1` → one-time skip, logs `Q-GATE-35-SKIPPED`.
- `PI_OVEN_GATE35_DISABLE=1` → project-wide disable, logs `Q-GATE-35-DISABLED`.

**Plan 1 vs Plan 3**: Plan 3 from day one. The docker compose invocation requires reliable tool-call interception to be useful; skill-layer enforcement alone is too fragile for container lifecycle management.

## Gate 4 — Playwright UI + dev-server health

**Trigger**: staged path matches frontend source glob (`src/**/*.{tsx,ts,css}` or repo equivalent). Exception: change is solely under `src/**/*.test.{tsx,ts}`.

**Dev-server health pre-check** (runs before Playwright):
1. Confirm dev server process is alive.
2. Tail dev server log (last 50 lines); grep for `error` / `Error` / `failed`.
3. Check for Tailwind v4 `@import` order warnings (dev passes, prod fails trap).

**Playwright procedure**: delegates to `playwright-verification` skill. Requires 3+ pages, full-page screenshot, 0 console errors.

**Bypass**: `PI_OVEN_GATE4_SKIP=1` → logs `Q-GATE-4-STALE`.

**Failure**: fix the UI issue or dev-server error, re-stage, new commit.

**Skill integration**: `playwright-verification` implements the browser flow. Gate 4 is a wrapper that enforces the dev-server pre-check and mandatory trigger condition.

**Plan 1 vs Plan 3**: skill-layer pre-check in Plan 1. Plan 3 hook can block the `git commit` Bash call if the dev-server health check fails inline.

## Gate 4.5 — Fix-scope expansion

**Default state**: DISABLED. Enabled by `pre-merge-sync` step 3.

**When enabled trigger**: any fix-start commit (commit message contains `fix(` prefix or diff touches a previously identified callsite).

**Procedure**: delegates to `fix-scope-expansion` skill §Gate 4.5 — callsite sanity check. Verifies no callsites were missed, no deprecated endpoints left live.

**Bypass**: `PI_OVEN_GATE45_SKIP=1` → logs `Q-GATE-45-STALE`.

**Skill integration**: `fix-scope-expansion` owns the callsite scan and BLOCK message format.

**Plan 1 vs Plan 3**: skill-layer in both plans. Gate 4.5 is a conditional check; no hard intercept adds reliability over the skill-layer here.

## Gate 5 — Fresh-verifier

**Trigger**: executable-code commit **and** at least one verifier-risk signal:
- exported / public / shared symbol change with reverse dependencies,
- user-visible behavior change that is not already proven by narrow TDD evidence,
- high-risk domain (`auth`, `payment`, `migration`, `public API`, credential / permission policy, prod-mutation path),
- heavy-path signal (`UI-heavy`, `MILESTONE:`, `CYCLE-EXIT:`, `STUB-CLEAR:`).

Explicit non-triggers: file-count thresholds by themselves, "main-authored commit" by itself, and doc-only commits.

If none apply → Gate 5 N/A.

**Procedure**: delegates to `fresh-verifier` skill. Stage 3 cache lookup first (key = staged\_diff\_hash + acceptance\_hash + verifier\_model). Cache hit → cite PASS in commit body. Cache miss → dispatch fresh verifier agent via omp `task`.
- If only the targeted implementation path is required, the verifier must prove intent-match + relevant TDD evidence + changed-area / reverse-dep / risk-focused checks only.
- If any heavy-path signal is present, the verifier must run the 4 heavy sub-checks from `references/4-sub-check.md`.

**Verdict**: `VERDICT: PASS` allows commit. `VERDICT: BLOCK` or `VERDICT: PARTIAL` halts.

**Bypass**: `PI_OVEN_GATE5_SKIP=1` → logs `Q-GATE-5-STALE`.

**Q-halt patterns**: `Q-VERIFIER-FAIL` (2 consecutive BLOCKs), `Q-VERIFIER-INVALID` (bad verdict format), `Q-VERIFIER-DISPATCH-FAIL` (omp task error).

**Skill integration**: `fresh-verifier` owns the intent/risk matrix, targeted evidence rules, heavy 4-sub-check path, and verdict format. Gate 5 is a wrapper that enforces the trigger condition and commit-body citation.

**Plan 1 vs Plan 3**: skill-layer in Plan 1. Plan 3 hook dispatches the verifier inline before allowing the `git commit` Bash call.

## Gate 6 — Cycle-exit verifier

**Trigger**: `gh pr create` or `git push origin main`.

**Procedure**: force the **heavy** `fresh-verifier` path (prod-build smoke, stub sweep, SoT alignment, spec-freeze re-check). Main self-declared "done" without Gate 6 PASS is forbidden.

**Bypass**: `PI_OVEN_CYCLE_EXIT_SKIP=1` → logs `Q-CYCLE-EXIT-STALE`. Fail-closed: the push / PR creation proceeds but the cycle is marked incomplete.

**Plan 1 vs Plan 3**: Plan 3 from day one. Intercepting `git push` and `gh pr` at the tool-call layer is the only reliable enforcement path; skill-layer reminders are insufficient for cycle-exit gates.

## Failure protocol summary

| Scenario | Action |
|---|---|
| Any single gate FAIL | Fix, re-stage, new commit. Never `--amend`. |
| 3 consecutive build/test FAILs (autonomous) | Halt + append user-queue entry per `autonomous-boundary`. |
| 2 consecutive reviewer/verifier FAILs | Halt + `Q-VERIFIER-FAIL` per `fresh-verifier`. |
| `--no-verify` requested | Refuse unless user explicitly orders it in the same turn. |

## Doc-only commit exception

Commits touching only `*.md`, `docs/**`, `CLAUDE.md`, or `skills/**/*.md`:

- Gates 0, 2, 3, 4, 5 → N/A (Gate 0 applies only if the doc commit adds/removes files under a source root).
- Gate 1.5 (secrets scan) → always required.
- Any single source-code line in the same commit revokes this exception.
