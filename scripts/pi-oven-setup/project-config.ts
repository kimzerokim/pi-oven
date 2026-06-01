/**
 * project-config.ts — per-project, machine-local pi-oven config.
 * Plan: docs/plans/2026-06-02-setup-language-selection.md §1.
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

import { promises as fs } from "fs";
import * as path from "path";

export type ProjectLanguage = "ko" | "en";

/** Directory + file the per-project config lives in (relative to a cwd). */
const CONFIG_DIR = ".pi-oven";
const CONFIG_FILE = "config.json";

function configPath(cwd: string): string {
  return path.resolve(cwd, CONFIG_DIR, CONFIG_FILE);
}

/**
 * Normalize a human-supplied language token to the canonical `"ko"` / `"en"`.
 * Accepts: ko / KO / korean / 한국어 → "ko"; en / EN / english → "en".
 * Throws on anything else.
 */
export function normalizeLanguage(input: string): ProjectLanguage {
  const v = input.trim().toLowerCase();
  if (v === "ko" || v === "korean" || v === "한국어") return "ko";
  if (v === "en" || v === "english") return "en";
  throw new Error(
    `Invalid language "${input}". Allowed: ko, en (also korean/한국어, english).`
  );
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
 * Returns `"ko"` / `"en"`, or `null` if the file is absent, unparsable, or the
 * stored language is missing/invalid.
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
    if (lang === "ko" || lang === "en") return lang;
    return null;
  } catch {
    return null;
  }
}
