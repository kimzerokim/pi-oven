/**
 * --reset subcommand for pi-oven setup wizard.
 * Spec B §9.5 — delete all pi-oven.* config keys, restore agent files to Profile A.
 */

import { deletePluginConfig, type DeletePluginConfigOpts } from "./persist";
import { rewriteAllAgents } from "./agent-rewriter";
import { ROLES, PROFILE_A } from "./profiles";

export interface ResetOptions {
  spawnFn?: DeletePluginConfigOpts["spawnFn"];
  agentsDir?: string;
}

/**
 * Delete all pi-oven.* config keys (71 total: 2 top-level + 23 × 3 per-role),
 * then rewrite all 23 agent files back to Profile A defaults.
 */
export async function runReset(
  opts?: ResetOptions
): Promise<{ exitCode: number; output: string }> {
  const spawnOpts = opts?.spawnFn ? { spawnFn: opts.spawnFn } : undefined;

  // Delete top-level keys
  await deletePluginConfig("pi-oven.profile", spawnOpts);
  await deletePluginConfig("pi-oven.provider.anthropic.enabled", spawnOpts);

  // Delete 3 keys × 23 roles = 69 delete calls
  for (const role of ROLES) {
    await deletePluginConfig(`pi-oven.models.${role}.primary`, spawnOpts);
    await deletePluginConfig(`pi-oven.models.${role}.registry_alternate`, spawnOpts);
    await deletePluginConfig(`pi-oven.models.${role}.thinkingLevel`, spawnOpts);
  }

  // Rewrite agent files to Profile A defaults
  if (opts?.agentsDir) {
    await rewriteAllAgents(opts.agentsDir, PROFILE_A);
  }

  return {
    exitCode: 0,
    output:
      "Config cleared. Agent files restored to Profile A defaults.\n" +
      "Run /pi-oven:setup to reconfigure, or /pi-oven:setup --status to verify.\n",
  };
}
