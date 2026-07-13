/**
 * --reset subcommand for pi-oven setup wizard.
 * Spec E §3.3 — global reset clears managed task.agentModelOverrides role keys
 * for both canonical `pov:*` and legacy `pi-oven:*` forms. Agent files are NOT
 * touched — they are the committed DEFAULT_PROFILE baseline.
 *
 * --reset --full additionally resets setup-owned routing keys (modelRoles,
 * retry.fallbackChains, setupVersion) to their omp type-defaults so config.yml
 * returns to the "new user" state for a clean uninstall. omp-internal keys (e.g.
 * lastChangelogVersion) are NEVER touched.
 */

import {
  buildResetGlobalOverrideRecord,
  readConfigSnapshotStrict,
  writeConfigSnapshot,
} from "./config-yml";
import type { ConfigYmlOpts } from "./config-yml";
import {
  buildClearedSetupReceiptConfig,
  globalConfigPath,
  projectConfigPath,
} from "./project-config";
import {
  buildProjectResetSettings,
  projectSettingsPath,
  serializeProjectSettings,
} from "./project-settings";
import { resolveHomePaths } from "../lib/home-paths";
import {
  readTextFileSnapshot,
  restoreTextFileSnapshot,
  type TextFileSnapshot,
} from "../lib/atomic-file";
import {
  ABSENT,
  applySetupTransaction,
  isAbsentSnapshot,
  resetConfigSnapshot,
  resolveSetupTransactionStateDir,
  type SetupTransactionFaultPoint,
  type SetupTransactionResourceAdapter,
  type SetupTransactionSnapshot,
} from "./setup-transaction";

export interface ResetOptions {
  /** Injectable spawn for omp config get/set (tests). */
  spawnFn?: ConfigYmlOpts["spawnFn"];
  /** Project root whose setup-completion marker is cleared (default cwd). */
  cwd?: string;
  /**
   * Full reset: in addition to the global managed override removal, reset the
   * other pi-oven-managed config.yml keys (modelRoles, disabledProviders,
   * setupVersion) to their omp defaults. Off by default. In project scope,
   * --full additionally clears the project modelRoles + retry.fallbackChains
   * from `<cwd>/.omp/settings.json`.
   */
  full?: boolean;
  /**
   * WHICH layer is reset:
   *   - "global" (default) → homedir-global config.yml; the GLOBAL
   *     setup-completion marker is cleared.
   *   - "project" → `<cwd>/.omp/settings.json` `pi-oven:*` overrides (and, with
   *     --full, modelRoles + retry.fallbackChains); the PROJECT marker is cleared.
   */
  scope?: "global" | "project";
  /**
   * Home directory whose global `~/.pi-oven/config.json` marker is cleared in the
   * global branch (default `os.homedir()`). Injectable for tests so a global reset
   * never touches the real ~/.pi-oven.
   */
  homeDir?: string;
  transactionFault?: (point: SetupTransactionFaultPoint) => void | Promise<void>;
}

/** pi-oven-managed config.yml keys reset by `--reset --full`. */
const FULL_RESET_KEYS = ["modelRoles", "retry.fallbackChains", "setupVersion"] as const;

function parseJsonObjectSnapshot(snapshot: TextFileSnapshot, file: string): Record<string, unknown> {
  if ("absent" in snapshot) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(snapshot.content);
  } catch {
    throw new Error(`present but unparsable JSON: ${file}`);
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`present but not a plain object: ${file}`);
  }
  return parsed as Record<string, unknown>;
}

function fileSnapshot(value: SetupTransactionSnapshot): TextFileSnapshot {
  if (isAbsentSnapshot(value)) return value;
  if (
    typeof value !== "object" || value === null || Array.isArray(value) ||
    typeof (value as { content?: unknown }).content !== "string"
  ) throw new Error("Invalid journaled file snapshot");
  return { content: (value as { content: string }).content };
}

