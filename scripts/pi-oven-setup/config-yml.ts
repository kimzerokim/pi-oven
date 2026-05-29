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
