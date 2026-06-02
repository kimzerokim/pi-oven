/**
 * isolate.ts — `/pi-oven:setup --isolate` / `--no-isolate`.
 *
 * Toggles omp's user-global `disabledProviders` so omp IGNORES (or re-enables)
 * the `~/.claude` Claude-Code CONTEXT layer — omc's `~/.claude/CLAUDE.md` and
 * pi-oven (`~/.claude/skills/pi-oven-*`) plus Claude hooks/commands/MCP. It
 * disables the `claude` discovery provider ONLY. It deliberately leaves
 * `claude-plugins` ENABLED, because pi-oven's own `/pi-oven:*` commands and skills
 * register through that same `claude-plugins` provider (it reads ~/.omp/plugins
 * too) — disabling it would also remove pi-oven's own commands. The accepted
 * trade-off: omc/agentmemory marketplace plugin commands (`/oh-my-claudecode:*`)
 * remain visible. pi-oven injects the repo-root `CLAUDE.md` in place of the
 * global one. The write is machine-global (`~/.omp/agent/config.yml`) and
 * omp-only — it never touches `~/.claude` on disk, so real Claude Code sessions
 * keep working.
 */

import {
  setPiOvenDisabledProviders,
  clearPiOvenDisabledProviders,
  PI_OVEN_MANAGED_PROVIDERS,
  PI_OVEN_DEPRECATED_PROVIDERS,
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
          "  pi-oven still loads via the claude-plugins provider, which stays enabled.\n" +
          "  Note: omc/agentmemory marketplace plugin commands remain visible.\n" +
          "  pi-oven injects the repo-root CLAUDE.md in place of the global one.\n" +
          "  Restart omp to apply. Real Claude Code sessions are unaffected.\n",
      };
    }

    const removed = await clearPiOvenDisabledProviders(opts);
    const undoSet = [...PI_OVEN_MANAGED_PROVIDERS, ...PI_OVEN_DEPRECATED_PROVIDERS];
    return {
      exitCode: 0,
      output:
        removed.length > 0
          ? `Re-enabled the ~/.claude layer in omp (removed ${removed.join(", ")} from disabledProviders). Restart omp to apply.\n`
          : `No pi-oven-managed providers (${undoSet.join(", ")}) were disabled — nothing to undo.\n`,
    };
  } catch (err) {
    return {
      exitCode: 1,
      output: `Isolation toggle failed: ${err instanceof Error ? err.message : String(err)}\n`,
    };
  }
}
