---
name: pi-oven-release
description: Safe release automation for pi-oven version/manifests/changelog/publish gating
argument-hint: "[--bump major|minor|patch | --version X.Y.Z] [--from-tag vX.Y.Z] [--dry-run] [--publish] [--update-changelog] [--sync-label]"
---

# /pi-oven:release

## Resolve the plugin script dir first

pi-oven may be installed globally, so the script does NOT live under the user's project cwd. Before dispatching any `bun` command, resolve the plugin script dir once and reuse `$PI_OVEN_DIR` for every dispatch (dev cwd → `installed_plugins.json` `installPath` → cache scan via `bun -e`):

```bash
PI_OVEN_DIR="$PWD"
if [ ! -f "$PI_OVEN_DIR/scripts/pi-oven-release/index.ts" ]; then
  PI_OVEN_DIR="$(bun -e '
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const manifestPath = path.join(os.homedir(), ".omp/plugins/installed_plugins.json");
const cacheRoot = path.join(os.homedir(), ".omp/plugins/cache/plugins");
let resolved = "";

try {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  resolved = manifest?.plugins?.["pi-oven@kzk"]?.[0]?.installPath ?? "";
} catch {}

if (!resolved) {
  try {
    const entries = fs
      .readdirSync(cacheRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name.startsWith("kzk___pi-oven___"))
      .map((entry) => entry.name)
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    resolved = entries.length ? path.join(cacheRoot, entries[entries.length - 1]) : "";
  } catch {}
}

process.stdout.write(resolved);
')"
fi
[ -n "$PI_OVEN_DIR" ] || { echo "pi-oven install not found" >&2; exit 1; }
```

Use `bun "${PI_OVEN_DIR%/}/scripts/pi-oven-release/index.ts" <args>` — never a cwd-relative `bun` call against `scripts/pi-oven-release/index.ts` (that breaks on global installs where cwd ≠ plugin dir).

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
