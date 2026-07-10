import { existsSync } from "node:fs";
import * as path from "node:path";
import {
  formatSkillKeywordIndexIssues,
  loadSkillKeywordIndexReport,
} from "../../.omp/extensions/pi-oven-runtime/skill-keyword-loader";
import {
  PI_OVEN_WORKFLOW_SKILL_INCLUDE,
  PI_OVEN_SIBLING_SKILL_GLOBS,
  PI_OVEN_MANAGED_PROVIDERS,
  PI_OVEN_DEPRECATED_PROVIDERS,
  readConfigValueDisplayState,
  readDisabledProvidersDisplayState,
  readIgnoredSkillsDisplayState,
  readIncludedSkillsDisplayState,
  type ConfigYmlOpts,
  type DisplayReadResult,
} from "./config-yml";
import {
  detectDuplicatePluginSurface,
} from "./cache-resolver";
import {
  SETUP_GLOBAL_PREREQUISITES,
  classifySetupPrerequisiteState,
  countPiOvenRoutingEntries,
  type SetupPrerequisiteTruthState,
} from "./project-config";
import {
  readProjectSettingsDisplayState,
  type ProjectSettingsDisplayState,
} from "./project-settings";
import {
  describeNativeWorkerRuntime,
  resolveNativeWorkerRuntimeStatus,
  type NativeWorkerRuntimeStatus,
} from "../pi-oven-team";

export type StandaloneTruthLevel = "INFO" | "WARN";

export interface StandaloneTruthSignal {
  level: StandaloneTruthLevel;
  name: string;
  detail: string;
  fix?: string;
}

type KeywordIndexTruthState = "ok" | "partial" | "unavailable" | "unknown";

export interface StandaloneTruthFacts {
  pluginAssetPath: string;
  projectRoot: string;
  projectSettingsFile: string;
  projectRoutingRoleCount: number | null;
  projectRoutingState: "present" | "absent" | "unknown";
  globalPrerequisiteStates: Array<{ key: string; state: SetupPrerequisiteTruthState }>;
  globalIncludedSkillsState: DisplayReadResult<string[]>;
  globalIgnoredSkillsState: DisplayReadResult<string[]>;
  globalDisabledProvidersState: DisplayReadResult<string[]>;
  projectIncludedSkillsState: DisplayReadResult<string[]>;
  keywordIndexTruth?: {
    state: KeywordIndexTruthState;
    loadedCount: number;
    shippedSkillCount: number;
    issues: string[];
    error?: string;
  };
  duplicatePluginSurface?: {
    activePluginRoot: string;
    cachePluginRoot: string;
    cacheIssues: string[];
    cacheLoadedCount: number;
    cacheShippedSkillCount: number;
  };
  nativeWorkerRuntime: NativeWorkerRuntimeStatus;
}

export const GLOBAL_CONFIG_PATH = "~/.omp/agent/config.yml";
export const PROJECT_SCOPE_GLOBAL_REMEDIATION_FIX =
  "Run /pi-oven:setup --repair-prereqs on this machine to restore those prerequisites. Project scope does not write ~/.omp/agent/config.yml.";
export const PROJECT_SCOPE_FILE_REPAIR_FIX =
  "Repair or remove the project's .omp/settings.json, then rerun /pi-oven:setup --status.";
export const NATIVE_WORKER_RUNTIME_FIX =
  "Restore the vendored native worker launcher under scripts/pi-oven-team/ or reinstall pi-oven@kzk.";
export const KEYWORD_SKILL_INTEGRITY_FIX =
  "Sync .claude-plugin/plugin.json skills[], shipped SKILL frontmatter names, and SKILL_KEYWORD_WHITELIST entries. Reinstall pi-oven@kzk if installed assets are stale.";
export const WORKFLOW_SKILL_OWNERSHIP_FIX =
  'Run /pi-oven:setup on the intended scope so the effective workflow-skill surface writes skills.includeSkills = ["pov:*"] at that omp config layer.';
export const PLUGIN_SURFACE_DRIFT_FIX =
  "Remove or refresh the stale duplicate plugin surface so runtime/setup/doctor all resolve the same active pi-oven root.";
