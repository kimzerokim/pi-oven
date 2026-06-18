/**
 * --import subcommand for pi-oven setup wizard.
 * Spec E §3.3 / Plan Task 2.5 — JSON import writes whitelisted per-role
 * model primaries to task.agentModelOverrides as colon keys (pi-oven:<role>).
 * Does NOT rewrite agent files. Does NOT touch plugin-config namespace.
 * No 'custom' profile concept.
 */

import { promises as fs } from "node:fs";
import { ROLES, type Role, type ModelEntry } from "./profiles";
import { setAgentModelOverride } from "./config-yml";
import { isResolvableModelId } from "./model-id-validator";

const ALLOWED_THINKING_LEVELS = ["minimal", "low", "medium", "high", "xhigh"] as const;
const ALWAYS_ALLOWED_PREFIXES = ["opencode-zen/", "openai-codex/"];
const ANTHROPIC_PREFIX = "anthropic/";

export interface ImportInput {
  "pi-oven"?: {
    profile?: "A" | "B";
    models?: Partial<Record<Role, Partial<ModelEntry>>>;
    provider?: { anthropic?: { enabled?: boolean } };
  };
}

export interface ValidateImportOpts {
  allowAnthropic?: boolean;
}

export interface RunImportOpts {
  allowAnthropic?: boolean;
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

  if (typeof input !== "object" || input === null) {
    errors.push("Import input must be a JSON object.");
    return { ok: false, errors };
  }

  const root = input as Record<string, unknown>;
  const piOven = root["pi-oven"] as Record<string, unknown> | undefined;
  if (!piOven || typeof piOven !== "object") {
    errors.push("Import must contain a top-level 'pi-oven' object.");
    return { ok: false, errors };
  }

  // Validate profile — 'custom' is no longer a valid profile
  const profile = piOven["profile"];
  if (profile !== undefined && !["A", "B"].includes(profile as string)) {
    errors.push(`Invalid profile value "${profile}". Allowed: "A", "B".`);
  }

  // Build allowed prefixes
  const allowedPrefixes = [...ALWAYS_ALLOWED_PREFIXES];
  if (opts?.allowAnthropic) {
    allowedPrefixes.push(ANTHROPIC_PREFIX);
  }

  // Validate models
  const models = piOven["models"];
  if (models !== undefined && typeof models === "object" && models !== null) {
    const rolesSet = new Set<string>(ROLES as readonly string[]);
    const rolesEnumeration = ROLES.join(", ");

    for (const [roleName, entry] of Object.entries(models as Record<string, unknown>)) {
      if (!rolesSet.has(roleName)) {
        errors.push(
          `Unknown role "${roleName}" in models.\nAllowed roles: ${rolesEnumeration}`
        );
        continue;
      }

      if (typeof entry !== "object" || entry === null) continue;
      const modelEntry = entry as Record<string, unknown>;

      for (const field of ["primary", "registry_alternate"] as const) {
        const val = modelEntry[field];
        if (val !== undefined) {
          if (typeof val !== "string") {
            errors.push(`"${roleName}.${field}" must be a string.`);
            continue;
          }
          const allowed = allowedPrefixes.some((p) => val.startsWith(p));
          if (!allowed) {
            errors.push(
              `"${roleName}.${field}" = "${val}" rejected.\n` +
                `Provider "${val}" is not in the allowed list: ${allowedPrefixes.join(", ")}`
            );
          }
        }
      }

      const thinkingLevel = modelEntry["thinkingLevel"];
      if (thinkingLevel !== undefined) {
        if (!ALLOWED_THINKING_LEVELS.includes(thinkingLevel as any)) {
          errors.push(
            `"${roleName}.thinkingLevel" = "${thinkingLevel}" is invalid. ` +
              `Allowed: ${ALLOWED_THINKING_LEVELS.join(", ")}.`
          );
        }
      }
    }
  }

  return { ok: errors.length === 0, errors };
}

/**
 * Run the --import flow: read file, parse JSON, validate whitelist,
 * validate EXACT-ID-ONLY model ids, then write all-or-nothing to
 * task.agentModelOverrides as pi-oven:<role> colon keys.
 *
 * registry_alternate and thinkingLevel are parsed but NOT written
 * (override layer supports single model string only — intended limitation).
 */
export async function runImport(
  filePath: string,
  opts?: RunImportOpts
): Promise<{ exitCode: number; output: string }> {
  // 1. Read file
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

  // 2. Parse JSON
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { exitCode: 1, output: `JSON parse error: ${msg}\n` };
  }

  // 3. Whitelist validation (pure, no IO)
  const validation = validateImport(parsed, { allowAnthropic: opts?.allowAnthropic });
  if (!validation.ok) {
    return {
      exitCode: 1,
      output: `Import validation failed:\n${validation.errors.join("\n")}\n`,
    };
  }

  const importInput = (parsed as ImportInput)["pi-oven"]!;
  const models = importInput.models;

  // No models block → write 0 entries, succeed
  if (!models || Object.keys(models).length === 0) {
    return {
      exitCode: 0,
      output: `Import complete. No models specified; 0 overrides written.\nNote: registry_alternate/thinkingLevel ignored (override = single model).\n`,
    };
  }

  // 4. Collect role→primary pairs (registry_alternate/thinkingLevel ignored)
  const toWrite: Array<{ colonKey: string; primary: string }> = [];
  for (const [roleName, entry] of Object.entries(models)) {
    if (!entry || typeof entry.primary !== "string") continue;
    const colonKey = `pi-oven:${roleName}`;
    toWrite.push({ colonKey, primary: entry.primary });
  }

  // 5. EXACT-ID-ONLY validation — all roles must resolve before any write
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

  // 6. All-or-nothing write: setAgentModelOverride for each role
  const configYmlOpts = opts?.spawnFn ? { spawnFn: opts.spawnFn } : undefined;
  for (const { colonKey, primary } of toWrite) {
    await setAgentModelOverride(colonKey, primary, configYmlOpts);
  }

  return {
    exitCode: 0,
    output:
      `Import complete. ${toWrite.length} override(s) written to task.agentModelOverrides.\n` +
      `Note: registry_alternate/thinkingLevel ignored (override = single model).\n`,
  };
}
