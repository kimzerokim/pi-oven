/**
 * --reset subcommand for pi-oven setup wizard.
 * Spec E §3.3 — global reset clears managed task.agentModelOverrides role keys
 * for both canonical `pov:*` and legacy `pi-oven:*` forms. Agent files are NOT
 * touched — they are the committed DEFAULT_PROFILE baseline.
 *
 * --reset --full additionally resets setup-owned routing keys (modelRoles,
 * retry.fallbackChains, setupVersion) to their omp type-defaults so config.yml
 * returns to the "new user" state for a clean uninstall. omp-internal keys (e.g.
 * lastChangelogVersion) are NEVER touched.
 */

import { deleteGlobalAgentModelOverrides, resetConfigKey } from "./config-yml";
import type { ConfigYmlOpts } from "./config-yml";
import { clearSetupComplete, clearSetupCompleteGlobal } from "./project-config";
import {
  clearProjectAgentModelOverrides,
  clearProjectIncludedSkills,
  clearProjectOrchestrator,
  projectSettingsPath,
} from "./project-settings";

export interface ResetOptions {
  /** Injectable spawn for omp config get/set (tests). */
  spawnFn?: ConfigYmlOpts["spawnFn"];
  /** Project root whose setup-completion marker is cleared (default cwd). */
  cwd?: string;
  /**
   * Full reset: in addition to the global managed override removal, reset the
   * other pi-oven-managed config.yml keys (modelRoles, disabledProviders,
   * setupVersion) to their omp defaults. Off by default. In project scope,
   * --full additionally clears the project modelRoles + retry.fallbackChains
   * from `<cwd>/.omp/settings.json`.
   */
  full?: boolean;
  /**
   * WHICH layer is reset:
   *   - "global" (default) → homedir-global config.yml; the GLOBAL
   *     setup-completion marker is cleared.
   *   - "project" → `<cwd>/.omp/settings.json` `pi-oven:*` overrides (and, with
   *     --full, modelRoles + retry.fallbackChains); the PROJECT marker is cleared.
   */
  scope?: "global" | "project";
  /**
   * Home directory whose global `~/.pi-oven/config.json` marker is cleared in the
   * global branch (default `os.homedir()`). Injectable for tests so a global reset
   * never touches the real ~/.pi-oven.
   */
  homeDir?: string;
}

/** pi-oven-managed config.yml keys reset by `--reset --full`. */
const FULL_RESET_KEYS = ["modelRoles", "retry.fallbackChains", "setupVersion"] as const;

/**
 * Global reset clears managed role overrides for known roles in either prefix
 * (`pov:*` canonical or legacy `pi-oven:*`). Project reset remains scoped to the
 * current project file's legacy `pi-oven:*` layer until project migration lands.
 */
export async function runReset(
  opts?: ResetOptions
): Promise<{ exitCode: number; output: string }> {
  const scope = opts?.scope ?? "global";

  if (scope === "project") {
    const removedKeys = await clearProjectAgentModelOverrides({ cwd: opts?.cwd });
    const removedIncludedSkills = await clearProjectIncludedSkills({ cwd: opts?.cwd });

    if (opts?.full) {
      await clearProjectOrchestrator({ cwd: opts?.cwd });
    }

    await clearSetupComplete({ cwd: opts?.cwd });

    const file = projectSettingsPath(opts?.cwd ?? process.cwd());
    const fullSuffix = opts?.full
      ? `Cleared project modelRoles + retry.fallbackChains from ${file}.\n`
      : "";
    const ownershipSuffix = removedIncludedSkills
      ? `Cleared project workflow-skill ownership filter from ${file}.\n`
      : "";

    if (removedKeys.length === 0) {
      return {
        exitCode: 0,
        output:
          `Already cleared — no pi-oven:* overrides in ${file}.\n` +
          ownershipSuffix +
          fullSuffix,
      };
    }

    const list = removedKeys.map((k) => `  - ${k}`).join("\n");
    return {
      exitCode: 0,
      output:
        `Cleared ${removedKeys.length} pi-oven:* override(s) from ${file}:\n${list}\n` +
        ownershipSuffix +
        fullSuffix +
        "Run /pi-oven:setup --status to verify, or /pi-oven:setup --scope project to reconfigure.\n",
    };
  }

  const removedKeys = await deleteGlobalAgentModelOverrides(opts);

  await resetConfigKey("skills.includeSkills", opts);

  if (opts?.full) {
    for (const key of FULL_RESET_KEYS) {
      await resetConfigKey(key, opts);
    }
  }

  await clearSetupCompleteGlobal({ homeDir: opts?.homeDir });

  const fullSuffix = opts?.full
    ? `Reset pi-oven-managed config keys to defaults: ${FULL_RESET_KEYS.join(", ")}.\n`
    : "";
  const ownershipSuffix =
    'Cleared machine-global workflow-skill ownership filter: skills.includeSkills = ["pov:*"].\n';

  if (removedKeys.length === 0) {
    return {
      exitCode: 0,
      output:
        "Already cleared — no global managed role overrides in task.agentModelOverrides.\n" +
        ownershipSuffix +
        fullSuffix,
    };
  }

  const list = removedKeys.map((k) => `  - ${k}`).join("\n");
  return {
    exitCode: 0,
    output:
      `Cleared ${removedKeys.length} global managed override key(s):\n${list}\n` +
      ownershipSuffix +
      fullSuffix +
      "Run /pi-oven:setup --status to verify, or /pi-oven:setup to reconfigure.\n",
  };
}
