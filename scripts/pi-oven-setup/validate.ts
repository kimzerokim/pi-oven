/**
 * Smoke ping validation for pi-oven setup wizard.
 * Spec B §8 — smoke/full/none validation modes.
 */

import type { Role, ProfileMap } from "./profiles";

export interface ValidateOptions {
  mode: "smoke" | "full" | "none";
  spawnFn?: (cmd: string, args: string[]) => { exitCode: number | null; stdout?: Buffer; stderr?: Buffer };
}

export interface ValidateResult {
  ok: boolean;
  verified: Role[];
  alternates: Role[];
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
 * Run validation pings for the given profileMap.
 *
 * mode=none → skip all pings, return all roles as verified.
 * mode=smoke → ping 7 MUST-tier roles.
 * mode=full  → ping all 23 roles.
 *
 * For each role: try primary; on fail try registry_alternate.
 * Results: verified (primary ok) | alternates (primary fail, alternate ok) | unverified (both fail).
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
      alternates: [],
      unverified: [],
    };
  }

  const rolesToPing: Role[] = opts.mode === "smoke" ? SMOKE_ROLES : allRoles;
  const spawn = opts.spawnFn ?? defaultSpawn;

  const verified: Role[] = [];
  const alternates: Role[] = [];
  const unverified: Role[] = [];

  for (const role of rolesToPing) {
    const entry = profileMap[role];
    if (!entry) continue;

    const primaryOk = pingModel(entry.primary, spawn);
    if (primaryOk) {
      verified.push(role);
      continue;
    }

    const alternateOk = pingModel(entry.registry_alternate, spawn);
    if (alternateOk) {
      alternates.push(role);
      continue;
    }

    unverified.push(role);
  }

  return {
    ok: unverified.length === 0,
    verified,
    alternates,
    unverified,
  };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function pingModel(
  model: string,
  spawnFn: (cmd: string, args: string[]) => { exitCode: number | null }
): boolean {
  const result = spawnFn("omp", [
    "-p",
    "Reply with the single word: ok",
    "--model",
    model,
    "--no-tools",
    "--max-tokens",
    "5",
  ]);
  return result.exitCode === 0;
}

function defaultSpawn(
  cmd: string,
  args: string[]
): { exitCode: number | null; stdout: Buffer; stderr: Buffer } {
  const result = Bun.spawnSync([cmd, ...args], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  return {
    exitCode: result.exitCode ?? 1,
    stdout: result.stdout ? Buffer.from(result.stdout) : Buffer.from(""),
    stderr: result.stderr ? Buffer.from(result.stderr) : Buffer.from(""),
  };
}
