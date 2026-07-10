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
import {
  getManagedOverrideState,
  readAgentModelOverrides,
  readConfigValueDisplayState,
  SUBAGENT_RUNTIME_PREREQUISITES,
  type ConfigYmlOpts,
  type DisplayReadResult,
} from "./config-yml";
import { ROLES } from "./profiles";
import { readProjectAgentModelOverrides } from "./project-settings";

/**
 * Canonical project response language. `"ko"` / `"en"` are the canonical codes
 * (rich, hand-authored directives); any other value is a free-form language
 * NAME (e.g. "Español"). All values are validated through `resolveLanguage`.
 */
export type ProjectLanguage = string;

export const DEFAULT_NATIVE_WORKER_MAX = 100;

export type SetupPrerequisiteTruthState = "configured" | "not-configured" | "unknown";

export type SetupGlobalPrerequisiteExpectation = {
  key: string;
  expected: boolean | string;
};

export interface SetupReadiness {
  globalReady: boolean;
  projectReady: boolean;
  globalRoutingRoleCount: number;
  projectRoutingRoleCount: number;
  missingGlobalPrerequisites: string[];
  unknownGlobalPrerequisites: string[];
}

export const SETUP_GLOBAL_PREREQUISITES: SetupGlobalPrerequisiteExpectation[] = [
  { key: "memory.backend", expected: "mnemopi" },
  { key: "mnemopi.noEmbeddings", expected: true },
  { key: "mnemopi.llmMode", expected: "none" },
  { key: "async.enabled", expected: true },
  ...Object.keys(SUBAGENT_RUNTIME_PREREQUISITES).map((key) => ({
    key,
    expected: true,
  })),
];

export function countPiOvenRoutingEntries(
  record: Record<string, unknown> | null | undefined
): number {
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    return 0;
  }

  const stringEntries: Record<string, string> = {};
  for (const [key, value] of Object.entries(record)) {
    if (typeof value === "string") {
      stringEntries[key] = value;
    }
  }

  return ROLES.filter(
    (role) => getManagedOverrideState(stringEntries, role).effectiveValue !== undefined
  ).length;
}

export function classifySetupPrerequisiteState(
  value: DisplayReadResult<unknown>,
  expected: boolean | string
): SetupPrerequisiteTruthState {
  if (value.state === "unknown") return "unknown";
  if (value.state === "absent") return "not-configured";
  if (typeof expected === "boolean") {
    return value.value === expected || value.value === String(expected)
      ? "configured"
      : "not-configured";
  }
  return value.value === expected ? "configured" : "not-configured";
}

export function classifySetupReadiness(input: {
  globalRoutingRoleCount: number;
  projectRoutingRoleCount: number;
  globalPrerequisiteStates: Array<{ key: string; state: SetupPrerequisiteTruthState }>;
}): SetupReadiness {
  const missingGlobalPrerequisites = input.globalPrerequisiteStates
    .filter(({ state }) => state === "not-configured")
    .map(({ key }) => key);
  const unknownGlobalPrerequisites = input.globalPrerequisiteStates
    .filter(({ state }) => state === "unknown")
    .map(({ key }) => key);

  return {
    globalReady:
      input.globalRoutingRoleCount > 0 &&
      missingGlobalPrerequisites.length === 0 &&
      unknownGlobalPrerequisites.length === 0,
    projectReady: input.projectRoutingRoleCount > 0,
    globalRoutingRoleCount: input.globalRoutingRoleCount,
    projectRoutingRoleCount: input.projectRoutingRoleCount,
    missingGlobalPrerequisites,
    unknownGlobalPrerequisites,
  };
}

export async function collectSetupReadiness(
  opts?: { cwd?: string } & ConfigYmlOpts
): Promise<SetupReadiness> {
  const cwd = opts?.cwd ?? process.cwd();
  const globalOverrides = await readAgentModelOverrides(opts);
  const projectOverrides = await readProjectAgentModelOverrides({ cwd });
  const globalPrerequisiteStates = await Promise.all(
    SETUP_GLOBAL_PREREQUISITES.map(async ({ key, expected }) => {
      const value = await readConfigValueDisplayState(key, opts);
      return {
        key,
        state: classifySetupPrerequisiteState(value, expected),
      };
    })
  );

  return classifySetupReadiness({
    globalRoutingRoleCount: countPiOvenRoutingEntries(globalOverrides),
    projectRoutingRoleCount: countPiOvenRoutingEntries(projectOverrides),
    globalPrerequisiteStates,
  });
}

