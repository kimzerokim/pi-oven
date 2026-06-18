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

/** Per-ping subprocess timeout (ms). Prevents a slow model from hanging the wizard.
 * 15s: fast enough that an ENABLED-but-slow thinking model times out and is classified
 * as verified (timeout = enabled-but-slow), while a DISABLED model fails fast with a
 * real non-zero exit before the timeout fires.
 */
export const PING_TIMEOUT_MS = 15_000;

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

/**
 * Classification rule (Change 5):
 *   - exitCode === 0           → VERIFIED (success)
 *   - exitCode === null        → VERIFIED (timeout-killed = enabled-but-slow)
 *   - exitCode > 0 (fast fail) → UNVERIFIED (disabled/401/not-supported/400)
 *
 * A DISABLED model fails fast with a real non-zero exit before the timeout fires.
 * An ENABLED-but-slow model (kimi-k2.6, gemini-3-flash, minimax-m2.7) is killed by
 * the PING_TIMEOUT_MS deadline and Bun.spawnSync sets exitCode to null on kill.
 */
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
  ]);
  // null = timeout kill → enabled-but-slow → verified
  return result.exitCode === 0 || result.exitCode === null;
}

function defaultSpawn(
  cmd: string,
  args: string[]
): { exitCode: number | null; stdout: Buffer; stderr: Buffer } {
  const result = Bun.spawnSync([cmd, ...args], {
    stdio: ["ignore", "pipe", "pipe"],
    timeout: PING_TIMEOUT_MS,
  });
  // Preserve null exitCode (timeout kill) — do NOT coerce to 1.
  // Callers use null to classify the result as verified (enabled-but-slow).
  return {
    exitCode: result.exitCode,
    stdout: result.stdout ? Buffer.from(result.stdout) : Buffer.from(""),
    stderr: result.stderr ? Buffer.from(result.stderr) : Buffer.from(""),
  };
}
