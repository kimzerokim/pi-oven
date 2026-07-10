/**
 * --import subcommand for pi-oven setup wizard.
 * Spec E §3.3 / Plan Task 2.5 — JSON import writes whitelisted per-role
 * model primaries to task.agentModelOverrides as canonical global `pov:<role>`
 * keys. Does NOT rewrite agent files. Does NOT touch plugin-config namespace.
 * No 'custom' profile concept.
 */

import { promises as fs } from "node:fs";
import { ROLES, type Role, type ModelEntry } from "./profiles";
import { setAgentModelOverrides, setPiOvenIncludedSkills } from "./config-yml";
import { isResolvableModelId } from "./model-id-validator";

const ALLOWED_THINKING_LEVELS = ["minimal", "low", "medium", "high", "xhigh"] as const;
const ALWAYS_ALLOWED_PREFIXES = ["opencode-zen/", "openai-codex/"];
const ANTHROPIC_PREFIX = "anthropic/";

export interface ImportInput {
  "pi-oven"?: {
    profile?: string;
    models?: Partial<Record<Role, Pick<ModelEntry, "primary" | "registry_alternate" | "thinkingLevel">>>;
  };
}

export interface ValidateImportOpts {
  allowAnthropic?: boolean;
}

export interface RunImportOpts {
  allowAnthropic?: boolean;
  scope?: "global" | "project";
  spawnFn?: (cmd: string, args: string[]) => { exitCode: number | null; stdout?: Buffer; stderr?: Buffer };
  /** Injectable `omp models` output for EXACT-ID-ONLY validation (tests). */
  listModelsOutput?: string;
}

/**
 * Validate an import input object against whitelist rules.
 * Returns { ok, errors } — does NOT perform I/O.
 */
export function validateImport(
  input: unknown,
  opts?: ValidateImportOpts
): { ok: boolean; errors: string[] } {
  const errors: string[] = [];

  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return { ok: false, errors: ["top-level JSON must be an object"] };
  }

  const root = input as Record<string, unknown>;
  const block = root["pi-oven"];
  if (block === undefined) {
    return { ok: true, errors: [] };
  }
  if (typeof block !== "object" || block === null || Array.isArray(block)) {
    return { ok: false, errors: ["pi-oven block must be an object"] };
  }

  const piOven = block as Record<string, unknown>;
  if (piOven.profile !== undefined) {
    errors.push("profile is not importable; use /pi-oven:setup --profile for baseline routing");
  }

  const models = piOven.models;
  if (models === undefined) {
    return { ok: errors.length === 0, errors };
  }
  if (typeof models !== "object" || models === null || Array.isArray(models)) {
    errors.push("pi-oven.models must be an object keyed by role");
    return { ok: false, errors };
  }

  for (const [role, value] of Object.entries(models as Record<string, unknown>)) {
    if (!(ROLES as readonly string[]).includes(role)) {
      errors.push(`pi-oven.models.${role}: unknown role`);
      continue;
    }
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      errors.push(`pi-oven.models.${role}: entry must be an object`);
      continue;
    }

    const entry = value as Record<string, unknown>;
    const primary = entry.primary;
    if (typeof primary !== "string" || primary.length === 0) {
      errors.push(`pi-oven.models.${role}.primary: required non-empty string`);
    } else {
      const allowedByPrefix =
        ALWAYS_ALLOWED_PREFIXES.some((prefix) => primary.startsWith(prefix)) ||
        (opts?.allowAnthropic === true && primary.startsWith(ANTHROPIC_PREFIX));
      if (!allowedByPrefix) {
        errors.push(`pi-oven.models.${role}.primary: model '${primary}' is outside the allowed import whitelist`);
      }
    }

    if (entry.registry_alternate !== undefined && typeof entry.registry_alternate !== "string") {
      errors.push(`pi-oven.models.${role}.registry_alternate: if present, must be a string`);
    }

    if (entry.thinkingLevel !== undefined) {
      if (
        typeof entry.thinkingLevel !== "string" ||
        !(ALLOWED_THINKING_LEVELS as readonly string[]).includes(entry.thinkingLevel)
      ) {
        errors.push(
          `pi-oven.models.${role}.thinkingLevel: if present, must be one of ${ALLOWED_THINKING_LEVELS.join(", ")}`
        );
      }
    }
  }

  return { ok: errors.length === 0, errors };
}

