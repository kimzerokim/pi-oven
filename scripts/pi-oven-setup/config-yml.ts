/**
 * OMP-delegated task.agentModelOverrides read/merge-write/delete helper.
 * Transport: omp config get → in-memory merge → omp config set (whole-record replace).
 */

import { ROLES, type Role } from "./profiles";
import type { SetupTransactionSnapshot } from "./setup-transaction";

export interface ConfigYmlOpts {
  /** Injectable spawn for omp config get/set (tests). Default: Bun.spawnSync wrapper. */
  spawnFn?: (cmd: string, args: string[]) => { exitCode: number | null; stdout?: Buffer; stderr?: Buffer };
}

export const GLOBAL_OVERRIDE_PREFIX = "pov:";
export const LEGACY_GLOBAL_OVERRIDE_PREFIX = "pi-oven:";

const MANAGED_ROLE_MAP: Record<string, true> = Object.fromEntries(
  ROLES.map((role) => [role, true] as const)
);

export interface ManagedOverrideConflict {
  role: Role;
  canonicalKey: string;
  canonicalValue: string;
  legacyKey: string;
  legacyValue: string;
}

export interface ManagedOverrideState {
  role: Role;
  canonicalKey: string;
  canonicalValue?: string;
  legacyKey: string;
  legacyValue?: string;
  effectiveValue?: string;
  kind: "absent" | "canonical" | "legacy-only" | "conflict";
}

function canonicalOverrideKey(role: Role): string {
  return `${GLOBAL_OVERRIDE_PREFIX}${role}`;
}

function legacyOverrideKey(role: Role): string {
  return `${LEGACY_GLOBAL_OVERRIDE_PREFIX}${role}`;
}

function managedRoleFromKey(key: string): Role | null {
  const role = key.startsWith(GLOBAL_OVERRIDE_PREFIX)
    ? key.slice(GLOBAL_OVERRIDE_PREFIX.length)
    : key.startsWith(LEGACY_GLOBAL_OVERRIDE_PREFIX)
      ? key.slice(LEGACY_GLOBAL_OVERRIDE_PREFIX.length)
      : null;
  if (role === null || !MANAGED_ROLE_MAP[role]) {
    return null;
  }
  return role as Role;
}

export function getManagedOverrideState(
  current: Record<string, string>,
  role: Role
): ManagedOverrideState {
  const canonicalKey = canonicalOverrideKey(role);
  const legacyKey = legacyOverrideKey(role);
  const canonicalValue = current[canonicalKey];
  const legacyValue = current[legacyKey];

  if (canonicalValue !== undefined && legacyValue !== undefined) {
    return {
      role,
      canonicalKey,
      canonicalValue,
      legacyKey,
      legacyValue,
      effectiveValue: canonicalValue,
      kind: "conflict",
    };
  }

  if (canonicalValue !== undefined) {
    return {
      role,
      canonicalKey,
      canonicalValue,
      legacyKey,
      effectiveValue: canonicalValue,
      kind: "canonical",
    };
  }

  if (legacyValue !== undefined) {
    return {
      role,
      canonicalKey,
      legacyKey,
      legacyValue,
      effectiveValue: legacyValue,
      kind: "legacy-only",
    };
  }

  return {
    role,
    canonicalKey,
    legacyKey,
    kind: "absent",
  };
}

function collectManagedOverrideConflicts(
  current: Record<string, string>
): ManagedOverrideConflict[] {
  return ROLES.flatMap((role) => {
    const state = getManagedOverrideState(current, role);
    return state.kind === "conflict"
      ? [{
          role,
          canonicalKey: state.canonicalKey,
          canonicalValue: state.canonicalValue!,
          legacyKey: state.legacyKey,
          legacyValue: state.legacyValue!,
        }]
      : [];
  });
}

function buildNormalizedGlobalOverrideRecord(
  current: Record<string, string>,
  desired: Record<string, string> = {}
): {
  normalized: Record<string, string>;
  migratedLegacyKeys: string[];
  conflicts: ManagedOverrideConflict[];
} {
  const conflicts = collectManagedOverrideConflicts(current);
  const normalized: Record<string, string> = {};

  for (const [key, value] of Object.entries(current)) {
    if (managedRoleFromKey(key) === null) {
      normalized[key] = value;
    }
  }

  const migratedLegacyKeys: string[] = [];

  for (const role of ROLES) {
    const state = getManagedOverrideState(current, role);
    const desiredValue = desired[canonicalOverrideKey(role)];

    if (state.kind === "conflict") {
      continue;
    }

    if (desiredValue !== undefined) {
      normalized[canonicalOverrideKey(role)] = desiredValue;
      if (state.legacyValue !== undefined) {
        migratedLegacyKeys.push(state.legacyKey);
      }
      continue;
    }

    if (state.canonicalValue !== undefined) {
      normalized[state.canonicalKey] = state.canonicalValue;
      continue;
    }

    if (state.legacyValue !== undefined) {
      normalized[state.canonicalKey] = state.legacyValue;
      migratedLegacyKeys.push(state.legacyKey);
    }
  }

  return {
    normalized,
    migratedLegacyKeys: migratedLegacyKeys.filter((key, index) => migratedLegacyKeys.indexOf(key) === index).sort(),
    conflicts,
  };
}

function buildGlobalOverrideCompatibilityRecord(
  current: Record<string, string>
): Record<string, string> {
  const compatible = { ...current };

  for (const role of ROLES) {
    const state = getManagedOverrideState(current, role);
    if (state.effectiveValue === undefined) {
      continue;
    }
    if (compatible[state.canonicalKey] === undefined) {
      compatible[state.canonicalKey] = state.effectiveValue;
    }
    if (compatible[state.legacyKey] === undefined) {
      compatible[state.legacyKey] = state.effectiveValue;
    }
  }

  return compatible;
}

function buildClearedGlobalOverrideRecord(
  current: Record<string, string>
): { cleared: Record<string, string>; removedKeys: string[] } {
  const cleared: Record<string, string> = {};
  const removedKeys: string[] = [];

  for (const [key, value] of Object.entries(current)) {
    if (managedRoleFromKey(key) !== null) {
      removedKeys.push(key);
      continue;
    }
    cleared[key] = value;
  }

  return { cleared, removedKeys: removedKeys.sort() };
}

