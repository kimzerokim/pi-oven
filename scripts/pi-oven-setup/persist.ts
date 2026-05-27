/**
 * Plugin config persistence for pi-oven setup wizard.
 * Spec B §9.1 — omp plugin config set/delete calls.
 * Spec B §9.3 — direct lock file read for readPluginConfig.
 */

import { promises as fs } from "node:fs";

const DEFAULT_LOCK_FILE = `${process.env.HOME}/.omp/plugins/omp-plugins.lock.json`;

export interface ReadPluginConfigOpts {
  /** Override lock file path (for tests). */
  lockFilePath?: string;
}

export interface WritePluginConfigOpts {
  /** Injectable spawn function for tests. */
  spawnFn?: (cmd: string, args: string[]) => { exitCode: number | null; stdout?: Buffer; stderr?: Buffer };
}

export interface DeletePluginConfigOpts {
  /** Injectable spawn function for tests. */
  spawnFn?: (cmd: string, args: string[]) => { exitCode: number | null; stdout?: Buffer; stderr?: Buffer };
}

/**
 * Read the pi-oven settings object directly from omp-plugins.lock.json.
 * Returns settings["pi-oven"] (or {}) on any failure (missing file, JSON parse error, wrong shape).
 */
export async function readPluginConfig(
  opts?: ReadPluginConfigOpts
): Promise<Record<string, string>> {
  const lockFilePath = opts?.lockFilePath ?? DEFAULT_LOCK_FILE;

  let raw: string;
  try {
    raw = await fs.readFile(lockFilePath, "utf-8");
  } catch {
    return {};
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }

  if (
    typeof parsed !== "object" ||
    parsed === null ||
    typeof (parsed as Record<string, unknown>)["settings"] !== "object" ||
    (parsed as Record<string, unknown>)["settings"] === null
  ) {
    return {};
  }

  const settings = (parsed as Record<string, unknown>)["settings"] as Record<string, unknown>;
  const pi-oven = settings["pi-oven"];

  if (typeof pi-oven !== "object" || pi-oven === null) {
    return {};
  }

  // Return a flat string-to-string map (all values coerced to string)
  const result: Record<string, string> = {};
  for (const [k, v] of Object.entries(pi-oven as Record<string, unknown>)) {
    result[k] = String(v);
  }
  return result;
}

/**
 * Write a pi-oven plugin config value via `omp plugin config set pi-oven <key> <value>`.
 * Plugin name is bare "pi-oven" (not "pi-oven@pi-oven").
 */
export async function writePluginConfig(
  key: string,
  value: string,
  opts?: WritePluginConfigOpts
): Promise<{ ok: boolean; stderr?: string }> {
  const spawn = opts?.spawnFn ?? defaultSpawn;
  const result = spawn("omp", ["plugin", "config", "set", "pi-oven", key, value]);
  if (result.exitCode !== 0) {
    return { ok: false, stderr: result.stderr?.toString() ?? "" };
  }
  return { ok: true };
}

/**
 * Delete a pi-oven plugin config key via `omp plugin config delete pi-oven <key>`.
 */
export async function deletePluginConfig(
  key: string,
  opts?: DeletePluginConfigOpts
): Promise<{ ok: boolean }> {
  const spawn = opts?.spawnFn ?? defaultSpawn;
  const result = spawn("omp", ["plugin", "config", "delete", "pi-oven", key]);
  if (result.exitCode !== 0) {
    return { ok: false };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

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
