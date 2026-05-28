---
name: pre-commit-gate
version: 0.1.0
description: "Sequential 11-gate pre-commit check (AGENTS.md sync, freshness, ai-slop, secrets, prod code-first, build, test, docker smoke, Playwright UI, fix-scope, fresh-verifier) before every git commit via Bash. One FAIL blocks immediately. New commit, never --amend."
trigger: "git commit / git push / gh pr command via Bash"
alwaysApply: false
---

# pre-commit-gate

## When to use

Run before every `git commit` executed via Bash — applies in interactive mode and autonomous mode alike. Also fires on `git push origin main` and `gh pr create` (Gate 6 cycle-exit verifier).

Do not bypass with `--no-verify` unless the user explicitly orders it. Partial gate runs are not valid passes.

## Gate sequence (11 gates)

| Gate | Name | Trigger condition | Bypass env |
|---|---|---|---|
| 0 | AGENTS.md sync | Staged adds / deletes (`A`/`D` status) | — |
| 0.5 | Freshness guard | Every commit | `PI_OVEN_GATE05_SKIP=1` |
| 1 | ai-slop-cleaner | Every commit (skip if trivial 1-line flag change) | — |
| 1.5 | Secrets scan | Every commit | — |
| 1.6 | Prod code-first | Staged path matches `migrations/`, `infra/`, `scripts/prod/`, `terraform/`, `cloudformation/`, `cdk/`, `serverless.yml` | — |
| 2 | Build green | Every commit (skip doc-only) | — |
| 3 | Module tests | Every commit (skip doc-only) | — |
| 3.5 | Docker compose smoke | Staged path touches `docker-compose*.yml`, `Dockerfile*`, or container infra | `PI_OVEN_GATE35_SKIP=1` / `PI_OVEN_GATE35_DISABLE=1` |
| 4 | Playwright UI + dev-server health | Staged path matches frontend source glob | `PI_OVEN_GATE4_SKIP=1` |
| 4.5 | Fix-scope expansion | Default DISABLED; enabled by `pre-merge-sync` step 3 | `PI_OVEN_GATE45_SKIP=1` |
| 5 | Fresh-verifier | 3+ files changed, high-risk tag, or any main-authored commit | `PI_OVEN_GATE5_SKIP=1` |

Gate 6 (cycle-exit verifier) fires separately on `gh pr create` / `git push origin main` — not part of the per-commit sequence above.

## Sequential failure protocol

1. Run gates in order: 0 → 0.5 → 1 → 1.5 → 1.6 → 2 → 3 → 3.5 → 4 → 4.5 → 5.
2. First FAIL: stop immediately. Do not run subsequent gates.
3. Fix the root cause. Re-stage the corrected files.
4. Create a **new commit**. NEVER use `git commit --amend` after a gate failure — the commit did not happen; amending would corrupt the previous commit.
5. Re-run all gates from Gate 0.

## Bypass envs + Q-codes

| Env var | Gate bypassed | Q-code auto-appended |
|---|---|---|
| `PI_OVEN_GATE05_SKIP=1` | Gate 0.5 | `Q-GATE-05-STALE` |
| `PI_OVEN_GATE35_SKIP=1` | Gate 3.5 (one-time skip) | `Q-GATE-35-SKIPPED` |
| `PI_OVEN_GATE35_DISABLE=1` | Gate 3.5 (project-wide disable) | `Q-GATE-35-DISABLED` |
| `PI_OVEN_GATE4_SKIP=1` | Gate 4 | `Q-GATE-4-STALE` |
| `PI_OVEN_GATE45_SKIP=1` | Gate 4.5 | `Q-GATE-45-STALE` |
| `PI_OVEN_GATE5_SKIP=1` | Gate 5 | `Q-GATE-5-STALE` |
| `PI_OVEN_CYCLE_EXIT_SKIP=1` | Gate 6 | `Q-CYCLE-EXIT-STALE` |

Bypass env use is always logged to the commit body. Q-codes are appended to `docs/harness/user-queue.md`.

## Gate 4 dev-server health pre-check

Before launching Playwright, verify the dev server is healthy:

1. **Process alive**: confirm the dev server process is running (`pgrep -f "next dev\|vite\|webpack-dev-server"` or equivalent).
2. **Log tail error grep**: tail the last 50 lines of the dev server log; grep for `error` / `Error` / `failed` patterns.
3. **Tailwind v4 trap**: Tailwind v4 requires `@import "tailwindcss"` before any other CSS imports. A wrong import order passes in dev (HMR patches it) but fails in prod build. Gate 4 must confirm no `@import` order warning appears in the dev server log before proceeding.

If the process is not alive or the log tail shows errors, fix the dev server before running Playwright. A passing Playwright run on a broken dev server is a false positive.

## v1 vs Plan 3 scope

- **v1 (Plan 1)**: SKILL.md skill-layer enforcement only. The model reads this skill and self-enforces the gate sequence. No hard intercept.
- **Plan 3**: TypeScript extension hook — `pi.on('tool_call', { tool: 'Bash' })` — intercepts every `git commit`, `git push`, and `gh pr` call at the omp runtime layer. Gates 3.5 and Gate 6 are Plan 3 from day one (they require the hook intercept to be reliable). Gates 0–5 start as Plan 1 skill-layer and gain hard intercept in Plan 3.

Per-gate procedure: skill://pi-oven/pre-commit-gate/references/gate-detail.md

## Agent Dispatch (omp)

Each gate has a default agent in an omp session:

- Gate (code review): `pi-oven:code-reviewer`.
- Gate (security): `pi-oven:security-reviewer`.
- Gate (verification, fresh-evidence): `pi-oven:verifier`.
- Gate (E2E / Playwright when UI changed): `pi-oven:qa-tester`.
- Gate (commit shaping, message style, atomic split): `pi-oven:git-master`.

If any gate fails twice in a row, escalate the failure to `pi-oven:oracle` before continuing.
