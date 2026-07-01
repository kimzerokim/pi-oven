/**
 * suppress-sibling.ts — `/pi-oven:setup --suppress-sibling-skills` /
 * `--no-suppress-sibling-skills`.
 *
 * Opt-in toggle that writes `skills.ignoredSkills` in omp's user-global
 * `~/.omp/agent/config.yml` so omp hides the shipped sibling marketplace
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
          "omp will now HIDE sibling marketplace skills from the model.\n" +
          `  skills.ignoredSkills = [${list.join(", ")}] in ~/.omp/agent/config.yml\n` +
          `  Hidden: ${[...PI_OVEN_SIBLING_SKILL_GLOBS].join(", ")}\n` +
          "  pi-oven:* skills are unaffected and remain fully available.\n" +
          "  Note (provenance): clearing this later also removes identical user-set globs.\n" +
          "  Restart omp to apply.\n",
      };
    }

    const removed = await clearPiOvenIgnoredSkills(opts);
    return {
      exitCode: 0,
      output:
        removed.length > 0
          ? `Re-enabled sibling skills in omp (removed ${removed.join(", ")} from skills.ignoredSkills). Restart omp to apply.\n`
          : `No pi-oven-managed skill globs (${[...PI_OVEN_SIBLING_SKILL_GLOBS].join(", ")}) were suppressed — nothing to undo.\n`,
    };
  } catch (err) {
    return {
      exitCode: 1,
      output: `Sibling-skill suppression toggle failed: ${err instanceof Error ? err.message : String(err)}\n`,
    };
  }
}