/**
 * Run the --import flow: read file, parse JSON, validate whitelist,
 * validate EXACT-ID-ONLY model ids, then write all-or-nothing to
 * task.agentModelOverrides as canonical global `pov:<role>` keys.
 *
 * registry_alternate and thinkingLevel are parsed but NOT written
 * (override layer supports single model string only — intended limitation).
 */
export async function runImport(
  filePath: string,
  opts?: RunImportOpts
): Promise<{ exitCode: number; output: string }> {
  if (opts?.scope === "project") {
    return {
      exitCode: 1,
      output:
        "--import is global-only today: it writes machine-global task.agentModelOverrides and does not support --scope project.\n",
    };
  }

  let raw: string;
  try {
    raw = await fs.readFile(filePath, "utf-8");
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      exitCode: 1,
      output: `Import file not found or unreadable: ${filePath}\n${msg}\n`,
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { exitCode: 1, output: `JSON parse error: ${msg}\n` };
  }

  const validation = validateImport(parsed, { allowAnthropic: opts?.allowAnthropic });
  if (!validation.ok) {
    return {
      exitCode: 1,
      output: `Import validation failed:\n${validation.errors.join("\n")}\n`,
    };
  }

  const importInput = (parsed as ImportInput)["pi-oven"]!;
  const models = importInput.models;

  if (!models || Object.keys(models).length === 0) {
    await setPiOvenIncludedSkills(opts?.spawnFn ? { spawnFn: opts.spawnFn } : undefined);
    return {
      exitCode: 0,
      output:
        `Import complete. No models specified; 0 overrides written.\n` +
        `Workflow-skill ownership filter applied via skills.includeSkills = ["pov:*"].\n` +
        `Note: registry_alternate/thinkingLevel ignored (override = single model).\n`,
    };
  }

  const toWrite: Array<{ colonKey: string; primary: string }> = [];
  for (const [roleName, entry] of Object.entries(models)) {
    if (!entry || typeof entry.primary !== "string") continue;
    const colonKey = `pov:${roleName}`;
    toWrite.push({ colonKey, primary: entry.primary });
  }

  const modelIdOpts = {
    spawnFn: opts?.spawnFn,
    ...(opts?.listModelsOutput !== undefined
      ? { listModelsOutput: opts.listModelsOutput }
      : {}),
  };

  const unresolvable: string[] = [];
  for (const { colonKey, primary } of toWrite) {
    const resolvable = await isResolvableModelId(primary, modelIdOpts);
    if (!resolvable) {
      unresolvable.push(`${colonKey}: "${primary}" not found in omp model registry`);
    }
  }

  if (unresolvable.length > 0) {
    return {
      exitCode: 1,
      output:
        `Import rejected — unresolvable model ids (write 0):\n` +
        unresolvable.join("\n") +
        `\n`,
    };
  }

  const configYmlOpts = opts?.spawnFn ? { spawnFn: opts.spawnFn } : undefined;
  const record = Object.fromEntries(
    toWrite.map(({ colonKey, primary }) => [colonKey, primary] as const)
  ) as Record<string, string>;
  await setAgentModelOverrides(record, configYmlOpts);
  await setPiOvenIncludedSkills(configYmlOpts);

  return {
    exitCode: 0,
    output:
      `Import complete. ${toWrite.length} override(s) written to task.agentModelOverrides.\n` +
      `Workflow-skill ownership filter applied via skills.includeSkills = ["pov:*"].\n` +
      `Note: registry_alternate/thinkingLevel ignored (override = single model).\n`,
  };
}
