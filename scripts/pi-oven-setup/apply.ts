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
import { rewriteAllAgents } from "./agent-rewriter";
import { runValidate } from "./validate";
import {
  setModelRoles,
  setMemoryAndAsyncConfig,
  setRetryFallbackChains,
  setAgentModelOverrides,
  setToolEnablementConfig,
  setPiOvenIncludedSkills,
} from "./config-yml";
import {
  setProjectAgentModelOverrides,
  setProjectIncludedSkills,
  setProjectModelRoles,
  setProjectRetryFallbackChains,
  projectSettingsPath,
} from "./project-settings";
import {
  collectStandaloneTruthSignals,
  formatStandaloneTruthSignals,
} from "./standalone-truth-surface";
import {
  describeNativeWorkerRuntime,
  resolveNativeWorkerRuntimeStatus,
} from "../pi-oven-team";
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
}

function modelOverrideValue(entry: ModelEntry): string {
  return `${entry.primary}:${entry.thinkingLevel}`;
}

const PLUGIN_ROOT = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));

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
  let nativeWorkerRuntimeLine = "";
  let workerCeilingLine = "";
  const scope = opts.scope ?? "global";

  if (opts.agentsDir) {
    // Maintainer generate: rewrite agent files only, write no config keys.
    await rewriteAllAgents(opts.agentsDir, DEFAULT_PROFILE);
  } else {
    if (scope === "project") {
      // PROJECT setup: write the model routing into <cwd>/.omp/settings.json
      // (the omp project layer), which deep-merges OVER global. Setup writes
      // all 24 per-role overrides here — agent-file frontmatter is the
      // shipped plugin default, so a project that wants different models must
      // carry explicit overrides for all 24 roles to actually diverge. NO global
      // config-yml writer runs and the memory/async infra is NOT written
      // (configure once globally).
      const cwd = opts.cwd ?? process.cwd();
      const overrideRecord: Record<string, string> = {};
      for (const role of ROLES) {
        overrideRecord[`pov:${role}`] = modelOverrideValue(DEFAULT_PROFILE[role]);
      }
      await setProjectAgentModelOverrides(overrideRecord, { cwd });
      await setProjectIncludedSkills({ cwd });
      await setProjectModelRoles(
        { default: DEFAULT_ORCHESTRATOR.default, title: DEFAULT_ORCHESTRATOR.title },
        { cwd }
      );
      await setProjectRetryFallbackChains(DEFAULT_FALLBACK_CHAINS, { cwd });
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
      workerCeilingLine = "";
    } else {
      // User setup (global): write the MAIN ORCHESTRATOR model pair (modelRoles
      // default + title) in ONE atomic whole-record merge-write. omp's schema
      // declares `modelRoles` as a record, so dotted `modelRoles.default` writes
      // are rejected — setModelRoles read-merge-writes the whole record,
      // preserving sibling roles.
      await setModelRoles(
        { default: DEFAULT_ORCHESTRATOR.default, title: DEFAULT_ORCHESTRATOR.title },
        { spawnFn: opts.spawnFn }
      );
      await setRetryFallbackChains(DEFAULT_FALLBACK_CHAINS, { spawnFn: opts.spawnFn });

      // Bulk-write all 24 per-role task.agentModelOverrides. Global persisted
      // routing is canonical `pov:*`; successful writes also migrate any old-only
      // `pi-oven:*` state in the same scope.
      const overrideRecord: Record<string, string> = {};
      for (const role of ROLES) {
        overrideRecord[`pov:${role}`] = modelOverrideValue(DEFAULT_PROFILE[role]);
      }
      await setAgentModelOverrides(overrideRecord, { spawnFn: opts.spawnFn });
      await setPiOvenIncludedSkills({ spawnFn: opts.spawnFn });
      workflowSkillLine =
        '✓ workflow-skill ownership: skills.includeSkills = ["pov:*"] written to ~/.omp/agent/config.yml (workflow skills only; populated ~/.claude/skills remains explicitly non-owning)\n';

      // Write mnemopi memory backend + async.enabled for native memory/irc.
      await setMemoryAndAsyncConfig({ spawnFn: opts.spawnFn });
      memoryConfigLine =
        "✓ memory: mnemopi backend (noEmbeddings, llmMode=none) + async.enabled — native retain/recall/reflect + irc enabled for subagent coordination\n";
      // Enable omp's gated tools so the agents' tool mandates have teeth
      // (inspect_image defaults false; the rest are written defensively). Global
      // scope only — project scope writes routing files, never `omp config set`.
      await setToolEnablementConfig({ spawnFn: opts.spawnFn });
      toolsEnabledLine =
        "✓ tools enabled: inspect_image, web_search, lsp, ast_grep, browser, debug\n";
      const nativeWorkerRuntime = await resolveNativeWorkerRuntimeStatus({
        pluginRoot: PLUGIN_ROOT,
        projectRoot: opts.cwd ?? process.cwd(),
      });
      nativeWorkerRuntimeLine =
        `✓ native worker runtime: ${describeNativeWorkerRuntime(nativeWorkerRuntime)}\n` +
        `✓ runtime trace primitives: ${nativeWorkerRuntime.tracePrimitives.join(", ")}\n` +
        `✓ verifier depth policy: ${nativeWorkerRuntime.verifierDepth.deepWhen} (deep hard cap ${nativeWorkerRuntime.verifierDepth.deepAutoContinueHardCap}; light path = ${nativeWorkerRuntime.verifierDepth.lightWhen})\n`;
      workerCeilingLine =
        `✓ native worker ceiling: nativeWorkers.maxWorkers=${nativeWorkerRuntime.maxWorkers} from ${nativeWorkerRuntime.maxWorkersConfigPath} (${nativeWorkerRuntime.maxWorkersSource})\n`;
    }
  }

  // Validate
  const validateMode = opts.validateMode ?? "smoke";
  const validateResult = await runValidate(DEFAULT_PROFILE, {
    mode: validateMode,
    spawnFn: opts.spawnFn,
  });

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
      nativeWorkerRuntimeLine +
      workerCeilingLine +
      "Configuration boundary: setup/status are visibility/guard layers only; runtime records current-session provider-family drift as diagnostics, not routing policy.\n" +
      "Fan-out contract: dispatch dependency-ready work in the widest safe wave (default target 8-12 siblings). The vendored pi-oven launcher enforces nativeWorkers.maxWorkers when its control path is present, and setup/status/doctor surface any degraded runtime state explicitly.\n" +
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
