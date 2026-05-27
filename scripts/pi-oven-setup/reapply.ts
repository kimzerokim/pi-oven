/**
 * --reapply subcommand for pi-oven setup wizard.
 * Spec B §2.1: Re-run apply with persisted profile after omp plugin upgrade drift.
 */

import { readPluginConfig, type ReadPluginConfigOpts } from "./persist";
import { runApply, type ApplyOptions } from "./apply";

export interface ReapplyOptions {
  spawnFn?: ApplyOptions["spawnFn"];
  agentsDir?: string;
  lockFilePath?: string;
}

/**
 * Read pi-oven.profile from plugin config and re-run apply with that profile.
 * Used after `omp plugin upgrade` when drift is detected.
 */
export async function runReapply(
  opts?: ReapplyOptions
): Promise<{ exitCode: number; output: string }> {
  const config = await readPluginConfig({ lockFilePath: opts?.lockFilePath });
  const profile = config["pi-oven.profile"];

  if (!profile) {
    return {
      exitCode: 1,
      output:
        "No profile configured. Run /pi-oven:setup to initialize before using --reapply.\n",
    };
  }

  if (profile !== "A" && profile !== "B") {
    return {
      exitCode: 1,
      output:
        `Unsupported profile "${profile}" for reapply. Only A and B are supported.\n`,
    };
  }

  return runApply({
    profile,
    validateMode: "smoke",
    spawnFn: opts?.spawnFn,
    agentsDir: opts?.agentsDir,
    lockFilePath: opts?.lockFilePath,
  });
}