export function buildSetupReadinessNotice(readiness: SetupReadiness): {
  message: string;
  level: "info" | "warning";
} {
  const mark = (ready: boolean) => (ready ? "✓" : "✗");
  const lines = [
    "pi-oven setup",
    `  [${mark(readiness.globalReady)}] Global   (~/.omp/agent/config.yml routing + machine-global prerequisites)`,
    `  [${mark(readiness.projectReady)}] Project  (.omp/settings.json routing)${
      readiness.projectReady ? "" : " — run /pi-oven:setup --scope project"
    }`,
  ];

  if (readiness.projectRoutingRoleCount > 0) {
    lines.push(`  ↳ project model routing active (${readiness.projectRoutingRoleCount} roles)`);
  }
  if (!readiness.globalReady && readiness.globalRoutingRoleCount > 0) {
    if (readiness.unknownGlobalPrerequisites.length > 0) {
      lines.push(
        "  ↳ machine-global routing is present, but some prerequisites could not be fully verified"
      );
    } else if (readiness.missingGlobalPrerequisites.length > 0) {
      lines.push(
        "  ↳ machine-global routing is present, but required prerequisites are missing or mismatched"
      );
    }
  }
  if (!readiness.globalReady && !readiness.projectReady) {
    lines.push(
      "  To stop seeing this, uninstall the plugin: omp plugin uninstall pi-oven@kzk"
    );
  }

  return {
    message: lines.join("\n"),
    level: readiness.projectReady ? "info" : "warning",
  };
}

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

type ConfigObjectReadResult =
  | { ok: true; data: Record<string, unknown> }
  | { ok: false; error: string };

async function atomicWriteConfig(
  file: string,
  data: Record<string, unknown>
): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(data, null, 2) + "\n", "utf-8");
  await fs.rename(tmp, file);
}

async function readConfigObjectStrict(file: string): Promise<ConfigObjectReadResult> {
  let raw: string;
  try {
    raw = await fs.readFile(file, "utf-8");
  } catch (error) {
    const code = (error as NodeJS.ErrnoException | undefined)?.code;
    if (code === "ENOENT") {
      return { ok: true, data: {} };
    }
    return { ok: false, error: `unreadable file: ${file}` };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, error: `present but unparsable JSON: ${file}` };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ok: false, error: `present but not a plain object: ${file}` };
  }
  return { ok: true, data: parsed as Record<string, unknown> };
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
 * Creates the directory if missing, fails closed on a present-but-malformed
 * file, and read-merges to preserve other keys atomically.
 */
export async function setProjectLanguage(
  lang: ProjectLanguage,
  opts?: { cwd?: string }
): Promise<void> {
  const cwd = opts?.cwd ?? process.cwd();
  const file = configPath(cwd);
  const read = await readConfigObjectStrict(file);
  if (!read.ok) {
    throw new Error(`setProjectLanguage: ${read.error}`);
  }

  const merged = { ...read.data, language: lang };
  await atomicWriteConfig(file, merged);
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
  const read = await readConfigObjectStrict(file);
  if (!read.ok) {
    throw new Error(`seedProjectNativeWorkerMax: ${read.error}`);
  }

  const current = readNativeWorkerMaxFromConfig(read.data);
  if (current !== null) return current;

  const value = normalizeNativeWorkerMax(opts?.maxWorkers) ?? DEFAULT_NATIVE_WORKER_MAX;
  await atomicWriteConfig(file, withNativeWorkerMax(read.data, value));
  return value;
}

/**
 * Key under which the setup receipt timestamp is stored. The receipt survives as
 * metadata for successful routing writes, but runtime/CLI readiness now derives
 * from routing + prerequisite facts instead of trusting this field alone.
 */
const SETUP_COMPLETE_KEY = "setupCompletedAt";

/**
 * Read `<cwd>/.pi-oven/config.json` and return it as a plain object, or `{}`
 * when the file is absent or its contents are not a JSON object. Used by
 * fail-soft readers; write paths MUST use `readConfigObjectStrict`.
 */
async function readConfigObject(file: string): Promise<Record<string, unknown>> {
  const read = await readConfigObjectStrict(file);
  return read.ok ? read.data : {};
}

/**
 * Mark this project as set up by writing `setupCompletedAt` (current ISO-8601
 * timestamp) into `<cwd>/.pi-oven/config.json`. This accompanies successful
 * routing / workflow-skill-ownership writes; read-merges so `language` and any
 * other keys survive. Creates the directory if missing.
 */
