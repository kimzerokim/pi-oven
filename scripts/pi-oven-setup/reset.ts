/**
 * --reset subcommand for pi-oven setup wizard.
 * Spec E §3.3 — delete only pi-oven:* keys from task.agentModelOverrides (config.yml).
 * Agent files are NOT touched — they are the committed PROFILE_A baseline.
 *
 * --reset --full additionally resets the other pi-oven-managed keys (modelRoles,
 * disabledProviders, setupVersion) to their omp type-defaults so config.yml
 * returns to the "new user" state for a clean uninstall. omp-internal keys (e.g.
 * lastChangelogVersion) are NEVER touched.
 */

import { deletePiOvenAgentModelOverrides, resetConfigKey } from "./config-yml";
import type { ConfigYmlOpts } from "./config-yml";
import { clearSetupComplete } from "./project-config";

export interface ResetOptions {
  /** Injectable spawn for omp config get/set (tests). */
  spawnFn?: ConfigYmlOpts["spawnFn"];
  /** Project root whose setup-completion marker is cleared (default cwd). */
  cwd?: string;
  /**
   * Full reset: in addition to the pi-oven:* override removal, reset the other
   * pi-oven-managed config.yml keys (modelRoles, disabledProviders, setupVersion)
   * to their omp defaults. Off by default (preserves the legacy --reset behavior).
   */
  full?: boolean;
}

/** pi-oven-managed config.yml keys reset by `--reset --full` (Spec E). */
const FULL_RESET_KEYS = ["modelRoles", "disabledProviders", "setupVersion"] as const;

/**
 * Delete all pi-oven:* keys from task.agentModelOverrides.
 * Preserves non-pi-oven:* keys (AC#2). Does NOT rewrite agent files.
 * When opts.full is set, ALSO resets modelRoles / disabledProviders /
 * setupVersion to their omp defaults (no-op-safe — reset is idempotent and never
 * touches omp-internal keys like lastChangelogVersion).
 */
export async function runReset(
  opts?: ResetOptions
): Promise<{ exitCode: number; output: string }> {
  const removedKeys = await deletePiOvenAgentModelOverrides(opts);

  // Full reset: return the remaining pi-oven-managed keys to omp defaults.
  if (opts?.full) {
    for (const key of FULL_RESET_KEYS) {
      await resetConfigKey(key, opts);
    }
  }

  // A successful reset returns the project to "not set up" — clear the marker
  // so the runtime shows the once-per-session "not set up" notice again.
  await clearSetupComplete({ cwd: opts?.cwd });

  const fullSuffix = opts?.full
    ? `Reset pi-oven-managed config keys to defaults: ${FULL_RESET_KEYS.join(", ")}.\n`
    : "";

  if (removedKeys.length === 0) {
    return {
      exitCode: 0,
      output:
        "Already cleared — no pi-oven:* overrides in task.agentModelOverrides.\n" +
        fullSuffix,
    };
  }

  const list = removedKeys.map((k) => `  - ${k}`).join("\n");
  return {
    exitCode: 0,
    output:
      `Cleared ${removedKeys.length} pi-oven:* override(s):\n${list}\n` +
      fullSuffix +
      "Run /pi-oven:setup --status to verify, or /pi-oven:setup to reconfigure.\n",
  };
}
