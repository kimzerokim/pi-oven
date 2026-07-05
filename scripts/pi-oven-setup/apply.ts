/**
 * --apply subcommand for pi-oven setup wizard.
 *
 * Two modes, keyed on whether `agentsDir` is supplied:
 * - WITH agentsDir = maintainer generate: rewrites repo agents/ frontmatter
 *   (model: array + thinkingLevel) from PROFILE_A/B via agent-rewriter. Writes
 *   NO config keys.
 * - WITHOUT agentsDir = user setup: writes the MAIN ORCHESTRATOR model pair
 *   (the `default` + `title` keys of the `modelRoles` record) from
 *   PROFILE_*_ORCHESTRATOR in ONE atomic whole-record merge-write.
 *   Profiles B/C/D also write 24 task.agentModelOverrides. Profile B writes
 *   model selectors with `:<thinkingLevel>` suffixes so the installation path
 *   carries both model and effort routing; C/D keep plain model ids.
 *
 * Personal per-role override is the --override path (Task 2.1).
 */

import path from "node:path";
import { rewriteAllAgents } from "./agent-rewriter";
import { runValidate } from "./validate";
import {
  setModelRoles,
  setMemoryAndAsyncConfig,
  setRetryFallbackChains,
  setAgentModelOverrides,
  setToolEnablementConfig,
} from "./config-yml";
import {
  setProjectAgentModelOverrides,
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
  PROFILE_A,
  PROFILE_B,
  PROFILE_C,
  PROFILE_D,
  PROFILE_A_ORCHESTRATOR,
  PROFILE_B_ORCHESTRATOR,
  PROFILE_C_ORCHESTRATOR,
  PROFILE_D_ORCHESTRATOR,
  PROFILE_A_FALLBACK_CHAINS,
  PROFILE_B_FALLBACK_CHAINS,
  PROFILE_C_FALLBACK_CHAINS,
  PROFILE_D_FALLBACK_CHAINS,
  ROLES,
  type ModelEntry,
  type ProfileMap,
} from "./profiles";

export interface ApplyOptions {
  profile: "A" | "B" | "C" | "D";
  validateMode?: "smoke" | "full" | "none";
  spawnFn?: (cmd: string, args: string[]) => { exitCode: number | null; stdout?: Buffer; stderr?: Buffer };
  agentsDir?: string; // maintainer generate target (repo agents/)
  /**
   * WHERE the user-setup branch writes model routing:
   *   - "global" (default) → homedir-global `~/.omp/agent/config.yml` via the
   *     config-yml writers. Behavior is byte-for-byte unchanged from before.
   *   - "project" → `<cwd>/.omp/settings.json` via the project-settings writers.
   *     ALL profiles (incl. A) write all 24 per-role overrides + modelRoles +
   *     retry.fallbackChains there; NO global config-yml writer runs and the
   *     memory/async infra is NOT written (configure that once via global scope).
   * Ignored on the maintainer path (with agentsDir).
   */
  scope?: "global" | "project";
  /** Project root the project-scope writers target (default process.cwd()). */
  cwd?: string;
}

function modelOverrideValue(profile: ApplyOptions["profile"], entry: ModelEntry): string {
  return profile === "B" ? `${entry.primary}:${entry.thinkingLevel}` : entry.primary;
}

/**
 * Apply a profile:
 * 1. Resolve profileMap = PROFILE_A/B/C/D.
 * 2. WITH agentsDir → maintainer generate path: rewrite agent files
 *    (model array + thinkingLevel); write NO config.
 * 3. WITHOUT agentsDir + global scope → write modelRoles + retry.fallbackChains;
 *    profiles B/C/D also write all 24 `task.agentModelOverrides`.
 *    Profile A remains orchestrator-only globally.
 * 4. WITHOUT agentsDir + project scope → write all 24 per-role overrides,
 *    modelRoles, and retry.fallbackChains to `<cwd>/.omp/settings.json`.
 *    Profile B per-role values include `:<thinkingLevel>` selector suffixes.
 * 5. runValidate per validateMode (default smoke).
 * 6. Return exit 0 if all ok; exit 1 if validation fails.
 */
