/**
 * --apply subcommand for pi-oven setup wizard.
 * Spec E §3.3 — MAINTAINER-GENERATE ONLY.
 * Generates repo agents/ frontmatter from PROFILE_A/B via agent-rewriter.
 * Does NOT write plugin-config keys. Personal override is the --override path (Task 2.1).
 */

import { rewriteAllAgents } from "./agent-rewriter";
import { runValidate } from "./validate";
import { PROFILE_A, PROFILE_B, type ProfileMap } from "./profiles";

export interface ApplyOptions {
  profile: "A" | "B";
  validateMode?: "smoke" | "full" | "none";
  spawnFn?: (cmd: string, args: string[]) => { exitCode: number | null; stdout?: Buffer; stderr?: Buffer };
  agentsDir?: string; // maintainer generate target (repo agents/)
}

/**
 * Apply a profile (maintainer-generate only):
 * 1. Resolve profileMap = PROFILE_A or PROFILE_B.
 * 2. If agentsDir provided, rewrite agent files (maintainer generate).
 * 3. runValidate per validateMode (default smoke).
 * 4. Return exit 0 if all ok; exit 1 if validation fails.
 *
 * Does NOT write any plugin-config (omp plugin config set) keys.
 * Personal override is the --override path (runOverride, Task 2.1).
 */
export async function runApply(
  opts: ApplyOptions
): Promise<{ exitCode: number; output: string }> {
  const profileMap: ProfileMap = opts.profile === "B" ? PROFILE_B : PROFILE_A;

  // Rewrite agent files (maintainer generate — only when agentsDir given)
  if (opts.agentsDir) {
    await rewriteAllAgents(opts.agentsDir, profileMap);
  }

  // Validate
  const validateMode = opts.validateMode ?? "smoke";
  const validateResult = await runValidate(profileMap, {
    mode: validateMode,
    spawnFn: opts.spawnFn,
  });

  if (!validateResult.ok) {
    const unverifiedList = validateResult.unverified.join(", ");
    return {
      exitCode: 1,
      output:
        `Profile ${opts.profile} applied but validation failed.\n` +
        `Unverified roles: ${unverifiedList}\n` +
        `Run /pi-oven:setup to reconfigure, or /pi-oven:setup --reset to return to defaults.\n`,
    };
  }

  const verifiedCount = validateResult.verified.length + validateResult.alternates.length;
  const alternateCount = validateResult.alternates.length;
  const summaryParts: string[] = [`${verifiedCount} roles verified`];
  if (alternateCount > 0) {
    summaryParts.push(`${alternateCount} alternate only`);
  }

  return {
    exitCode: 0,
    output:
      `Profile ${opts.profile} active. ${summaryParts.join(", ")}.\n` +
      `Setup complete.\n`,
  };
}
