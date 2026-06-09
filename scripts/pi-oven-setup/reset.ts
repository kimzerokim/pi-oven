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

import { deletePiOvenAgentModelOverrides, resetConfigKey, clearPiOvenIgnoredSkills } from "./config-yml";
import type { ConfigYmlOpts } from "./config-yml";
import { clearSetupComplete, clearSetupCompleteGlobal } from "./project-config";
import {
  clearProjectAgentModelOverrides,
  clearProjectOrchestrator,
  projectSettingsPath,
} from "./project-settings";

export interface ResetOptions {
  /** Injectable spawn for omp config get/set (tests). */
  spawnFn?: ConfigYmlOpts["spawnFn"];
  /** Project root whose setup-completion marker is cleared (default cwd). */
  cwd?: string;
  /**
   * Full reset: in addition to the pi-oven:* override removal, reset the other
   * pi-oven-managed config.yml keys (modelRoles, disabledProviders, setupVersion)
   * to their omp defaults. Off by default (preserves the legacy --reset behavior).
   * In project scope, --full additionally clears the project modelRoles +
   * retry.fallbackChains from `<cwd>/.omp/settings.json`.
   */
  full?: boolean;
  /**
   * WHICH layer is reset:
   *   - "global" (default) → homedir-global config.yml (unchanged behavior); the
   *     GLOBAL setup-completion marker is cleared.
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
  const scope = opts?.scope ?? "global";

  // -------------------------------------------------------------------------
  // PROJECT scope: clear <cwd>/.omp/settings.json instead of the global config.
  // -------------------------------------------------------------------------
  if (scope === "project") {
    const removedKeys = await clearProjectAgentModelOverrides({ cwd: opts?.cwd });

    // Full reset: also drop the project orchestrator routing (modelRoles +
    // retry.fallbackChains) from the project settings file.
    if (opts?.full) {
      await clearProjectOrchestrator({ cwd: opts?.cwd });
    }

    // A successful project reset returns this project to "not set up" — clear the
    // PROJECT marker so the runtime shows the project checklist line again.
    await clearSetupComplete({ cwd: opts?.cwd });

    const file = projectSettingsPath(opts?.cwd ?? process.cwd());
    const fullSuffix = opts?.full
      ? `Cleared project modelRoles + retry.fallbackChains from ${file}.\n`
      : "";

    if (removedKeys.length === 0) {
      return {
        exitCode: 0,
        output:
          `Already cleared — no pi-oven:* overrides in ${file}.\n` + fullSuffix,
      };
    }

    const list = removedKeys.map((k) => `  - ${k}`).join("\n");
    return {
      exitCode: 0,
      output:
        `Cleared ${removedKeys.length} pi-oven:* override(s) from ${file}:\n${list}\n` +
        fullSuffix +
        "Run /pi-oven:setup --status to verify, or /pi-oven:setup --scope project to reconfigure.\n",
    };
  }

  // -------------------------------------------------------------------------
  // GLOBAL scope (default): clear the homedir-global config.yml (unchanged).
  // -------------------------------------------------------------------------
  const removedKeys = await deletePiOvenAgentModelOverrides(opts);

  // Also clear the pi-oven-managed ignoredSkills globs (§3.4: --reset clears them).
  // Fail-soft: a missing or record-typed skills.ignoredSkills is treated as already
  // empty — the reset overall must not fail just because this key is absent.
  try {
    await clearPiOvenIgnoredSkills(opts);
  } catch {
    // Already empty or key not present — nothing to clear.
  }

  // Full reset: return the remaining pi-oven-managed keys to omp defaults.
  if (opts?.full) {
    for (const key of FULL_RESET_KEYS) {
      await resetConfigKey(key, opts);
    }
  }

  // A successful global reset returns the user to "not set up" — clear the GLOBAL
  // marker so the runtime shows the once-per-session "not set up" notice again.
  await clearSetupCompleteGlobal({ homeDir: opts?.homeDir });

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