export async function runApply(
  opts: ApplyOptions
): Promise<{ exitCode: number; output: string }> {
  const profileMap: ProfileMap =
    opts.profile === "D"
      ? PROFILE_D
      : opts.profile === "C"
      ? PROFILE_C
      : opts.profile === "B"
      ? PROFILE_B
      : PROFILE_A;

  let memoryConfigLine = "";
  let toolsEnabledLine = "";
  let scopeLine = "";
  let projectRemediationLine = "";
  let nativeWorkerRuntimeLine = "";
  let workerCeilingLine = "";
  const scope = opts.scope ?? "global";

  if (opts.agentsDir) {
    // Maintainer generate: rewrite agent files only, write no config keys.
    await rewriteAllAgents(opts.agentsDir, profileMap);
  } else {
    // Resolve the orchestrator pair + fallback chains for the profile (shared by
    // both scopes).
    const orchestrator =
      opts.profile === "D"
        ? PROFILE_D_ORCHESTRATOR
        : opts.profile === "C"
        ? PROFILE_C_ORCHESTRATOR
        : opts.profile === "B"
        ? PROFILE_B_ORCHESTRATOR
        : PROFILE_A_ORCHESTRATOR;
    const fallbackChains =
      opts.profile === "D"
        ? PROFILE_D_FALLBACK_CHAINS
        : opts.profile === "C"
        ? PROFILE_C_FALLBACK_CHAINS
        : opts.profile === "B"
        ? PROFILE_B_FALLBACK_CHAINS
        : PROFILE_A_FALLBACK_CHAINS;

    if (scope === "project") {
      // PROJECT setup: write the model routing into <cwd>/.omp/settings.json
      // (the omp project layer), which deep-merges OVER global. EVERY profile
      // (incl. A) writes ALL 24 per-role overrides here — agent-file frontmatter
      // is the global plugin default, so a project that wants different models
      // must carry explicit overrides for all 24 roles to actually diverge. This
      // is a DIFFERENT layer than the global config.yml, so Spec E's per-role
      // global ban for Profile A is not violated. NO global config-yml writer
      // runs and the memory/async infra is NOT written (configure once globally).
      const cwd = opts.cwd ?? process.cwd();
      const overrideRecord: Record<string, string> = {};
      for (const role of ROLES) {
        overrideRecord[`pi-oven:${role}`] = modelOverrideValue(opts.profile, profileMap[role]);
      }
      await setProjectAgentModelOverrides(overrideRecord, { cwd });
      await setProjectModelRoles(
        { default: orchestrator.default, title: orchestrator.title },
        { cwd }
      );
      await setProjectRetryFallbackChains(fallbackChains, { cwd });
      const standaloneSignals = await collectStandaloneTruthSignals({
        pluginAssetPath: path.resolve(import.meta.dir, "..", ".."),
        projectRoot: cwd,
        spawnFn: opts.spawnFn,
      });
      scopeLine = `✓ project routing written to ${projectSettingsPath(cwd)} (all 24 roles pinned + modelRoles + retry.fallbackChains; Profile B includes reasoning-effort suffixes)\n`;
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
      // preserving sibling roles. Never task.agentModelOverrides for A (anti-Spec-E).
      await setModelRoles(
        { default: orchestrator.default, title: orchestrator.title },
        { spawnFn: opts.spawnFn }
      );
      await setRetryFallbackChains(fallbackChains, { spawnFn: opts.spawnFn });

      // Profile B + C + D: bulk-write all 24 per-role task.agentModelOverrides.
      // Profile B values include :<thinkingLevel> model-selector suffixes.
      if (opts.profile === "B" || opts.profile === "C" || opts.profile === "D") {
        const overrideRecord: Record<string, string> = {};
        for (const role of ROLES) {
          overrideRecord[`pi-oven:${role}`] = modelOverrideValue(opts.profile, profileMap[role]);
        }
        await setAgentModelOverrides(overrideRecord, { spawnFn: opts.spawnFn });
      }

      // Write mnemopi memory backend + async.enabled for native memory/irc.
      // Does NOT touch task.agentModelOverrides for A (Spec E boundary preserved).
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
        pluginRoot: path.resolve(import.meta.dir, "..", ".."),
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
  const validateResult = await runValidate(profileMap, {
    mode: validateMode,
    spawnFn: opts.spawnFn,
  });

  if (!validateResult.ok) {
    const unverifiedList = validateResult.unverified.join(", ");
    return {
      exitCode: 1,
      output:
        `Profile ${opts.profile} applied but validation failed.\n` +
        `Unverified roles: ${unverifiedList}\n` +
        `Run /pi-oven:setup to reconfigure, or /pi-oven:setup --reset to return to defaults.\n`,
    };
  }

  const verifiedCount = validateResult.verified.length + validateResult.alternates.length;
  const alternateCount = validateResult.alternates.length;
  const summaryParts: string[] = [`${verifiedCount} roles verified`];
  if (alternateCount > 0) {
    summaryParts.push(`${alternateCount} alternate only`);
  }

  return {
    exitCode: 0,
    output:
      `Profile ${opts.profile} active. ${summaryParts.join(", ")}.\n` +
      scopeLine +
      projectRemediationLine +
      memoryConfigLine +
      toolsEnabledLine +
      nativeWorkerRuntimeLine +
      workerCeilingLine +
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
