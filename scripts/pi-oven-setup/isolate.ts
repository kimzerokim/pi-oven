/**
 * isolate.ts — `/pi-oven:setup --isolate` / `--no-isolate`.
 *
 * Toggles omp's user-global `disabledProviders` so omp IGNORES (or re-enables)
 * the entire `~/.claude` Claude-Code layer — omc (`~/.claude/CLAUDE.md` + the omc
 * marketplace plugin) and pi-oven (`~/.claude/skills/pi-oven-*`) plus Claude
 * hooks/commands/MCP. pi-oven itself loads via the separate `omp-plugins`
 * discovery provider and is unaffected; it injects the repo-root `CLAUDE.md` in
 * place of the global one. The write is machine-global (`~/.omp/agent/config.yml`)
 * and omp-only — it never touches `~/.claude` on disk, so real Claude Code
 * sessions keep working.
 */

import {
  setPiOvenDisabledProviders,
  clearPiOvenDisabledProviders,
  PI_OVEN_MANAGED_PROVIDERS,
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
          "omp will now IGNORE the ~/.claude Claude-Code layer (omc + pi-oven).\n" +
          `  disabledProviders = [${list.join(", ")}] in ~/.omp/agent/config.yml\n` +
          "  pi-oven still loads (omp-plugins provider) and injects the repo-root CLAUDE.md.\n" +
          "  Restart omp to apply. Real Claude Code sessions are unaffected.\n",
      };
    }

    const removed = await clearPiOvenDisabledProviders(opts);
    return {
      exitCode: 0,
      output:
        removed.length > 0
          ? `Re-enabled the ~/.claude layer in omp (removed ${removed.join(", ")} from disabledProviders). Restart omp to apply.\n`
          : `No pi-oven-managed providers (${PI_OVEN_MANAGED_PROVIDERS.join(", ")}) were disabled — nothing to undo.\n`,
    };
  } catch (err) {
    return {
      exitCode: 1,
      output: `Isolation toggle failed: ${err instanceof Error ? err.message : String(err)}\n`,
    };
  }
}
