# fresh-verifier — 4 Sub-Check Procedure

Sources: autonomous-boundary §Mandate, harness-share.md §33, pre-merge-sync §5/§6/§7

---

## Sub-check 1: Prod-build smoke

**Goal** — confirm the built artifact serves real user-persona flows without runtime errors.

**Procedure**

1. Run `bun run build` (or the project's canonical prod-build command). Build failure is an immediate FAIL.
2. Start the prod server locally (`bun run start` or equivalent).
3. Execute the Playwright user-persona script: at minimum one login flow and one primary feature flow.
4. Collect: (a) console error count, (b) network response codes.

**Evidence required**

- Build exit code 0.
- Playwright run: 0 console errors, 0 HTTP 5xx responses.
- Screenshot of the primary feature page attached to the verdict note.

**FAIL conditions**

- Build exits non-zero.
- Any `console.error` emitted during the Playwright run.
- Any HTTP 5xx response in the network log.
- Dev server used instead of prod build (dev/prod divergence trap — harness-share.md §3 Gate 4).

**Integration** — mirrors pre-merge-sync §5 prod-build smoke step. If §5 has already run in the same cycle with a passing result and no files have changed since, the verifier may cite that result rather than re-running. Cite the exact git SHA.

---

## Sub-check 2: Stub sweep

**Goal** — ensure no `STUB:` markers remain in source or in recent commit history.

**Procedure**

1. `grep -rn "STUB:" src/` — must return zero matches.
2. `git log --oneline -20` — scan for commit messages containing `STUB:` or `[stub]`.
3. If any match found in either command, list each location.

**Evidence required**

- `grep` output showing zero matches (paste the command + empty output).
- `git log` excerpt showing the 20 most recent one-line commit messages.

**FAIL conditions**

- Any `grep` match in source files.
- Any `git log` entry containing `STUB:` or `[stub]` (case-insensitive) in the 20-commit window that has not been superseded by a STUB-CLEAR commit.

**Integration** — mirrors pre-merge-sync §6 stub sweep. A `STUB-CLEAR:` commit message line is the canonical acknowledgement that a stub has been resolved. The verifier checks that every prior stub marker has a corresponding STUB-CLEAR entry.

---

## Sub-check 3: SoT alignment

**Goal** — every feature line in the active spec/plan maps to staged code; no spec item is left unimplemented.

**Procedure**

1. Locate the active spec or plan file (most recent file in `docs/specs/` or `docs/plans/` by filename date).
2. Extract every feature line (lines beginning with `-`, `*`, or numbered list items under a `## Features` / `## Scope` / `## Requirements` section).
3. For each feature line, confirm a corresponding implementation exists: file path + function/component name cited.
4. Record unmatched feature lines as FAIL items.

**Evidence required**

- Spec file path + git SHA.
- Table: feature line | implementation reference | status (FOUND / MISSING).

**FAIL conditions**

- Any feature line with status MISSING.
- Spec file not found (treat as BLOCK — verifier cannot confirm alignment without a SoT).

**Integration** — mirrors pre-merge-sync §7 SoT alignment check. If the spec was updated in the same cycle, the verifier must use the post-update version.

---

## Sub-check 4: Spec-freeze re-check

**Goal** — confirm all visual modifiers from the frozen spec have been absorbed and no UI-layer TODOs remain.

**Procedure**

1. Search for `TODO:` in UI layer paths (`src/components/`, `src/pages/`, `src/app/`, or equivalent).
2. Verify size tokens, spacing values, and color semantics in changed UI files match the frozen spec exactly (diff the spec section against the implementation).
3. Check that no `// spec:` inline annotation remains unresolved.

**Evidence required**

- `grep -rn "TODO:" src/components src/pages` output (must be empty, or each match must be pre-existing and unrelated to the current cycle's changes).
- Confirmation that visual modifier values match the spec (cite spec line and implementation line for each token).

**FAIL conditions**

- Any `TODO:` in UI files introduced in the current cycle's diff.
- Any size/spacing/color token that differs from the frozen spec.
- Any unresolved `// spec:` annotation.

---

## Verdict template

The verifier agent must open its response with exactly one of:

```
VERDICT: PASS
```

```
VERDICT: BLOCK
Sub-check failures:
- [1] Prod-build smoke: <reason>
- [2] Stub sweep: <reason>
- [3] SoT alignment: <reason>
- [4] Spec-freeze: <reason>
```

Only failed sub-checks are listed under `VERDICT: BLOCK`. A PASS response must include a one-line evidence summary for each sub-check.

---

## Integration with pre-merge-sync

| Pre-merge step | Fresh-verifier sub-check | Relationship |
|---|---|---|
| §5 prod-build smoke | Sub-check 1 | Verifier re-runs or cites §5 result by SHA |
| §6 stub sweep | Sub-check 2 | Verifier re-runs; same grep + git log commands |
| §7 SoT alignment | Sub-check 3 | Verifier uses same spec file; must post-date §7 run |

Sub-check 4 (spec-freeze) is a fresh-verifier-only gate with no pre-merge-sync counterpart. It catches UI drift that occurs between §7 and the final commit.
