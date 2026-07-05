/**
 * OMP-delegated task.agentModelOverrides read/merge-write/delete helper.
 * Transport: omp config get → in-memory merge → omp config set (whole-record replace).
 */

export interface ConfigYmlOpts {
  /** Injectable spawn for omp config get/set (tests). Default: Bun.spawnSync wrapper. */
  spawnFn?: (cmd: string, args: string[]) => { exitCode: number | null; stdout?: Buffer; stderr?: Buffer };
}

// ---------------------------------------------------------------------------
// Pure merge helper (no IO)
// ---------------------------------------------------------------------------

/**
 * PURE merge helper (no IO). Given the current record + a mutation, return the new record.
 * - op "set": returns { ...current, [colonKey]: model }
 * - op "delete-pi-oven": returns current with every /^pi-oven:/ key removed
 * Preserves all sibling keys (non-pi-oven:* and other pi-oven:*) by construction.
 */
export function mergeOverrideRecord(
  current: Record<string, string>,
  mutation: { op: "set"; colonKey: string; model: string } | { op: "delete-pi-oven" }
): Record<string, string> {
  if (mutation.op === "set") {
    return { ...current, [mutation.colonKey]: mutation.model };
  }
  // op === "delete-pi-oven": remove all /^pi-oven:/ keys
  const result: Record<string, string> = {};
  for (const [k, v] of Object.entries(current)) {
    if (!k.startsWith("pi-oven:")) {
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
 * GRACEFUL read for the DISPLAY path only (status). Returns {} on any error/absent.
 * MUST NOT be used by write paths (set/delete).
 */
export async function readAgentModelOverrides(
  opts?: ConfigYmlOpts
): Promise<Record<string, string>> {
  const result = await readOverridesStrict(opts);
  if (!result.ok) {
    return {};
  }
  return result.record;
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
 * SET one override: readOverridesStrict → if !ok ABORT(throw) → mergeOverrideRecord(set)
 * → `omp config set task.agentModelOverrides '<whole-merged-json>'`.
 * colonKey MUST start with "pi-oven:". Throws on non-pi-oven colonKey, strict-read !ok, or set non-zero exit.
 */
export async function setAgentModelOverride(
  colonKey: string,
  model: string,
  opts?: ConfigYmlOpts
): Promise<void> {
  if (!colonKey.startsWith("pi-oven:")) {
    throw new Error(`setAgentModelOverride: colonKey must start with "pi-oven:", got: ${colonKey}`);
  }

  const readResult = await readOverridesStrict(opts);
  if (!readResult.ok) {
    throw new Error(`setAgentModelOverride: readOverridesStrict failed — ${readResult.error}`);
  }

  const merged = mergeOverrideRecord(readResult.record, {
    op: "set",
    colonKey,
    model,
  });

  const spawn = opts?.spawnFn ?? defaultSpawn;
  const setResult = spawn("omp", [
    "config",
    "set",
    "task.agentModelOverrides",
    JSON.stringify(merged),
  ]);

  if (setResult.exitCode !== 0) {
    throw new Error(
      `setAgentModelOverride: omp config set failed (exit ${String(setResult.exitCode)}): ${setResult.stderr?.toString() ?? ""}`
    );
  }
}

// ---------------------------------------------------------------------------
// setAgentModelOverrides — bulk WRITE path (Profile C only)
// ---------------------------------------------------------------------------

/**
 * Bulk-set multiple task.agentModelOverrides entries atomically: ONE read →
 * merge all provided pi-oven:* entries into the existing record (overwriting
 * those roles, preserving all non-pi-oven:* keys and any pi-oven:* keys NOT
 * in `record`) → ONE `omp config set task.agentModelOverrides '<merged-json>'`.
 * Every key in `record` MUST start with "pi-oven:". Throws on any non-pi-oven
 * key, strict-read failure, or non-zero set exit.
 */
export async function setAgentModelOverrides(
  record: Record<string, string>,
  opts?: ConfigYmlOpts
): Promise<void> {
  for (const key of Object.keys(record)) {
    if (!key.startsWith("pi-oven:")) {
      throw new Error(`setAgentModelOverrides: every key must start with "pi-oven:", got: ${key}`);
    }
  }

  const readResult = await readOverridesStrict(opts);
  if (!readResult.ok) {
    throw new Error(`setAgentModelOverrides: readOverridesStrict failed — ${readResult.error}`);
  }

  const merged = { ...readResult.record, ...record };

  const spawn = opts?.spawnFn ?? defaultSpawn;
  const setResult = spawn("omp", [
    "config",
    "set",
    "task.agentModelOverrides",
    JSON.stringify(merged),
  ]);

  if (setResult.exitCode !== 0) {
    throw new Error(
      `setAgentModelOverrides: omp config set failed (exit ${String(setResult.exitCode)}): ${setResult.stderr?.toString() ?? ""}`
    );
  }
}

// ---------------------------------------------------------------------------
// deletePiOvenAgentModelOverrides — WRITE path
// ---------------------------------------------------------------------------

/**
 * DELETE all /^pi-oven:/ keys: readOverridesStrict → if !ok ABORT(throw) → mergeOverrideRecord(delete-pi-oven)
 * → `omp config set task.agentModelOverrides '<whole-merged-json>'`.
 * Returns the sorted list of removed colon keys. Preserves non-pi-oven:* keys.
 */
export async function deletePiOvenAgentModelOverrides(
  opts?: ConfigYmlOpts
): Promise<string[]> {
  const readResult = await readOverridesStrict(opts);
  if (!readResult.ok) {
    throw new Error(`deletePiOvenAgentModelOverrides: readOverridesStrict failed — ${readResult.error}`);
  }

  const current = readResult.record;
  const removedKeys = Object.keys(current)
    .filter((k) => k.startsWith("pi-oven:"))
    .sort();

  // No-op: nothing to remove, skip the set call entirely
  if (removedKeys.length === 0) {
    return removedKeys;
  }

  const merged = mergeOverrideRecord(current, { op: "delete-pi-oven" });

  const spawn = opts?.spawnFn ?? defaultSpawn;
  const setResult = spawn("omp", [
    "config",
    "set",
    "task.agentModelOverrides",
    JSON.stringify(merged),
  ]);

  if (setResult.exitCode !== 0) {
    throw new Error(
      `deletePiOvenAgentModelOverrides: omp config set failed (exit ${String(setResult.exitCode)}): ${setResult.stderr?.toString() ?? ""}`
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
 * removes omp's default subagent LSP gate. Worker breadth is intentionally NOT
 * stored here; the pi-oven-owned launcher (`scripts/pi-oven-team/index.ts` →
 * `runtime-v2.ts`) resolves `.pi-oven/config.json` and enforces
 * `nativeWorkers.maxWorkers` itself, so setup/status can tell the truth without
 * claiming omp-core scheduling control. Scalar keys → individual
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
// skills.ignoredSkills (ARRAY) — opt-in sibling-skill suppression (§3.4).
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
