/**
 * --apply subcommand for pi-oven setup wizard.
 * Spec B §10.3 — profile apply, persist, agent rewrite, validate.
 */

import { writePluginConfig, type WritePluginConfigOpts } from "./persist";
import { rewriteAllAgents } from "./agent-rewriter";
import { runValidate } from "./validate";
import { ROLES, PROFILE_A, PROFILE_B, type Role, type ModelEntry, type ProfileMap } from "./profiles";

export interface ApplyOptions {
  profile: "A" | "B";
  overrides?: Partial<Record<Role, Partial<ModelEntry>>>;
  validateMode?: "smoke" | "full" | "none";
  spawnFn?: WritePluginConfigOpts["spawnFn"];
  agentsDir?: string;
  lockFilePath?: string;
}

/**
 * Apply a profile: persist config, rewrite agent files, run validation.
 *
 * 1. Resolve profileMap = PROFILE_A or PROFILE_B; apply overrides.
 * 2. Persist: pi-oven.profile, pi-oven.provider.anthropic.enabled (true if B), per-role keys.
 * 3. Rewrite agent files in agentsDir (if provided).
 * 4. runValidate per validateMode (default smoke).
 * 5. Return exit 0 if all ok; exit 1 if validation fails.
 */
export async function runApply(
  opts: ApplyOptions
): Promise<{ exitCode: number; output: string }> {
  const baseMap: ProfileMap = opts.profile === "B" ? PROFILE_B : PROFILE_A;

  // Apply overrides
  const profileMap: ProfileMap = { ...baseMap };
  if (opts.overrides) {
    for (const [roleName, override] of Object.entries(opts.overrides)) {
      const role = roleName as Role;
      profileMap[role] = {
        ...baseMap[role],
        ...override,
      } as ModelEntry;
    }
  }

  const spawnOpts = opts.spawnFn ? { spawnFn: opts.spawnFn } : undefined;

  // Persist top-level keys
  await writePluginConfig("pi-oven.profile", opts.profile, spawnOpts);
  if (opts.profile === "B") {
    await writePluginConfig("pi-oven.provider.anthropic.enabled", "true", spawnOpts);
  }

  // Persist 23 × 3 per-role keys
  for (const role of ROLES) {
    const entry = profileMap[role];
    await writePluginConfig(`pi-oven.models.${role}.primary`, entry.primary, spawnOpts);
    await writePluginConfig(`pi-oven.models.${role}.registry_alternate`, entry.registry_alternate, spawnOpts);
    await writePluginConfig(`pi-oven.models.${role}.thinkingLevel`, entry.thinkingLevel, spawnOpts);
  }

  // Rewrite agent files
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
