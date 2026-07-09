/**
 * --override subcommand for pi-oven setup wizard.
 * Spec E §3.3/§3.4 — per-role model override written to user-global config.yml
 * via OMP-delegated transport (omp config get → merge → omp config set).
 */

import { ROLES, type Role } from "./profiles";
import { isResolvableModelId, type ModelIdValidatorOpts } from "./model-id-validator";
import {
  setAgentModelOverride,
  setPiOvenIncludedSkills,
  type ConfigYmlOpts,
} from "./config-yml";
import { setProjectAgentModelOverrides, setProjectIncludedSkills } from "./project-settings";

export interface OverrideOptions {
  /** Raw "role=model" entries from --override (repeatable). */
  entries: string[];
  /** Injectable list-models output for validator (tests). */
  listModelsOutput?: string;
  /** Injectable spawn for config-yml get/set (tests). */
  spawnFn?: (cmd: string, args: string[]) => { exitCode: number | null; stdout?: Buffer; stderr?: Buffer };
  /**
   * WHERE the overrides are written:
   *   - "global" (default) → homedir-global `~/.omp/agent/config.yml` via the
   *     per-entry `setAgentModelOverride` loop (unchanged behavior).
   *   - "project" → `<cwd>/.omp/settings.json` via ONE batched
   *     `setProjectAgentModelOverrides` call.
   */
  scope?: "global" | "project";
  /** Project root the project-scope writer targets (default process.cwd()). */
  cwd?: string;
}

const ROLES_SET: ReadonlySet<string> = new Set(ROLES);

/**
 * For each "role=model": parse (must contain "="; non-empty role+model), validate role ∈ ROLES,
 * validate model resolvable (EXACT-ID-ONLY). Validate ALL entries FIRST; only if all pass,
 * write each via setAgentModelOverride("pi-oven:"+role, model). Any invalid → exit 1, ZERO writes.
 * Returns per-entry result for status echo.
 */
export async function runOverride(
  opts: OverrideOptions
): Promise<{ exitCode: number; output: string; applied: Array<{ colonKey: string; model: string }> }> {
  const validatorOpts: ModelIdValidatorOpts = {
    listModelsOutput: opts.listModelsOutput,
    spawnFn: opts.spawnFn,
  };
  const configOpts: ConfigYmlOpts = {
    spawnFn: opts.spawnFn,
  };

  // ---------------------------------------------------------------------------
  // Phase 1: validate ALL entries before any write
  // ---------------------------------------------------------------------------

  type ParsedEntry = { colonKey: string; model: string };
  const parsed: ParsedEntry[] = [];
  const errors: string[] = [];

  for (const entry of opts.entries) {
    const eqIdx = entry.indexOf("=");

    // Must contain "="
    if (eqIdx === -1) {
      errors.push(`invalid --override '${entry}': expected <role>=<model>`);
      continue;
    }

    const role = entry.slice(0, eqIdx);
    const model = entry.slice(eqIdx + 1);

    // Non-empty role
    if (!role) {
      errors.push(`invalid --override '${entry}': role must not be empty (expected <role>=<model>)`);
      continue;
    }

    // Non-empty model
    if (!model) {
      errors.push(`invalid --override '${entry}': model must not be empty (expected <role>=<model>)`);
      continue;
    }

    // role ∈ ROLES
    if (!ROLES_SET.has(role)) {
      errors.push(`invalid --override '${entry}': role '${role}' is not a known pi-oven role`);
      continue;
    }

    // Model resolvable (EXACT-ID-ONLY)
    const resolvable = await isResolvableModelId(model, validatorOpts);
    if (!resolvable) {
      errors.push(
        `invalid --override '${entry}': model '${model}' is not resolvable — run 'omp models' to see canonical ids`
      );
      continue;
    }

    parsed.push({ colonKey: `pi-oven:${role as Role}`, model });
  }

  if (errors.length > 0) {
    return {
      exitCode: 1,
      output: errors.join("\n") + "\n",
      applied: [],
    };
  }

  // ---------------------------------------------------------------------------
  // Phase 2: write all — only reached if ALL entries passed validation
  // ---------------------------------------------------------------------------

  const applied: Array<{ colonKey: string; model: string }> = [];
  const scope = opts.scope ?? "global";

  if (scope === "project") {
    // Batch all parsed entries into ONE atomic write to <cwd>/.omp/settings.json.
    const record: Record<string, string> = {};
    for (const { colonKey, model } of parsed) {
      record[colonKey] = model;
      applied.push({ colonKey, model });
    }
    await setProjectAgentModelOverrides(record, { cwd: opts.cwd });
    await setProjectIncludedSkills({ cwd: opts.cwd });
  } else {
    for (const { colonKey, model } of parsed) {
      await setAgentModelOverride(colonKey, model, configOpts);
      applied.push({ colonKey, model });
    }
    await setPiOvenIncludedSkills(configOpts);
  }

  const lines = applied.map((a) => `  ${a.colonKey} = ${a.model}`).join("\n");
  return {
    exitCode: 0,
    output: `Override applied (${applied.length} role${applied.length === 1 ? "" : "s"}):\n${lines}\n`,
    applied,
  };
}
