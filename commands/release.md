---
name: pi-oven-release
description: Safe release automation for pi-oven version/manifests/changelog/publish gating
argument-hint: "[--bump major|minor|patch | --version X.Y.Z] [--from-tag vX.Y.Z] [--dry-run] [--publish] [--update-changelog] [--sync-label]"
---

# /pi-oven:release

## Resolve the plugin script dir first

pi-oven may be installed globally, so the script does NOT live under the user's project cwd. Before dispatching any `bun` command, resolve the plugin script dir once and reuse `$PI_OVEN_DIR` for every dispatch (dev cwd → `installed_plugins.json` `installPath` → cache glob):

```bash
PI_OVEN_DIR="$PWD"
if [ ! -f "$PI_OVEN_DIR/scripts/pi-oven-release/index.ts" ]; then
  PI_OVEN_DIR="$(jq -r '.plugins["pi-oven@kzk"][0].installPath // empty' "$HOME/.omp/plugins/installed_plugins.json" 2>/dev/null)"
  [ -z "$PI_OVEN_DIR" ] && PI_OVEN_DIR="$(ls -d "$HOME"/.omp/plugins/cache/plugins/kzk___pi-oven___*/ 2>/dev/null | sort -V | tail -1)"
fi
```

Use `bun "${PI_OVEN_DIR%/}/scripts/pi-oven-release/index.ts" <args>` — never a bare `bun scripts/pi-oven-release/index.ts` (that breaks on global installs where cwd ≠ plugin dir).

Run release automation via:

```sh
bun "${PI_OVEN_DIR%/}/scripts/pi-oven-release/index.ts" --bump patch --dry-run
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
