/**
 * --reset subcommand for pi-oven setup wizard.
 * Spec E §3.3 — delete only pi-oven:* keys from task.agentModelOverrides (config.yml).
 * Agent files are NOT touched — they are the committed PROFILE_A baseline.
 */

import { deletePiOvenAgentModelOverrides } from "./config-yml";
import type { ConfigYmlOpts } from "./config-yml";
import { clearSetupComplete } from "./project-config";

export interface ResetOptions {
  /** Injectable spawn for omp config get/set (tests). */
  spawnFn?: ConfigYmlOpts["spawnFn"];
  /** Project root whose setup-completion marker is cleared (default cwd). */
  cwd?: string;
}

/**
 * Delete all pi-oven:* keys from task.agentModelOverrides.
 * Preserves non-pi-oven:* keys (AC#2). Does NOT rewrite agent files.
 */
export async function runReset(
  opts?: ResetOptions
): Promise<{ exitCode: number; output: string }> {
  const removedKeys = await deletePiOvenAgentModelOverrides(opts);

  // A successful reset returns the project to "not set up" — clear the marker
  // so the runtime shows the once-per-session "not set up" notice again.
  await clearSetupComplete({ cwd: opts?.cwd });

  if (removedKeys.length === 0) {
    return {
      exitCode: 0,
      output: "Already cleared — no pi-oven:* overrides in task.agentModelOverrides.\n",
    };
  }

  const list = removedKeys.map((k) => `  - ${k}`).join("\n");
  return {
    exitCode: 0,
    output:
      `Cleared ${removedKeys.length} pi-oven:* override(s):\n${list}\n` +
      "Run /pi-oven:setup --status to verify, or /pi-oven:setup to reconfigure.\n",
  };
}
