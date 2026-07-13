import { existsSync, readdirSync, readFileSync } from "node:fs";
import * as path from "node:path";
import {
  ROLE_NAMES,
  RUNTIME_CONTRACT_VERSION,
  SUPPORTED_OMP_VERSION,
  TaskDispatchSchema,
  canonicalAgentName,
} from "../../.omp/extensions/pi-oven-runtime/runtime-contract";
import {
  CAPABILITY_POLICY_VERSION,
  CAPABILITY_RULES,
} from "../../.omp/extensions/pi-oven-runtime/capability-registry";
import { inspectRunLedgerSurface } from "../../.omp/extensions/pi-oven-runtime/run-ledger-health";
import { checkEvalDiscrimination } from "../check-eval-discrimination";
import {
  generatedArtifacts,
  renderGeneratedArtifacts,
} from "../pi-oven-contract/generate";
import { compareSemver } from "./cache-resolver";
import { DEFAULT_PROFILE } from "./profiles";
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
  readOverridesStrict,
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
  recoverSetupTransactionsOnStartup,
  type SetupTransactionScopeHealth,
} from "./setup-transaction";

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
  setupTransactions?: SetupTransactionScopeHealth[];
}

export const GLOBAL_CONFIG_PATH = "~/.omp/agent/config.yml";
export const PROJECT_SCOPE_GLOBAL_REMEDIATION_FIX =
  "Run /pi-oven:setup --repair-prereqs on this machine to restore those prerequisites. Project scope does not write ~/.omp/agent/config.yml.";
