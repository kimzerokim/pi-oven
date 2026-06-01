---
name: pi-oven-release
description: Safe release automation for pi-oven version/manifests/changelog/publish gating
argument-hint: [--bump major|minor|patch | --version X.Y.Z] [--from-tag vX.Y.Z] [--dry-run] [--publish] [--update-changelog] [--sync-label]
---

# /pi-oven:release

Run release automation via:

```sh
bun scripts/pi-oven-release/index.ts --bump patch --dry-run
```

## Flags

- `--bump major|minor|patch`: compute next version from current SoT version.
- `--version X.Y.Z`: set explicit target version.
- `--from-tag vX.Y.Z`: changelog diff base (default: latest git tag).
- `--dry-run`: no commit/tag/push or file writes.
- `--publish`: enable commit/tag/push stage (still blocked by `--dry-run`).
- `--update-changelog`: write `CHANGELOG.md` entry from git log.
- `--sync-label`: sync `.omp/extensions/pi-oven.ts` label (`pi-oven vX.Y.Z`).

## Safety / SoT rules

- Safe by default: if `--publish` is omitted, run is dry-run by default.
- Version SoT must start consistent before release:
  - `package.json`
  - `.claude-plugin/plugin.json`
  - `.claude-plugin/marketplace.json` (`plugins[0].version`)
- Optional label sync updates `pi.setLabel("pi-oven v...")` only when requested.
