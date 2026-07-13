/**
 * --apply subcommand for pi-oven setup wizard.
 *
 * Two modes, keyed on whether `agentsDir` is supplied:
 * - WITH agentsDir = maintainer generate: rewrites repo agents/ frontmatter
 *   (model + thinkingLevel) from DEFAULT_PROFILE. Writes NO config keys.
 * - WITHOUT agentsDir = user setup: writes DEFAULT_ORCHESTRATOR, empty
 *   retry.fallbackChains, and all 24 task.agentModelOverrides.
 *
 * Personal per-role override is the --override path (Task 2.1).
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveHomePaths } from "../lib/home-paths";
import {
  readTextFileSnapshot,
  restoreTextFileSnapshot,
  type TextFileSnapshot,
} from "../lib/atomic-file";
import { rewriteAllAgents } from "./agent-rewriter";
import { runValidate } from "./validate";
import {
  buildDesiredGlobalOverrideRecord,
  readConfigSnapshotStrict,
  writeConfigSnapshot,
  setMemoryAndAsyncConfig,
  setToolEnablementConfig,
  SUBAGENT_RUNTIME_PREREQUISITES,
} from "./config-yml";
import {
  buildProjectSetupSettings,
  projectSettingsPath,
  serializeProjectSettings,
} from "./project-settings";
import {
  buildSetupReceiptConfig,
  globalConfigPath,
  projectConfigPath,
} from "./project-config";
import {
  applySetupTransaction,
  isAbsentSnapshot,
  resolveSetupTransactionStateDir,
  type SetupTransactionFaultPoint,
  type SetupTransactionResourceAdapter,
  type SetupTransactionSnapshot,
} from "./setup-transaction";
import {
  collectStandaloneTruthSignals,
  formatStandaloneTruthSignals,
} from "./standalone-truth-surface";
import {
  DEFAULT_FALLBACK_CHAINS,
  DEFAULT_ORCHESTRATOR,
  DEFAULT_PROFILE,
  ROLES,
  type ModelEntry,
} from "./profiles";

export interface ApplyOptions {
  /** Backward-compatible no-op. All values resolve to DEFAULT_PROFILE. */
  profile?: string;
  validateMode?: "smoke" | "full" | "none";
  spawnFn?: (cmd: string, args: string[]) => { exitCode: number | null; stdout?: Buffer; stderr?: Buffer };
  agentsDir?: string; // maintainer generate target (repo agents/)
  /**
   * WHERE the user-setup branch writes model routing:
   *   - "global" (default) → homedir-global `~/.omp/agent/config.yml` via the
   *     config-yml writers. Behavior is byte-for-byte unchanged from before.
   *   - "project" → `<cwd>/.omp/settings.json` via the project-settings writers.
   *     Writes all 24 per-role overrides + modelRoles + retry.fallbackChains there;
   *     NO global config-yml writer runs and the
   *     memory/async infra is NOT written (configure that once via global scope).
   * Ignored on the maintainer path (with agentsDir).
   */
  scope?: "global" | "project";
  /** Project root the project-scope writers target (default process.cwd()). */
  cwd?: string;
  /** Injectable home for global journal/receipt isolation. */
  homeDir?: string;
  /** Deterministic transaction fault injection used by the fault matrix. */
  transactionFault?: (point: SetupTransactionFaultPoint) => void | Promise<void>;
  now?: () => Date;
}

function modelOverrideValue(entry: ModelEntry): string {
  return `${entry.primary}:${entry.thinkingLevel}`;
}

const PLUGIN_ROOT = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));

const GLOBAL_MEMORY_CONFIG: Record<string, SetupTransactionSnapshot> = {
  "memory.backend": "mnemopi",
  "mnemopi.noEmbeddings": true,
  "mnemopi.llmMode": "none",
  "async.enabled": true,
};

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