export function buildDesiredGlobalOverrideRecord(
  current: Record<string, string>,
  desired: Record<string, string>
): Record<string, string> {
  const result = buildNormalizedGlobalOverrideRecord(current, desired);
  if (result.conflicts.length > 0) {
    throw new Error(
      `same-scope dual-key conflict(s): ${formatManagedOverrideConflicts(result.conflicts)}`
    );
  }
  return result.normalized;
}

export function buildResetGlobalOverrideRecord(
  current: Record<string, string>
): { cleared: Record<string, string>; removedKeys: string[] } {
  return buildClearedGlobalOverrideRecord(current);
}

function formatManagedOverrideConflicts(conflicts: ManagedOverrideConflict[]): string {
  return conflicts
    .map(
      ({ role, canonicalKey, legacyKey, canonicalValue, legacyValue }) =>
        `${role} (${canonicalKey}=${canonicalValue}, ${legacyKey}=${legacyValue})`
    )
    .join("; ");
}

// ---------------------------------------------------------------------------
// Pure merge helper (no IO)
// ---------------------------------------------------------------------------

/**
 * PURE low-level merge helper (no IO). Given the current record + a mutation, return the new record.
 * - op "set": returns { ...current, [colonKey]: model }
 * - op "delete-pi-oven": returns current with every /^pi-oven:/ key removed
 * Preserves all sibling keys by construction.
 */
export function mergeOverrideRecord(
  current: Record<string, string>,
  mutation: { op: "set"; colonKey: string; model: string } | { op: "delete-pi-oven" }
): Record<string, string> {
  if (mutation.op === "set") {
    return { ...current, [mutation.colonKey]: mutation.model };
  }
  const result: Record<string, string> = {};
  for (const [k, v] of Object.entries(current)) {
    if (!k.startsWith(LEGACY_GLOBAL_OVERRIDE_PREFIX)) {
      result[k] = v;
    }
  }
  return result;
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

interface OmpGetShape {
  key?: unknown;
  value: unknown;
  type?: unknown;
  description?: unknown;
}
export type DisplayReadResult<T> =
  | { state: "present"; value: T }
  | { state: "absent" }
  | { state: "unknown"; error: string };

function isMissingConfigKeyError(stderr: string): boolean {
  return /missing key|not found|not set|no such key|does not exist/i.test(stderr);
}

function classifyDisplayReadFailure(result: {
  exitCode: number | null;
  stderr?: Buffer;
}): { state: "absent" } | { state: "unknown"; error: string } {
  const stderr = result.stderr?.toString().trim() ?? "";
  if (isMissingConfigKeyError(stderr)) {
    return { state: "absent" };
  }
  return {
    state: "unknown",
    error: stderr || `omp config get exited ${String(result.exitCode)}`,
  };
}

/**
 * Parse the raw stdout of `omp config get task.agentModelOverrides --json`.
 * Returns { ok: true, record } on valid shape, { ok: false, error } otherwise.
 */
function parseGetOutput(
  stdout: string
): { ok: true; record: Record<string, string> } | { ok: false; error: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return { ok: false, error: "JSON.parse failed" };
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return { ok: false, error: "top-level is not an object" };
  }

  const obj = parsed as OmpGetShape;

  // .type must be "record"
  if (obj.type !== "record") {
    return { ok: false, error: `type is not "record": ${String(obj.type)}` };
  }

  // .value must be a non-null, non-array object
  if (
    typeof obj.value !== "object" ||
    obj.value === null ||
    Array.isArray(obj.value)
  ) {
    return { ok: false, error: ".value is not a plain object" };
  }

  // Cast to Record<string, string> — individual value types trusted per plan
  const record: Record<string, string> = {};
  for (const [k, v] of Object.entries(obj.value as Record<string, unknown>)) {
    record[k] = String(v);
  }

  return { ok: true, record };
}

// ---------------------------------------------------------------------------
// readOverridesStrict — fail-closed, WRITE path
// ---------------------------------------------------------------------------

/**
 * STRICT read for the WRITE path (fail-closed, Pc2-1).
 * Spawns `omp config get task.agentModelOverrides --json`.
 * Returns { ok: true, record } or { ok: false, error }.
 * Callers MUST abort on ok:false — never merge-into-{} then set (would wipe siblings).
 */
export async function readOverridesStrict(
  opts?: ConfigYmlOpts
): Promise<{ ok: true; record: Record<string, string> } | { ok: false; error: string }> {
  const spawn = opts?.spawnFn ?? defaultSpawn;
  const result = spawn("omp", ["config", "get", "task.agentModelOverrides", "--json"]);

  if (result.exitCode !== 0) {
    return { ok: false, error: `omp config get exited ${String(result.exitCode)}` };
  }

  const stdout = result.stdout?.toString() ?? "";
  return parseGetOutput(stdout);
}

// ---------------------------------------------------------------------------
// readAgentModelOverrides — graceful, DISPLAY path only
// ---------------------------------------------------------------------------

/**
 * GRACEFUL compatibility read for DISPLAY / setup-readiness paths only.
 * Returns the raw record plus any missing managed aliases, preferring `pov:*`
 * when both keys exist and backfilling `pi-oven:*` only for compatibility
 * readers that still count legacy-shaped entries.
 * MUST NOT be used by write paths (set/delete).
 */
export async function readAgentModelOverrides(
  opts?: ConfigYmlOpts
): Promise<Record<string, string>> {
  const result = await readOverridesStrict(opts);
  if (!result.ok) {
    return {};
  }
  return buildGlobalOverrideCompatibilityRecord(result.record);
}

/**
 * GRACEFUL scalar read for DISPLAY / diagnostic paths only. Returns the raw
 * `value` from `omp config get <key> --json`, distinguishing:
 *   - `{ state:"present", value }`
 *   - `{ state:"absent" }` for a genuinely missing key
 *   - `{ state:"unknown" }` for unreadable / malformed output
 * MUST NOT be used by write paths.
 */
