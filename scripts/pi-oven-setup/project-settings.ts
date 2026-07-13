/**
 * project-settings.ts — owns `<cwd>/.omp/settings.json`, the PROJECT layer of
 * omp's subagent model routing (Spec "project-scoped-model-routing" §2/§5.1).
 *
 * omp loads this file at `level:"project"` and deep-merges it OVER the homedir-
 * global `~/.omp/agent/config.yml` (record-typed settings merge key-by-key), so a
 * project file overriding individual `pi-oven:<role>` keys leaves every unlisted
 * role inheriting from global. This module is the ONLY writer pi-oven points at
 * that file, and it manages exactly three key paths inside it:
 *   - `task.agentModelOverrides` (the `pi-oven:*` keys)
 *   - `modelRoles` (`default` / `title`)
 *   - `retry.fallbackChains`
 * Every OTHER key (`extensions`, user-added override keys, sibling `task.*`) is
 * PRESERVED by read-merge.
 *
 * Design notes:
 *   - WRITE paths read STRICT (fail-CLOSED): a PRESENT-but-malformed file makes the
 *     write throw rather than clobber a hand-authored settings.json. An ABSENT file
 *     reads as `{}` (the legitimate first-write case).
 *   - DISPLAY/extension paths read SOFT: any fault yields `{}` so status/extension
 *     never crash on a broken file.
 *   - Writes are ATOMIC: serialize to `<file>.tmp` then `fs.rename` over the target
 *     (rename is atomic on the same filesystem), so a crash mid-write never leaves a
 *     half-written settings.json.
 *   - `deepMerge` mirrors omp's own merge (recurse plain objects; arrays + scalars
 *     replace), so the in-memory merge matches what omp will compute at load time.
 */

import { promises as fs } from "fs";
import * as path from "path";
import { atomicReplaceFile } from "../lib/atomic-file";
import {
  GLOBAL_OVERRIDE_PREFIX,
  LEGACY_GLOBAL_OVERRIDE_PREFIX,
  PI_OVEN_WORKFLOW_SKILL_INCLUDE,
  getManagedOverrideState,
} from "./config-yml";
import { ROLES } from "./profiles";

/** Directory + file the per-project omp settings live in (relative to a cwd). */
const SETTINGS_DIR = ".omp";
const SETTINGS_FILE = "settings.json";

const PROJECT_OVERRIDE_PREFIX = GLOBAL_OVERRIDE_PREFIX;
const LEGACY_PROJECT_OVERRIDE_PREFIX = LEGACY_GLOBAL_OVERRIDE_PREFIX;

const MANAGED_ROLE_MAP: Record<string, true> = Object.fromEntries(
  ROLES.map((role) => [role, true] as const)
);

function managedProjectRoleFromKey(key: string): string | null {
  const role = key.startsWith(PROJECT_OVERRIDE_PREFIX)
    ? key.slice(PROJECT_OVERRIDE_PREFIX.length)
    : key.startsWith(LEGACY_PROJECT_OVERRIDE_PREFIX)
      ? key.slice(LEGACY_PROJECT_OVERRIDE_PREFIX.length)
      : null;
  if (role === null || !MANAGED_ROLE_MAP[role]) {
    return null;
  }
  return role;
}

function readRawProjectOverrideRecord(
  data: Record<string, unknown>
): Record<string, unknown> {
  const task = data["task"];
  if (!isPlainObject(task)) return {};
  const overrides = task["agentModelOverrides"];
  if (!isPlainObject(overrides)) return {};
  return overrides;
}

function buildNormalizedProjectOverrideRecord(
  current: Record<string, unknown>,
  desired: Record<string, string>
): Record<string, unknown> {
  const normalized: Record<string, unknown> = {};
  const currentStringEntries: Record<string, string> = {};

  for (const [key, value] of Object.entries(current)) {
    if (typeof value === "string") {
      currentStringEntries[key] = value;
    }
    if (managedProjectRoleFromKey(key) === null) {
      normalized[key] = value;
    }
  }

  for (const role of ROLES) {
    const desiredState = getManagedOverrideState(desired, role);
    if (desiredState.canonicalValue !== undefined) {
      normalized[desiredState.canonicalKey] = desiredState.canonicalValue;
      continue;
    }
    if (desiredState.legacyValue !== undefined) {
      normalized[desiredState.canonicalKey] = desiredState.legacyValue;
      continue;
    }

    const currentState = getManagedOverrideState(currentStringEntries, role);
    if (currentState.canonicalValue !== undefined) {
      normalized[currentState.canonicalKey] = currentState.canonicalValue;
      continue;
    }
    if (currentState.legacyValue !== undefined) {
      normalized[currentState.canonicalKey] = currentState.legacyValue;
    }
  }

  return normalized;
}

