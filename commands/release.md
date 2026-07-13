---
name: pi-oven-release
description: Safe release preparation for pi-oven version/manifests/changelog validation
argument-hint: "[--bump major|minor|patch | --version X.Y.Z] [--from-tag vX.Y.Z] [--dry-run] [--prepare] [--update-changelog] [--sync-label]"
---

# /pi-oven:release

## Run only from the source repo

`/pi-oven:release` is maintainer-only automation for the pi-oven **source repo** checkout.

- **source repo** — the cwd checkout you are authoring and versioning
- **release artifact** — the deterministic, checksummed, attested archive produced only by the `vX.Y.Z` tag workflow
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
- `--dry-run`: no commit or file writes.
- `--prepare`: sync files, run the full validation gate, and create a local release commit. It never tags or pushes.
- `--update-changelog`: write `CHANGELOG.md` entry from git log.
- `--sync-label`: sync `.omp/extensions/pi-oven.ts` label (`pi-oven vX.Y.Z`).

## Safety / SoT rules

- Safe by default: if `--prepare` is omitted, run is dry-run by default.
- The helper refuses installed-cache roots; release automation is source-repo only.
- `package.json.version` is the version SoT. `.claude-plugin/plugin.json`, marketplace `plugins[0].version`, and immutable `plugins[0].source.ref = vX.Y.Z` must match it.
- Local release writes are limited to the current checked-out branch's release commit. The helper never creates a tag, pushes a ref, or guesses `main`.
- A pushed `vX.Y.Z` tag is the only publish trigger. The workflow revalidates tag/version/ref parity before any artifact or release write.
- Optional label sync updates `pi.setLabel("pi-oven v...")` only when requested.
- The installed cache remains observation-only even after release; verify sync there only after publish/install completes.
