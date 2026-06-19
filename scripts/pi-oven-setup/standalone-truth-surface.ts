import {
  PI_OVEN_SIBLING_SKILL_GLOBS,
  TOOL_ENABLEMENT,
  readBooleanSettingDisplayState,
  readIgnoredSkillsDisplayState,
  type ConfigYmlOpts,
  type DisplayReadResult,
} from "./config-yml";
import {
  readProjectSettingsDisplayState,
} from "./project-settings";

export type StandaloneTruthLevel = "INFO" | "WARN";

export interface StandaloneTruthSignal {
  level: StandaloneTruthLevel;
  name: string;
  detail: string;
  fix?: string;
}

type ToolFlagTruthState = "enabled" | "not-enabled" | "unknown";

export interface StandaloneTruthFacts {
  pluginAssetPath: string;
  projectRoot: string;
  projectSettingsFile: string;
  projectRoutingRoleCount: number | null;
  projectRoutingState: "present" | "absent" | "unknown";
  toolFlagStates: Array<{ key: string; state: ToolFlagTruthState }>;
  ignoredSkillsState: DisplayReadResult<string[]>;
}

export const GLOBAL_CONFIG_PATH = "~/.omp/agent/config.yml";
export const PROJECT_SCOPE_GLOBAL_REMEDIATION_FIX =
  "Run /pi-oven:setup --scope global once on this machine to enable those tool flags. Project scope does not write ~/.omp/agent/config.yml.";
export const PROJECT_SCOPE_FILE_REPAIR_FIX =
  "Repair or remove the project's .omp/settings.json, then rerun /pi-oven:setup --status.";
export const SIBLING_SUPPRESSION_FIX =
  "Optional global-only step: /pi-oven:setup --suppress-sibling-skills";

function countProjectRoutingRoles(data: Record<string, unknown>): number {
  const task = data["task"];
  if (typeof task !== "object" || task === null || Array.isArray(task)) return 0;
  const overrides = (task as Record<string, unknown>)["agentModelOverrides"];
  if (typeof overrides !== "object" || overrides === null || Array.isArray(overrides)) return 0;
  return Object.keys(overrides as Record<string, unknown>).filter((key) => key.startsWith("pi-oven:")).length;
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
  ];

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
    const unknownToolFlags = facts.toolFlagStates
      .filter(({ state }) => state === "unknown")
      .map(({ key }) => key);
    const notEnabledToolFlags = facts.toolFlagStates
      .filter(({ state }) => state === "not-enabled")
      .map(({ key }) => key);

    if (unknownToolFlags.length > 0) {
      signals.push({
        level: "WARN",
        name: "project-scope remediation",
        detail:
          `project routing is active in ${facts.projectSettingsFile} ` +
          `(${facts.projectRoutingRoleCount} roles), but the machine-global tool-flag state could not be verified for: ` +
          `${unknownToolFlags.join(", ")}.` +
          (notEnabledToolFlags.length > 0
            ? ` Confirmed not enabled: ${notEnabledToolFlags.join(", ")}.`
            : ""),
        fix: PROJECT_SCOPE_GLOBAL_REMEDIATION_FIX,
      });
    } else if (notEnabledToolFlags.length === 0) {
      signals.push({
        level: "INFO",
        name: "project-scope remediation",
        detail:
          `project routing is active in ${facts.projectSettingsFile} ` +
          `(${facts.projectRoutingRoleCount} roles); required machine-global tool flags are already present.`,
      });
    } else {
      signals.push({
        level: "WARN",
        name: "project-scope remediation",
        detail:
          `project routing is active in ${facts.projectSettingsFile} ` +
          `(${facts.projectRoutingRoleCount} roles), but the required machine-global tool flags are not enabled: ` +
          `${notEnabledToolFlags.join(", ")}.`,
        fix: PROJECT_SCOPE_GLOBAL_REMEDIATION_FIX,
      });
    }
  }

  if (facts.ignoredSkillsState.state === "unknown") {
    signals.push({
      level: "WARN",
      name: "sibling-skill suppression",
      detail: `state unknown because skills.ignoredSkills in ${GLOBAL_CONFIG_PATH} is unreadable/corrupt.`,
      fix: SIBLING_SUPPRESSION_FIX,
    });
    return signals;
  }
  const ignoredSkills = facts.ignoredSkillsState.state === "present" ? facts.ignoredSkillsState.value : [];

  const matched = [...PI_OVEN_SIBLING_SKILL_GLOBS].filter((glob) =>
    ignoredSkills.includes(glob)
  );
  const missing = [...PI_OVEN_SIBLING_SKILL_GLOBS].filter((glob) => !matched.includes(glob));

  if (matched.length === PI_OVEN_SIBLING_SKILL_GLOBS.length) {
    signals.push({
      level: "INFO",
      name: "sibling-skill suppression",
      detail:
        `enabled in ${GLOBAL_CONFIG_PATH} ` +
        `(${[...PI_OVEN_SIBLING_SKILL_GLOBS].join(", ")} hidden).`,
    });
  } else if (matched.length === 0) {
    signals.push({
      level: "INFO",
      name: "sibling-skill suppression",
      detail: `not enabled in ${GLOBAL_CONFIG_PATH}; sibling marketplace skills remain visible.`,
      fix: SIBLING_SUPPRESSION_FIX,
    });
  } else {
    signals.push({
      level: "WARN",
      name: "sibling-skill suppression",
      detail:
        `partially enabled in ${GLOBAL_CONFIG_PATH} ` +
        `(${matched.join(", ")} present; missing ${missing.join(", ")}).`,
      fix: SIBLING_SUPPRESSION_FIX,
    });
  }

  return signals;
}

export async function collectStandaloneTruthSignals(
  opts: {
    pluginAssetPath: string;
    projectRoot: string;
  } & ConfigYmlOpts
): Promise<StandaloneTruthSignal[]> {
  const projectSettings = await readProjectSettingsDisplayState({ cwd: opts.projectRoot });
  const toolFlagStates: StandaloneTruthFacts["toolFlagStates"] = await Promise.all(
    Object.keys(TOOL_ENABLEMENT).map(async (key) => {
      const value = await readBooleanSettingDisplayState(key, opts);
      const state: ToolFlagTruthState =
        value.state === "present"
          ? value.value
            ? "enabled"
            : "not-enabled"
          : value.state === "absent"
          ? "not-enabled"
          : "unknown";
      return { key, state };
    })
  );

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
    toolFlagStates,
    ignoredSkillsState: await readIgnoredSkillsDisplayState(opts),
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