export const PROJECT_SCOPE_FILE_REPAIR_FIX =
  "Repair or remove the project's .omp/settings.json, then rerun /pi-oven:setup --status.";
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
export const SETUP_TRANSACTION_SIGNAL_NAME = "setup transaction";

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
      level: "INFO",
      name: "task dispatch",
      detail:
        "OMP task is the single dispatch seam. The dependency-ready wave target remains 8-12 siblings, while async.enabled, task.maxConcurrency, and provider/runtime admission determine actual concurrency.",
    },
  ];
  if (facts.setupTransactions) {
    for (const transaction of facts.setupTransactions) {
      const { health } = transaction;
      if (transaction.recovered) {
        signals.push({
          level: "INFO",
          name: SETUP_TRANSACTION_SIGNAL_NAME,
          detail: `${transaction.scope} transaction recovered safely; original state was restored before diagnostics ran.`,
        });
      } else if (health.state === "healthy") {
        signals.push({
          level: "INFO",
          name: SETUP_TRANSACTION_SIGNAL_NAME,
          detail: `${transaction.scope} transaction journal is terminal or absent.`,
        });
      } else if (health.state === "rollback_failed") {
        signals.push({
          level: "WARN",
          name: SETUP_TRANSACTION_SIGNAL_NAME,
          detail: `${transaction.scope} setup rollback failed; partial desired state is not healthy and automatic overwrite stopped at a CAS conflict.`,
          fix: `Review and apply the manual recovery diff at ${health.manualRecoveryPath}.`,
        });
      } else if (health.state === "recovery_needed") {
        signals.push({
          level: "WARN",
          name: SETUP_TRANSACTION_SIGNAL_NAME,
          detail: `${transaction.scope} setup transaction still needs recovery (${health.phase}, ${health.txnId}); partial desired state is not healthy.`,
          fix: "Stop the competing setup process, then rerun /pi-oven:setup --status to retry safe rollback.",
        });
      } else {
        signals.push({
          level: "WARN",
          name: SETUP_TRANSACTION_SIGNAL_NAME,
          detail: `${transaction.scope} setup transaction journal is corrupt: ${health.error}`,
          fix: `Inspect ${transaction.stateDir} and repair the journal before changing routing.`,
        });
      }
    }
  }
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
    setupTransactions?: SetupTransactionScopeHealth[];
  } & ConfigYmlOpts
): Promise<StandaloneTruthSignal[]> {
  const setupTransactions = opts.setupTransactions ?? await recoverSetupTransactionsOnStartup({
    cwd: opts.projectRoot,
    homeDir: opts.homeDir,
    spawnFn: opts.spawnFn,
  });
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
    setupTransactions,
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

export type RuntimeTruthStatus = "PASS" | "WARN" | "FAIL" | "NOT RUN";

export interface RuntimeTruthCheck {
  status: RuntimeTruthStatus;
  name: string;
  detail: string;
  fix?: string;
}

export interface RuntimeTruthReport {
  checks: RuntimeTruthCheck[];
}

export interface RuntimeTruthOptions extends ConfigYmlOpts {
  pluginAssetPath: string;
  projectRoot: string;
  homeDir?: string;
  liveCanaryReceiptPath?: string;
  now?: number;
}

function readJsonObject(file: string): Record<string, unknown> {
  const value = JSON.parse(readFileSync(file, "utf8")) as unknown;
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${file} must contain a JSON object`);
  }
  return value as Record<string, unknown>;
}

function runtimeContractCheck(pluginRoot: string): RuntimeTruthCheck {
  if (pluginRoot === PLUGIN_ROOT_UNAVAILABLE) {
    return {
      status: "WARN",
      name: "RuntimeContract",
      detail: `${RUNTIME_CONTRACT_VERSION}; plugin root unavailable, generated parity not inspected`,
      fix: "Reinstall pi-oven@kzk, then run /pi-oven:doctor.",
    };
  }
  try {
    const expected = renderGeneratedArtifacts();
    const drift = generatedArtifacts.filter((file) => {
      const absolute = path.join(pluginRoot, file);
      return !existsSync(absolute) || readFileSync(absolute, "utf8") !== expected[file];
    });
    return drift.length === 0
      ? {
          status: "PASS",
          name: "RuntimeContract",
          detail: `${RUNTIME_CONTRACT_VERSION}; ${generatedArtifacts.length}/${generatedArtifacts.length} generated artifacts match`,
        }
      : {
          status: "FAIL",
          name: "RuntimeContract",
          detail: `${RUNTIME_CONTRACT_VERSION}; generated artifact drift: ${drift.join(", ")}`,
          fix: "Run `bun run contract:generate`, review the diff, then rerun /pi-oven:doctor.",
        };
  } catch (error) {
    return {
      status: "FAIL",
      name: "RuntimeContract",
      detail: `generated parity inspection failed: ${error instanceof Error ? error.message : String(error)}`,
      fix: "Run `bun run contract:generate`, review the diff, then rerun /pi-oven:doctor.",
    };
  }
}

function roleRegistryCheck(): RuntimeTruthCheck {
  const unique = new Set(ROLE_NAMES);
  const canonical = ROLE_NAMES.map(canonicalAgentName);
  const healthy = ROLE_NAMES.length === 24 && unique.size === 24 && new Set(canonical).size === 24;
  return {
    status: healthy ? "PASS" : "FAIL",
    name: "role registry",
    detail: `${ROLE_NAMES.length}/24 roles; ${unique.size} unique; canonical namespace pov:*`,
    fix: healthy ? undefined : "Restore ROLE_NAMES from the generated RuntimeContract, then run `bun run contract:generate`.",
  };
}

function namespaceMigrationCheck(
  pluginRoot: string,
  projectOverrides: Record<string, string> | null,
  globalOverrides: Record<string, string> | null,
): RuntimeTruthCheck {
  if (pluginRoot === PLUGIN_ROOT_UNAVAILABLE) {
    return {
      status: "WARN",
      name: "namespace migration",
      detail: "canonical agent count unavailable; plugin root unavailable",
      fix: "Reinstall pi-oven@kzk, then run /pi-oven:doctor.",
    };
  }
  try {
    const agentsDir = path.join(pluginRoot, "agents");
    const files = existsSync(agentsDir) ? readdirSync(agentsDir).filter((file) => file.endsWith(".md")) : [];
    let canonicalCount = 0;
    let staleAgentCount = 0;
    for (const role of ROLE_NAMES) {
      const file = `pov-${role}.md`;
      const absolute = path.join(agentsDir, file);
      if (existsSync(absolute) && new RegExp(`^name:\\s*${canonicalAgentName(role)}\\s*$`, "m").test(readFileSync(absolute, "utf8"))) {
        canonicalCount += 1;
      }
    }
    staleAgentCount = files.filter((file) => file.startsWith("pi-oven-")).length;
    const knownOverrides = [projectOverrides, globalOverrides].filter(
      (record): record is Record<string, string> => record !== null,
    );
    const unknownConfigScopes = 2 - knownOverrides.length;
    const staleConfigCount = knownOverrides
      .flatMap((record) => Object.keys(record))
      .filter((key) => key.startsWith("pi-oven:") && ROLE_NAMES.includes(key.slice("pi-oven:".length) as typeof ROLE_NAMES[number]))
      .length;
    const healthy = canonicalCount === ROLE_NAMES.length && staleAgentCount === 0 && staleConfigCount === 0 && unknownConfigScopes === 0;
    return {
      status: healthy ? "PASS" : "WARN",
      name: "namespace migration",
      detail: `${canonicalCount}/${ROLE_NAMES.length} canonical agents; ${staleAgentCount} stale agent files; ${staleConfigCount} known stale config keys; ${unknownConfigScopes} unreadable config scopes`,
      fix: healthy ? undefined : "Run /pi-oven:setup --status, then use the reported scope-specific migration command.",
    };
  } catch (error) {
    return {
      status: "FAIL",
      name: "namespace migration",
      detail: `namespace inspection failed: ${error instanceof Error ? error.message : String(error)}`,
      fix: "Run /pi-oven:setup --status and repair the reported namespace drift.",
    };
  }
}

function setupTransactionChecks(
  transactions: readonly SetupTransactionScopeHealth[],
): RuntimeTruthCheck[] {
  return transactions.map(({ scope, health, recovered }) => {
    if (recovered) {
      return {
        status: "PASS",
        name: `setup transaction (${scope})`,
        detail: "recovered safely; original state restored before diagnostics",
      };
    }
    if (health.state === "healthy") {
      return {
        status: "PASS",
        name: `setup transaction (${scope})`,
        detail: "terminal or absent",
      };
    }
    if (health.state === "rollback_failed") {
      return {
        status: "FAIL",
        name: `setup transaction (${scope})`,
        detail: `rollback stopped at a conflict; manual recovery diff: ${health.manualRecoveryPath}`,
        fix: `/pi-oven:setup --status  # inspect ${health.manualRecoveryPath}; no destructive action is automatic`,
      };
    }
    if (health.state === "recovery_needed") {
      return {
        status: "FAIL",
        name: `setup transaction (${scope})`,
        detail: `non-terminal ${health.phase} transaction ${health.txnId} remains after safe recovery attempt`,
        fix: "/pi-oven:setup --status",
      };
    }
    return {
      status: "FAIL",
      name: `setup transaction (${scope})`,
      detail: `corrupt journal: ${health.error}`,
      fix: "/pi-oven:doctor  # inspect the reported journal path before any manual edit",
    };
  });
}

