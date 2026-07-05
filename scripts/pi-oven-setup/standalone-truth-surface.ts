import { existsSync } from "node:fs";
import * as path from "node:path";
import {
  formatSkillKeywordIndexIssues,
  loadSkillKeywordIndexReport,
} from "../../.omp/extensions/pi-oven-runtime/skill-keyword-loader";
import {
  SUBAGENT_RUNTIME_PREREQUISITES,
  readConfigValueDisplayState,
  readIgnoredSkillsDisplayState,
  type ConfigYmlOpts,
  type DisplayReadResult,
} from "./config-yml";
import { readProjectSettingsDisplayState } from "./project-settings";
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

type GlobalPrerequisiteTruthState = "configured" | "not-configured" | "unknown";
type KeywordIndexTruthState = "ok" | "partial" | "unavailable" | "unknown";

type GlobalPrerequisiteExpectation = {
  key: string;
  expected: boolean | string;
};

export interface StandaloneTruthFacts {
  pluginAssetPath: string;
  projectRoot: string;
  projectSettingsFile: string;
  projectRoutingRoleCount: number | null;
  projectRoutingState: "present" | "absent" | "unknown";
  globalPrerequisiteStates: Array<{ key: string; state: GlobalPrerequisiteTruthState }>;
  disabledProvidersState: DisplayReadResult<string[]>;
  ignoredSkillsState: DisplayReadResult<string[]>;
  keywordIndexTruth?: {
    state: KeywordIndexTruthState;
    loadedCount: number;
    shippedSkillCount: number;
    issues: string[];
    error?: string;
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

const PROJECT_SCOPE_GLOBAL_PREREQUISITES: GlobalPrerequisiteExpectation[] = [
  { key: "memory.backend", expected: "mnemopi" },
  { key: "mnemopi.noEmbeddings", expected: true },
  { key: "mnemopi.llmMode", expected: "none" },
  { key: "async.enabled", expected: true },
  ...Object.keys(SUBAGENT_RUNTIME_PREREQUISITES).map((key) => ({ key, expected: true })),
];

function countProjectRoutingRoles(data: Record<string, unknown>): number {
  const task = data["task"];
  if (typeof task !== "object" || task === null || Array.isArray(task)) return 0;
  const overrides = (task as Record<string, unknown>)["agentModelOverrides"];
  if (typeof overrides !== "object" || overrides === null || Array.isArray(overrides)) return 0;
  return Object.keys(overrides as Record<string, unknown>).filter((key) => key.startsWith("pi-oven:")).length;
}

function classifyGlobalPrerequisiteState(
  value: DisplayReadResult<unknown>,
  expected: boolean | string
): GlobalPrerequisiteTruthState {
  if (value.state === "unknown") return "unknown";
  if (value.state === "absent") return "not-configured";
  if (typeof expected === "boolean") {
    return value.value === expected || value.value === String(expected)
      ? "configured"
      : "not-configured";
  }
  return value.value === expected ? "configured" : "not-configured";
}

function normalizeStringArrayDisplayState(
  value: DisplayReadResult<unknown>
): DisplayReadResult<string[]> {
  if (value.state !== "present") return value;
  if (!Array.isArray(value.value)) {
    return { state: "unknown", error: "value is not array-like" };
  }
  return { state: "present", value: value.value.map((entry) => String(entry)) };
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

  const keywordIndexTruth = facts.keywordIndexTruth;
  if (keywordIndexTruth?.state === "partial") {
    signals.push({
      level: "WARN",
      name: "keyword-skill integrity",
      detail:
        `runtime keyword index loaded ${keywordIndexTruth.loadedCount}/${keywordIndexTruth.shippedSkillCount} shipped skills from ${facts.pluginAssetPath}, ` +
        `but skipped ${keywordIndexTruth.issues.length}: ${keywordIndexTruth.issues.join("; ")}. ` +
        "Runtime keyword-matched skills are partially available.",
      fix: KEYWORD_SKILL_INTEGRITY_FIX,
    });
  } else if (keywordIndexTruth?.state === "unavailable") {
    signals.push({
      level: "WARN",
      name: "keyword-skill integrity",
      detail:
        `runtime keyword index could not load any shipped skills from ${facts.pluginAssetPath}; ` +
        `skipped ${keywordIndexTruth.issues.length}: ${keywordIndexTruth.issues.join("; ")}. ` +
        "Runtime keyword-matched skills are unavailable.",
      fix: KEYWORD_SKILL_INTEGRITY_FIX,
    });
  } else if (keywordIndexTruth?.state === "unknown") {
    signals.push({
      level: "WARN",
      name: "keyword-skill integrity",
      detail:
        `runtime keyword index could not be probed from ${facts.pluginAssetPath}` +
        (keywordIndexTruth.error ? ` (${keywordIndexTruth.error})` : "."),
      fix: KEYWORD_SKILL_INTEGRITY_FIX,
    });
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
    PROJECT_SCOPE_GLOBAL_PREREQUISITES.map(async ({ key, expected }) => {
      const value = await readConfigValueDisplayState(key, opts);
      return {
        key,
        state: classifyGlobalPrerequisiteState(value, expected),
      };
    })
  );
  const disabledProvidersState = normalizeStringArrayDisplayState(
    await readConfigValueDisplayState("disabledProviders", opts)
  );

  const nativeWorkerRuntime = await resolveNativeWorkerRuntimeStatus({
    pluginRoot: opts.pluginAssetPath,
    projectRoot: opts.projectRoot,
    homeDir: opts.homeDir,
  });

  let keywordIndexTruth: StandaloneTruthFacts["keywordIndexTruth"];
  const pluginManifestPath = path.join(opts.pluginAssetPath, ".claude-plugin", "plugin.json");
  if (existsSync(pluginManifestPath)) {
    try {
      const report = loadSkillKeywordIndexReport(opts.pluginAssetPath);
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
  }

  return buildStandaloneTruthSignals({
    pluginAssetPath: opts.pluginAssetPath,
    projectRoot: opts.projectRoot,
    projectSettingsFile: projectSettings.file,
    projectRoutingRoleCount:
      projectSettings.state === "present"
        ? countProjectRoutingRoles(projectSettings.data)
        : projectSettings.state === "absent"
          ? 0
          : null,
    projectRoutingState: projectSettings.state,
    globalPrerequisiteStates,
    disabledProvidersState,
    ignoredSkillsState: await readIgnoredSkillsDisplayState(opts),
    keywordIndexTruth,
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
