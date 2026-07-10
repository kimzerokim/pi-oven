/**
 * Canonical model-id validation for pi-oven setup wizard.
 */

import type { Role, ProfileMap } from "./profiles";
import { isResolvableModelId } from "./model-id-validator";

export interface ValidateOptions {
  mode: "smoke" | "full" | "none";
  listModelsOutput?: string;
  spawnFn?: (cmd: string, args: string[]) => { exitCode: number | null; stdout?: Buffer; stderr?: Buffer };
}

export interface ValidateResult {
  ok: boolean;
  verified: Role[];
  unverified: Role[];
}

/** Spec B §8.1: 7 MUST-tier roles for smoke validation. */
export const SMOKE_ROLES: Role[] = [
  "executor",
  "explorer",
  "verifier",
  "critic",
  "planner",
  "code-reviewer",
  "debugger",
];

/**
 * Run exact-id validation for the given profileMap.
 *
 * mode=none → skip checks, return all roles as verified.
 * mode=smoke → check 7 MUST-tier roles.
 * mode=full  → check all roles.
 * ok=true when unverified is empty.
 */
export async function runValidate(
  profileMap: ProfileMap,
  opts: ValidateOptions
): Promise<ValidateResult> {
  const allRoles = Object.keys(profileMap) as Role[];

  if (opts.mode === "none") {
    return {
      ok: true,
      verified: allRoles,
      unverified: [],
    };
  }

  const rolesToPing: Role[] = opts.mode === "smoke" ? SMOKE_ROLES : allRoles;
  const verified: Role[] = [];
  const unverified: Role[] = [];

  for (const role of rolesToPing) {
    const entry = profileMap[role];
    if (!entry) continue;

    const primaryOk = await isResolvableModelId(entry.primary, {
      listModelsOutput: opts.listModelsOutput,
      spawnFn: opts.spawnFn,
    });
    if (primaryOk) {
      verified.push(role);
      continue;
    }
    unverified.push(role);
  }

  return {
    ok: unverified.length === 0,
    verified,
    unverified,
  };
}