function capabilityParityCheck(): RuntimeTruthCheck {
  const policyTools = new Set(CAPABILITY_RULES.map((rule) => rule.toolName));
  const profileRoles = Object.keys(DEFAULT_PROFILE);
  const rosterMismatch = profileRoles.filter((role) => !ROLE_NAMES.includes(role as typeof ROLE_NAMES[number]));
  const missingRoles = ROLE_NAMES.filter((role) => !(role in DEFAULT_PROFILE));
  const unclassified = [...new Set(
    Object.values(DEFAULT_PROFILE).flatMap((entry) => [...entry.tools, ...entry.blocked_tools]),
  )].filter((tool) => !policyTools.has(tool));
  const healthy = rosterMismatch.length === 0 && missingRoles.length === 0 && unclassified.length === 0;
  return {
    status: healthy ? "PASS" : "FAIL",
    name: "capability policy / agent parity",
    detail: healthy
      ? `${ROLE_NAMES.length}/${ROLE_NAMES.length} agent profiles; every declared tool is classified by capability policy v${CAPABILITY_POLICY_VERSION}`
      : `missing roles=${missingRoles.join(",") || "none"}; extra roles=${rosterMismatch.join(",") || "none"}; unclassified tools=${unclassified.join(",") || "none"}`,
    fix: healthy ? undefined : "Align profiles.ts and capability-registry.ts, then run `bun run lint:agents`.",
  };
}

