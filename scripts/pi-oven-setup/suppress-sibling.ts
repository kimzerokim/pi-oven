/**
 * suppress-sibling.ts — legacy skill-visibility compatibility filter toggle.
 *
 * Writes `skills.ignoredSkills` in omp's user-global
 * `~/.omp/agent/config.yml` so omp hides the shipped legacy marketplace
 * skill globs selected by `PI_OVEN_SIBLING_SKILL_GLOBS`
 * from the model. This is
 * GLOBAL-ONLY — it never writes to a project `.omp/settings.json`.
 *
 * Design decisions (§3.4):
 *   - agentmemory:* is excluded (non-overlapping memory tools, D5).
 *   - Idempotent (union/diff semantics, same as disabledProviders).
 *   - Provenance-loss: clear also removes identical user-set globs since
 *     there is no ownership tracking (same inherent property as
 *     clearPiOvenDisabledProviders). This is documented in the output.
 */

import {
  setPiOvenIgnoredSkills,
  clearPiOvenIgnoredSkills,
  PI_OVEN_SIBLING_SKILL_GLOBS,
  LEGACY_FRONT_DOOR_BOUNDARY_LINE,
  type ConfigYmlOpts,
} from "./config-yml";

export async function runSuppressSibling(
  opts: { enable: boolean } & ConfigYmlOpts
): Promise<{ exitCode: number; output: string }> {
  try {
    if (opts.enable) {
      const list = await setPiOvenIgnoredSkills(opts);
      return {
        exitCode: 0,
        output:
          "omp will now apply the legacy skill-visibility compatibility aid.\n" +
          `  skills.ignoredSkills = [${list.join(", ")}] in ~/.omp/agent/config.yml\n` +
          `  Filtered globs: ${[...PI_OVEN_SIBLING_SKILL_GLOBS].join(", ")}\n` +
          "  This is a compatibility helper only; it does not establish workflow-skill ownership.\n" +
          "  Empty ~/.claude/skills is not the target state; populated Claude user workflow skills can stay in place for other users.\n" +
          "  pov:* skills are unaffected and remain fully available.\n" +
          "  Note: this does not disable claude-plugins or unrelated namespaced marketplace workflow skills.\n" +
          "  Note (provenance): clearing this later also removes identical user-set globs.\n" +
          `  ${LEGACY_FRONT_DOOR_BOUNDARY_LINE}\n` +
          "  Restart omp to apply.\n",
      };
    }

    const removed = await clearPiOvenIgnoredSkills(opts);
    return {
      exitCode: 0,
      output:
        removed.length > 0
          ? `Cleared the legacy skill-visibility compatibility aid in omp (removed ${removed.join(", ")} from skills.ignoredSkills).\n  ${LEGACY_FRONT_DOOR_BOUNDARY_LINE}\n  Restart omp to apply.\n`
          : `No pi-oven-managed legacy skill-filter globs (${[...PI_OVEN_SIBLING_SKILL_GLOBS].join(", ")}) were active — no compatibility aid to undo.\n  ${LEGACY_FRONT_DOOR_BOUNDARY_LINE}\n`,
    };
  } catch (err) {
    return {
      exitCode: 1,
      output: `Legacy skill-visibility compatibility aid failed: ${err instanceof Error ? err.message : String(err)}\n`,
    };
  }
}
