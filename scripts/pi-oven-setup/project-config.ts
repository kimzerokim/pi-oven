/**
 * project-config.ts — per-project, machine-local pi-oven config.
 *
 * Persists `{ language }` to `<cwd>/.pi-oven/config.json` (machine-local,
 * gitignored). This is the project default RESPONSE language honored by the
 * runtime extension (rules-injector). It does NOT change skill/agent body
 * language (those stay English-only).
 *
 * Design notes:
 *   - setProjectLanguage: read-merge so any OTHER keys in config.json survive.
 *   - readProjectLanguage: returns null when the file is absent OR the stored
 *     language is missing/invalid (fail-soft — the runtime then injects NOTHING
 *     and the ambient setting is respected).
 *   - normalizeLanguage: accepts a handful of human spellings; throws on garbage
 *     so the CLI can surface a clear error.
 */

import { promises as fs, readFileSync } from "fs";
import * as path from "path";
import * as os from "os";
import { resolveLanguage } from "../../.omp/extensions/pi-oven-runtime/language";

/**
 * Canonical project response language. `"ko"` / `"en"` are the canonical codes
 * (rich, hand-authored directives); any other value is a free-form language
 * NAME (e.g. "Español"). All values are validated through `resolveLanguage`.
 */
export type ProjectLanguage = string;

export const DEFAULT_NATIVE_WORKER_MAX = 100;

function normalizeNativeWorkerMax(value: unknown): number | null {
  return typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 1 &&
    value <= DEFAULT_NATIVE_WORKER_MAX
    ? value
    : null;
}

function readNativeWorkerMaxFromConfig(data: Record<string, unknown>): number | null {
  const nativeWorkers = data.nativeWorkers;
  if (!nativeWorkers || typeof nativeWorkers !== "object" || Array.isArray(nativeWorkers)) {
    return null;
  }
  return normalizeNativeWorkerMax((nativeWorkers as Record<string, unknown>).maxWorkers);
}

function withNativeWorkerMax(
  existing: Record<string, unknown>,
  maxWorkers: number
): Record<string, unknown> {
  const currentNativeWorkers =
    existing.nativeWorkers &&
    typeof existing.nativeWorkers === "object" &&
    !Array.isArray(existing.nativeWorkers)
      ? (existing.nativeWorkers as Record<string, unknown>)
      : {};

  return {
    ...existing,
    nativeWorkers: {
      ...currentNativeWorkers,
      maxWorkers,
    },
  };
}

/** Directory + file the per-project config lives in (relative to a cwd). */
const CONFIG_DIR = ".pi-oven";
const CONFIG_FILE = "config.json";

function configPath(cwd: string): string {
  return path.resolve(cwd, CONFIG_DIR, CONFIG_FILE);
}

/**
 * Normalize a human-supplied language token. Canonical: ko / KO / korean / 한국어
 * → "ko"; en / EN / english → "en". Any other SAFE language name (letters,
 * spaces, ()-. ; ≤ 40 chars) is accepted verbatim with original casing.
 * Throws on an empty / over-length / unsafe value (the safe-name whitelist is a
 * SECURITY boundary — the value is later injected into the system prompt).
 */
export function normalizeLanguage(input: string): ProjectLanguage {
  const r = resolveLanguage(input);
  if (r === null) {
    throw new Error(
      `Invalid language "${input}". Use ko/en or a plain language name (letters, spaces, ()-. ; max 40 chars).`
    );
  }
  return r;
}

/**
 * Write `{ language }` to `<cwd>/.pi-oven/config.json`.
 * Creates the directory if missing and read-merges to preserve other keys.
 */
export async function setProjectLanguage(
  lang: ProjectLanguage,
  opts?: { cwd?: string }
): Promise<void> {
  const cwd = opts?.cwd ?? process.cwd();
  const file = configPath(cwd);
  await fs.mkdir(path.dirname(file), { recursive: true });

  // Read-merge: preserve any other keys an earlier/other writer may have left.
  let existing: Record<string, unknown> = {};
  try {
    const raw = await fs.readFile(file, "utf-8");
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      existing = parsed as Record<string, unknown>;
    }
  } catch {
    // absent or unparsable — start from an empty object
  }

  const merged = { ...existing, language: lang };
  await fs.writeFile(file, JSON.stringify(merged, null, 2) + "\n", "utf-8");
}

/**
 * Read the project default language from `<cwd>/.pi-oven/config.json`.
 * Returns the canonical/free-form language, or `null` if the file is absent,
 * unparsable, or the stored language is missing/invalid. The persisted string
 * is RE-VALIDATED through `resolveLanguage` (defends a hand-edited config.json
 * — a poisoned value never reaches the prompt).
 */
export async function readProjectLanguage(
  opts?: { cwd?: string }
): Promise<ProjectLanguage | null> {
  const cwd = opts?.cwd ?? process.cwd();
  const file = configPath(cwd);
  try {
    const raw = await fs.readFile(file, "utf-8");
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    const lang = (parsed as Record<string, unknown>).language;
    if (typeof lang === "string") return resolveLanguage(lang);
    return null;
  } catch {
    return null;
  }
}

