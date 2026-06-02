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
import { resolveLanguage } from "../../.omp/extensions/pi-oven-runtime/language";

/**
 * Canonical project response language. `"ko"` / `"en"` are the canonical codes
 * (rich, hand-authored directives); any other value is a free-form language
 * NAME (e.g. "Español"). All values are validated through `resolveLanguage`.
 */
export type ProjectLanguage = string;

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
