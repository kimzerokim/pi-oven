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
import {
  readProjectSettingsDisplayState,
  type ProjectSettingsDisplayState,
} from "./project-settings";
import {
  collectStandaloneTruthSignals,
  formatStandaloneTruthSignals,
} from "./standalone-truth-surface";
import * as path from "path";

export interface StatusOptions extends ConfigYmlOpts {
  /** Override agents directory (for tests). */
  agentsDir?: string;
  /** Override plugin asset root path in the truth surface (for tests). */
  pluginAssetPath?: string;
  /** list-models fixture output (for unresolved-override warning in tests). */
  listModelsOutput?: string;
  /** Project root whose `.omp/settings.json` layer is shown (default cwd). */
  cwd?: string;
}

export async function runStatus(
  opts?: StatusOptions
): Promise<{ exitCode: number; output: string }> {
  const lines: string[] = [];

  const cwd = opts?.cwd ?? process.cwd();
  const projectState = await readProjectSettingsDisplayState({ cwd });
  const projectFileLabel =
    projectState.state === "present"
      ? "present"
      : projectState.state === "absent"
      ? "absent"
      : "present but unreadable/corrupt";

  lines.push("Configured model layers — visibility/guard only; project wins per role:");
  lines.push(`  project: ${projectState.file} (${projectFileLabel})`);
  lines.push("  override: machine-global (~/.omp/agent/config.yml)");
  lines.push("  default:  agent-file frontmatter");
  lines.push("  note: runtime owns current-session provider-family choice");

  const overrides = await readAgentModelOverrides(opts);
  const projectOverrides = extractProjectOverrides(projectState);
  const frontmatterMap = await buildFrontmatterMap(opts?.agentsDir);

  const strayWarnings: string[] = [];
  const seenStray = new Set<string>();
  for (const key of [...Object.keys(overrides), ...Object.keys(projectOverrides)]) {
    if (!key.startsWith("pi-oven:") || seenStray.has(key)) continue;
    const role = key.slice("pi-oven:".length);
    if (!(ROLES as readonly string[]).includes(role)) {
      seenStray.add(key);
      strayWarnings.push(`  WARNING: unknown role override key "${key}" (not in ROLES)`);
    }
  }

  lines.push("Role model summary:");
  const unresolvedWarnings: string[] = [];

  for (const role of ROLES) {
    const colonKey = `pi-oven:${role}`;
    const projectModel = projectOverrides[colonKey];
    const overrideModel = overrides[colonKey];
    const frontmatterModel = frontmatterMap[role];

    let effectiveModel: string;
    let source: string;

    if (projectModel !== undefined) {
      effectiveModel = projectModel;
      source = "project(.omp/settings.json)";

      if (opts?.listModelsOutput !== undefined && !isModelInList(projectModel, opts.listModelsOutput)) {
        unresolvedWarnings.push(
          `  WARNING: project override ${role}=${projectModel} 미해소 — visibility layer only; runtime must diagnose/refuse unsupported mapping`
        );
      }
    } else if (overrideModel !== undefined) {
      effectiveModel = overrideModel;
      source = "override(config.yml)";

      if (opts?.listModelsOutput !== undefined && !isModelInList(overrideModel, opts.listModelsOutput)) {
        unresolvedWarnings.push(
          `  WARNING: override ${role}=${overrideModel} 미해소 — visibility layer only; runtime must diagnose/refuse unsupported mapping`
        );
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

  if (strayWarnings.length > 0) {
    lines.push("");
    lines.push(...strayWarnings);
  }

  if (unresolvedWarnings.length > 0) {
    lines.push("");
    lines.push(...unresolvedWarnings);
  }

  lines.push("");
  lines.push(
    ...formatStandaloneTruthSignals(
      await collectStandaloneTruthSignals({
        ...opts,
        pluginAssetPath:
          opts?.pluginAssetPath ??
          (opts?.agentsDir ? path.resolve(opts.agentsDir, "..") : "(plugin root unavailable)"),
        projectRoot: cwd,
      })
    )
  );

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

function extractProjectOverrides(
  projectState: ProjectSettingsDisplayState
): Record<string, string> {
  if (projectState.state !== "present") return {};

  const task = projectState.data["task"];
  if (typeof task !== "object" || task === null || Array.isArray(task)) return {};
  const overrides = (task as Record<string, unknown>)["agentModelOverrides"];
  if (typeof overrides !== "object" || overrides === null || Array.isArray(overrides)) return {};

  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(overrides as Record<string, unknown>)) {
    out[key] = String(value);
  }
  return out;
}

/**
 * Check if a model id appears in a JSON list-models output.
 * list-models output is expected to be an array of objects with an "id" field.
 * Returns true if found, false if not found or if parsing fails.
 */
function isModelInList(modelId: string, listModelsOutput: string): boolean {
  const baseModelId = modelId.replace(/:(minimal|low|medium|high|xhigh)$/, "");
  try {
    const parsed = JSON.parse(listModelsOutput) as unknown;
    if (!Array.isArray(parsed)) return false;
    return parsed.some(
      (item) =>
        typeof item === "object" &&
        item !== null &&
        (((item as Record<string, unknown>)["id"] === modelId) ||
          (item as Record<string, unknown>)["id"] === baseModelId)
    );
  } catch {
    return false;
  }
}