async function offlineDiscriminationCheck(pluginRoot: string): Promise<RuntimeTruthCheck> {
  if (pluginRoot === PLUGIN_ROOT_UNAVAILABLE || !existsSync(path.join(pluginRoot, "evals"))) {
    return {
      status: "NOT RUN",
      name: "offline eval discrimination",
      detail: "eval assets unavailable in this installed surface",
      fix: "Reinstall pi-oven@kzk, then run `bun scripts/check-eval-discrimination.ts`.",
    };
  }
  try {
    const report = await checkEvalDiscrimination(path.join(pluginRoot, "evals"));
    const passed = report.positiveScenarios > 0 && report.vacuousPasses.length === 0;
    return {
      status: passed ? "PASS" : "FAIL",
      name: "offline eval discrimination",
      detail: `${report.rejectedScenarios}/${report.positiveScenarios} positive scenarios reject the vacuous response`,
      fix: passed ? undefined : "Run `bun scripts/check-eval-discrimination.ts` and repair every vacuous pass.",
    };
  } catch (error) {
    return {
      status: "FAIL",
      name: "offline eval discrimination",
      detail: `discrimination check failed: ${error instanceof Error ? error.message : String(error)}`,
      fix: "Run `bun scripts/check-eval-discrimination.ts` and repair the reported scenario.",
    };
  }
}

function liveCanaryCheck(opts: RuntimeTruthOptions): RuntimeTruthCheck {
  const receipt = opts.liveCanaryReceiptPath ?? process.env.PI_OVEN_CANARY_RECEIPT ?? path.join(opts.projectRoot, "artifacts", "trusted-canary-receipt.json");
  if (!existsSync(receipt)) {
    return {
      status: "NOT RUN",
      name: "live dispatch canary",
      detail: `no local receipt at ${receipt}; absence is not PASS`,
      fix: "Run the trusted-provider-canary workflow, download its receipt, and set PI_OVEN_CANARY_RECEIPT to that file.",
    };
  }
  try {
    const value = readJsonObject(receipt);
    const stored = value.status;
    const status: RuntimeTruthStatus = stored === "NOT_RUN" ? "NOT RUN" : stored === "PASS" || stored === "FAIL" ? stored : "FAIL";
    return {
      status,
      name: "live dispatch canary",
      detail: `last receipt ${receipt}: ${String(stored)}${typeof value.reason === "string" ? ` (${value.reason})` : ""}`,
      fix: status === "PASS" ? undefined : "Run the trusted-provider-canary workflow and inspect the uploaded receipt before release.",
    };
  } catch (error) {
    return {
      status: "FAIL",
      name: "live dispatch canary",
      detail: `receipt is unreadable: ${error instanceof Error ? error.message : String(error)}`,
      fix: "Replace the receipt with the JSON artifact from trusted-provider-canary, then rerun /pi-oven:doctor.",
    };
  }
}

