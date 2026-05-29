/**
 * --status subcommand for pi-oven setup wizard.
 * Spec E §3.3 / AC#4: shows REAL effective model per role =
 *   override(pi-oven:<role>) ?? frontmatter model[0]
 * with source label: override(config.yml) / default(frontmatter).
 * Reads task.agentModelOverrides via readAgentModelOverrides (graceful, display-only).
 * Does NOT read plugin-config / detect drift.
 */

import { readAgentModelOverrides, type ConfigYmlOpts } from "./config-yml";
import { readAgentFiles } from "./agent-rewriter";
import { ROLES } from "./profiles";

export interface StatusOptions extends ConfigYmlOpts {
  /** Override agents directory (for tests). */
  agentsDir?: string;
  /** list-models fixture output (for unresolved-override warning in tests). */
  listModelsOutput?: string;
}

export async function runStatus(
  opts?: StatusOptions
): Promise<{ exitCode: number; output: string }> {
  const lines: string[] = [];

  // Header: scope
  lines.push("Effective model overrides — scope: machine-global (~/.omp/agent/config.yml)");
  lines.push("");

  // Read configured overrides (graceful: returns {} on any failure)
  const overrides = await readAgentModelOverrides(opts);

  // Read frontmatter model[0] per role from agent files
  const frontmatterMap = await buildFrontmatterMap(opts?.agentsDir);

  // Collect stray override keys (pi-oven:* keys not in ROLES)
  const strayWarnings: string[] = [];
  for (const key of Object.keys(overrides)) {
    if (key.startsWith("pi-oven:")) {
      const role = key.slice(4);
      if (!(ROLES as readonly string[]).includes(role)) {
        strayWarnings.push(`  WARNING: unknown role override key "${key}" (not in ROLES)`);
      }
    }
  }

  // Build per-role rows
  lines.push("Role model summary:");
  const unresolvedWarnings: string[] = [];

  for (const role of ROLES) {
    const colonKey = `pi-oven:${role}`;
    const overrideModel = overrides[colonKey];
    const frontmatterModel = frontmatterMap[role];

    let effectiveModel: string;
    let source: string;

    if (overrideModel !== undefined) {
      effectiveModel = overrideModel;
      source = "override(config.yml)";

      // Check resolvability if listModelsOutput provided
      if (opts?.listModelsOutput !== undefined) {
        const resolvable = isModelInList(overrideModel, opts.listModelsOutput);
        if (!resolvable) {
          unresolvedWarnings.push(
            `  WARNING: override ${role}=${overrideModel} 미해소 — session default 로 fallback 중`
          );
        }
      }
    } else if (frontmatterModel !== undefined) {
      effectiveModel = frontmatterModel;
      source = "default(frontmatter)";
    } else {
      effectiveModel = "(no agent file)";
      source = "default(frontmatter)";
    }

    lines.push(`  ${role.padEnd(24)} ${effectiveModel.padEnd(46)} [${source}]`);
  }

  // Append stray key warnings
  if (strayWarnings.length > 0) {
    lines.push("");
    lines.push(...strayWarnings);
  }

  // Append unresolved override warnings
  if (unresolvedWarnings.length > 0) {
    lines.push("");
    lines.push(...unresolvedWarnings);
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
 * Build a map of role → frontmatter model[0] by reading agent files.
 * Returns {} if agentsDir is absent or unreadable.
 */
async function buildFrontmatterMap(
  agentsDir?: string
): Promise<Record<string, string>> {
  if (!agentsDir) return {};
  const entries = await readAgentFiles(agentsDir);
  const map: Record<string, string> = {};
  for (const entry of entries) {
    if (entry.currentModel.length > 0) {
      map[entry.role] = entry.currentModel[0];
    }
  }
  return map;
}

/**
 * Check if a model id appears in a JSON list-models output.
 * list-models output is expected to be an array of objects with an "id" field.
 * Returns true if found, false if not found or if parsing fails.
 */
function isModelInList(modelId: string, listModelsOutput: string): boolean {
  try {
    const parsed = JSON.parse(listModelsOutput) as unknown;
    if (!Array.isArray(parsed)) return false;
    return parsed.some(
      (item) =>
        typeof item === "object" &&
        item !== null &&
        (item as Record<string, unknown>)["id"] === modelId
    );
  } catch {
    return false;
  }
}