export const PLUGIN_ROOT_UNAVAILABLE = "(plugin root unavailable)";
export const WORKFLOW_SKILL_OWNERSHIP_SIGNAL_NAME = "workflow-skill ownership";
export const BOOTSTRAP_PARITY_TRACK_SIGNAL_NAME = "bootstrap parity track";
export const HEALTHY_SINGLE_POV_SURFACE_LABEL = "healthy single pov surface";
export const OLD_CONFIG_KEYS_LABEL = "old config keys";
export const DUAL_PLUGIN_SURFACE_LABEL = "dual plugin surface";
export const MIXED_MIGRATION_STATE_LABEL = "mixed migration state";
export const AGENT_NAMESPACE_DRIFT_LABEL = "agent namespace drift";

export type WorkflowSkillOwnershipClassification =
  | "owned-surface active"
  | "compatibility aids only"
  | "ownership not established";

export function isWorkflowSkillOwnershipClassification(
  value: string
): value is WorkflowSkillOwnershipClassification {
  return (
    value === "owned-surface active" ||
    value === "compatibility aids only" ||
    value === "ownership not established"
  );
}

export function extractWorkflowSkillOwnershipClassification(
  detail: string
): WorkflowSkillOwnershipClassification | null {
  const classification = detail.match(
    /classification:\s+(owned-surface active|compatibility aids only|ownership not established)\./
  )?.[1];
  return classification && isWorkflowSkillOwnershipClassification(classification)
    ? classification
    : null;
}

const CLAUDE_SKILLS_PRESERVATION_NOTE =
  "Empty ~/.claude/skills is not the target state; populated Claude user workflow skills should remain intact for other users.";
const LEGACY_COMPATIBILITY_AIDS_LIMITATION =
  "Legacy compatibility aids do not by themselves stop claude-plugins or namespaced marketplace workflow skills.";

function normalizeStringArrayDisplayState(
  value: DisplayReadResult<unknown>
): DisplayReadResult<string[]> {
  if (value.state !== "present") return value;
  if (!Array.isArray(value.value)) {
    return { state: "unknown", error: "value is not array-like" };
  }
  return { state: "present", value: value.value.map((entry) => String(entry)) };
}

function readProjectIncludedSkillsState(
  projectState: ProjectSettingsDisplayState
): DisplayReadResult<string[]> {
  if (projectState.state === "unknown") {
    return { state: "unknown", error: projectState.error };
  }
  if (projectState.state === "absent") {
    return { state: "absent" };
  }
  const skills = projectState.data["skills"];
  if (skills === undefined) {
    return { state: "absent" };
  }
  if (typeof skills !== "object" || skills === null || Array.isArray(skills)) {
    return { state: "unknown", error: `present but malformed skills block: ${projectState.file}` };
  }
  const includeSkills = (skills as Record<string, unknown>)["includeSkills"];
  if (includeSkills === undefined) {
    return { state: "absent" };
  }
  const normalized = normalizeStringArrayDisplayState({ state: "present", value: includeSkills });
  return normalized.state === "unknown"
    ? {
        state: "unknown",
        error: `present but malformed skills.includeSkills in ${projectState.file}: ${normalized.error}`,
      }
    : normalized;
}

function isCanonicalWorkflowSkillSurface(list: readonly string[]): boolean {
  return (
    list.length === PI_OVEN_WORKFLOW_SKILL_INCLUDE.length &&
    list.every((entry, index) => entry === PI_OVEN_WORKFLOW_SKILL_INCLUDE[index])
  );
}

function formatStringList(list: readonly string[]): string {
  return `[${list.map((entry) => JSON.stringify(entry)).join(", ")}]`;
}

function describeActiveLegacyCompatibilityAids(
  facts: StandaloneTruthFacts
): string[] {
  const aids: string[] = [];

  if (facts.globalDisabledProvidersState.state === "present") {
    const disabledProviders = facts.globalDisabledProvidersState.value;
    const activeProviders = [...PI_OVEN_MANAGED_PROVIDERS, ...PI_OVEN_DEPRECATED_PROVIDERS].filter(
      (entry) => disabledProviders.includes(entry)
    );
    if (activeProviders.length > 0) {
      aids.push(`disabledProviders = ${formatStringList(activeProviders)}`);
    }
  }

  if (facts.globalIgnoredSkillsState.state === "present") {
    const ignoredSkills = facts.globalIgnoredSkillsState.value;
    const activeGlobs = [...PI_OVEN_SIBLING_SKILL_GLOBS].filter((entry) =>
      ignoredSkills.includes(entry)
    );
    if (activeGlobs.length > 0) {
      aids.push(`skills.ignoredSkills = ${formatStringList(activeGlobs)}`);
    }
  }

  return aids;
}