function ompPackageCheck(pluginRoot: string, opts: RuntimeTruthOptions): RuntimeTruthCheck {
  if (pluginRoot === PLUGIN_ROOT_UNAVAILABLE) {
    return { status: "WARN", name: "OMP package", detail: `supported exact version ${SUPPORTED_OMP_VERSION}; package manifest unavailable` };
  }
  try {
    const manifest = readJsonObject(path.join(pluginRoot, "package.json"));
    const dependencies = manifest.dependencies as Record<string, unknown> | undefined;
    const pinned = dependencies?.["@oh-my-pi/pi-coding-agent"];
    if (pinned !== SUPPORTED_OMP_VERSION) {
      return {
        status: "FAIL",
        name: "OMP package",
        detail: `package pin ${String(pinned)} differs from RuntimeContract ${SUPPORTED_OMP_VERSION}`,
        fix: "Restore the exact package.json OMP dependency and run `bun install --frozen-lockfile`.",
      };
    }
    const spawn = opts.spawnFn ?? ((cmd: string, args: string[]) => {
      const result = Bun.spawnSync([cmd, ...args], { stdout: "pipe", stderr: "pipe" });
      return { exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr };
    });
    const result = spawn("omp", ["--version"]);
    const installed = result.exitCode === 0 ? result.stdout?.toString().match(/\d+\.\d+\.\d+/)?.[0] : undefined;
    if (!installed) {
      return {
        status: "WARN",
        name: "OMP package",
        detail: `exact package pin ${SUPPORTED_OMP_VERSION}; installed omp version not observed`,
        fix: "Run `omp --version`, then rerun /pi-oven:doctor.",
      };
    }
    const supported = compareSemver(installed, SUPPORTED_OMP_VERSION) >= 0;
    return {
      status: supported ? "PASS" : "FAIL",
      name: "OMP package",
      detail: `exact package pin ${SUPPORTED_OMP_VERSION}; installed omp ${installed}`,
      fix: supported ? undefined : `Upgrade omp to ${SUPPORTED_OMP_VERSION} or newer, then rerun /pi-oven:doctor.`,
    };
  } catch (error) {
    return {
      status: "FAIL",
      name: "OMP package",
      detail: `package inspection failed: ${error instanceof Error ? error.message : String(error)}`,
      fix: "Restore package.json and run `bun install --frozen-lockfile`.",
    };
  }
}

function releaseMetadataCheck(pluginRoot: string): RuntimeTruthCheck {
  if (pluginRoot === PLUGIN_ROOT_UNAVAILABLE) {
    return { status: "WARN", name: "release metadata", detail: "plugin root unavailable; version/ref parity not inspected" };
  }
  try {
    const pkg = readJsonObject(path.join(pluginRoot, "package.json"));
    const plugin = readJsonObject(path.join(pluginRoot, ".claude-plugin", "plugin.json"));
    const marketplace = readJsonObject(path.join(pluginRoot, ".claude-plugin", "marketplace.json"));
    const entry = Array.isArray(marketplace.plugins) ? marketplace.plugins[0] as Record<string, unknown> | undefined : undefined;
    const source = entry?.source as Record<string, unknown> | undefined;
    const version = pkg.version;
    const ref = source?.ref;
    const duplicateMarketplace = existsSync(path.join(pluginRoot, "marketplace.json"));
    const healthy = typeof version === "string" && plugin.version === version && entry?.version === version && ref === `v${version}` && !duplicateMarketplace;
    return {
      status: healthy ? "PASS" : "FAIL",
      name: "release metadata",
      detail: healthy
        ? `package/plugin/marketplace version ${version}; immutable ref ${ref}; duplicate catalog 0`
        : `package=${String(version)}, plugin=${String(plugin.version)}, marketplace=${String(entry?.version)}, ref=${String(ref)}, duplicate catalog=${duplicateMarketplace ? 1 : 0}`,
      fix: healthy ? undefined : "Run `bun run release:contract -- --tag v<package-version> --check-only` and repair version/ref parity.",
    };
  } catch (error) {
    return {
      status: "FAIL",
      name: "release metadata",
      detail: `release metadata inspection failed: ${error instanceof Error ? error.message : String(error)}`,
      fix: "Restore package and plugin marketplace manifests, then rerun /pi-oven:doctor.",
    };
  }
}

