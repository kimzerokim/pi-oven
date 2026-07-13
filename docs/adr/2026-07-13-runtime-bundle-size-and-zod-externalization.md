# ADR: Keep Zod as an exact runtime dependency, not an extension-bundled copy

- Status: accepted
- Date: 2026-07-13
- Scope: runtime-contract remediation release candidate

## Context

The remediation plan requires an architectural decision when the built extension grows by more than 150 KiB over the recorded nominal 340,000-byte baseline. The first post-ledger build was 952,064 bytes, a 612,064-byte increase.

`bun build --metafile-md` attributed 0.53 MB across 79 `node_modules` inputs. The largest duplicated inputs were `zod/v4/core/schemas.js` (65.41 KB), `zod/v4/classic/schemas.js` (45.25 KB), and the rest of the classic/core/locales graph. Project modules were materially smaller: `pi-oven.ts` 52.72 KB, deep-interview state 35.57 KB, `pi-oven-ask.ts` 34.87 KB, the SQLite ledger 15.0 KB, and setup transaction code 9.70 KB.

The RuntimeContract already imports `zod/mini`. The remaining classic Zod graph entered through existing exact `zod` imports because the build externalized `zod/*` but not the package root `zod` specifier.

## Decision

Externalize both `zod` and `zod/*` in the extension build. Keep the exact `zod` 4.4.3 dependency pinned in `package.json` and installed by the frozen-lockfile release path. Keep RuntimeContract on `zod/mini`; do not split the contract into a second tooling-only schema package in this release.

This preserves one runtime schema implementation and avoids shipping a second copy of an already required dependency. Candidate installation and doctor rehearsal verify that the freshly extracted artifact resolves the exact dependency after `bun install --frozen-lockfile`.

## Consequences

- The extension is 414,918 bytes across 46 bundled modules.
- The final increase is 74,918 bytes over the nominal 340,000-byte baseline, below the 153,600-byte ADR trigger.
- Zod is now an explicit runtime-install requirement rather than hidden bundle content; the exact dependency pin, frozen lockfile, fresh candidate install, and doctor gate make that dependency visible.
- A tooling/runtime schema split remains unnecessary unless a later bundle report shows project-owned schema code, rather than dependency duplication, crossing the threshold.

## Rejected alternatives

- Bundle classic Zod and accept 952,064 bytes: rejected because it duplicates a pinned runtime dependency and crosses the threshold without buying isolation.
- Rewrite all existing schemas to `zod/mini` in this remediation: rejected as a wider migration with no bundle advantage once the dependency is correctly externalized.
- Move generated-schema tooling into a new package now: rejected because the measured excess came from dependency bundling, not the generated-schema boundary.