/**
 * Resolve the absolute path of the project omp settings file for a given cwd:
 * `<cwd>/.omp/settings.json`. omp discovers the project config dir from
 * `ctx.cwd` (the launch directory — no git-root ancestor walk), so this MUST be
 * resolved against the same cwd setup runs in.
 */
export function projectSettingsPath(cwd: string): string {
  return path.resolve(cwd, SETTINGS_DIR, SETTINGS_FILE);
}

// ---------------------------------------------------------------------------
// deepMerge — pure, no IO. Mirrors omp's #deepMerge.
// ---------------------------------------------------------------------------

/** True for a plain (non-null, non-array) object — the only thing deepMerge recurses into. */
function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Deep-merge `override` onto `base`, mirroring omp's settings `#deepMerge`:
 *   - when BOTH sides at a key are plain objects → recurse (key-by-key merge);
 *   - otherwise (scalar, array, or type mismatch) → `override` REPLACES `base`
 *     (arrays are replaced wholesale, never concatenated).
 * Returns a fresh object; neither input is mutated.
 */
export function deepMerge(
  base: Record<string, unknown>,
  override: Record<string, unknown>
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base };
  for (const [key, overrideVal] of Object.entries(override)) {
    const baseVal = out[key];
    if (isPlainObject(baseVal) && isPlainObject(overrideVal)) {
      out[key] = deepMerge(baseVal, overrideVal);
    } else {
      out[key] = overrideVal;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Read helpers
// ---------------------------------------------------------------------------

/**
 * STRICT read for the WRITE path (fail-CLOSED). Returns:
 *   - `{ ok:true, data:{} }`        when the file is ABSENT (legitimate first write);
 *   - `{ ok:true, data:<parsed> }`  when the file parses to a plain object;
 *   - `{ ok:false, error }`         when the file is PRESENT but unparsable or not a
 *     plain object (an array / scalar top-level).
 * Callers MUST abort on `ok:false` — never merge-into-{} then write (that would
 * clobber a hand-authored settings.json).
 */
export async function readProjectSettingsStrict(opts?: {
  cwd?: string;
}): Promise<
  | { ok: true; data: Record<string, unknown> }
  | { ok: false; error: string }
> {
  const cwd = opts?.cwd ?? process.cwd();
  const file = projectSettingsPath(cwd);

  let raw: string;
  try {
    raw = await fs.readFile(file, "utf-8");
  } catch {
    // Absent — the legitimate first-write case. Start from an empty object.
    return { ok: true, data: {} };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, error: `present but unparsable JSON: ${file}` };
  }
  if (!isPlainObject(parsed)) {
    return { ok: false, error: `present but not a plain object: ${file}` };
  }
  return { ok: true, data: parsed };
}

/**
 * SOFT read for DISPLAY / extension paths. Returns the parsed plain object, or
 * `{}` on ANY fault (absent / unparsable / wrong-shape). MUST NOT be used by
 * write paths (which need the fail-closed strict read).
 */
export async function readProjectSettingsSoft(opts?: {
  cwd?: string;
}): Promise<Record<string, unknown>> {
  const result = await readProjectSettingsStrict(opts);
  return result.ok ? result.data : {};
}
export type ProjectSettingsDisplayState =
  | { state: "absent"; file: string }
  | { state: "present"; file: string; data: Record<string, unknown> }
  | { state: "unknown"; file: string; error: string };

/**
 * DISPLAY-oriented read of `<cwd>/.omp/settings.json` that preserves the
 * distinction between an ABSENT file and a PRESENT-but-unreadable/corrupt one.
 * Status / truth-surface paths use this to avoid calling a broken file
 * "missing".
 */
export async function readProjectSettingsDisplayState(opts?: {
  cwd?: string;
}): Promise<ProjectSettingsDisplayState> {
  const cwd = opts?.cwd ?? process.cwd();
  const file = projectSettingsPath(cwd);

  let raw: string;
  try {
    raw = await fs.readFile(file, "utf-8");
  } catch (error) {
    const code = (error as NodeJS.ErrnoException | undefined)?.code;
    if (code === "ENOENT") {
      return { state: "absent", file };
    }
    return { state: "unknown", file, error: `unreadable file: ${file}` };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { state: "unknown", file, error: `present but unparsable JSON: ${file}` };
  }
  if (!isPlainObject(parsed)) {
    return { state: "unknown", file, error: `present but not a plain object: ${file}` };
  }
  return { state: "present", file, data: parsed };
}

// ---------------------------------------------------------------------------
// Atomic write
// ---------------------------------------------------------------------------

/**
 * Serialize `data` to `<file>.tmp` then `fs.rename` it over `file` (atomic on the
 * same filesystem). Creates the parent directory if missing. Trailing newline to
 * match the repo's JSON-file convention.
 */
async function atomicWrite(file: string, data: Record<string, unknown>): Promise<void> {
  await atomicReplaceFile(file, JSON.stringify(data, null, 2) + "\n");
}

export function serializeProjectSettings(data: Record<string, unknown>): string {
  return `${JSON.stringify(data, null, 2)}\n`;
}

/** Pure whole-file setup transform used by the project transaction. */
export function buildProjectSetupSettings(
  current: Record<string, unknown>,
  input: {
    overrides: Record<string, string>;
    modelRoles: Record<string, string>;
    fallbackChains: Record<string, string[]>;
  }
): Record<string, unknown> {
  for (const key of Object.keys(input.overrides)) {
    if (managedProjectRoleFromKey(key) === null) {
      throw new Error(`buildProjectSetupSettings: invalid managed role key: ${key}`);
    }
  }
  const existingTask = isPlainObject(current.task) ? current.task : {};
  const withRouting: Record<string, unknown> = {
    ...current,
    task: {
      ...existingTask,
      agentModelOverrides: buildNormalizedProjectOverrideRecord(
        readRawProjectOverrideRecord(current),
        input.overrides
      ),
    },
  };
  const existingSkills = isPlainObject(withRouting.skills) ? withRouting.skills : {};
  const existingModelRoles = isPlainObject(withRouting.modelRoles) ? withRouting.modelRoles : {};
  const existingRetry = isPlainObject(withRouting.retry) ? withRouting.retry : {};
  return {
    ...withRouting,
    skills: { ...existingSkills, includeSkills: [...PI_OVEN_WORKFLOW_SKILL_INCLUDE] },
    modelRoles: { ...existingModelRoles, ...input.modelRoles },
    retry: { ...existingRetry, fallbackChains: input.fallbackChains },
  };
}

export interface ProjectResetTransform {
  data: Record<string, unknown> | null;
  removedKeys: string[];
  removedIncludedSkills: boolean;
}

/** Pure whole-file reset transform; unrelated keys and siblings survive. */
export function buildProjectResetSettings(
  current: Record<string, unknown>,
  full: boolean
): ProjectResetTransform {
  const data = structuredClone(current);
  const task = isPlainObject(data.task) ? data.task : undefined;
  const overrides = task && isPlainObject(task.agentModelOverrides)
    ? task.agentModelOverrides
    : undefined;
  const removedKeys = overrides
    ? Object.keys(overrides).filter((key) => managedProjectRoleFromKey(key) !== null).sort()
    : [];
  for (const key of removedKeys) delete overrides![key];
  if (overrides && Object.keys(overrides).length === 0) delete task!.agentModelOverrides;
  if (task && Object.keys(task).length === 0) delete data.task;

  const skills = isPlainObject(data.skills) ? data.skills : undefined;
  const removedIncludedSkills = Boolean(skills && "includeSkills" in skills);
  if (skills) {
    delete skills.includeSkills;
    if (Object.keys(skills).length === 0) delete data.skills;
  }

  if (full) {
    delete data.modelRoles;
    const retry = isPlainObject(data.retry) ? data.retry : undefined;
    if (retry) {
      delete retry.fallbackChains;
      if (Object.keys(retry).length === 0) delete data.retry;
    }
  }
  return {
    data: Object.keys(data).length === 0 ? null : data,
    removedKeys,
    removedIncludedSkills,
  };
}

// ---------------------------------------------------------------------------
// Write helpers — task.agentModelOverrides (the pi-oven:* keys)
// ---------------------------------------------------------------------------

/**
 * SET project subagent overrides: accepts canonical `pov:<role>` keys plus
 * legacy `pi-oven:<role>` migration input → strict-read (abort on
 * present-but-malformed) → canonicalize the WHOLE managed project override
 * surface to `pov:*` → replace `data.task.agentModelOverrides` atomically.
 * Preserves non-managed override keys, sibling `task.*`, and every unrelated
 * top-level key. Throws on an unknown/non-managed key or a present-but-malformed
 * file.
 */
export async function setProjectAgentModelOverrides(
  record: Record<string, string>,
  opts?: { cwd?: string }
): Promise<void> {
  for (const key of Object.keys(record)) {
    if (managedProjectRoleFromKey(key) === null) {
      throw new Error(
        `setProjectAgentModelOverrides: every key must be a managed pov:/pi-oven: role key, got: ${key}`
      );
    }
  }

  const read = await readProjectSettingsStrict(opts);
  if (!read.ok) {
    throw new Error(`setProjectAgentModelOverrides: ${read.error}`);
  }

  const existingTask = isPlainObject(read.data["task"]) ? read.data["task"] : {};
  const normalizedOverrides = buildNormalizedProjectOverrideRecord(
    readRawProjectOverrideRecord(read.data),
    record
  );
  const merged = {
    ...read.data,
    task: {
      ...existingTask,
      agentModelOverrides: normalizedOverrides,
    },
  };

  await atomicWrite(projectSettingsPath(opts?.cwd ?? process.cwd()), merged);
}

/**
 * SET the canonical workflow-skill include filter in the project layer:
 * strict-read → deep-merge `skills.includeSkills = ["pov:*"]` → atomic write.
 * This owns ONLY workflow-skill visibility. Commands / agents / hooks / MCP stay
 * out of scope, and populated `~/.claude/skills` remains explicitly non-owning.
 */
export async function setProjectIncludedSkills(opts?: { cwd?: string }): Promise<void> {
  const read = await readProjectSettingsStrict(opts);
  if (!read.ok) {
    throw new Error(`setProjectIncludedSkills: ${read.error}`);
  }

  const merged = deepMerge(read.data, {
    skills: { includeSkills: [...PI_OVEN_WORKFLOW_SKILL_INCLUDE] },
  });
  await atomicWrite(projectSettingsPath(opts?.cwd ?? process.cwd()), merged);
}

/**
 * SET the MAIN orchestrator model roles (`default` / `title`) in the project
 * layer: strict-read → deep-merge `roles` into `data.modelRoles` (preserving
 * sibling roles) → atomic write. Throws on a present-but-malformed file.
 */
export async function setProjectModelRoles(
  roles: Record<string, string>,
  opts?: { cwd?: string }
): Promise<void> {
  const read = await readProjectSettingsStrict(opts);
  if (!read.ok) {
    throw new Error(`setProjectModelRoles: ${read.error}`);
  }

  const merged = deepMerge(read.data, { modelRoles: roles });
  await atomicWrite(projectSettingsPath(opts?.cwd ?? process.cwd()), merged);
}

/**
 * SET the retry fallback chains in the project layer: strict-read → deep-merge
 * `chains` into `data.retry.fallbackChains` (whole record; arrays REPLACE per
 * role, never concatenate) → atomic write. Throws on a present-but-malformed file.
 */
export async function setProjectRetryFallbackChains(
  chains: Record<string, string[]>,
  opts?: { cwd?: string }
): Promise<void> {
  const read = await readProjectSettingsStrict(opts);
  if (!read.ok) {
    throw new Error(`setProjectRetryFallbackChains: ${read.error}`);
  }

  const merged = deepMerge(read.data, {
    retry: { fallbackChains: chains },
  });
  await atomicWrite(projectSettingsPath(opts?.cwd ?? process.cwd()), merged);
}

// ---------------------------------------------------------------------------
// Read helper — project task.agentModelOverrides (display/extension)
// ---------------------------------------------------------------------------

/**
 * SOFT read of the project layer's `task.agentModelOverrides`, returning the raw
 * string-valued entries as `Record<string,string>`. Legacy `pi-oven:*` entries
 * are preserved here so status/readiness paths can diagnose migration input.
 * `{}` on any fault or when the path is absent. For status/extension display —
 * NOT a write path.
 */
export async function readProjectAgentModelOverrides(opts?: {
  cwd?: string;
}): Promise<Record<string, string>> {
  const data = await readProjectSettingsSoft(opts);
  const overrides = readRawProjectOverrideRecord(data);

  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(overrides)) {
    if (typeof v === "string") out[k] = v;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Clear helpers
// ---------------------------------------------------------------------------

/**
 * Prune empties left behind by a clear and persist (or remove) the file:
 *   - drop an empty `task.agentModelOverrides`, then an empty `task`;
 *   - drop an empty `skills.includeSkills`, then an empty `skills`;
 *   - if `data` is left `{}` → REMOVE the file (don't leave an empty shell);
 *   - otherwise atomic-write the pruned object.
 */
async function pruneAndPersist(
  file: string,
  data: Record<string, unknown>
): Promise<void> {
  const task = data["task"];
  if (isPlainObject(task)) {
    const overrides = task["agentModelOverrides"];
    if (isPlainObject(overrides) && Object.keys(overrides).length === 0) {
      delete task["agentModelOverrides"];
    }
    if (Object.keys(task).length === 0) {
      delete data["task"];
    }
  }
  const skills = data["skills"];
  if (isPlainObject(skills)) {
    const includeSkills = skills["includeSkills"];
    if (Array.isArray(includeSkills) && includeSkills.length === 0) {
      delete skills["includeSkills"];
    }
    if (Object.keys(skills).length === 0) {
      delete data["skills"];
    }
  }

  if (Object.keys(data).length === 0) {
    // Nothing left — remove the file rather than leave an empty `{}` shell.
    await fs.rm(file, { force: true });
    return;
  }
  await atomicWrite(file, data);
}

/**
 * CLEAR the project subagent overrides: SOFT-read → delete every managed
 * `pov:*`/`pi-oven:*` role key from `data.task.agentModelOverrides` → prune the
 * now-empty `task.agentModelOverrides`/`task` → if `data` becomes `{}` REMOVE the
 * file, else atomic-write. Returns the SORTED list of removed keys. No-op
 * (returns `[]`, never creates a file) when the file is absent or carries no
 * managed project override keys.
 */
export async function clearProjectAgentModelOverrides(opts?: {
  cwd?: string;
}): Promise<string[]> {
  const file = projectSettingsPath(opts?.cwd ?? process.cwd());
  const data = await readProjectSettingsSoft(opts);

  const task = data["task"];
  if (!isPlainObject(task)) return [];
  const overrides = task["agentModelOverrides"];
  if (!isPlainObject(overrides)) return [];

  const removed = Object.keys(overrides)
    .filter((k) => managedProjectRoleFromKey(k) !== null)
    .sort();
  if (removed.length === 0) return [];

  for (const k of removed) {
    delete overrides[k];
  }

  await pruneAndPersist(file, data);
  return removed;
}

/**
 * CLEAR the project workflow-skill include filter: SOFT-read → delete
 * `data.skills.includeSkills` → prune an empty `skills` shell → if `data`
 * becomes `{}` REMOVE the file, else atomic-write. Returns true when the filter
 * existed and was removed. No-op (returns false, never creates a file) when the
 * file is absent or when `skills.includeSkills` is already absent.
 */
export async function clearProjectIncludedSkills(opts?: {
  cwd?: string;
}): Promise<boolean> {
  const file = projectSettingsPath(opts?.cwd ?? process.cwd());
  const data = await readProjectSettingsSoft(opts);

  const skills = data["skills"];
  if (!isPlainObject(skills) || !("includeSkills" in skills)) {
    return false;
  }

  delete skills["includeSkills"];
  await pruneAndPersist(file, data);
  return true;
}

/**
 * CLEAR the project orchestrator routing written by project-scope `--reset --full`:
 * SOFT-read → delete `data.modelRoles` + `data.retry.fallbackChains` → prune
 * empties (including a now-empty `task`) → if `data` becomes `{}` REMOVE the file,
 * else atomic-write. No-op (never creates a file) when the file is absent.
 */
export async function clearProjectOrchestrator(opts?: {
  cwd?: string;
}): Promise<void> {
  const file = projectSettingsPath(opts?.cwd ?? process.cwd());
  const data = await readProjectSettingsSoft(opts);

  // Nothing on disk → nothing to clear (don't create a file).
  if (Object.keys(data).length === 0) return;

  delete data["modelRoles"];
  const retry = data["retry"];
  if (isPlainObject(retry)) {
    delete retry["fallbackChains"];
    if (Object.keys(retry).length === 0) delete data["retry"];
  }

  await pruneAndPersist(file, data);
}
