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
 *   It NEVER writes task.agentModelOverrides (the 24 subagent overrides) — that
 *   per-role write is banned by Spec E (frozen). modelRoles.default is the
 *   top-level session/orchestrator model, which is orthogonal and allowed.
 *
 * Personal per-role override is the --override path (Task 2.1).
 */

import { rewriteAllAgents } from "./agent-rewriter";
import { runValidate } from "./validate";
import { setModelRoles, setMemoryAndAsyncConfig, setRetryFallbackChains, setAgentModelOverrides } from "./config-yml";
import {
  PROFILE_A,
  PROFILE_B,
  PROFILE_C,
  PROFILE_A_ORCHESTRATOR,
  PROFILE_B_ORCHESTRATOR,
  PROFILE_C_ORCHESTRATOR,
  PROFILE_A_FALLBACK_CHAINS,
  PROFILE_B_FALLBACK_CHAINS,
  PROFILE_C_FALLBACK_CHAINS,
  ROLES,
  type ProfileMap,
} from "./profiles";

export interface ApplyOptions {
  profile: "A" | "B" | "C";
  validateMode?: "smoke" | "full" | "none";
  spawnFn?: (cmd: string, args: string[]) => { exitCode: number | null; stdout?: Buffer; stderr?: Buffer };
  agentsDir?: string; // maintainer generate target (repo agents/)
}

/**
 * Apply a profile:
 * 1. Resolve profileMap = PROFILE_A or PROFILE_B.
 * 2. WITH agentsDir → rewrite agent files (maintainer generate); write NO config.
 *    WITHOUT agentsDir → user setup: write the MAIN ORCHESTRATOR model pair
 *    (the modelRoles record's default + title keys) from PROFILE_*_ORCHESTRATOR
 *    in ONE atomic whole-record merge-write.
 * 3. runValidate per validateMode (default smoke).
 * 4. Return exit 0 if all ok; exit 1 if validation fails.
 *
 * NEVER writes task.agentModelOverrides (the 24 subagent overrides) — Spec E
 * (frozen) bans that per-role write. modelRoles.default is the top-level
 * session/orchestrator model and is orthogonal/allowed. Personal per-role
 * override is the --override path (runOverride, Task 2.1).
 */
export async function runApply(
  opts: ApplyOptions
): Promise<{ exitCode: number; output: string }> {
  const profileMap: ProfileMap =
    opts.profile === "C" ? PROFILE_C : opts.profile === "B" ? PROFILE_B : PROFILE_A;

  let memoryConfigLine = "";

  if (opts.agentsDir) {
    // Maintainer generate: rewrite agent files only, write no config keys.
    await rewriteAllAgents(opts.agentsDir, profileMap);
  } else {
    // User setup: write the MAIN ORCHESTRATOR model pair (modelRoles default +
    // title) in ONE atomic whole-record merge-write. omp's schema declares
    // `modelRoles` as a record, so dotted `modelRoles.default` writes are
    // rejected — setModelRoles read-merge-writes the whole record, preserving
    // sibling roles. Never task.agentModelOverrides for A/B (anti-Spec-E).
    const orchestrator =
      opts.profile === "C"
        ? PROFILE_C_ORCHESTRATOR
        : opts.profile === "B"
        ? PROFILE_B_ORCHESTRATOR
        : PROFILE_A_ORCHESTRATOR;
    await setModelRoles(
      { default: orchestrator.default, title: orchestrator.title },
      { spawnFn: opts.spawnFn }
    );
    const fallbackChains =
      opts.profile === "C"
        ? PROFILE_C_FALLBACK_CHAINS
        : opts.profile === "B"
        ? PROFILE_B_FALLBACK_CHAINS
        : PROFILE_A_FALLBACK_CHAINS;
    await setRetryFallbackChains(fallbackChains, { spawnFn: opts.spawnFn });

    // Profile B + C: bulk-write all 24 per-role task.agentModelOverrides.
    // Deliberate Spec E relaxation — profile A writes ZERO per-role overrides.
    if (opts.profile === "B" || opts.profile === "C") {
      const overrideRecord: Record<string, string> = {};
      for (const role of ROLES) {
        overrideRecord[`pi-oven:${role}`] = profileMap[role].primary;
      }
      await setAgentModelOverrides(overrideRecord, { spawnFn: opts.spawnFn });
    }

    // Write mnemopi memory backend + async.enabled for native memory/irc.
    // Does NOT touch task.agentModelOverrides for A/B (Spec E boundary preserved).
    await setMemoryAndAsyncConfig({ spawnFn: opts.spawnFn });
    memoryConfigLine =
      "✓ memory: mnemopi backend (noEmbeddings, llmMode=none) + async.enabled — native retain/recall/reflect + irc enabled\n";
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
      memoryConfigLine +
      `Setup complete.\n`,
  };
}