function buildWorkflowSkillOwnershipSignal(
  facts: StandaloneTruthFacts
): StandaloneTruthSignal {
  const projectState = facts.projectIncludedSkillsState;
  const globalState = facts.globalIncludedSkillsState;
  const canonicalList = formatStringList(PI_OVEN_WORKFLOW_SKILL_INCLUDE);
  const sourceLabel =
    projectState.state === "present"
      ? `${facts.projectSettingsFile} (project layer)`
      : `${GLOBAL_CONFIG_PATH} (machine-global layer)`;
  const activeLegacyAids = describeActiveLegacyCompatibilityAids(facts);
  const activeLegacyAidsSentence =
    activeLegacyAids.length > 0
      ? ` Active legacy compatibility aids: ${activeLegacyAids.join("; ")}. These are compatibility helpers only; ${LEGACY_COMPATIBILITY_AIDS_LIMITATION}`
      : "";

  if (projectState.state === "unknown") {
    return {
      level: "WARN",
      name: WORKFLOW_SKILL_OWNERSHIP_SIGNAL_NAME,
      detail:
        `classification: ownership not established. effective workflow-skill ownership is unknown because ${projectState.error}. ` +
        `The ${HEALTHY_SINGLE_POV_SURFACE_LABEL} could not be verified yet. Success is judged by the visible workflow-skill surface resolving to pov-only via skills.includeSkills = ${canonicalList}, ` +
        `not by incidental ~/.claude/skills state on disk. ${CLAUDE_SKILLS_PRESERVATION_NOTE}` +
        activeLegacyAidsSentence,
      fix: PROJECT_SCOPE_FILE_REPAIR_FIX,
    };
  }

  if (projectState.state === "present") {
    if (isCanonicalWorkflowSkillSurface(projectState.value)) {
      return {
        level: "INFO",
        name: WORKFLOW_SKILL_OWNERSHIP_SIGNAL_NAME,
        detail:
          `classification: owned-surface active. workflow-skill surface is on the ${HEALTHY_SINGLE_POV_SURFACE_LABEL} via skills.includeSkills = ${canonicalList} from ${sourceLabel}. ` +
          "This preserves the populated Claude workflow-skill source for other users instead of deleting it, and it applies only to workflow skills — not commands, agents, hooks, or MCP. " +
          CLAUDE_SKILLS_PRESERVATION_NOTE,
      };
    }
    return {
      level: "WARN",
      name: WORKFLOW_SKILL_OWNERSHIP_SIGNAL_NAME,
      detail:
        `classification: ${activeLegacyAids.length > 0 ? "compatibility aids only" : "ownership not established"}. ` +
        `project skills.includeSkills in ${facts.projectSettingsFile} is ${formatStringList(projectState.value)}, not the canonical workflow-skill filter ${canonicalList}. ` +
        `This is not the ${HEALTHY_SINGLE_POV_SURFACE_LABEL}. ${CLAUDE_SKILLS_PRESERVATION_NOTE} ` +
        (activeLegacyAids.length > 0
          ? `Ownership is not established until the effective visible workflow-skill surface resolves to pov-only. ${activeLegacyAidsSentence.slice(1)}`
          : `${LEGACY_COMPATIBILITY_AIDS_LIMITATION} Ownership succeeds only when the effective visible workflow-skill surface resolves to pov-only.`),
      fix: WORKFLOW_SKILL_OWNERSHIP_FIX,
    };
  }

  if (globalState.state === "unknown") {
    return {
      level: "WARN",
      name: WORKFLOW_SKILL_OWNERSHIP_SIGNAL_NAME,
      detail:
        `classification: ownership not established. effective workflow-skill ownership could not be verified from ${GLOBAL_CONFIG_PATH}. ` +
        `The ${HEALTHY_SINGLE_POV_SURFACE_LABEL} could not be verified yet. Success is judged by the visible workflow-skill surface resolving to pov-only via skills.includeSkills = ${canonicalList}, ` +
        `not by incidental ~/.claude/skills state on disk. ${CLAUDE_SKILLS_PRESERVATION_NOTE}` +
        activeLegacyAidsSentence,
      fix: WORKFLOW_SKILL_OWNERSHIP_FIX,
    };
  }

  if (globalState.state === "present") {
    if (isCanonicalWorkflowSkillSurface(globalState.value)) {
      return {
        level: "INFO",
        name: WORKFLOW_SKILL_OWNERSHIP_SIGNAL_NAME,
        detail:
          `classification: owned-surface active. workflow-skill surface is on the ${HEALTHY_SINGLE_POV_SURFACE_LABEL} via skills.includeSkills = ${canonicalList} from ${sourceLabel}. ` +
          "This preserves the populated Claude workflow-skill source for other users instead of deleting it, and it applies only to workflow skills — not commands, agents, hooks, or MCP. " +
          CLAUDE_SKILLS_PRESERVATION_NOTE,
      };
    }
    return {
      level: "WARN",
      name: WORKFLOW_SKILL_OWNERSHIP_SIGNAL_NAME,
      detail:
        `classification: ${activeLegacyAids.length > 0 ? "compatibility aids only" : "ownership not established"}. ` +
        `${GLOBAL_CONFIG_PATH} currently exposes skills.includeSkills = ${formatStringList(globalState.value)}, not the canonical workflow-skill filter ${canonicalList}. ` +
        `This is not the ${HEALTHY_SINGLE_POV_SURFACE_LABEL}. ${CLAUDE_SKILLS_PRESERVATION_NOTE} ` +
        (activeLegacyAids.length > 0
          ? `Ownership is not established until the effective visible workflow-skill surface resolves to pov-only. ${activeLegacyAidsSentence.slice(1)}`
          : `${LEGACY_COMPATIBILITY_AIDS_LIMITATION} Ownership succeeds only when the effective visible workflow-skill surface resolves to pov-only.`),
      fix: WORKFLOW_SKILL_OWNERSHIP_FIX,
    };
  }

  return {
    level: "WARN",
    name: WORKFLOW_SKILL_OWNERSHIP_SIGNAL_NAME,
    detail:
      `classification: ${activeLegacyAids.length > 0 ? "compatibility aids only" : "ownership not established"}. ` +
      `no effective skills.includeSkills workflow-skill policy was found in ${facts.projectSettingsFile} or ${GLOBAL_CONFIG_PATH}. ` +
      `This is not the ${HEALTHY_SINGLE_POV_SURFACE_LABEL}. ${CLAUDE_SKILLS_PRESERVATION_NOTE} ` +
      (activeLegacyAids.length > 0
        ? `Ownership is not established until the effective visible workflow-skill surface resolves to pov-only via skills.includeSkills = ${canonicalList}. ${activeLegacyAidsSentence.slice(1)}`
        : `${LEGACY_COMPATIBILITY_AIDS_LIMITATION} Ownership succeeds only when the effective visible workflow-skill surface resolves to pov-only via skills.includeSkills = ${canonicalList}.`),
    fix: WORKFLOW_SKILL_OWNERSHIP_FIX,
  };
}

