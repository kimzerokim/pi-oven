# Install Detection Survey — pi-oven

## 1. Summary
The repository currently detects installation via two distinct signals:
- **Project-local**: Presence of `.pi-oven/config.json` (specifically the `setupCompletedAt` key). This is used by the runtime extension to show a "not set up" notice and to inject project-specific settings (language).
- **Global-user**: Presence of agent files in the marketplace install cache (`~/.omp/plugins/cache/plugins/kzk___pi-oven___*`). This is used by `pi-oven:setup --status` to resolve default model routing when run outside a development checkout.

The desired policy is **global-user installation only**, but the codebase still relies on a per-project `.pi-oven/config.json` marker to suppress setup warnings.

## 2. Evidence
### Setup & Status Logic
- **File**: `scripts/pi-oven-setup.ts`
- **Logic**: Uses `resolveDefaultAgentsDir` from `scripts/pi-oven-setup/cache-resolver.ts`.
- **Finding**: Correctly resolves to the global cache if the local `agents/` directory is missing.
- **Surface**: The `markSetupComplete` function still writes to `<cwd>/.pi-oven/config.json`.

### Doctor Logic
- **File**: `scripts/pi-oven-doctor.ts`
- **Logic**: `gather(root)` uses `process.cwd()` by default and probes for `./agents` and `./skills` relative to that root.
- **Finding**: **Major fix surface.** The doctor script is currently bound to the project root and fails if run in a project that hasn't vendored `pi-oven` files.
- **Checks affected**:
  - `#6 skills`: Probes `./.claude-plugin/plugin.json` and `./skills`.
  - `#7 agents`: Probes `./agents`.

### Extension Logic
- **File**: `.omp/extensions/pi-oven.ts`
- **Logic**: Reads `<repoRoot>/.pi-oven/config.json` to set `setupComplete`.
- **Finding**: Shows a "not set up" notice if the project-local marker is missing, even if `pi-oven` is installed globally.

## 3. Effective Policy
- **Code**: Hybrid. Commands (`setup --status`) are global-aware, but the "is set up" state and `doctor` are project-local.
- **Docs**: `README.md` and `CLAUDE.md` mention `.pi-oven/config.json` as the source of truth for project setup.

## 4. Fix Surface
To move to a strictly global-user installation model while allowing project-level overrides:
1.  **Doctor**: Update `scripts/pi-oven-doctor.ts` to use `resolveDefaultAgentsDir` for finding agents/skills when they are absent from the local root.
2.  **Extension**: Modify `.omp/extensions/pi-oven.ts` to check for global installation/config before showing the "not set up" notice, OR move the setup marker to a global user config (e.g., `~/.omp/agent/config.yml` or a dedicated global `pi-oven` config).
3.  **Setup**: Redirect `markSetupComplete` to a global store if project-local persistence is not desired, though keeping `language` per-project is likely still required.