export async function readProjectNativeWorkerMax(opts?: { cwd?: string }): Promise<number | null> {
  const cwd = opts?.cwd ?? process.cwd();
  return readNativeWorkerMaxFromConfig(await readConfigObject(configPath(cwd)));
}

export async function seedProjectNativeWorkerMax(opts?: {
  cwd?: string;
  maxWorkers?: number;
}): Promise<number> {
  const cwd = opts?.cwd ?? process.cwd();
  const file = configPath(cwd);
  await fs.mkdir(path.dirname(file), { recursive: true });

  const existing = await readConfigObject(file);
  const current = readNativeWorkerMaxFromConfig(existing);
  if (current !== null) return current;

  const value = normalizeNativeWorkerMax(opts?.maxWorkers) ?? DEFAULT_NATIVE_WORKER_MAX;
  await fs.writeFile(file, JSON.stringify(withNativeWorkerMax(existing, value), null, 2) + "\n", "utf-8");
  return value;
}

/**
 * Key under which the setup-completion timestamp is stored. Its presence (as a
 * non-empty string) is the "this project has been set up" signal the runtime
 * extension reads to decide whether to show the once-per-session "not set up"
 * notice. Stored alongside `language` in the same machine-local config.json.
 */
const SETUP_COMPLETE_KEY = "setupCompletedAt";

/**
 * Read `<cwd>/.pi-oven/config.json` and return it as a plain object, or `{}`
 * when the file is absent or its contents are not a JSON object. Used by the
 * read-merge writers so any OTHER keys survive a write.
 */
async function readConfigObject(file: string): Promise<Record<string, unknown>> {
  try {
    const raw = await fs.readFile(file, "utf-8");
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // absent or unparsable — start from an empty object
  }
  return {};
}

/**
 * Mark this project as set up by writing `setupCompletedAt` (current ISO-8601
 * timestamp) into `<cwd>/.pi-oven/config.json`. Read-merges so `language` and
 * any other keys survive. Creates the directory if missing.
 */
export async function markSetupComplete(opts?: { cwd?: string }): Promise<void> {
  const cwd = opts?.cwd ?? process.cwd();
  const file = configPath(cwd);
  await fs.mkdir(path.dirname(file), { recursive: true });

  const existing = await readConfigObject(file);
  const merged = { ...existing, [SETUP_COMPLETE_KEY]: new Date().toISOString() };
  await fs.writeFile(file, JSON.stringify(merged, null, 2) + "\n", "utf-8");
}
/**
 * Synchronously report whether this project has been set up: `true` iff
 * `<cwd>/.pi-oven/config.json` parses and carries a non-empty string
 * `setupCompletedAt`. Fail-soft to `false` on any error (absent/unparsable/
 * wrong-shape). Sync (readFileSync) so it is safe to call at extension load.
 */
export function isSetupComplete(opts?: { cwd?: string }): boolean {
  const cwd = opts?.cwd ?? process.cwd();
  const file = configPath(cwd);
  try {
    const raw = readFileSync(file, "utf-8");
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return false;
    }
    const ts = (parsed as Record<string, unknown>)[SETUP_COMPLETE_KEY];
    return typeof ts === "string" && ts.length > 0;
  } catch {
    return false;
  }
}

/**
 * Clear the setup-completion marker: read-merge that DELETES `setupCompletedAt`
 * while preserving `language` and any other keys. No-op when the config file is
 * absent (does not create one).
 */
export async function clearSetupComplete(opts?: { cwd?: string }): Promise<void> {
  const cwd = opts?.cwd ?? process.cwd();
  const file = configPath(cwd);

  // No-op when absent — never create a config file just to clear a missing key.
  let raw: string;
  try {
    raw = await fs.readFile(file, "utf-8");
  } catch {
    return;
  }

  let existing: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      existing = parsed as Record<string, unknown>;
    }
  } catch {
    // unparsable — nothing to clear; leave the file untouched
    return;
  }

  if (!(SETUP_COMPLETE_KEY in existing)) return;

  const { [SETUP_COMPLETE_KEY]: _removed, ...rest } = existing;
  await fs.writeFile(file, JSON.stringify(rest, null, 2) + "\n", "utf-8");
}

// ---------------------------------------------------------------------------
// Global config helpers — ~/.pi-oven/config.json
// Same schema as the project-local config ({ language, nativeWorkers.maxWorkers,
// setupCompletedAt }). Writes to os.homedir()/.pi-oven/config.json (or homeDir
// override for tests).
// ---------------------------------------------------------------------------

function globalConfigPath(homeDir: string): string {
  return path.resolve(homeDir, CONFIG_DIR, CONFIG_FILE);
}

