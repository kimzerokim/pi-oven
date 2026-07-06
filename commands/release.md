---
name: pi-oven-release
description: Safe release automation for pi-oven version/manifests/changelog/publish gating
argument-hint: "[--bump major|minor|patch | --version X.Y.Z] [--from-tag vX.Y.Z] [--dry-run] [--publish] [--update-changelog] [--sync-label]"
---

# /pi-oven:release

## Run only from the source repo

`/pi-oven:release` is maintainer-only automation for the pi-oven **source repo** checkout.

- **source repo** — the cwd checkout you are authoring and versioning
- **release artifact** — the version-synced manifests, optional label update, changelog diff, commit, and `vX.Y.Z` tag produced from that checkout
- **installed cache** — the consumer snapshot under `~/.omp/plugins/cache/plugins/`, useful for post-install verification only and never a patch target

Before dispatching any `bun` command, confirm the current cwd is the source repo and that `scripts/pi-oven-release/index.ts` exists there. Do **not** resolve `installed_plugins.json`, do **not** scan the install cache, and do **not** run release automation from a marketplace install snapshot.

```sh
test -f scripts/pi-oven-release/index.ts || {
  echo "Run /pi-oven:release from the pi-oven source repo checkout" >&2
  exit 1
}

bun ./scripts/pi-oven-release/index.ts --bump patch --dry-run
```

The dry-run JSON prints a `boundary` object that makes the source repo → release artifact → installed cache contract explicit for the current run.

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
- The helper refuses installed-cache roots; release automation is source-repo only.
- Version SoT must start consistent before release:
  - `package.json`
  - `.claude-plugin/plugin.json`
  - `.claude-plugin/marketplace.json` (`plugins[0].version`)
- Local git release writes use the current checked-out branch plus the `vX.Y.Z` tag; the helper never guesses `main`.
- Optional label sync updates `pi.setLabel("pi-oven v...")` only when requested.
- The installed cache remains observation-only even after release; verify sync there only after publish/install completes.