function stringRecord(value: SetupTransactionSnapshot, key: string): Record<string, string> {
  if (isAbsentSnapshot(value)) return {};
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${key} must be a record`);
  }
  return Object.fromEntries(Object.entries(value).map(([name, entry]) => [name, String(entry)]));
}

/**
 * Global reset clears managed role overrides for known roles in either prefix
 * (`pov:*` canonical or legacy `pi-oven:*`). Project reset remains scoped to the
 * current project file's legacy `pi-oven:*` layer until project migration lands.
 */
export async function runReset(
  opts?: ResetOptions
): Promise<{ exitCode: number; output: string }> {
  const scope = opts?.scope ?? "global";

  if (scope === "project") {
    const cwd = opts?.cwd ?? process.cwd();
    const file = projectSettingsPath(cwd);
    const receiptFile = projectConfigPath(cwd);
    const settingsOriginal = await readTextFileSnapshot(file);
    const receiptOriginal = await readTextFileSnapshot(receiptFile);
    const transformed = buildProjectResetSettings(
      parseJsonObjectSnapshot(settingsOriginal, file),
      Boolean(opts?.full)
    );
    const clearedReceipt = buildClearedSetupReceiptConfig(
      parseJsonObjectSnapshot(receiptOriginal, receiptFile)
    );
    const settingsResource = `file:${file}`;
    const receiptResource = `file:${receiptFile}`;
    const files = new Map([
      [settingsResource, file],
      [receiptResource, receiptFile],
    ]);
    const adapter: SetupTransactionResourceAdapter = {
      read: async (resource) => readTextFileSnapshot(files.get(resource)!),
      write: async (resource, value) => restoreTextFileSnapshot(files.get(resource)!, fileSnapshot(value)),
    };
    await applySetupTransaction({
      scope,
      operation: "reset",
      stateDir: resolveSetupTransactionStateDir({ scope, cwd }),
      adapter,
      desired: {
        [settingsResource]: transformed.data
          ? { content: serializeProjectSettings(transformed.data) }
          : ABSENT,
        [receiptResource]: "absent" in receiptOriginal
          ? ABSENT
          : { content: `${JSON.stringify(clearedReceipt, null, 2)}\n` },
      },
      originals: {
        [settingsResource]: settingsOriginal,
        [receiptResource]: receiptOriginal,
      },
      validate: async () => ({ ok: true }),
      fault: opts?.transactionFault,
    });
    const removedKeys = transformed.removedKeys;
    const removedIncludedSkills = transformed.removedIncludedSkills;
    const fullSuffix = opts?.full
      ? `Cleared project modelRoles + retry.fallbackChains from ${file}.\n`
      : "";
    const ownershipSuffix = removedIncludedSkills
      ? `Cleared project workflow-skill ownership filter from ${file}.\n`
      : "";

    if (removedKeys.length === 0) {
      return {
        exitCode: 0,
        output:
          `Already cleared — no pi-oven:* overrides in ${file}.\n` +
          ownershipSuffix +
          fullSuffix,
      };
    }

    const list = removedKeys.map((k) => `  - ${k}`).join("\n");
    return {
      exitCode: 0,
      output:
        `Cleared ${removedKeys.length} pi-oven:* override(s) from ${file}:\n${list}\n` +
        ownershipSuffix +
        fullSuffix +
        "Run /pi-oven:setup --status to verify, or /pi-oven:setup --scope project to reconfigure.\n",
    };
  }

  const homeDir = opts?.homeDir ?? resolveHomePaths().homeDir;
  const receiptFile = globalConfigPath(homeDir);
  const receiptOriginal = await readTextFileSnapshot(receiptFile);
  const keys = [
    "task.agentModelOverrides",
    "skills.includeSkills",
    ...(opts?.full ? [...FULL_RESET_KEYS] : []),
  ];
  const originals: Record<string, SetupTransactionSnapshot> = {};
  for (const key of keys) {
    originals[`config:${key}`] = await readConfigSnapshotStrict(key, opts);
  }
  const overrideTransform = buildResetGlobalOverrideRecord(
    stringRecord(originals["config:task.agentModelOverrides"]!, "task.agentModelOverrides")
  );
  const desired: Record<string, SetupTransactionSnapshot> = {
    "config:task.agentModelOverrides": overrideTransform.cleared,
    "config:skills.includeSkills": resetConfigSnapshot([]),
  };
  const fullResetDefaults: Record<(typeof FULL_RESET_KEYS)[number], SetupTransactionSnapshot> = {
    modelRoles: resetConfigSnapshot({}),
    "retry.fallbackChains": resetConfigSnapshot({}),
    setupVersion: resetConfigSnapshot(0),
  };
  for (const key of opts?.full ? FULL_RESET_KEYS : []) {
    desired[`config:${key}`] = fullResetDefaults[key];
  }
  const receiptResource = `file:${receiptFile}`;
  const clearedReceipt = buildClearedSetupReceiptConfig(
    parseJsonObjectSnapshot(receiptOriginal, receiptFile)
  );
  desired[receiptResource] = "absent" in receiptOriginal
    ? ABSENT
    : { content: `${JSON.stringify(clearedReceipt, null, 2)}\n` };
  originals[receiptResource] = receiptOriginal;
  const adapter: SetupTransactionResourceAdapter = {
    read: async (resource) =>
      resource.startsWith("config:")
        ? readConfigSnapshotStrict(resource.slice("config:".length), opts)
        : readTextFileSnapshot(receiptFile),
    write: async (resource, value) => {
      if (resource.startsWith("config:")) {
        await writeConfigSnapshot(resource.slice("config:".length), value, opts);
      } else {
        await restoreTextFileSnapshot(receiptFile, fileSnapshot(value));
      }
    },
  };
  await applySetupTransaction({
    scope,
    operation: "reset",
    stateDir: resolveSetupTransactionStateDir({ scope, homeDir }),
    adapter,
    desired,
    originals,
    validate: async () => ({ ok: true }),
    fault: opts?.transactionFault,
  });
  const removedKeys = overrideTransform.removedKeys;

  const fullSuffix = opts?.full
    ? `Reset pi-oven-managed config keys to defaults: ${FULL_RESET_KEYS.join(", ")}.\n`
    : "";
  const ownershipSuffix =
    'Cleared machine-global workflow-skill ownership filter: skills.includeSkills = ["pov:*"].\n';

  if (removedKeys.length === 0) {
    return {
      exitCode: 0,
      output:
        "Already cleared — no global managed role overrides in task.agentModelOverrides.\n" +
        ownershipSuffix +
        fullSuffix,
    };
  }

  const list = removedKeys.map((k) => `  - ${k}`).join("\n");
  return {
    exitCode: 0,
    output:
      `Cleared ${removedKeys.length} global managed override key(s):\n${list}\n` +
      ownershipSuffix +
      fullSuffix +
      "Run /pi-oven:setup --status to verify, or /pi-oven:setup to reconfigure.\n",
  };
}