function asStringRecord(value: SetupTransactionSnapshot, key: string): Record<string, string> {
  if (isAbsentSnapshot(value)) return {};
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${key} must be a record`);
  }
  const record: Record<string, string> = {};
  for (const [name, entry] of Object.entries(value)) record[name] = String(entry);
  return record;
}

function fileSnapshot(value: SetupTransactionSnapshot): TextFileSnapshot {
  if (isAbsentSnapshot(value)) return value;
  if (
    typeof value !== "object" || value === null || Array.isArray(value) ||
    typeof (value as { content?: unknown }).content !== "string"
  ) {
    throw new Error("Invalid journaled file snapshot");
  }
  return { content: (value as { content: string }).content };
}

/**
 * Apply the default profile:
 * 1. Resolve DEFAULT_PROFILE.
 * 2. WITH agentsDir → maintainer generate path: rewrite agent files
 *    (model array + thinkingLevel); write NO config.
 * 3. WITHOUT agentsDir + global scope → write modelRoles + retry.fallbackChains
 *    and all 24 `task.agentModelOverrides`.
 * 4. WITHOUT agentsDir + project scope → write all 24 per-role overrides,
 *    modelRoles, and retry.fallbackChains to `<cwd>/.omp/settings.json`.
 * 5. runValidate per validateMode (default smoke).
 * 6. Return exit 0 if all ok; exit 1 if validation fails.
 */
export async function runApply(
  opts: ApplyOptions
): Promise<{ exitCode: number; output: string }> {
  let memoryConfigLine = "";
  let toolsEnabledLine = "";
  let workflowSkillLine = "";
  let scopeLine = "";
  let projectRemediationLine = "";
  const scope = opts.scope ?? "global";
  let validateResult: Awaited<ReturnType<typeof runValidate>> | undefined;

  if (opts.agentsDir) {
    // Maintainer generate: rewrite agent files only, write no config keys.
    await rewriteAllAgents(opts.agentsDir, DEFAULT_PROFILE);
  } else {
    const overrideRecord: Record<string, string> = {};
    for (const role of ROLES) {
      overrideRecord[`pov:${role}`] = modelOverrideValue(DEFAULT_PROFILE[role]);
    }
    const validateTransaction = async () => {
      validateResult = await runValidate(DEFAULT_PROFILE, {
        mode: opts.validateMode ?? "smoke",
        spawnFn: opts.spawnFn,
      });
      return validateResult.ok
        ? { ok: true as const }
        : { ok: false as const, error: `unverified roles: ${validateResult.unverified.join(", ")}` };
    };

    if (scope === "project") {
      const cwd = opts.cwd ?? process.cwd();
      const settingsFile = projectSettingsPath(cwd);
      const receiptFile = projectConfigPath(cwd);
      const settingsOriginal = await readTextFileSnapshot(settingsFile);
      const receiptOriginal = await readTextFileSnapshot(receiptFile);
      const settings = buildProjectSetupSettings(
        parseJsonObjectSnapshot(settingsOriginal, settingsFile),
        {
          overrides: overrideRecord,
          modelRoles: {
            default: DEFAULT_ORCHESTRATOR.default,
            title: DEFAULT_ORCHESTRATOR.title,
          },
          fallbackChains: DEFAULT_FALLBACK_CHAINS,
        }
      );
      const receipt = buildSetupReceiptConfig(
        parseJsonObjectSnapshot(receiptOriginal, receiptFile),
        (opts.now?.() ?? new Date()).toISOString()
      );
      const settingsResource = `file:${settingsFile}`;
      const receiptResource = `file:${receiptFile}`;
      const files = new Map([
        [settingsResource, settingsFile],
        [receiptResource, receiptFile],
      ]);
      const adapter: SetupTransactionResourceAdapter = {
        read: async (resource) => readTextFileSnapshot(files.get(resource)!),
        write: async (resource, value) => restoreTextFileSnapshot(files.get(resource)!, fileSnapshot(value)),
      };
      try {
        await applySetupTransaction({
          scope,
          operation: "apply",
          stateDir: resolveSetupTransactionStateDir({ scope, cwd }),
          adapter,
          desired: {
            [settingsResource]: { content: serializeProjectSettings(settings) },
          },
          receipt: {
            resource: receiptResource,
            value: { content: `${JSON.stringify(receipt, null, 2)}\n` },
          },
          originals: {
            [settingsResource]: settingsOriginal,
            [receiptResource]: receiptOriginal,
          },
          validate: validateTransaction,
          fault: opts.transactionFault,
        });
      } catch (error) {
        if (!validateResult || validateResult.ok) throw error;
      }
      const standaloneSignals = await collectStandaloneTruthSignals({
        pluginAssetPath: PLUGIN_ROOT,
        projectRoot: cwd,
        spawnFn: opts.spawnFn,
      });
      scopeLine = `✓ project visibility matrix written to ${projectSettingsPath(cwd)} (all 24 roles pinned + skills.includeSkills + modelRoles + empty retry.fallbackChains)\n`;
      workflowSkillLine =
        '✓ workflow-skill ownership: skills.includeSkills = ["pov:*"] written to project .omp/settings.json (workflow skills only; populated ~/.claude/skills remains explicitly non-owning)\n';
      projectRemediationLine =
        "Project scope kept ~/.omp/agent/config.yml untouched.\n" +
        formatStandaloneTruthSignals(standaloneSignals).join("\n") +
        "\n";
    } else {
      const homeDir = opts.homeDir ?? resolveHomePaths().homeDir;
      const receiptFile = globalConfigPath(homeDir);
      const receiptOriginal = await readTextFileSnapshot(receiptFile);
      const configKeys = [
        "modelRoles",
        "retry.fallbackChains",
        "task.agentModelOverrides",
        "skills.includeSkills",
        ...Object.keys(GLOBAL_MEMORY_CONFIG),
        ...Object.keys(SUBAGENT_RUNTIME_PREREQUISITES),
      ];
      const originals: Record<string, SetupTransactionSnapshot> = {};
      for (const key of configKeys) {
        originals[`config:${key}`] = await readConfigSnapshotStrict(key, { spawnFn: opts.spawnFn });
      }
      const currentModelRoles = asStringRecord(originals["config:modelRoles"]!, "modelRoles");
      const currentOverrides = asStringRecord(
        originals["config:task.agentModelOverrides"]!,
        "task.agentModelOverrides"
      );
      const desired: Record<string, SetupTransactionSnapshot> = {
        "config:modelRoles": { ...currentModelRoles, ...DEFAULT_ORCHESTRATOR },
        "config:retry.fallbackChains": DEFAULT_FALLBACK_CHAINS,
        "config:task.agentModelOverrides": buildDesiredGlobalOverrideRecord(
          currentOverrides,
          overrideRecord
        ),
        "config:skills.includeSkills": ["pov:*"],
        ...Object.fromEntries(
          Object.entries(GLOBAL_MEMORY_CONFIG).map(([key, value]) => [`config:${key}`, value])
        ),
        ...Object.fromEntries(
          Object.entries(SUBAGENT_RUNTIME_PREREQUISITES).map(([key, value]) => [
            `config:${key}`,
            value,
          ])
        ),
      };
      const receiptResource = `file:${receiptFile}`;
      const receipt = buildSetupReceiptConfig(
        parseJsonObjectSnapshot(receiptOriginal, receiptFile),
        (opts.now?.() ?? new Date()).toISOString()
      );
      originals[receiptResource] = receiptOriginal;
      const adapter: SetupTransactionResourceAdapter = {
        read: async (resource) =>
          resource.startsWith("config:")
            ? readConfigSnapshotStrict(resource.slice("config:".length), { spawnFn: opts.spawnFn })
            : readTextFileSnapshot(receiptFile),
        write: async (resource, value) => {
          if (resource.startsWith("config:")) {
            await writeConfigSnapshot(resource.slice("config:".length), value, { spawnFn: opts.spawnFn });
          } else {
            await restoreTextFileSnapshot(receiptFile, fileSnapshot(value));
          }
        },
      };
      try {
        await applySetupTransaction({
          scope,
          operation: "apply",
          stateDir: resolveSetupTransactionStateDir({ scope, homeDir }),
          adapter,
          desired,
          receipt: {
            resource: receiptResource,
            value: { content: `${JSON.stringify(receipt, null, 2)}\n` },
          },
          originals,
          validate: validateTransaction,
          fault: opts.transactionFault,
        });
      } catch (error) {
        if (!validateResult || validateResult.ok) throw error;
      }
      workflowSkillLine =
        '✓ workflow-skill ownership: skills.includeSkills = ["pov:*"] written to ~/.omp/agent/config.yml (workflow skills only; populated ~/.claude/skills remains explicitly non-owning)\n';
      memoryConfigLine =
        "✓ memory: mnemopi backend (noEmbeddings, llmMode=none) + async.enabled — native retain/recall/reflect + irc enabled for subagent coordination\n";
      toolsEnabledLine =
        "✓ tools enabled: inspect_image, web_search, lsp, ast_grep, browser, debug\n";
    }
  }

  if (!validateResult) {
    validateResult = await runValidate(DEFAULT_PROFILE, {
      mode: opts.validateMode ?? "smoke",
      spawnFn: opts.spawnFn,
    });
  }

  if (!validateResult.ok) {
    const unverifiedList = validateResult.unverified.join(", ");
    return {
      exitCode: 1,
      output:
        `Default setup applied but validation failed.\n` +
        `Unverified roles: ${unverifiedList}\n` +
        `Run /pi-oven:setup to reconfigure, or /pi-oven:setup --reset to return to defaults.\n`,
    };
  }

  const verifiedCount = validateResult.verified.length;
  const summaryParts: string[] = [`${verifiedCount} roles verified`];

  return {
    exitCode: 0,
    output:
      `Default codex-only setup applied. ${summaryParts.join(", ")}.\n` +
      scopeLine +
      projectRemediationLine +
      workflowSkillLine +
      memoryConfigLine +
      toolsEnabledLine +
      "Configuration boundary: setup/status are visibility/guard layers only; runtime records current-session provider-family drift as diagnostics, not routing policy.\n" +
      "Fan-out contract: dispatch dependency-ready work in the widest safe wave (default target 8-12 siblings). OMP task owns dispatch; async.enabled, task.maxConcurrency, and provider/runtime admission determine actual concurrency.\n" +
      `Setup complete.\n`,
  };
}

export async function runRepairPrereqs(opts: {
  spawnFn?: (cmd: string, args: string[]) => { exitCode: number | null; stdout?: Buffer; stderr?: Buffer };
} = {}): Promise<{ exitCode: number; output: string }> {
  await setMemoryAndAsyncConfig({ spawnFn: opts.spawnFn });
  await setToolEnablementConfig({ spawnFn: opts.spawnFn });

  return {
    exitCode: 0,
    output:
      "Machine-global prerequisites repaired.\n" +
      "✓ memory: mnemopi backend (noEmbeddings, llmMode=none) + async.enabled — native retain/recall/reflect + irc enabled for subagent coordination\n" +
      "✓ tools enabled: inspect_image, web_search, lsp, ast_grep, browser, debug\n" +
      "Repair complete.\n",
  };
}