export async function readConfigValueDisplayState(
  key: string,
  opts?: ConfigYmlOpts
): Promise<DisplayReadResult<unknown>> {
  const spawn = opts?.spawnFn ?? defaultSpawn;
  const result = spawn("omp", ["config", "get", key, "--json"]);
  if (result.exitCode !== 0) return classifyDisplayReadFailure(result);

  let parsed: unknown;
  try {
    parsed = JSON.parse(result.stdout?.toString() ?? "");
  } catch {
    return { state: "unknown", error: "JSON.parse failed" };
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return { state: "unknown", error: "top-level is not an object" };
  }

  const obj = parsed as OmpGetShape;
  if (!Object.prototype.hasOwnProperty.call(obj, "value")) {
    return { state: "absent" };
  }
  return { state: "present", value: obj.value };
}

/** Strict generic config snapshot used by the setup transaction preflight. */
export async function readConfigSnapshotStrict(
  key: string,
  opts?: ConfigYmlOpts
): Promise<SetupTransactionSnapshot> {
  const spawn = opts?.spawnFn ?? defaultSpawn;
  const result = spawn("omp", ["config", "get", key, "--json"]);
  if (result.exitCode !== 0) {
    const classified = classifyDisplayReadFailure(result);
    if (classified.state === "absent") return { absent: true };
    throw new Error(`readConfigSnapshotStrict: ${key}: ${classified.error}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(result.stdout?.toString() ?? "");
  } catch {
    throw new Error(`readConfigSnapshotStrict: ${key}: malformed JSON`);
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed) || !("value" in parsed)) {
    throw new Error(`readConfigSnapshotStrict: ${key}: invalid omp config shape`);
  }
  const value = (parsed as { value: unknown }).value;
  if (value === undefined || typeof value === "function" || typeof value === "symbol" || typeof value === "bigint") {
    throw new Error(`readConfigSnapshotStrict: ${key}: value is not JSON`);
  }
  return structuredClone(value) as SetupTransactionSnapshot;
}

/** Restore/set one generic config snapshot, including true ABSENT via reset. */
export async function writeConfigSnapshot(
  key: string,
  value: SetupTransactionSnapshot,
  opts?: ConfigYmlOpts
): Promise<void> {
  const spawn = opts?.spawnFn ?? defaultSpawn;
  const resetRequested =
    typeof value === "object" && value !== null && !Array.isArray(value) &&
    ((value as { absent?: unknown }).absent === true ||
      (value as { resetToDefault?: unknown }).resetToDefault === true);
  const args = resetRequested
    ? ["config", "reset", key]
    : [
        "config",
        "set",
        key,
        typeof value === "string" || typeof value === "number" || typeof value === "boolean"
          ? String(value)
          : JSON.stringify(value),
      ];
  const result = spawn("omp", args);
  if (result.exitCode !== 0) {
    throw new Error(
      `writeConfigSnapshot: omp ${args.slice(0, 3).join(" ")} failed (exit ${String(result.exitCode)}): ${result.stderr?.toString() ?? ""}`
    );
  }
}

export async function readConfigValueDisplay(
  key: string,
  opts?: ConfigYmlOpts
): Promise<unknown | null> {
  const result = await readConfigValueDisplayState(key, opts);
  return result.state === "present" ? (result.value ?? null) : null;
}

/**
 * GRACEFUL boolean read for DISPLAY / diagnostic paths only. Returns:
 *   - `{ state:"present", value:true|false }` for a boolean-like scalar
 *   - `{ state:"absent" }` when the key is genuinely absent
 *   - `{ state:"unknown" }` on unreadable / malformed / non-boolean output
 */
export async function readBooleanSettingDisplayState(
  key: string,
  opts?: ConfigYmlOpts
): Promise<DisplayReadResult<boolean>> {
  const value = await readConfigValueDisplayState(key, opts);
  if (value.state !== "present") return value;
  if (value.value === true || value.value === "true") return { state: "present", value: true };
  if (value.value === false || value.value === "false") return { state: "present", value: false };
  return { state: "unknown", error: "value is not boolean-like" };
}

export async function readBooleanSettingDisplay(
  key: string,
  opts?: ConfigYmlOpts
): Promise<boolean | null> {
  const result = await readBooleanSettingDisplayState(key, opts);
  return result.state === "present" ? result.value : null;
}

// ---------------------------------------------------------------------------
// setAgentModelOverride — WRITE path
// ---------------------------------------------------------------------------

/**
 * SET one global override: readOverridesStrict → normalize current scope to
 * canonical `pov:*` keys (migrating any old-only `pi-oven:*` roles) → apply the
 * requested `pov:<role>` value → `omp config set task.agentModelOverrides
 * '<whole-normalized-json>'`.
 *
 * Same-scope dual-key conflicts are explicit and abort the write.
 */
export async function setAgentModelOverride(
  colonKey: string,
  model: string,
  opts?: ConfigYmlOpts
): Promise<void> {
  const role = managedRoleFromKey(colonKey);
  if (role === null || !colonKey.startsWith(GLOBAL_OVERRIDE_PREFIX)) {
    throw new Error(
      `setAgentModelOverride: colonKey must be canonical "pov:<role>", got: ${colonKey}`
    );
  }

  const readResult = await readOverridesStrict(opts);
  if (!readResult.ok) {
    throw new Error(`setAgentModelOverride: readOverridesStrict failed — ${readResult.error}`);
  }

  const { normalized, conflicts } = buildNormalizedGlobalOverrideRecord(
    readResult.record,
    { [canonicalOverrideKey(role)]: model }
  );
  if (conflicts.length > 0) {
    throw new Error(
      `setAgentModelOverride: same-scope dual-key conflict(s): ${formatManagedOverrideConflicts(conflicts)}`
    );
  }

  const spawn = opts?.spawnFn ?? defaultSpawn;
  const setResult = spawn("omp", [
    "config",
    "set",
    "task.agentModelOverrides",
    JSON.stringify(normalized),
  ]);

  if (setResult.exitCode !== 0) {
    throw new Error(
      `setAgentModelOverride: omp config set failed (exit ${String(setResult.exitCode)}): ${setResult.stderr?.toString() ?? ""}`
    );
  }
}

// ---------------------------------------------------------------------------
// setAgentModelOverrides — bulk WRITE path
// ---------------------------------------------------------------------------

/**
 * Bulk-set multiple global task.agentModelOverrides entries atomically: ONE read →
 * normalize current scope to canonical `pov:*` keys → merge all provided
 * `pov:<role>` entries → ONE `omp config set task.agentModelOverrides
 * '<normalized-json>'`.
 *
 * Same-scope dual-key conflicts are explicit and abort the write.
 */
export async function setAgentModelOverrides(
  record: Record<string, string>,
  opts?: ConfigYmlOpts
): Promise<void> {
  for (const key of Object.keys(record)) {
    if (managedRoleFromKey(key) === null || !key.startsWith(GLOBAL_OVERRIDE_PREFIX)) {
      throw new Error(
        `setAgentModelOverrides: every key must be canonical "pov:<role>", got: ${key}`
      );
    }
  }

  const readResult = await readOverridesStrict(opts);
  if (!readResult.ok) {
    throw new Error(`setAgentModelOverrides: readOverridesStrict failed — ${readResult.error}`);
  }

  const { normalized, conflicts } = buildNormalizedGlobalOverrideRecord(
    readResult.record,
    record
  );
  if (conflicts.length > 0) {
    throw new Error(
      `setAgentModelOverrides: same-scope dual-key conflict(s): ${formatManagedOverrideConflicts(conflicts)}`
    );
  }

  const spawn = opts?.spawnFn ?? defaultSpawn;
  const setResult = spawn("omp", [
    "config",
    "set",
    "task.agentModelOverrides",
    JSON.stringify(normalized),
  ]);

  if (setResult.exitCode !== 0) {
    throw new Error(
      `setAgentModelOverrides: omp config set failed (exit ${String(setResult.exitCode)}): ${setResult.stderr?.toString() ?? ""}`
    );
  }
}

// ---------------------------------------------------------------------------
// deleteGlobalAgentModelOverrides — WRITE path
// ---------------------------------------------------------------------------

/**
 * DELETE all managed global overrides for known roles (both `pov:*` and legacy
 * `pi-oven:*` keys): readOverridesStrict → prune the managed keys →
 * `omp config set task.agentModelOverrides '<whole-pruned-json>'`.
 * Returns the sorted list of removed keys. Preserves non-managed siblings.
 */
export async function deleteGlobalAgentModelOverrides(
  opts?: ConfigYmlOpts
): Promise<string[]> {
  const readResult = await readOverridesStrict(opts);
  if (!readResult.ok) {
    throw new Error(`deleteGlobalAgentModelOverrides: readOverridesStrict failed — ${readResult.error}`);
  }

  const { cleared, removedKeys } = buildClearedGlobalOverrideRecord(readResult.record);

  if (removedKeys.length === 0) {
    return removedKeys;
  }

  const spawn = opts?.spawnFn ?? defaultSpawn;
  const setResult = spawn("omp", [
    "config",
    "set",
    "task.agentModelOverrides",
    JSON.stringify(cleared),
  ]);

  if (setResult.exitCode !== 0) {
    throw new Error(
      `deleteGlobalAgentModelOverrides: omp config set failed (exit ${String(setResult.exitCode)}): ${setResult.stderr?.toString() ?? ""}`
    );
  }

  return removedKeys;
}

// ---------------------------------------------------------------------------
// resetConfigKey — WRITE path (full-reset only)
// ---------------------------------------------------------------------------

/**
 * Reset a single omp setting back to its type-default via `omp config reset
 * <key>` (number→0, record→{}, array→[]). Used only by `--reset --full` to
 * return pi-oven-managed keys (modelRoles / disabledProviders / setupVersion) to
 * the "new user" state. Throws (including stderr) on a non-zero exit. The caller
 * MUST only pass pi-oven-managed keys — never omp-internal keys like
 * lastChangelogVersion.
 */
export async function resetConfigKey(key: string, opts?: ConfigYmlOpts): Promise<void> {
  const spawn = opts?.spawnFn ?? defaultSpawn;
  const result = spawn("omp", ["config", "reset", key]);

  if (result.exitCode !== 0) {
    throw new Error(
      `resetConfigKey: omp config reset ${key} failed (exit ${String(result.exitCode)}): ${result.stderr?.toString() ?? ""}`
    );
  }
}

// ---------------------------------------------------------------------------
// modelRoles (RECORD) — the MAIN orchestrator model pair (default + title).
// Same whole-record merge transport as task.agentModelOverrides: omp config get
// modelRoles --json → in-memory merge → omp config set modelRoles '<json>'.
// omp's settings schema declares `modelRoles` as a `record` (NOT individual
// `modelRoles.<role>` dotted keys), so `omp config set modelRoles.default <v>`
// is REJECTED ("Unknown setting") — the write MUST target the whole record.
// This is ORTHOGONAL to task.agentModelOverrides: modelRoles holds the launched
// top-level session/orchestrator model, NOT a subagent override (Spec E's
// per-role-write ban applies only to task.agentModelOverrides).
// ---------------------------------------------------------------------------

/**
 * STRICT read for the WRITE path (fail-closed). Spawns
 * `omp config get modelRoles --json` and parses the `{type:"record"}` shape via
 * the shared parseGetOutput helper. Returns { ok: true, record } or
 * { ok: false, error }. Callers MUST abort on ok:false — never merge-into-{}
 * then set (that would wipe sibling modelRoles the user set themselves).
 */
export async function readModelRolesStrict(
  opts?: ConfigYmlOpts
): Promise<{ ok: true; record: Record<string, string> } | { ok: false; error: string }> {
  const spawn = opts?.spawnFn ?? defaultSpawn;
  const result = spawn("omp", ["config", "get", "modelRoles", "--json"]);

  if (result.exitCode !== 0) {
    return { ok: false, error: `omp config get exited ${String(result.exitCode)}` };
  }

  const stdout = result.stdout?.toString() ?? "";
  return parseGetOutput(stdout);
}

/**
 * SET the MAIN orchestrator model roles atomically: readModelRolesStrict → if
 * !ok ABORT(throw, never merge-into-{}) → merge the provided roles into the
 * record (preserving all sibling keys) → ONE `omp config set modelRoles
 * '<whole-merged-json>'` write. Throws (including stderr) on a non-zero set exit.
 */
export async function setModelRoles(
  roles: Record<string, string>,
  opts?: ConfigYmlOpts
): Promise<void> {
  const readResult = await readModelRolesStrict(opts);
  if (!readResult.ok) {
    throw new Error(`setModelRoles: readModelRolesStrict failed — ${readResult.error}`);
  }

  const merged = { ...readResult.record, ...roles };

  const spawn = opts?.spawnFn ?? defaultSpawn;
  const setResult = spawn("omp", ["config", "set", "modelRoles", JSON.stringify(merged)]);

  if (setResult.exitCode !== 0) {
    throw new Error(
      `setModelRoles: omp config set modelRoles failed (exit ${String(setResult.exitCode)}): ${setResult.stderr?.toString() ?? ""}`
    );
  }
}

// ---------------------------------------------------------------------------
// retryFallbackChains (RECORD of string[]) — rate-limit failover chains for the
// orchestrator modelRoles, keyed by modelRole name (default, title). WRITE paths
// read STRICT: a malformed `omp config get retry.fallbackChains --json` aborts
// rather than merge-into-{} and wiping sibling chains. A genuinely absent key is
// represented by an empty record on success.
// ---------------------------------------------------------------------------

function parseRetryFallbackChainsOutput(
  stdout: string
): { ok: true; record: Record<string, string[]> } | { ok: false; error: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return { ok: false, error: "JSON.parse failed" };
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return { ok: false, error: "top-level is not an object" };
  }

  const obj = parsed as OmpGetShape;
  if (
    obj.type !== "record" ||
    typeof obj.value !== "object" ||
    obj.value === null ||
    Array.isArray(obj.value)
  ) {
    return { ok: false, error: `type is not "record": ${String(obj.type)}` };
  }

  const record: Record<string, string[]> = {};
  for (const [k, v] of Object.entries(obj.value as Record<string, unknown>)) {
    record[k] = Array.isArray(v) ? v.map(String) : [String(v)];
  }
  return { ok: true, record };
}

/**
 * STRICT read of retry.fallbackChains for the WRITE path. Returns:
 *   - `{ ok:true, record:{} }` when the key is genuinely absent
 *   - `{ ok:true, record:<parsed> }` on valid record output
 *   - `{ ok:false, error }` on unreadable / malformed output
 */
export async function readRetryFallbackChains(
  opts?: ConfigYmlOpts
): Promise<{ ok: true; record: Record<string, string[]> } | { ok: false; error: string }> {
  const spawn = opts?.spawnFn ?? defaultSpawn;
  const result = spawn("omp", ["config", "get", "retry.fallbackChains", "--json"]);
  if (result.exitCode !== 0) {
    return classifyDisplayReadFailure(result).state === "absent"
      ? { ok: true, record: {} }
      : { ok: false, error: `omp config get exited ${String(result.exitCode)}` };
  }

  return parseRetryFallbackChainsOutput(result.stdout?.toString() ?? "");
}

/**
 * SET the retry fallback chains: strict-read → merge the provided chains
 * (overwriting same-named roles, preserving others) → ONE
 * `omp config set retry.fallbackChains '<json>'` write. Throws on read or set
 * failure.
 */
export async function setRetryFallbackChains(
  chains: Record<string, string[]>,
  opts?: ConfigYmlOpts
): Promise<void> {
  const existing = await readRetryFallbackChains(opts);
  if (!existing.ok) {
    throw new Error(`setRetryFallbackChains: readRetryFallbackChains failed — ${existing.error}`);
  }
  const merged = { ...existing.record, ...chains };

  const spawn = opts?.spawnFn ?? defaultSpawn;
  const setResult = spawn("omp", ["config", "set", "retry.fallbackChains", JSON.stringify(merged)]);
  if (setResult.exitCode !== 0) {
    throw new Error(
      `setRetryFallbackChains: omp config set retry.fallbackChains failed (exit ${String(setResult.exitCode)}): ${setResult.stderr?.toString() ?? ""}`
    );
  }
}


// ---------------------------------------------------------------------------
// setMemoryAndAsyncConfig — writes 4 global scalar keys for mnemopi + async.
// Each key is a simple dotted scalar (not a record), so individual
// `omp config set <dotted.key> <value>` calls are used — no read-merge-write
// needed. Does NOT touch task.agentModelOverrides (Spec E boundary preserved).
// ---------------------------------------------------------------------------

/**
 * Write the 4 global keys required for native mnemopi memory and irc:
 *   memory.backend=mnemopi  — BLOCKER: without this retain/recall/reflect are inert
 *   mnemopi.noEmbeddings=true — zero-network local-only mode
 *   mnemopi.llmMode=none    — zero-network local-only mode
 *   async.enabled=true      — enables in-call irc sibling fan-out (main session only)
 *
 * Uses individual `omp config set <dotted.key> <value>` calls (one per key).
 * These are scalar values so dotted-key writes are accepted (unlike record-typed
 * keys such as modelRoles, which require whole-record replacement).
 * Throws (including stderr) on any non-zero exit. Never touches
 * task.agentModelOverrides (Spec E boundary).
 */
export async function setMemoryAndAsyncConfig(opts?: ConfigYmlOpts): Promise<void> {
  const spawn = opts?.spawnFn ?? defaultSpawn;

  const keys: Array<[string, string]> = [
    ["memory.backend", "mnemopi"],
    ["mnemopi.noEmbeddings", "true"],
    ["mnemopi.llmMode", "none"],
    ["async.enabled", "true"],
  ];

  for (const [key, value] of keys) {
    const result = spawn("omp", ["config", "set", key, value]);
    if (result.exitCode !== 0) {
      throw new Error(
        `setMemoryAndAsyncConfig: omp config set ${key} failed (exit ${String(result.exitCode)}): ${result.stderr?.toString() ?? ""}`
      );
    }
  }
}

// ---------------------------------------------------------------------------
// setToolEnablementConfig — writes the subagent runtime prerequisites so the
// agents' tool mandates are not toothless and subagent LSP is actually enabled.
// Scalar dotted keys → individual `omp config set <dotted.key> <value>` (same
// scalar-write transport as setMemoryAndAsyncConfig; no read-merge needed,
// these are not record-typed).
// ---------------------------------------------------------------------------

/**
 * Subagent runtime prerequisites written on global-scope setup. The gated tool
 * flags ensure the mandated tools stay callable, and `task.enableLsp=true`
 * removes omp's default subagent LSP gate. OMP task owns dispatch, and worker
 * breadth is controlled by `async.enabled`, `task.maxConcurrency`, and
 * provider/runtime admission. Scalar keys → individual
 * `omp config set <dotted.key> <value>` (no read-merge needed; not
 * record-typed). The EXACT casing is the omp setting key (astGrep camelCase,
 * inspect_image snake) — do not normalize it.
 */
export const TOOL_ENABLEMENT: Record<string, boolean> = {
  "inspect_image.enabled": true,
  "web_search.enabled": true,
  "lsp.enabled": true,
  "astGrep.enabled": true,
  "browser.enabled": true,
  "debug.enabled": true,
};

export const SUBAGENT_RUNTIME_PREREQUISITES: Record<string, boolean> = {
  "task.enableLsp": true,
  ...TOOL_ENABLEMENT,
};

/**
 * Write every subagent runtime prerequisite via individual
 * `omp config set <key> <value>` calls (one per scalar key). Mirrors
 * setMemoryAndAsyncConfig. Throws (including stderr) on any non-zero exit.
 * Called from apply.ts on global-scope user setup only — project scope writes
 * routing files, never `omp config set`.
 */
export async function setToolEnablementConfig(opts?: ConfigYmlOpts): Promise<void> {
  const spawn = opts?.spawnFn ?? defaultSpawn;
  for (const [key, value] of Object.entries(SUBAGENT_RUNTIME_PREREQUISITES)) {
    const result = spawn("omp", ["config", "set", key, String(value)]);
    if (result.exitCode !== 0) {
      throw new Error(
        `setToolEnablementConfig: omp config set ${key} failed (exit ${String(result.exitCode)}): ${result.stderr?.toString() ?? ""}`
      );
    }
  }
}

// ---------------------------------------------------------------------------
// skills.includeSkills (ARRAY) — canonical workflow-skill ownership mainline.
// This controls ONLY the visible workflow-skill surface. It is intentionally
// orthogonal to commands / agents / hooks / MCP and intentionally does NOT rely
// on an empty ~/.claude/skills tree. Populated Claude skills may continue to
// exist for other users; pi-oven owns workflow-skill visibility by writing an
// explicit include filter instead.
// ---------------------------------------------------------------------------

export const PI_OVEN_WORKFLOW_SKILL_INCLUDE = ["pov:*"] as const;

// ---------------------------------------------------------------------------
// skills.ignoredSkills (ARRAY) — legacy opt-in sibling-skill suppression (§3.4).
// Same transport as disabledProviders: omp config get skills.ignoredSkills --json
// → in-memory union/diff → omp config set skills.ignoredSkills '<whole-merged-json>'.
// ---------------------------------------------------------------------------

/**
 * The legacy marketplace skill globs pi-oven can write into
 * `skills.ignoredSkills` when the operator explicitly opts into the
 * compatibility filter. Excludes agentmemory:* by design (D5 decision:
 * non-overlapping memory tools).
 */
export const PI_OVEN_SIBLING_SKILL_GLOBS = [
  "superpowers:*",
  "oh-my-claudecode:*",
] as const;
export const LEGACY_FRONT_DOOR_BOUNDARY_LINE =
  "Legacy front doors (`--isolate`, `--no-isolate`, `--suppress-sibling-skills`, `--no-suppress-sibling-skills`) are global-only maintenance paths, owned by pi-oven maintainers, and must be removed once the omp-native control plane owns those surfaces end-to-end.";


/**
 * Generic STRICT read for any array-typed omp setting (the WRITE path, fail-closed).
 * Spawns `omp config get <key> --json`. Returns { ok: true, list } or { ok: false, error }.
 * Callers MUST abort on ok:false — never merge-into-[] then set (would wipe siblings).
 */
export async function readStringArraySettingStrict(
  key: string,
  opts?: ConfigYmlOpts
): Promise<{ ok: true; list: string[] } | { ok: false; error: string }> {
  const spawn = opts?.spawnFn ?? defaultSpawn;
  const result = spawn("omp", ["config", "get", key, "--json"]);

  if (result.exitCode !== 0) {
    return { ok: false, error: `omp config get exited ${String(result.exitCode)}` };
  }

  const stdout = result.stdout?.toString() ?? "";
  return parseGetArrayOutput(stdout);
}

/**
 * STRICT read of `skills.ignoredSkills` for the WRITE path (fail-closed).
 * Delegates to the generic readStringArraySettingStrict.
 */
export async function readIgnoredSkillsStrict(
  opts?: ConfigYmlOpts
): Promise<{ ok: true; list: string[] } | { ok: false; error: string }> {
  return readStringArraySettingStrict("skills.ignoredSkills", opts);
}

/**
 * GRACEFUL read of `skills.ignoredSkills` for DISPLAY / diagnostic paths only.
 * Distinguishes a genuinely absent key from unreadable / malformed output.
 */
export async function readIgnoredSkillsDisplayState(
  opts?: ConfigYmlOpts
): Promise<DisplayReadResult<string[]>> {
  const spawn = opts?.spawnFn ?? defaultSpawn;
  const result = spawn("omp", ["config", "get", "skills.ignoredSkills", "--json"]);
  if (result.exitCode !== 0) return classifyDisplayReadFailure(result);

  const parsed = parseGetArrayOutput(result.stdout?.toString() ?? "");
  return parsed.ok ? { state: "present", value: parsed.list } : { state: "unknown", error: parsed.error };
}

export async function readIgnoredSkillsDisplay(
  opts?: ConfigYmlOpts
): Promise<string[] | null> {
  const result = await readIgnoredSkillsDisplayState(opts);
  return result.state === "present" ? result.value : null;
}

/**
 * GRACEFUL read of `skills.includeSkills` for DISPLAY / diagnostic paths only.
 * Distinguishes a genuinely absent key from unreadable / malformed output.
 */
export async function readIncludedSkillsDisplayState(
  opts?: ConfigYmlOpts
): Promise<DisplayReadResult<string[]>> {
  const spawn = opts?.spawnFn ?? defaultSpawn;
  const result = spawn("omp", ["config", "get", "skills.includeSkills", "--json"]);
  if (result.exitCode !== 0) return classifyDisplayReadFailure(result);

  const parsed = parseGetArrayOutput(result.stdout?.toString() ?? "");
  return parsed.ok ? { state: "present", value: parsed.list } : { state: "unknown", error: parsed.error };
}

export async function readIncludedSkillsDisplay(
  opts?: ConfigYmlOpts
): Promise<string[] | null> {
  const result = await readIncludedSkillsDisplayState(opts);
  return result.state === "present" ? result.value : null;
}

/**
 * Write the canonical workflow-skill ownership surface into omp's global config.
 * This is the mainline ownership policy for workflow skills only: populated
 * `~/.claude/skills` may continue to exist, but the effective visible workflow
 * skill surface is filtered to `pov:*`. Commands / agents / hooks / MCP are
 * explicitly out of scope for this write.
 */
export async function setPiOvenIncludedSkills(opts?: ConfigYmlOpts): Promise<string[]> {
  const spawn = opts?.spawnFn ?? defaultSpawn;
  const includeSkills = [...PI_OVEN_WORKFLOW_SKILL_INCLUDE];
  const setResult = spawn("omp", ["config", "set", "skills.includeSkills", JSON.stringify(includeSkills)]);

  if (setResult.exitCode !== 0) {
    throw new Error(
      `setPiOvenIncludedSkills: omp config set failed (exit ${String(setResult.exitCode)}): ${setResult.stderr?.toString() ?? ""}`
    );
  }

  return includeSkills;
}

/**
 * ENABLE sibling suppression: readIgnoredSkillsStrict → if !ok ABORT(throw) →
 * union-add PI_OVEN_SIBLING_SKILL_GLOBS (via mergeDisabledProviders reused as
 * a pure string-array helper) → `omp config set skills.ignoredSkills '<json>'`.
 * Idempotent — re-adding already-present globs is a no-op union.
 * Returns the resulting ignoredSkills list. Preserves user-set sibling globs.
 */
export async function setPiOvenIgnoredSkills(opts?: ConfigYmlOpts): Promise<string[]> {
  const readResult = await readIgnoredSkillsStrict(opts);
  if (!readResult.ok) {
    throw new Error(`setPiOvenIgnoredSkills: readIgnoredSkillsStrict failed — ${readResult.error}`);
  }

  const merged = mergeDisabledProviders(readResult.list, {
    op: "add",
    providers: PI_OVEN_SIBLING_SKILL_GLOBS,
  });

  const spawn = opts?.spawnFn ?? defaultSpawn;
  const setResult = spawn("omp", ["config", "set", "skills.ignoredSkills", JSON.stringify(merged)]);

  if (setResult.exitCode !== 0) {
    throw new Error(
      `setPiOvenIgnoredSkills: omp config set failed (exit ${String(setResult.exitCode)}): ${setResult.stderr?.toString() ?? ""}`
    );
  }

  return merged;
}

/**
 * DISABLE sibling suppression: readIgnoredSkillsStrict → if !ok ABORT(throw) →
 * set-difference remove PI_OVEN_SIBLING_SKILL_GLOBS → set.
 * Returns the sorted list of globs actually removed. No-op (skips set) when none
 * of the managed globs are present. Preserves sibling globs the user set themselves
 * EXCEPT identical globs (provenance-loss limitation, same as disabledProviders).
 */
export async function clearPiOvenIgnoredSkills(opts?: ConfigYmlOpts): Promise<string[]> {
  const readResult = await readIgnoredSkillsStrict(opts);
  if (!readResult.ok) {
    throw new Error(`clearPiOvenIgnoredSkills: readIgnoredSkillsStrict failed — ${readResult.error}`);
  }

  const current = readResult.list;
  const removed = [...PI_OVEN_SIBLING_SKILL_GLOBS].filter((g) => current.includes(g)).sort();

  if (removed.length === 0) {
    return [];
  }

  const merged = mergeDisabledProviders(current, {
    op: "remove",
    providers: PI_OVEN_SIBLING_SKILL_GLOBS,
  });

  const spawn = opts?.spawnFn ?? defaultSpawn;
  const setResult = spawn("omp", ["config", "set", "skills.ignoredSkills", JSON.stringify(merged)]);

  if (setResult.exitCode !== 0) {
    throw new Error(
      `clearPiOvenIgnoredSkills: omp config set failed (exit ${String(setResult.exitCode)}): ${setResult.stderr?.toString() ?? ""}`
    );
  }

  return removed;
}

// disabledProviders (ARRAY) — legacy home-layer compatibility mode.
// Same transport as the overrides path: omp config get disabledProviders --json
// → in-memory merge → omp config set disabledProviders '<whole-merged-json>'.
// ---------------------------------------------------------------------------

/**
 * The discovery provider pi-oven toggles for the legacy home-layer
 * compatibility mode: `claude` ONLY (~/.claude CLAUDE.md / skills / hooks /
 * commands). It must NOT disable `claude-plugins`: pi-oven's own
 * `/pi-oven:*` commands and skills register through that same `claude-plugins`
 * discovery provider (it reads ~/.omp/plugins too, not just ~/.claude/plugins),
 * so disabling it would also kill pi-oven's own commands. Trade-off (by design):
 * marketplace plugin commands that still load through `claude-plugins`
 * remain visible under omp.
 */
export const PI_OVEN_MANAGED_PROVIDERS = ["claude"] as const;

/**
 * Legacy providers an earlier (buggy, pre-0.5.3) compatibility toggle added to
 * `disabledProviders`. They are ALWAYS purged on either toggle to heal those
 * configs: disabling `claude-plugins` removed pi-oven's own `/pi-oven:*` commands, so
 * the compatibility mode strips it back out on enable and removes it alongside
 * the managed set on disable.
 */
export const PI_OVEN_DEPRECATED_PROVIDERS = ["claude-plugins"] as const;

/**
 * PURE merge helper (no IO) for the disabledProviders ARRAY.
 * - op "add":    union(current, providers), first-seen order preserved, de-duped.
 * - op "remove": current minus providers (preserves sibling providers the user
 *   set themselves).
 */
export function mergeDisabledProviders(
  current: string[],
  mutation:
    | { op: "add"; providers: readonly string[] }
    | { op: "remove"; providers: readonly string[] }
): string[] {
  if (mutation.op === "add") {
    const out: string[] = [];
    const seen = new Set<string>();
    for (const p of [...current, ...mutation.providers]) {
      if (!seen.has(p)) {
        seen.add(p);
        out.push(p);
      }
    }
    return out;
  }
  const removeSet = new Set(mutation.providers);
  return current.filter((p) => !removeSet.has(p));
}

/**
 * Parse the raw stdout of `omp config get disabledProviders --json`.
 * Returns { ok: true, list } on a valid array shape, { ok: false, error } else.
 */
function parseGetArrayOutput(
  stdout: string
): { ok: true; list: string[] } | { ok: false; error: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return { ok: false, error: "JSON.parse failed" };
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return { ok: false, error: "top-level is not an object" };
  }

  const obj = parsed as OmpGetShape;

  if (obj.type !== "array") {
    return { ok: false, error: `type is not "array": ${String(obj.type)}` };
  }
  if (!Array.isArray(obj.value)) {
    return { ok: false, error: ".value is not an array" };
  }

  return { ok: true, list: (obj.value as unknown[]).map((v) => String(v)) };
}

/**
 * STRICT read for the WRITE path (fail-closed). Spawns
 * `omp config get disabledProviders --json`. Callers MUST abort on ok:false —
 * never merge-into-[] then set (that would wipe sibling providers).
 */
export async function readDisabledProvidersStrict(
  opts?: ConfigYmlOpts
): Promise<{ ok: true; list: string[] } | { ok: false; error: string }> {
  const spawn = opts?.spawnFn ?? defaultSpawn;
  const result = spawn("omp", ["config", "get", "disabledProviders", "--json"]);

  if (result.exitCode !== 0) {
    return { ok: false, error: `omp config get exited ${String(result.exitCode)}` };
  }

  const stdout = result.stdout?.toString() ?? "";
  return parseGetArrayOutput(stdout);
}

/**
 * GRACEFUL read of `disabledProviders` for DISPLAY / diagnostic paths only.
 * Distinguishes a genuinely absent key from unreadable / malformed output.
 */
export async function readDisabledProvidersDisplayState(
  opts?: ConfigYmlOpts
): Promise<DisplayReadResult<string[]>> {
  const spawn = opts?.spawnFn ?? defaultSpawn;
  const result = spawn("omp", ["config", "get", "disabledProviders", "--json"]);
  if (result.exitCode !== 0) return classifyDisplayReadFailure(result);

  const parsed = parseGetArrayOutput(result.stdout?.toString() ?? "");
  return parsed.ok ? { state: "present", value: parsed.list } : { state: "unknown", error: parsed.error };
}

/**
 * ENABLE isolation: readDisabledProvidersStrict → if !ok ABORT(throw) → FIRST
 * purge PI_OVEN_DEPRECATED_PROVIDERS (op "remove"), THEN add PI_OVEN_MANAGED_PROVIDERS
 * (op "add") → `omp config set disabledProviders '<whole-merged-json>'`. Net
 * result: `claude` present, legacy `claude-plugins` absent, siblings preserved
 * (e.g. [claude,claude-plugins]→[claude]; []→[claude]; [codex,claude-plugins]→
 * [codex,claude]). Returns the resulting provider list. Idempotent — re-adding
 * an already-present managed provider is a no-op union.
 */
export async function setPiOvenDisabledProviders(opts?: ConfigYmlOpts): Promise<string[]> {
  const readResult = await readDisabledProvidersStrict(opts);
  if (!readResult.ok) {
    throw new Error(`setPiOvenDisabledProviders: readDisabledProvidersStrict failed — ${readResult.error}`);
  }

  const purged = mergeDisabledProviders(readResult.list, {
    op: "remove",
    providers: PI_OVEN_DEPRECATED_PROVIDERS,
  });
  const merged = mergeDisabledProviders(purged, {
    op: "add",
    providers: PI_OVEN_MANAGED_PROVIDERS,
  });

  const spawn = opts?.spawnFn ?? defaultSpawn;
  const setResult = spawn("omp", ["config", "set", "disabledProviders", JSON.stringify(merged)]);

  if (setResult.exitCode !== 0) {
    throw new Error(
      `setPiOvenDisabledProviders: omp config set failed (exit ${String(setResult.exitCode)}): ${setResult.stderr?.toString() ?? ""}`
    );
  }

  return merged;
}

/**
 * DISABLE isolation: readDisabledProvidersStrict → if !ok ABORT(throw) →
 * mergeDisabledProviders(remove the UNION of PI_OVEN_MANAGED_PROVIDERS +
 * PI_OVEN_DEPRECATED_PROVIDERS) → set, so it strips BOTH `claude` and any legacy
 * `claude-plugins` a buggy pre-0.5.3 isolate left behind. Returns the sorted
 * list of providers actually removed (union ∩ current). Preserves sibling
 * providers. No-op (skips the set call) when none of those providers are present
 * (e.g. [claude,claude-plugins]→[] removed [claude,claude-plugins];
 * [codex,claude]→[codex] removed [claude]).
 */
export async function clearPiOvenDisabledProviders(opts?: ConfigYmlOpts): Promise<string[]> {
  const readResult = await readDisabledProvidersStrict(opts);
  if (!readResult.ok) {
    throw new Error(`clearPiOvenDisabledProviders: readDisabledProvidersStrict failed — ${readResult.error}`);
  }

  const current = readResult.list;
  const union = [...PI_OVEN_MANAGED_PROVIDERS, ...PI_OVEN_DEPRECATED_PROVIDERS];
  const removed = union.filter((p) => current.includes(p)).sort();

  if (removed.length === 0) {
    return [];
  }

  const merged = mergeDisabledProviders(current, {
    op: "remove",
    providers: union,
  });

  const spawn = opts?.spawnFn ?? defaultSpawn;
  const setResult = spawn("omp", ["config", "set", "disabledProviders", JSON.stringify(merged)]);

  if (setResult.exitCode !== 0) {
    throw new Error(
      `clearPiOvenDisabledProviders: omp config set failed (exit ${String(setResult.exitCode)}): ${setResult.stderr?.toString() ?? ""}`
    );
  }

  return removed;
}
