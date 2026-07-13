# Runtime contract remediation result

- Date: 2026-07-13
- Result: **PASS**
- Machine receipt: `artifacts/runtime-contract-rehearsal.json`
- Contract: `runtime-contract@1`

## Release rehearsal

The final escalated rehearsal completed all ten cases. The candidate artifact was freshly extracted, its 273-file shipped manifest was verified, dependencies were newly materialized with `bun install --frozen-lockfile --offline --backend=copyfile`, and the isolated candidate doctor exited 0 with no `[FAIL]`. Two consecutive rehearsals from the same worktree produced the identical candidate archive SHA-256, `8db22d195fad98d93aa9d9509c5e50d4beb52890cc9bce28f6284e87b5c81a4a`. The live provider canary remained explicitly `NOT RUN (credentials-unavailable)`; it was not counted as a live PASS.

| Case | Result | Evidence |
|---|---:|---|
| Fresh isolated HOME | PASS | prior plugin state absent; status did not invent routing |
| Legacy routing | PASS | `pi-oven:executor` remained readable and advertised canonical `pov:executor` rewrite |
| Project over global | PASS | project `pov:critic` model won over the machine-global model |
| Setup validation rollback | PASS | originals restored; concurrent edit preserved; manual diff written |
| Corrupt/nonterminal journal recovery | PASS | nonterminal journal recovered; corrupt journal reported |
| Explicit autonomous after 9 implicit | PASS | explicit recall 100%; 9 implicit matches; 1 root + 8 deferred |
| Canonical/unknown/missing task | PASS | canonical accepted; unknown and missing roles rejected; 100% matrix accuracy |
| Crash before/after effect receipt | PASS | open intent required manual review; completed receipt prevented replay |
| Provider canary available/unavailable | PASS | deterministic available seam passed 6/6; unavailable path was `NOT RUN` |
| Candidate artifact install + doctor | PASS | manifest PASS; fresh frozen install PASS; doctor exit 0; ledger PASS |

## Rollback proof

All one-release rollback boundaries were exercised:

- RuntimeContract compatibility reader: legacy routing was visible and migration-safe.
- Setup transaction: compensation restored originals; compare-and-swap rollback preserved concurrent edits and emitted a manual recovery diff.
- Ledger JSON fallback: ledger-primary read fell back to JSON, while JSON-only rollback writes did not touch SQLite.
- Prompt legacy flag: compositor retained the compact role/assignment/skill/safety capsule, while `PI_OVEN_PROMPT_MODE=legacy` restored full pre-capsule runtime, language, and corrected project-instruction injection.
- Immutable release version: exact tag/version/ref parity passed and a post-tag version mutation was rejected.

## Contract and eval evidence

Final authored-surface counts are all zero:

| Counter | Final |
|---|---:|
| stale legacy agent references | 0 |
| stale slash commands | 0 |
| invalid/unclassified task examples | 0 |
| provider-tier aliases | 0 |

- Fake-`ok` discrimination: 84/84 positive scenarios rejected; 0 vacuous passes.
- Runtime benchmark correctness: contract valid, explicit recall 100%, required recall 100%, forbidden precision 100%, deterministic.
- Worst worker prompt: 7,253 → 2,599 bytes, a 64.1666% reduction against a 50% requirement. The denominator is the sealed production `legacy` surface from corrected commit `40dfbd97b80db9127f89ba49e2c8525cc168f09c`.
- Read-only gate p95: 0.008833 ms against a 0.007958 ms baseline and 0.057958 ms maximum.

## Tests, coverage, and build

- Full suite: 1,234 passed, 0 failed, 4,571 assertions across 86 files.
- Bun coverage view: 93.31% functions / 92.97% lines.
- Coverage-ratchet view: 91.04% functions / 93.44% lines; all global and per-file floors passed.
- Setup transaction: 95.35% functions / 96.43% lines.
- Rehearsal runner: 91.94% functions / 89.50% lines.
- Typecheck, contract generation/check, agent lint, skill lint, build, benchmark, discrimination, rehearsal, and coverage ratchet all passed.

## Artifact size and checksums

An intermediate build bundled the exact `zod` package root and grew to 952,064 bytes. Module attribution showed 0.53 MB from 79 Zod inputs. The accepted build externalizes both `zod` and `zod/*`, retains the exact pinned install dependency, and is 415,284 bytes across 46 bundled modules. This is 75,284 bytes above the nominal 340,000-byte baseline, below the 150 KiB threshold. The decision and rejected alternatives are recorded in `docs/adr/2026-07-13-runtime-bundle-size-and-zod-externalization.md`.

| Artifact | SHA-256 |
|---|---|
| `dist/pi-oven.js` | `900383ebe48698eaed0749c6d906ae877a2b95e514c0b52ed749d682f80107e9` |
| candidate `pi-oven-v0.2.4.tar.gz` | `8db22d195fad98d93aa9d9509c5e50d4beb52890cc9bce28f6284e87b5c81a4a` |

## Automation order

Both CI and tag release workflows now enforce the deterministic order:

1. correctness-first runtime benchmark;
2. fake-`ok` discrimination gate;
3. integrated release rehearsal.

The tag workflow completes contract/type/lint/build/coverage gates before this sequence, runs trusted canary/regression gates after it, then performs the independent fresh-HOME install smoke before attestation and publish. Missing trusted credentials write `NOT_RUN` evidence and block release publication; they are never converted to PASS.
