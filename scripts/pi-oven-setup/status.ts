/**
 * --status subcommand for pi-oven setup wizard.
 * Spec B §2.1: output current profile and resolved model per role.
 */

import { readPluginConfig } from "./persist";
import { readAgentFiles, detectDrift } from "./agent-rewriter";
import { ROLES, PROFILE_A, PROFILE_B, type ProfileMap } from "./profiles";

export interface StatusOptions {
  /** Override lock file path (for tests). */
  lockFilePath?: string;
  /** Override agents directory (for tests). */
  agentsDir?: string;
}

export async function runStatus(
  opts?: StatusOptions
): Promise<{ exitCode: number; output: string }> {
  const config = await readPluginConfig({ lockFilePath: opts?.lockFilePath });
  const profile = config["pi-oven.profile"];

  if (!profile) {
    return {
      exitCode: 0,
      output: "Profile not configured. Run /pi-oven:setup to initialize.\n",
    };
  }

  const lines: string[] = [];
  lines.push(`Profile ${profile} active`);

  if (profile === "B") {
    const anthropicEnabled = config["pi-oven.provider.anthropic.enabled"];
    lines.push(`Anthropic opt-in: ${anthropicEnabled === "true" ? "enabled" : "disabled"}`);
  }

  lines.push("");
  lines.push("Role model summary:");

  // Use per-role config if available, otherwise fall back to profile defaults
  const profileMap: ProfileMap = profile === "B" ? PROFILE_B : PROFILE_A;

  for (const role of ROLES) {
    const primaryKey = `pi-oven.models.${role}.primary`;
    const primary = config[primaryKey] ?? profileMap[role].primary;
    lines.push(`  ${role.padEnd(22)} ${primary}`);
  }

  // Drift detection
  if (opts?.agentsDir) {
    const configProfileMap = buildConfigProfileMap(config, profileMap);
    const drift = await detectDrift(opts.agentsDir, configProfileMap);
    if (drift.length > 0) {
      lines.push("");
      lines.push(`WARNING: ${drift.length} role(s) have agent files that drift from plugin config.`);
      lines.push("Run /pi-oven:setup --reapply to sync agent files with persisted config.");
      for (const d of drift) {
        lines.push(`  ${d.role}: file=[${d.fileModel.join(", ")}] config=[${d.configModel.join(", ")}]`);
      }
    }
  }

  return {
    exitCode: 0,
    output: lines.join("\n") + "\n",
  };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Build a ProfileMap using per-role config values where available,
 * falling back to profile defaults for unspecified roles.
 */
function buildConfigProfileMap(
  config: Record<string, string>,
  defaultMap: ProfileMap
): ProfileMap {
  const result = { ...defaultMap } as ProfileMap;

  for (const role of ROLES) {
    const primary = config[`pi-oven.models.${role}.primary`];
    const registry_alternate = config[`pi-oven.models.${role}.registry_alternate`];
    const thinkingLevel = config[`pi-oven.models.${role}.thinkingLevel`] as ProfileMap[typeof role]["thinkingLevel"];

    if (primary || registry_alternate || thinkingLevel) {
      result[role] = {
        primary: primary ?? defaultMap[role].primary,
        registry_alternate: registry_alternate ?? defaultMap[role].registry_alternate,
        thinkingLevel: thinkingLevel ?? defaultMap[role].thinkingLevel,
      };
    }
  }

  return result;
}
