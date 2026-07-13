/**
 * --status subcommand for pi-oven setup wizard.
 * Spec E §3.3 / AC#4: shows REAL effective model per role using the project layer
 * first, then machine-global overrides, then agent-file frontmatter. Each scope
 * prefers canonical `pov:<role>` when both prefixes exist, diagnoses legacy-only
 * `pi-oven:<role>` global state as a migration candidate, and surfaces same-scope
 * dual-key conflicts explicitly.
 */

import {
  GLOBAL_OVERRIDE_PREFIX,
  LEGACY_GLOBAL_OVERRIDE_PREFIX,
  getManagedOverrideState,
  readOverridesStrict,
  type ConfigYmlOpts,
} from "./config-yml";
import { readAgentFiles } from "./agent-rewriter";
import { ROLES } from "./profiles";
import {
  buildSetupReadinessNotice,
  collectSetupReadiness,
} from "./project-config";
import {
  readProjectSettingsDisplayState,
  type ProjectSettingsDisplayState,
} from "./project-settings";
import {
  AGENT_NAMESPACE_DRIFT_LABEL,
  collectRuntimeTruthSurface,
  DUAL_PLUGIN_SURFACE_LABEL,
  formatRuntimeTruthSurface,
  HEALTHY_SINGLE_POV_SURFACE_LABEL,
  MIXED_MIGRATION_STATE_LABEL,
  OLD_CONFIG_KEYS_LABEL,
  PLUGIN_ROOT_UNAVAILABLE,
} from "./standalone-truth-surface";
import { existsSync } from "node:fs";
import * as path from "path";

export interface StatusOptions extends ConfigYmlOpts {
  /** Override agents directory (for tests). */
  agentsDir?: string;
  /** Override plugin asset root path in the truth surface (for tests). */
  pluginAssetPath?: string;
  /** list-models fixture output (for unresolved-override warning in tests). */
  listModelsOutput?: string;
  /** Override HOME for cache-surface diagnostics (for tests). */
  homeDir?: string;
  /** Project root whose `.omp/settings.json` layer is shown (default cwd). */
  cwd?: string;
  /** Last trusted-provider canary receipt (tests or downloaded CI artifact). */
  liveCanaryReceiptPath?: string;
}

const ROLE_NAME_MAP: Record<string, true> = Object.fromEntries(
  ROLES.map((role) => [role, true] as const)
);

function looksLikePluginRoot(root: string): boolean {
  const resolvedRoot = path.resolve(root);
  return existsSync(path.join(resolvedRoot, ".claude-plugin", "plugin.json"));
}