export function buildKeywordSkillIntegritySignal(opts: {
  pluginAssetPath: string;
  keywordIndexTruth:
    | {
        state: KeywordIndexTruthState;
        loadedCount: number;
        shippedSkillCount: number;
        issues: string[];
        error?: string;
      }
    | undefined;
}): StandaloneTruthSignal | null {
  const keywordIndexTruth = opts.keywordIndexTruth;
  if (!keywordIndexTruth || keywordIndexTruth.state === "ok") {
    return null;
  }
  if (keywordIndexTruth.state === "partial") {
    return {
      level: "WARN",
      name: "keyword-skill integrity",
      detail:
        `runtime keyword index loaded ${keywordIndexTruth.loadedCount}/${keywordIndexTruth.shippedSkillCount} shipped skills from ${opts.pluginAssetPath}, ` +
        `but skipped ${keywordIndexTruth.issues.length}: ${keywordIndexTruth.issues.join("; ")}. ` +
        "Runtime keyword-matched skills are partially available.",
      fix: KEYWORD_SKILL_INTEGRITY_FIX,
    };
  }
  if (keywordIndexTruth.state === "unavailable") {
    return {
      level: "WARN",
      name: "keyword-skill integrity",
      detail:
        `runtime keyword index could not load any shipped skills from ${opts.pluginAssetPath}; ` +
        `skipped ${keywordIndexTruth.issues.length}: ${keywordIndexTruth.issues.join("; ")}. ` +
        "Runtime keyword-matched skills are unavailable.",
      fix: KEYWORD_SKILL_INTEGRITY_FIX,
    };
  }
  return {
    level: "WARN",
    name: "keyword-skill integrity",
    detail:
      `runtime keyword index could not be probed from ${opts.pluginAssetPath}` +
      (keywordIndexTruth.error ? ` (${keywordIndexTruth.error})` : "."),
    fix: KEYWORD_SKILL_INTEGRITY_FIX,
  };
}

