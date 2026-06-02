---
name: omp-marketplace-command-namespacing
description: How omp's Claude Code Marketplace provider derives a marketplace-plugin's slash-command name from the file basename — and why command files must NOT carry the plugin-name prefix
confidence: high
captured: 2026-06-02
source: omp v15.7.6 src read (discovery/claude-plugins.ts) + live slash-command discovery probe
---

# omp Marketplace Command Namespacing

## Action

When naming command files for a marketplace plugin (pi-oven ships as
`pi-oven@pi-oven`), name each file by the bare command — `setup.md`,
`doctor.md`, `release.md` — with NO plugin-name prefix. omp builds the slash
command from the file basename, so a `pi-oven-` prefix produces a doubled
namespace.

## Why

(a) omp's "Claude Code Marketplace" discovery provider
(`src/discovery/claude-plugins.ts`) registers a marketplace plugin's commands
(and skills) as `${pluginName}:${basename(file)}` — the colon namespace. The
basename is taken verbatim from the filename.

(b) `pluginName` is parsed from the `installed_plugins.json` registry key
`<plugin>@<marketplace>`, so `pi-oven@pi-oven` → `pluginName = pi-oven`.

(c) Therefore the command file MUST be named WITHOUT the plugin-name prefix:
`setup.md` → `/pi-oven:setup`. A `pi-oven-setup.md` file registers as
`/pi-oven:pi-oven-setup` (double "pi-oven"), which never matches the documented
`/pi-oven:setup` — the command silently does not exist under its documented name.

(d) Precedent in other marketplace plugins:
- oh-my-claudecode: `ask.md` → `/oh-my-claudecode:ask`
- slack: `standup.md` → `/slack:standup`

In every case the filename carries no plugin-name prefix.

(e) The regression guard test `tests/plugin/command-namespacing.test.ts`
enforces that no file in `commands/` starts with `pi-oven-`.

(f) The command file's frontmatter `name:` field is IGNORED for slash-command
resolution — the filename basename is what wins. Do not rely on `name:` to
correct a mis-prefixed filename.

## Related

- `omp-discovery-providers.md` — the full provider model (the `claude-plugins`
  provider is what performs this registration).
- `omp-install-layout.md` — where marketplace plugins and their
  `installed_plugins.json` registry live on disk.
