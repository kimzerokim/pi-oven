/**
 * isolate.ts — `/pi-oven:setup --isolate` / `--no-isolate`.
 *
 * Toggles omp's user-global `disabledProviders` so omp IGNORES (or re-enables)
 * the `~/.claude` home context layer — sibling marketplace CLAUDE/skills plus
 * Claude hooks/commands/MCP discovered from that tree. It
 * disables the `claude` discovery provider ONLY. It deliberately leaves
 * `claude-plugins` ENABLED, because pi-oven's own `/pi-oven:*` commands and skills
 * register through that same `claude-plugins` provider (it reads ~/.omp/plugins
 * too) — disabling it would also remove pi-oven's own commands. The accepted
 * trade-off: sibling marketplace plugin commands that still load through
 * `claude-plugins` remain visible. pi-oven injects the repo-root `CLAUDE.md` in place of the
 * global one. The write is machine-global (`~/.omp/agent/config.yml`) and
 * omp-only — it never touches `~/.claude` on disk, so real Claude Code sessions
 * keep working.
 */

import {
  setPiOvenDisabledProviders,
  clearPiOvenDisabledProviders,
  PI_OVEN_MANAGED_PROVIDERS,
  PI_OVEN_DEPRECATED_PROVIDERS,
  LEGACY_FRONT_DOOR_BOUNDARY_LINE,
  type ConfigYmlOpts,
} from "./config-yml";

export async function runIsolate(
  opts: { enable: boolean } & ConfigYmlOpts
): Promise<{ exitCode: number; output: string }> {
  try {
    if (opts.enable) {
      const list = await setPiOvenDisabledProviders(opts);
      return {
        exitCode: 0,
        output:
          "Applied the legacy home-layer compatibility mode for omp.\n" +
          `  disabledProviders = [${list.join(", ")}] in ~/.omp/agent/config.yml\n` +
          "  This mode hides the ~/.claude home layer from omp while leaving claude-plugins enabled so pi-oven still loads.\n" +
          "  Note: marketplace plugin commands that still load via claude-plugins remain visible.\n" +
          "  pi-oven injects the repo-root CLAUDE.md in place of the global one.\n" +
          `  ${LEGACY_FRONT_DOOR_BOUNDARY_LINE}\n` +
          "  Restart omp to apply. Real Claude Code sessions are unaffected.\n",
      };
    }

    const removed = await clearPiOvenDisabledProviders(opts);
    const undoSet = [...PI_OVEN_MANAGED_PROVIDERS, ...PI_OVEN_DEPRECATED_PROVIDERS];
    return {
      exitCode: 0,
      output:
        removed.length > 0
          ? `Cleared the legacy home-layer compatibility mode in omp (removed ${removed.join(", ")} from disabledProviders).\n  ${LEGACY_FRONT_DOOR_BOUNDARY_LINE}\n  Restart omp to apply.\n`
          : `No pi-oven-managed legacy home-layer providers (${undoSet.join(", ")}) were disabled — nothing to undo.\n  ${LEGACY_FRONT_DOOR_BOUNDARY_LINE}\n`,
    };
  } catch (err) {
    return {
      exitCode: 1,
      output: `Legacy home-layer compatibility toggle failed: ${err instanceof Error ? err.message : String(err)}\n`,
    };
  }
}