/**
 * Write `{ language }` to `~/.pi-oven/config.json` (or homeDir/.pi-oven/config.json).
 * Creates the directory if missing and read-merges to preserve other keys.
 * The `lang` value must already be validated (pass through resolveLanguage first).
 */
export async function setGlobalLanguage(
  lang: ProjectLanguage,
  opts?: { homeDir?: string }
): Promise<void> {
  const homeDir = opts?.homeDir ?? os.homedir();
  const file = globalConfigPath(homeDir);
  await fs.mkdir(path.dirname(file), { recursive: true });

  const existing = await readConfigObject(file);
  const merged = { ...existing, language: lang };
  await fs.writeFile(file, JSON.stringify(merged, null, 2) + "\n", "utf-8");
}

/**
 * Read the global default language from `~/.pi-oven/config.json`.
 * Returns the canonical/free-form language, or `null` if absent/unparsable/
 * missing/invalid. Re-validates through `resolveLanguage` (same defence as the
 * project-local reader).
 */
export async function readGlobalLanguage(
  opts?: { homeDir?: string }
): Promise<ProjectLanguage | null> {
  const homeDir = opts?.homeDir ?? os.homedir();
  const file = globalConfigPath(homeDir);
  try {
    const raw = await fs.readFile(file, "utf-8");
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    const lang = (parsed as Record<string, unknown>).language;
    if (typeof lang === "string") return resolveLanguage(lang);
    return null;
  } catch {
    return null;
  }
}

export async function readGlobalNativeWorkerMax(opts?: {
  homeDir?: string;
}): Promise<number | null> {
  const homeDir = opts?.homeDir ?? os.homedir();
  return readNativeWorkerMaxFromConfig(await readConfigObject(globalConfigPath(homeDir)));
}

export async function seedGlobalNativeWorkerMax(opts?: {
  homeDir?: string;
  maxWorkers?: number;
}): Promise<number> {
  const homeDir = opts?.homeDir ?? os.homedir();
  const file = globalConfigPath(homeDir);
  await fs.mkdir(path.dirname(file), { recursive: true });

  const existing = await readConfigObject(file);
  const current = readNativeWorkerMaxFromConfig(existing);
  if (current !== null) return current;

  const value = normalizeNativeWorkerMax(opts?.maxWorkers) ?? DEFAULT_NATIVE_WORKER_MAX;
  await fs.writeFile(file, JSON.stringify(withNativeWorkerMax(existing, value), null, 2) + "\n", "utf-8");
  return value;
}

/**
 * Mark setup complete globally by writing `setupCompletedAt` (current ISO-8601
 * timestamp) to `~/.pi-oven/config.json`. Read-merges so other keys survive.
 */
export async function markSetupCompleteGlobal(opts?: { homeDir?: string }): Promise<void> {
  const homeDir = opts?.homeDir ?? os.homedir();
  const file = globalConfigPath(homeDir);
  await fs.mkdir(path.dirname(file), { recursive: true });

  const existing = await readConfigObject(file);
  const merged = { ...existing, [SETUP_COMPLETE_KEY]: new Date().toISOString() };
  await fs.writeFile(file, JSON.stringify(merged, null, 2) + "\n", "utf-8");
}

/**
 * Clear the GLOBAL setup-completion marker: read-merge that DELETES
 * `setupCompletedAt` from `~/.pi-oven/config.json` while preserving `language`
 * and any other keys. No-op when the global config file is absent (does not
 * create one). Mirrors `clearSetupComplete` for the global path.
 */
export async function clearSetupCompleteGlobal(opts?: { homeDir?: string }): Promise<void> {
  const homeDir = opts?.homeDir ?? os.homedir();
  const file = globalConfigPath(homeDir);

  // No-op when absent — never create a config file just to clear a missing key.
  let raw: string;
  try {
    raw = await fs.readFile(file, "utf-8");
  } catch {
    return;
  }

  let existing: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      existing = parsed as Record<string, unknown>;
    }
  } catch {
    // unparsable — nothing to clear; leave the file untouched
    return;
  }

  if (!(SETUP_COMPLETE_KEY in existing)) return;

  const { [SETUP_COMPLETE_KEY]: _removed, ...rest } = existing;
  await fs.writeFile(file, JSON.stringify(rest, null, 2) + "\n", "utf-8");
}

/**
 * Synchronously report whether global setup has been completed: `true` iff
 * `~/.pi-oven/config.json` parses and carries a non-empty `setupCompletedAt`.
 * Fail-soft to `false` on any error. Sync so it is safe to call at extension load.
 */
export function isSetupCompleteGlobal(opts?: { homeDir?: string }): boolean {
  const homeDir = opts?.homeDir ?? os.homedir();
  const file = globalConfigPath(homeDir);
  try {
    const raw = readFileSync(file, "utf-8");
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return false;
    }
    const ts = (parsed as Record<string, unknown>)[SETUP_COMPLETE_KEY];
    return typeof ts === "string" && ts.length > 0;
  } catch {
    return false;
  }
}
