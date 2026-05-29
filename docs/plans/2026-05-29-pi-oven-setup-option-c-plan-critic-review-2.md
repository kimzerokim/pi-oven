# pi-oven-setup option-C plan — Critic Review (cycle 2)

**Date**: 2026-05-29
**Previous**: `2026-05-29-pi-oven-setup-option-c-plan-critic-review.md` (cycle 1, 🔴8)
**BLOCKERs resolved since cycle 1**: 7/8 ([PASS] transport omp-delegated, malformed override error, validator split, Wave4 explicit directives, auth-detect test removal, AC#1 scoped, --override+--validate test).
**Source**: codex `gpt-5.3-codex` (read-only, high) — raw `/tmp/codex-out-plan-c2.txt`.

**Gate decision**: **CONTINUE (cycle 3, bounded)**. codex "BLOCKER count: 2". This is the 2nd consecutive plan FAIL → the pi-oven 2-FAIL halt threshold is reached. **Judgment**: findings are converging objectively (8→2; the 2 are NEW, smaller, and require NO user judgment — a fail-closed guard + one contradictory line). Halting to user-queue would not serve its purpose (no decision for the user to make). Apply the 2 objective fixes + ONE bounded codex confirm (cycle 3). If cycle 3 is not clean → genuine non-convergence → HALT + user-queue.

---

## 🔴 BLOCKER (2) — cycle 3 fixes

### Pc2-1. Transport read path not fail-closed (data-loss on parse drift)
- codex: plan says unparseable `omp config get` may return `{}`; only non-zero exit aborts the set. exit=0 + malformed/missing `.value` → merges into `{}` → `set` wipes sibling overrides. get-output parse not strict-schema-guarded for the write path.
- **fix**: the read step MUST distinguish (i) key genuinely absent/empty → start from `{}` (safe) from (ii) parse failure / unexpected shape / non-zero exit → **ABORT the write entirely** (never merge-into-{}-and-set on a parse failure). Strict-parse the get output; proceed to `set` only when the record parsed cleanly OR the key is provably-absent. Add test: `omp config get` returns malformed JSON or exit≠0 → command aborts with error, `set` NOT invoked, config unchanged.

### Pc2-2. Wave 4.2 setup-wizard:57 contradictory directive
- codex: the bullet says both "change" and "leave" for setup-wizard line 57 — zero-context executor can branch wrong.
- **fix**: read setup-wizard.md:57, resolve to ONE unambiguous directive (change-to-4-8 OR leave-as-PROFILE_B/historical), state it singularly.

## NIT
- codex couldn't fully runtime-verify `omp config get --help` (EPERM log-write in sandbox). Transport reasoning from config-cli.ts stands; the fail-closed guard (Pc2-1) makes the parse-shape robust regardless.

## Re-review
planner SendMessage (2 fixes) → codex plan-review cycle 3 → freeze on 🔴0, else HALT+user-queue.

## 부록
`/tmp/codex-out-plan-c2.txt` (4152 bytes), "BLOCKER count: 2".