function dispatchOwnershipCheck(): RuntimeTruthCheck {
  const ompOwnsDispatch = TaskDispatchSchema.safeParse({
    agent: canonicalAgentName("executor"),
    tasks: [{
      id: "contract-probe",
      description: "Validate canonical dispatch ownership",
      assignment: "Validate the RuntimeContract task seam without executing work.",
    }],
  }).success;
  return {
    status: ompOwnsDispatch ? "PASS" : "FAIL",
    name: "native team",
    detail: ompOwnsDispatch
      ? "removed; OMP task owns dispatch"
      : "RuntimeContract rejected the canonical OMP task ownership probe",
    fix: ompOwnsDispatch
      ? undefined
      : "Restore TaskDispatchSchema and rerun `bun run contract:check`.",
  };
}

/** Shared, read-only contract report consumed by both setup status and doctor. */
export async function collectRuntimeTruthSurface(
  opts: RuntimeTruthOptions,
): Promise<RuntimeTruthReport> {
  const pluginRoot = opts.pluginAssetPath === PLUGIN_ROOT_UNAVAILABLE
    ? PLUGIN_ROOT_UNAVAILABLE
    : path.resolve(opts.pluginAssetPath);
  const projectState = await readProjectSettingsDisplayState({ cwd: opts.projectRoot });
  const projectOverrides = projectState.state === "present"
    ? (((projectState.data.task as Record<string, unknown> | undefined)?.agentModelOverrides as Record<string, string> | undefined) ?? {})
    : projectState.state === "absent" ? {} : null;
  const globalRead = await readOverridesStrict(opts);
  const globalOverrides = globalRead.ok ? globalRead.record : null;
  const transactions = await recoverSetupTransactionsOnStartup({
    cwd: opts.projectRoot,
    homeDir: opts.homeDir,
    spawnFn: opts.spawnFn,
  });
  const ledger = inspectRunLedgerSurface(opts.projectRoot, process.env.PI_OVEN_RUN_LEDGER_MODE, opts.now);
  const standalone = await collectStandaloneTruthSignals({
    ...opts,
    pluginAssetPath: pluginRoot,
    setupTransactions: transactions,
  });
  const checks: RuntimeTruthCheck[] = [
    runtimeContractCheck(pluginRoot),
    roleRegistryCheck(),
    namespaceMigrationCheck(pluginRoot, projectOverrides, globalOverrides),
    ...setupTransactionChecks(transactions),
    {
      status: ledger.status === "INACTIVE" ? "NOT RUN" : ledger.status,
      name: "run ledger",
      detail: ledger.detail,
      fix: ledger.status === "FAIL" ? "Set PI_OVEN_RUN_LEDGER_MODE=json for rollback mode, then inspect the database before retrying." : undefined,
    },
    capabilityParityCheck(),
    await offlineDiscriminationCheck(pluginRoot),
    liveCanaryCheck(opts),
    ompPackageCheck(pluginRoot, opts),
    releaseMetadataCheck(pluginRoot),
    dispatchOwnershipCheck(),
    ...standalone
      .filter((signal) => signal.name !== SETUP_TRANSACTION_SIGNAL_NAME)
      .map((signal): RuntimeTruthCheck => ({
        status: signal.level === "INFO" ? "PASS" : "WARN",
        name: signal.name,
        detail: signal.detail,
        fix: signal.fix,
      })),
  ];
  return { checks };
}

export function formatRuntimeTruthSurface(report: RuntimeTruthReport): string {
  const lines = ["Runtime contract truth surface:"];
  for (const check of report.checks) {
    lines.push(`  [${check.status}] ${check.name}: ${check.detail}`);
    if (check.fix && check.status !== "PASS") lines.push(`         fix: ${check.fix}`);
  }
  return lines.join("\n");
}