export async function markSetupComplete(opts?: { cwd?: string }): Promise<void> {
  const cwd = opts?.cwd ?? process.cwd();
  const file = configPath(cwd);
  const read = await readConfigObjectStrict(file);
  if (!read.ok) {
    throw new Error(`markSetupComplete: ${read.error}`);
  }

  const merged = { ...read.data, [SETUP_COMPLETE_KEY]: new Date().toISOString() };
  await atomicWriteConfig(file, merged);
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
 * Clear the setup-completion marker: strict-read the existing project
 * `.pi-oven/config.json`, fail closed on a present-but-malformed file, then
 * delete `setupCompletedAt` via atomic read-merge-write while preserving
 * `language` and any other keys. No-op when the config file is absent (does not
 * create one).
 */
export async function clearSetupComplete(opts?: { cwd?: string }): Promise<void> {
  const cwd = opts?.cwd ?? process.cwd();
  const file = configPath(cwd);

  try {
    await fs.access(file);
  } catch {
    return;
  }

  const read = await readConfigObjectStrict(file);
  if (!read.ok) {
    throw new Error(`clearSetupComplete: ${read.error}`);
  }
  if (!(SETUP_COMPLETE_KEY in read.data)) return;

  const { [SETUP_COMPLETE_KEY]: _removed, ...rest } = read.data;
  await atomicWriteConfig(file, rest);
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
 * Creates the directory if missing, fails closed on a present-but-malformed
 * file, and read-merges to preserve other keys atomically.
 * The `lang` value must already be validated (pass through resolveLanguage first).
 */
export async function setGlobalLanguage(
  lang: ProjectLanguage,
  opts?: { homeDir?: string }
): Promise<void> {
  const homeDir = opts?.homeDir ?? os.homedir();
  const file = globalConfigPath(homeDir);
  const read = await readConfigObjectStrict(file);
  if (!read.ok) {
    throw new Error(`setGlobalLanguage: ${read.error}`);
  }

  const merged = { ...read.data, language: lang };
  await atomicWriteConfig(file, merged);
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
  const read = await readConfigObjectStrict(file);
  if (!read.ok) {
    throw new Error(`seedGlobalNativeWorkerMax: ${read.error}`);
  }

  const current = readNativeWorkerMaxFromConfig(read.data);
  if (current !== null) return current;

  const value = normalizeNativeWorkerMax(opts?.maxWorkers) ?? DEFAULT_NATIVE_WORKER_MAX;
  await atomicWriteConfig(file, withNativeWorkerMax(read.data, value));
  return value;
}

/**
 * Mark setup complete globally by writing `setupCompletedAt` (current ISO-8601
 * timestamp) to `~/.pi-oven/config.json`. Read-merges so other keys survive.
 */
export async function markSetupCompleteGlobal(opts?: { homeDir?: string }): Promise<void> {
  const homeDir = opts?.homeDir ?? os.homedir();
  const file = globalConfigPath(homeDir);
  const read = await readConfigObjectStrict(file);
  if (!read.ok) {
    throw new Error(`markSetupCompleteGlobal: ${read.error}`);
  }

  const merged = { ...read.data, [SETUP_COMPLETE_KEY]: new Date().toISOString() };
  await atomicWriteConfig(file, merged);
}

/**
 * Clear the GLOBAL setup-completion marker: strict-read the existing global
 * `.pi-oven/config.json`, fail closed on a present-but-malformed file, then
 * delete `setupCompletedAt` via atomic read-merge-write while preserving
 * `language` and any other keys. No-op when the global config file is absent
 * (does not create one). Mirrors `clearSetupComplete` for the global path.
 */
export async function clearSetupCompleteGlobal(opts?: { homeDir?: string }): Promise<void> {
  const homeDir = opts?.homeDir ?? os.homedir();
  const file = globalConfigPath(homeDir);

  try {
    await fs.access(file);
  } catch {
    return;
  }

  const read = await readConfigObjectStrict(file);
  if (!read.ok) {
    throw new Error(`clearSetupCompleteGlobal: ${read.error}`);
  }
  if (!(SETUP_COMPLETE_KEY in read.data)) return;

  const { [SETUP_COMPLETE_KEY]: _removed, ...rest } = read.data;
  await atomicWriteConfig(file, rest);
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