export function buildStandaloneTruthSignals(
  facts: StandaloneTruthFacts
): StandaloneTruthSignal[] {
  const signals: StandaloneTruthSignal[] = [
    {
      level: "INFO",
      name: "installed topology",
      detail:
        `pi-oven shipped assets read from ${facts.pluginAssetPath}; ` +
        `project state read from ${facts.projectRoot}; ` +
        `machine-global config remains ${GLOBAL_CONFIG_PATH}.`,
    },
    {
      level: "INFO",
      name: "control-plane front door",
      detail:
        "automatic pi-oven routing enters gated lanes only through explicit capability proofs: `requiredSkills`, exact plugin-owned SKILL.md reads, the branch contract, and external execution consent where relevant. Bootstrap message injection, tool remap, and discovery-layer compatibility toggles are not normal control-plane paths.",
    },
    buildWorkflowSkillOwnershipSignal(facts),
    {
      level: "INFO",
      name: BOOTSTRAP_PARITY_TRACK_SIGNAL_NAME,
      detail:
        "Secondary OMP/architecture track only: bootstrap-level gajae parity remains open. Task 1 ownership success comes from the effective workflow-skill filter plus runtime capability proofs; matching gajae-style bootstrap exclusivity is visible here but is not a blocker yet.",
    },
    {
      level: facts.nativeWorkerRuntime.active ? "INFO" : "WARN",
      name: "native worker runtime",
      detail:
        "Only temporary adapter boundary remains: " + describeNativeWorkerRuntime(facts.nativeWorkerRuntime),
      fix: facts.nativeWorkerRuntime.active ? undefined : NATIVE_WORKER_RUNTIME_FIX,
    },
    {
      level: "INFO",
      name: "native worker ceiling",
      detail:
        `dependency-ready wave target remains 8-12 siblings. Effective native worker ceiling is nativeWorkers.maxWorkers=${facts.nativeWorkerRuntime.maxWorkers} from ${facts.nativeWorkerRuntime.maxWorkersConfigPath} (${facts.nativeWorkerRuntime.maxWorkersSource}); ` +
        (facts.nativeWorkerRuntime.active
          ? "the vendored pi-oven launcher enforces this ceiling while that temporary adapter boundary remains."
          : "pi-oven cannot enforce this ceiling until the vendored native runtime path is restored."),
    },
  ];
  const duplicatePluginSurface = facts.duplicatePluginSurface;
  if (duplicatePluginSurface) {
    const cacheDriftDetail =
      duplicatePluginSurface.cacheIssues.length > 0
        ? ` Stale cache diagnostics from ${duplicatePluginSurface.cachePluginRoot}: ${duplicatePluginSurface.cacheIssues.join("; ")}.`
        : duplicatePluginSurface.cacheShippedSkillCount === 0
          ? ` ${duplicatePluginSurface.cachePluginRoot} did not expose any shipped skills.`
          : ` ${duplicatePluginSurface.cachePluginRoot} also exposes ${duplicatePluginSurface.cacheLoadedCount}/${duplicatePluginSurface.cacheShippedSkillCount} shipped skills, so duplicate install surfaces remain visible.`;
    signals.push({
      level: "WARN",
      name: DUAL_PLUGIN_SURFACE_LABEL,
      detail:
        `dual plugin surface detected: active plugin root is ${duplicatePluginSurface.activePluginRoot}; latest marketplace cache is ${duplicatePluginSurface.cachePluginRoot}. ` +
        `Public \`pov:*\` skill names and exact \`SKILL.md\` proof targets are resolved from ${duplicatePluginSurface.activePluginRoot} only.` +
        cacheDriftDetail +
        " Bare or duplicate skill discovery outside that active root is stale install state, not runtime truth.",
      fix: PLUGIN_SURFACE_DRIFT_FIX,
    });
  }

  const keywordIntegritySignal = buildKeywordSkillIntegritySignal({
    pluginAssetPath: facts.pluginAssetPath,
    keywordIndexTruth: facts.keywordIndexTruth,
  });
  if (keywordIntegritySignal) {
    signals.push(keywordIntegritySignal);
  }

  if (facts.projectRoutingState === "unknown") {
    signals.push({
      level: "WARN",
      name: "project-scope remediation",
      detail: `project routing state is unknown because ${facts.projectSettingsFile} is unreadable/corrupt.`,
      fix: PROJECT_SCOPE_FILE_REPAIR_FIX,
    });
  } else if ((facts.projectRoutingRoleCount ?? 0) === 0) {
    signals.push({
      level: "INFO",
      name: "project-scope remediation",
      detail: `no pi-oven project routing detected in ${facts.projectSettingsFile}.`,
    });
  } else {
    const unknownPrerequisites = facts.globalPrerequisiteStates
      .filter(({ state }) => state === "unknown")
      .map(({ key }) => key);
    const notConfiguredPrerequisites = facts.globalPrerequisiteStates
      .filter(({ state }) => state === "not-configured")
      .map(({ key }) => key);

    if (unknownPrerequisites.length > 0) {
      signals.push({
        level: "WARN",
        name: "project-scope remediation",
        detail:
          `project routing is active in ${facts.projectSettingsFile} ` +
          `(${facts.projectRoutingRoleCount} roles), but the machine-global prerequisite state could not be verified for: ` +
          `${unknownPrerequisites.join(", ")}.` +
          (notConfiguredPrerequisites.length > 0
            ? ` Confirmed missing or mismatched: ${notConfiguredPrerequisites.join(", ")}.`
            : ""),
        fix: PROJECT_SCOPE_GLOBAL_REMEDIATION_FIX,
      });
    } else if (notConfiguredPrerequisites.length === 0) {
      signals.push({
        level: "INFO",
        name: "project-scope remediation",
        detail:
          `project routing is active in ${facts.projectSettingsFile} ` +
          `(${facts.projectRoutingRoleCount} roles); required machine-global prerequisites are already present.`,
      });
    } else {
      signals.push({
        level: "WARN",
        name: "project-scope remediation",
        detail:
          `project routing is active in ${facts.projectSettingsFile} ` +
          `(${facts.projectRoutingRoleCount} roles), but the required machine-global prerequisites are missing or mismatched: ` +
          `${notConfiguredPrerequisites.join(", ")}.`,
        fix: PROJECT_SCOPE_GLOBAL_REMEDIATION_FIX,
      });
    }
  }

  return signals;
}

