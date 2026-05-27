/**
 * --import subcommand for pi-oven setup wizard.
 * Spec B §7 — JSON import with whitelist validation.
 */

import { promises as fs } from "node:fs";
import { ROLES, type Role, type ModelEntry, type ProfileMap, PROFILE_A, PROFILE_B } from "./profiles";
import { writePluginConfig } from "./persist";
import { rewriteAllAgents } from "./agent-rewriter";
import { runValidate } from "./validate";

const ALLOWED_THINKING_LEVELS = ["minimal", "low", "medium", "high", "xhigh"] as const;
const ALWAYS_ALLOWED_PREFIXES = ["opencode-zen/", "openai-codex/"];
const ANTHROPIC_PREFIX = "anthropic/";

export interface ImportInput {
  pi-oven?: {
    profile?: "A" | "B" | "custom";
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
  agentsDir?: string;
  lockFilePath?: string;
  validateMode?: "smoke" | "full" | "none";
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
  const pi-oven = root["pi-oven"] as Record<string, unknown> | undefined;
  if (!pi-oven || typeof pi-oven !== "object") {
    errors.push("Import must contain a top-level 'pi-oven' object.");
    return { ok: false, errors };
  }

  // Validate profile
  const profile = pi-oven["profile"];
  if (profile !== undefined && !["A", "B", "custom"].includes(profile as string)) {
    errors.push(`Invalid profile value "${profile}". Allowed: "A", "B", "custom".`);
  }

  // Build allowed prefixes
  const allowedPrefixes = [...ALWAYS_ALLOWED_PREFIXES];
  if (opts?.allowAnthropic) {
    allowedPrefixes.push(ANTHROPIC_PREFIX);
  }

  // Validate models
  const models = pi-oven["models"];
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
            const prefixList = allowedPrefixes.map((p) => p.replace(/\/$/, "")).join(", ");
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
 * Run the --import flow: read file, parse JSON, validate, persist, rewrite agents.
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

  // 3. Validate
  const validation = validateImport(parsed, { allowAnthropic: opts?.allowAnthropic });
  if (!validation.ok) {
    return {
      exitCode: 1,
      output: `Import validation failed:\n${validation.errors.join("\n")}\n`,
    };
  }

  const importInput = (parsed as ImportInput).pi-oven!;
  const profile = importInput.profile ?? "A";
  const baseMap: ProfileMap = profile === "B" ? PROFILE_B : PROFILE_A;

  // 4. Merge models: base profile + import overrides
  const profileMap: ProfileMap = { ...baseMap };
  if (importInput.models) {
    for (const [roleName, override] of Object.entries(importInput.models)) {
      const role = roleName as Role;
      profileMap[role] = {
        ...baseMap[role],
        ...override,
      } as ModelEntry;
    }
  }

  // 5. Persist
  const spawnOpts = opts?.spawnFn ? { spawnFn: opts.spawnFn } : undefined;

  await writePluginConfig("pi-oven.profile", profile, spawnOpts);
  if (importInput.provider?.anthropic?.enabled) {
    await writePluginConfig("pi-oven.provider.anthropic.enabled", "true", spawnOpts);
  }
  for (const role of ROLES) {
    const entry = profileMap[role];
    await writePluginConfig(`pi-oven.models.${role}.primary`, entry.primary, spawnOpts);
    await writePluginConfig(`pi-oven.models.${role}.registry_alternate`, entry.registry_alternate, spawnOpts);
    await writePluginConfig(`pi-oven.models.${role}.thinkingLevel`, entry.thinkingLevel, spawnOpts);
  }

  // 6. Rewrite agent files
  if (opts?.agentsDir) {
    await rewriteAllAgents(opts.agentsDir, profileMap);
  }

  // 7. Validate
  const validateMode = opts?.validateMode ?? "smoke";
  const validateResult = await runValidate(profileMap, {
    mode: validateMode,
    spawnFn: opts?.spawnFn,
  });

  if (!validateResult.ok) {
    const unverifiedList = validateResult.unverified.join(", ");
    return {
      exitCode: 1,
      output: `Import applied but validation failed. Unverified roles: ${unverifiedList}\n`,
    };
  }

  return {
    exitCode: 0,
    output: `Import complete. Profile ${profile} active. ${validateResult.verified.length + validateResult.alternates.length} roles verified.\n`,
  };
}
