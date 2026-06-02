/**
 * OMP-delegated task.agentModelOverrides read/merge-write/delete helper.
 * Transport: omp config get → in-memory merge → omp config set (whole-record replace).
 * Plan: docs/plans/2026-05-29-pi-oven-setup-option-c-plan.md §Task 1.1
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
// disabledProviders (ARRAY) — the ~/.claude isolation toggle.
// Same transport as the overrides path: omp config get disabledProviders --json
// → in-memory merge → omp config set disabledProviders '<whole-merged-json>'.
// ---------------------------------------------------------------------------

/**
 * The discovery provider pi-oven toggles for the "ignore the ~/.claude
 * Claude-Code layer" isolation: `claude` ONLY (~/.claude CLAUDE.md / skills /
 * hooks / commands). It must NOT disable `claude-plugins`: pi-oven's own
 * `/pi-oven:*` commands and skills register through that same `claude-plugins`
 * discovery provider (it reads ~/.omp/plugins too, not just ~/.claude/plugins),
 * so disabling it would also kill pi-oven's own commands. Trade-off (by design):
 * omc/agentmemory marketplace plugin commands remain visible under omp.
 */
export const PI_OVEN_MANAGED_PROVIDERS = ["claude"] as const;

/**
 * Legacy providers an earlier (buggy, pre-0.1.0) isolate added to
 * `disabledProviders`. They are ALWAYS purged on either toggle to heal those
 * configs: disabling `claude-plugins` removed pi-oven's own `/pi-oven:*` commands, so
 * `--isolate` strips it back out and `--no-isolate` removes it alongside the
 * managed set.
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
 * `claude-plugins` a buggy pre-0.1.0 isolate left behind. Returns the sorted
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