async function resolveStatusPluginAssetPath(
  opts: StatusOptions | undefined,
  cwd: string
): Promise<string> {
  if (opts?.pluginAssetPath) return path.resolve(opts.pluginAssetPath);
  if (opts?.agentsDir) {
    const candidate = path.resolve(opts.agentsDir, "..");
    return looksLikePluginRoot(candidate) ? candidate : PLUGIN_ROOT_UNAVAILABLE;
  }
  if (looksLikePluginRoot(cwd)) return path.resolve(cwd);
  return PLUGIN_ROOT_UNAVAILABLE;
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

  const setupReadiness = await collectSetupReadiness({
    cwd,
    spawnFn: opts?.spawnFn,
  });
  lines.push(buildSetupReadinessNotice(setupReadiness).message);
  lines.push("");

  lines.push("Configured model layers — visibility/guard only; project wins per role:");
  lines.push(`  project: ${projectState.file} (${projectFileLabel})`);
  lines.push(
    `  override: machine-global (~/.omp/agent/config.yml; ${HEALTHY_SINGLE_POV_SURFACE_LABEL} / ${OLD_CONFIG_KEYS_LABEL} / ${MIXED_MIGRATION_STATE_LABEL} input)`
  );
  lines.push("  default:  agent-file frontmatter");
  lines.push("  note: runtime owns current-session provider-family choice");
  lines.push(
    `  note: workflow-skill ownership below reaches the ${HEALTHY_SINGLE_POV_SURFACE_LABEL} only when the effective skills.includeSkills surface resolves to ["pov:*"], not when ~/.claude/skills happens to be empty`
  );
  lines.push(
    `  note: ${DUAL_PLUGIN_SURFACE_LABEL}, ${AGENT_NAMESPACE_DRIFT_LABEL}, and bootstrap-level gajae parity are reported separately; only the first two describe stale migration/install state`
  );

  const globalRead = await readOverridesStrict(opts);
  const globalOverrides = globalRead.ok ? globalRead.record : {};
  const projectOverrides = extractProjectOverrides(projectState);
  const { map: frontmatterMap, warnings: agentSurfaceWarnings } =
    await buildFrontmatterMap(opts?.agentsDir);

  const strayWarnings: string[] = [];
  const conflictWarnings: string[] = [];
  const migrationWarnings: string[] = [];
  const mixedScopeWarnings: string[] = [];
  const partialProjectWarnings: string[] = [];
  const unresolvedWarnings: string[] = [];
  const healthyWarnings: string[] = [];
  const seenStray: Record<string, true> = {};
  let hasManagedOverrides = false;
  let hasLiveLegacyKeys = false;
  let hasManagedConflicts = false;

  if (Object.keys(projectOverrides).length > 0 && projectState.state === "present") {
    const gaps: string[] = [];

    const skills = projectState.data["skills"];
    const includeSkills =
      typeof skills === "object" && skills !== null && !Array.isArray(skills)
        ? (skills as Record<string, unknown>).includeSkills
        : undefined;
    if (!Array.isArray(includeSkills) || includeSkills.length !== 1 || includeSkills[0] !== "pov:*") {
      gaps.push('skills.includeSkills=["pov:*"]');
    }

    const modelRoles = projectState.data["modelRoles"];
    const hasProjectModelRoles =
      typeof modelRoles === "object" &&
      modelRoles !== null &&
      !Array.isArray(modelRoles) &&
      typeof (modelRoles as Record<string, unknown>).default === "string" &&
      typeof (modelRoles as Record<string, unknown>).title === "string";
    if (!hasProjectModelRoles) {
      gaps.push("modelRoles.default/title");
    }

    const retry = projectState.data["retry"];
    const fallbackChains =
      typeof retry === "object" && retry !== null && !Array.isArray(retry)
        ? (retry as Record<string, unknown>).fallbackChains
        : undefined;
    if (
      typeof fallbackChains !== "object" ||
      fallbackChains === null ||
      Array.isArray(fallbackChains)
    ) {
      gaps.push("retry.fallbackChains");
    }

    if (gaps.length > 0) {
      partialProjectWarnings.push(
        `  PARTIAL: project routing is present but setup-owned companion keys are missing or malformed: ${gaps.join(", ")}`
      );
    }
  }
  for (const key of [...Object.keys(globalOverrides), ...Object.keys(projectOverrides)]) {
    const role = key.startsWith(GLOBAL_OVERRIDE_PREFIX)
      ? key.slice(GLOBAL_OVERRIDE_PREFIX.length)
      : key.startsWith(LEGACY_GLOBAL_OVERRIDE_PREFIX)
      ? key.slice(LEGACY_GLOBAL_OVERRIDE_PREFIX.length)
      : null;
    if (role === null || seenStray[key]) continue;
    if (!ROLE_NAME_MAP[role]) {
      seenStray[key] = true;
      strayWarnings.push(`  WARNING: unknown role override key "${key}" (not in ROLES)`);
    }
  }

  lines.push("Role model summary:");

  for (const role of ROLES) {
    const projectRoleState = getManagedOverrideState(projectOverrides, role);
    const globalRoleState = getManagedOverrideState(globalOverrides, role);
    const frontmatterModel = frontmatterMap[role];

    let effectiveModel: string;
    let source: string;
    let warningPrefix: string | null = null;

    const roleHasManagedOverride =
      projectRoleState.effectiveValue !== undefined ||
      globalRoleState.effectiveValue !== undefined;
    hasManagedOverrides = hasManagedOverrides || roleHasManagedOverride;
    hasLiveLegacyKeys =
      hasLiveLegacyKeys ||
      projectRoleState.legacyValue !== undefined ||
      globalRoleState.legacyValue !== undefined;
    hasManagedConflicts =
      hasManagedConflicts ||
      projectRoleState.kind === "conflict" ||
      globalRoleState.kind === "conflict";

    if (projectRoleState.effectiveValue !== undefined) {
      effectiveModel = projectRoleState.effectiveValue;
      warningPrefix = "project override";
      if (projectRoleState.kind === "canonical") {
        source = `project(.omp/settings.json ${HEALTHY_SINGLE_POV_SURFACE_LABEL})`;
        if (globalRoleState.kind === "legacy-only") {
          mixedScopeWarnings.push(
            `  ${MIXED_MIGRATION_STATE_LABEL}: machine-global ${globalRoleState.legacyKey}=${globalRoleState.legacyValue} still uses ${OLD_CONFIG_KEYS_LABEL} while project ${projectRoleState.canonicalKey}=${projectRoleState.canonicalValue} is already on the ${HEALTHY_SINGLE_POV_SURFACE_LABEL}; project still wins for ${role}`
          );
        }
      } else if (projectRoleState.kind === "legacy-only") {
        source = `project(.omp/settings.json ${OLD_CONFIG_KEYS_LABEL})`;
        migrationWarnings.push(
          `  ${OLD_CONFIG_KEYS_LABEL}: project override ${projectRoleState.legacyKey}=${projectRoleState.legacyValue} still uses pi-oven:* in .omp/settings.json`
        );
        if (globalRoleState.kind === "canonical") {
          mixedScopeWarnings.push(
            `  ${MIXED_MIGRATION_STATE_LABEL}: project ${projectRoleState.legacyKey}=${projectRoleState.legacyValue} still uses ${OLD_CONFIG_KEYS_LABEL} while machine-global ${globalRoleState.canonicalKey}=${globalRoleState.canonicalValue} is already on the ${HEALTHY_SINGLE_POV_SURFACE_LABEL}; project still wins for ${role}`
          );
        }
      } else {
        source = `project(.omp/settings.json ${MIXED_MIGRATION_STATE_LABEL}; preferring pov:*)`;
        conflictWarnings.push(
          `  ${MIXED_MIGRATION_STATE_LABEL}: project scope has both ${projectRoleState.canonicalKey}=${projectRoleState.canonicalValue} and ${projectRoleState.legacyKey}=${projectRoleState.legacyValue}; status prefers pov:*`
        );
      }
    } else if (globalRoleState.effectiveValue !== undefined) {
      effectiveModel = globalRoleState.effectiveValue;
      warningPrefix = "override";
      if (globalRoleState.kind === "canonical") {
        source = `override(config.yml ${HEALTHY_SINGLE_POV_SURFACE_LABEL})`;
      } else if (globalRoleState.kind === "legacy-only") {
        source = `override(config.yml ${OLD_CONFIG_KEYS_LABEL})`;
        migrationWarnings.push(
          `  ${OLD_CONFIG_KEYS_LABEL}: machine-global ${globalRoleState.legacyKey}=${globalRoleState.legacyValue} is legacy-only; next successful global write rewrites it to ${globalRoleState.canonicalKey}`
        );
      } else {
        source = `override(config.yml ${MIXED_MIGRATION_STATE_LABEL}; preferring pov:*)`;
        conflictWarnings.push(
          `  ${MIXED_MIGRATION_STATE_LABEL}: global scope has both ${globalRoleState.canonicalKey}=${globalRoleState.canonicalValue} and ${globalRoleState.legacyKey}=${globalRoleState.legacyValue}; status prefers pov:* and global write paths refuse this mixed state`
        );
      }
    } else if (frontmatterModel !== undefined) {
      effectiveModel = frontmatterModel;
      source = "default(frontmatter)";
    } else {
      effectiveModel = "(no agent file)";
      source = "default(frontmatter)";
    }


    if (
      warningPrefix !== null &&
      opts?.listModelsOutput !== undefined &&
      !isModelInList(effectiveModel, opts.listModelsOutput)
    ) {
      unresolvedWarnings.push(
        `  WARNING: ${warningPrefix} ${role}=${effectiveModel} 미해소 — visibility layer only; runtime must diagnose/refuse unsupported mapping`
      );
    }

    lines.push(`  ${role.padEnd(24)} ${effectiveModel.padEnd(46)} [${source}]`);
  }
  if (
    hasManagedOverrides &&
    !hasLiveLegacyKeys &&
    !hasManagedConflicts &&
    partialProjectWarnings.length === 0
  ) {
    healthyWarnings.push(
      `  ${HEALTHY_SINGLE_POV_SURFACE_LABEL}: all live managed overrides use canonical pov:* keys across project and machine-global scopes`
    );
  }

  if (strayWarnings.length > 0) {
    lines.push("");
    lines.push(...strayWarnings);
  }

  if (conflictWarnings.length > 0) {
    lines.push("");
    lines.push(...conflictWarnings);
  }

  if (migrationWarnings.length > 0) {
    lines.push("");
    lines.push(...migrationWarnings);
  }

  if (mixedScopeWarnings.length > 0) {
    lines.push("");
    lines.push(...mixedScopeWarnings);
  }

  if (partialProjectWarnings.length > 0) {
    lines.push("");
    lines.push(...partialProjectWarnings);
  }

  if (agentSurfaceWarnings.length > 0) {
    lines.push("");
    lines.push(...agentSurfaceWarnings);
  }

  if (healthyWarnings.length > 0) {
    lines.push("");
    lines.push(...healthyWarnings);
  }

  if (unresolvedWarnings.length > 0) {
    lines.push("");
    lines.push(...unresolvedWarnings);
  }

  const pluginAssetPath = await resolveStatusPluginAssetPath(opts, cwd);
  const runtimeTruth = await collectRuntimeTruthSurface({
    ...opts,
    pluginAssetPath,
    projectRoot: cwd,
  });
  lines.push("");
  lines.push(formatRuntimeTruthSurface(runtimeTruth));

  return {
    exitCode: runtimeTruth.checks.some(({ status }) => status === "FAIL") ? 1 : 0,
    output: lines.join("\n") + "\n",
  };
}

/**
 * Build a map of role → frontmatter model[0] by reading canonical agent files.
 * Also returns actionable agent-namespace-drift warnings when setup is pointed at
 * a stale legacy agent surface.
 */
async function buildFrontmatterMap(
  agentsDir?: string
): Promise<{ map: Record<string, string>; warnings: string[] }> {
  if (!agentsDir) return { map: {}, warnings: [] };
  try {
    const entries = await readAgentFiles(agentsDir);
    const map: Record<string, string> = {};
    for (const entry of entries) {
      if (entry.currentModel.length > 0) {
        map[entry.role] = entry.currentModel[0];
      }
    }
    return { map, warnings: [] };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("Legacy agent filenames detected")) {
      return {
        map: {},
        warnings: [`  ${AGENT_NAMESPACE_DRIFT_LABEL}: ${message}`],
      };
    }
    return { map: {}, warnings: [] };
  }
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
    if (typeof value === "string") out[key] = value;
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