export async function collectStandaloneTruthSignals(
  opts: {
    pluginAssetPath: string;
    projectRoot: string;
    homeDir?: string;
  } & ConfigYmlOpts
): Promise<StandaloneTruthSignal[]> {
  const projectSettings = await readProjectSettingsDisplayState({ cwd: opts.projectRoot });
  const globalPrerequisiteStates: StandaloneTruthFacts["globalPrerequisiteStates"] = await Promise.all(
    SETUP_GLOBAL_PREREQUISITES.map(async ({ key, expected }) => {
      const value = await readConfigValueDisplayState(key, opts);
      return {
        key,
        state: classifySetupPrerequisiteState(value, expected),
      };
    })
  );

  const globalIncludedSkillsState = await readIncludedSkillsDisplayState(opts);
  const globalIgnoredSkillsState = await readIgnoredSkillsDisplayState(opts);
  const globalDisabledProvidersState = await readDisabledProvidersDisplayState(opts);
  const projectIncludedSkillsState = readProjectIncludedSkillsState(projectSettings);
  const pluginAssetPath =
    opts.pluginAssetPath === PLUGIN_ROOT_UNAVAILABLE
      ? PLUGIN_ROOT_UNAVAILABLE
      : path.resolve(opts.pluginAssetPath);

  const nativeWorkerRuntime = await resolveNativeWorkerRuntimeStatus({
    pluginRoot: pluginAssetPath === PLUGIN_ROOT_UNAVAILABLE ? opts.projectRoot : pluginAssetPath,
    projectRoot: opts.projectRoot,
    homeDir: opts.homeDir,
  });

  let keywordIndexTruth: StandaloneTruthFacts["keywordIndexTruth"];
  if (pluginAssetPath === PLUGIN_ROOT_UNAVAILABLE) {
    keywordIndexTruth = {
      state: "unknown",
      loadedCount: 0,
      shippedSkillCount: 0,
      issues: [],
      error: "plugin root unavailable",
    };
  } else {
    const pluginManifestPath = path.join(pluginAssetPath, ".claude-plugin", "plugin.json");
    if (existsSync(pluginManifestPath)) {
      try {
        const report = loadSkillKeywordIndexReport(pluginAssetPath);
        if (report.issues.length > 0) {
          keywordIndexTruth = {
            state: report.index.length === 0 ? "unavailable" : "partial",
            loadedCount: report.index.length,
            shippedSkillCount: report.shippedSkillCount,
            issues: formatSkillKeywordIndexIssues(report.issues, report.issues.length)
              .split("; ")
              .filter((entry) => entry.length > 0),
          };
        } else if (report.index.length === 0 || report.shippedSkillCount === 0) {
          keywordIndexTruth = {
            state: "unavailable",
            loadedCount: report.index.length,
            shippedSkillCount: report.shippedSkillCount,
            issues: ["plugin.json skills[] did not yield any shipped skills"],
          };
        } else {
          keywordIndexTruth = {
            state: "ok",
            loadedCount: report.index.length,
            shippedSkillCount: report.shippedSkillCount,
            issues: [],
          };
        }
      } catch (err) {
        keywordIndexTruth = {
          state: "unknown",
          loadedCount: 0,
          shippedSkillCount: 0,
          issues: [],
          error: err instanceof Error ? err.message : String(err),
        };
      }
    } else {
      keywordIndexTruth = {
        state: "unknown",
        loadedCount: 0,
        shippedSkillCount: 0,
        issues: [],
        error: `missing ${pluginManifestPath}`,
      };
    }
  }

  const duplicatePluginSurface =
    pluginAssetPath === PLUGIN_ROOT_UNAVAILABLE
      ? null
      : await detectDuplicatePluginSurface(
          pluginAssetPath,
          opts.homeDir ? path.join(opts.homeDir, ".omp", "plugins", "cache", "plugins") : undefined
        );
  let duplicatePluginSurfaceFacts: StandaloneTruthFacts["duplicatePluginSurface"];
  if (duplicatePluginSurface) {
    try {
      const cacheReport = loadSkillKeywordIndexReport(duplicatePluginSurface.cachePluginRoot);
      duplicatePluginSurfaceFacts = {
        activePluginRoot: duplicatePluginSurface.activePluginRoot,
        cachePluginRoot: duplicatePluginSurface.cachePluginRoot,
        cacheIssues: formatSkillKeywordIndexIssues(cacheReport.issues, cacheReport.issues.length)
          .split("; ")
          .filter((entry) => entry.length > 0),
        cacheLoadedCount: cacheReport.index.length,
        cacheShippedSkillCount: cacheReport.shippedSkillCount,
      };
    } catch (err) {
      duplicatePluginSurfaceFacts = {
        activePluginRoot: duplicatePluginSurface.activePluginRoot,
        cachePluginRoot: duplicatePluginSurface.cachePluginRoot,
        cacheIssues: [err instanceof Error ? err.message : String(err)],
        cacheLoadedCount: 0,
        cacheShippedSkillCount: 0,
      };
    }
  }
  return buildStandaloneTruthSignals({
    pluginAssetPath,
    projectRoot: opts.projectRoot,
    projectSettingsFile: projectSettings.file,
    projectRoutingRoleCount:
      projectSettings.state === "present"
        ? countPiOvenRoutingEntries(
            ((projectSettings.data["task"] as Record<string, unknown> | undefined)
              ?.["agentModelOverrides"] as Record<string, unknown> | undefined) ?? {}
          )
        : projectSettings.state === "absent"
          ? 0
          : null,
    projectRoutingState: projectSettings.state,
    globalPrerequisiteStates,
    globalIncludedSkillsState,
    globalIgnoredSkillsState,
    globalDisabledProvidersState,
    projectIncludedSkillsState,
    keywordIndexTruth,
    duplicatePluginSurface: duplicatePluginSurfaceFacts,
    nativeWorkerRuntime,
  });
}

export function formatStandaloneTruthSignals(signals: StandaloneTruthSignal[]): string[] {
  const lines = ["Standalone truth surface:"];
  for (const signal of signals) {
    lines.push(`  [${signal.level}] ${signal.name}: ${signal.detail}`);
    if (signal.fix) {
      lines.push(`         fix: ${signal.fix}`);
    }
  }
  return lines;
}
