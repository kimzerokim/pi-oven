import { createHash, randomUUID } from "node:crypto";
import { constants, promises as fs } from "node:fs";
import { join } from "node:path";
import {
  atomicReplaceFile,
  readTextFileSnapshot,
  restoreTextFileSnapshot,
} from "../lib/atomic-file";
import { resolveHomePaths } from "../lib/home-paths";
import {
  readConfigSnapshotStrict,
  writeConfigSnapshot,
  type ConfigYmlOpts,
} from "./config-yml";

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export interface AbsentSnapshot {
  absent: true;
}
export type SetupTransactionSnapshot = JsonValue | AbsentSnapshot;

export const ABSENT: AbsentSnapshot = Object.freeze({ absent: true });

export function resetConfigSnapshot(expected: JsonValue): SetupTransactionSnapshot {
  return { resetToDefault: true, expected };
}

export type SetupTransactionPhase =
  | "prepared"
  | "applying"
  | "validating"
  | "committed"
  | "rolling_back"
  | "rollback_failed";

export interface SetupTransactionJournal {
  schemaVersion: 1;
  txnId: string;
  scope: "project" | "global";
  operation: "apply" | "reset";
  phase: SetupTransactionPhase;
  desiredHash: string;
  originals: Record<string, SetupTransactionSnapshot>;
  completedSteps: string[];
  /** Serialized desired values make crash recovery and rollback CAS possible. */
  desired: Record<string, SetupTransactionSnapshot>;
  receipt?: { resource: string; value: SetupTransactionSnapshot };
}

export interface SetupTransactionResourceAdapter {
  read(resource: string): Promise<SetupTransactionSnapshot>;
  write(resource: string, value: SetupTransactionSnapshot): Promise<void>;
}

export function createSetupTransactionResourceAdapter(
  options: ConfigYmlOpts = {}
): SetupTransactionResourceAdapter {
  return {
    read: async (resource) => {
      if (resource.startsWith("config:")) {
        return readConfigSnapshotStrict(resource.slice("config:".length), options);
      }
      if (resource.startsWith("file:")) {
        return readTextFileSnapshot(resource.slice("file:".length));
      }
      throw new Error(`Unknown setup transaction resource: ${resource}`);
    },
    write: async (resource, value) => {
      if (resource.startsWith("config:")) {
        await writeConfigSnapshot(resource.slice("config:".length), value, options);
        return;
      }
      if (resource.startsWith("file:")) {
        const snapshot = isAbsentSnapshot(value)
          ? value
          : typeof value === "object" && value !== null && !Array.isArray(value) &&
              typeof (value as { content?: unknown }).content === "string"
            ? { content: (value as { content: string }).content }
            : null;
        if (!snapshot) throw new Error(`Invalid file snapshot for ${resource}`);
        await restoreTextFileSnapshot(resource.slice("file:".length), snapshot);
        return;
      }
      throw new Error(`Unknown setup transaction resource: ${resource}`);
    },
  };
}

export type SetupTransactionFaultPoint =
  | "journal_write"
  | "validation"
  | "receipt_write"
  | `forward:${string}`
  | `compensation:${string}`;

export interface ApplySetupTransactionOptions {
  scope: "project" | "global";
  operation: "apply" | "reset";
  stateDir: string;
  adapter: SetupTransactionResourceAdapter;
  desired: Record<string, SetupTransactionSnapshot>;
  /** Optional already-read snapshots, used by strict single-read file merges. */
  originals?: Record<string, SetupTransactionSnapshot>;
  receipt?: { resource: string; value: SetupTransactionSnapshot };
  validate?: () => Promise<{ ok: true } | { ok: false; error: string }>;
  fault?: (point: SetupTransactionFaultPoint) => void | Promise<void>;
}

export interface RecoverSetupTransactionsOptions {
  stateDir: string;
  adapter: SetupTransactionResourceAdapter;
  fault?: (point: SetupTransactionFaultPoint) => void | Promise<void>;
}

export interface SetupTransactionResult {
  txnId: string;
  desiredHash: string;
  phase: "committed";
}

export type SetupTransactionRecoveryResult =
  | { state: "none" | "committed" | "recovered" }
  | { state: "rollback_failed"; manualRecoveryPath: string };

export type SetupTransactionHealth =
  | { state: "healthy" }
  | { state: "recovery_needed"; phase: SetupTransactionPhase; txnId: string }
  | { state: "rollback_failed"; txnId: string; manualRecoveryPath: string }
  | { state: "corrupt"; error: string };

export interface SetupTransactionScopeHealth {
  scope: "project" | "global";
  stateDir: string;
  health: SetupTransactionHealth;
  recovered: boolean;
}

export class SetupTransactionLockedError extends Error {
  constructor(readonly lockPath: string) {
    super(`Another setup transaction owns ${lockPath}`);
    this.name = "SetupTransactionLockedError";
  }
}

export class SetupTransactionRollbackError extends Error {
  constructor(message: string, readonly manualRecoveryPath: string) {
    super(message);
    this.name = "SetupTransactionRollbackError";
  }
}

const JOURNAL_FILE = "setup-transaction.json";
const LOCK_FILE = "setup-transaction.lock";
const MANUAL_FILE = "setup-transaction.manual-recovery.json";

export function resolveSetupTransactionStateDir(options: {
  scope: "project" | "global";
  cwd?: string;
  homeDir?: string;
}): string {
  const root = options.scope === "project"
    ? options.cwd ?? process.cwd()
    : options.homeDir ?? resolveHomePaths().homeDir;
  return join(root, ".pi-oven", "state", "setup-transactions", options.scope);
}

function journalPath(stateDir: string): string {
  return join(stateDir, JOURNAL_FILE);
}

export function setupTransactionPaths(stateDir: string): {
  journal: string;
  lock: string;
  manualRecovery: string;
} {
  return {
    journal: journalPath(stateDir),
    lock: join(stateDir, LOCK_FILE),
    manualRecovery: join(stateDir, MANUAL_FILE),
  };
}

export function isAbsentSnapshot(value: SetupTransactionSnapshot): value is AbsentSnapshot {
  return typeof value === "object" && value !== null && !Array.isArray(value) && value.absent === true;
}

function canonical(value: unknown): string {
  if (
    typeof value === "object" && value !== null && !Array.isArray(value) &&
    (value as { resetToDefault?: unknown }).resetToDefault === true &&
    "expected" in value
  ) {
    return canonical((value as { expected: unknown }).expected);
  }
  if (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    (value as Partial<AbsentSnapshot>).absent === true &&
    Object.keys(value).length === 1
  ) return '{"absent":true}';
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (typeof value === "object" && value !== null) {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function desiredHash(desired: Record<string, SetupTransactionSnapshot>): string {
  return createHash("sha256").update(canonical(desired)).digest("hex");
}

function snapshotsEqual(a: SetupTransactionSnapshot, b: SetupTransactionSnapshot): boolean {
  return canonical(a) === canonical(b);
}

function isResetToDefaultAction(value: SetupTransactionSnapshot): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    (value as { resetToDefault?: unknown }).resetToDefault === true &&
    "expected" in value
  );
}

async function writeJournal(path: string, journal: SetupTransactionJournal): Promise<void> {
  await atomicReplaceFile(path, `${JSON.stringify(journal, null, 2)}\n`);
}

function isJournal(value: unknown): value is SetupTransactionJournal {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const candidate = value as Partial<SetupTransactionJournal>;
  return (
    candidate.schemaVersion === 1 &&
    typeof candidate.txnId === "string" &&
    (candidate.scope === "project" || candidate.scope === "global") &&
    (candidate.operation === "apply" || candidate.operation === "reset") &&
    typeof candidate.phase === "string" &&
    typeof candidate.desiredHash === "string" &&
    typeof candidate.originals === "object" &&
    candidate.originals !== null &&
    Array.isArray(candidate.completedSteps) &&
    typeof candidate.desired === "object" &&
    candidate.desired !== null
  );
}

async function readJournal(path: string): Promise<SetupTransactionJournal | null> {
  let raw: string;
  try {
    raw = await fs.readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  const parsed: unknown = JSON.parse(raw);
  if (!isJournal(parsed)) throw new Error(`Invalid setup transaction journal: ${path}`);
  return parsed;
}

async function pidIsAlive(pid: number): Promise<boolean> {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

async function acquireLock(stateDir: string): Promise<() => Promise<void>> {
  const { lock } = setupTransactionPaths(stateDir);
  await fs.mkdir(stateDir, { recursive: true });

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const handle = await fs.open(lock, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600);
      await handle.writeFile(`${JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() })}\n`);
      await handle.sync();
      await handle.close();
      return async () => {
        await fs.rm(lock, { force: true });
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      let ownerPid = 0;
      try {
        ownerPid = Number(JSON.parse(await fs.readFile(lock, "utf8")).pid);
      } catch {
        throw new SetupTransactionLockedError(lock);
      }
      if (await pidIsAlive(ownerPid)) throw new SetupTransactionLockedError(lock);
      await fs.rm(lock, { force: true });
    }
  }
  throw new SetupTransactionLockedError(lock);
}

function allDesired(journal: SetupTransactionJournal): Record<string, SetupTransactionSnapshot> {
  return journal.receipt
    ? { ...journal.desired, [journal.receipt.resource]: journal.receipt.value }
    : journal.desired;
}

async function recordManualRecovery(
  path: string,
  journal: SetupTransactionJournal,
  resource: string,
  current: SetupTransactionSnapshot
): Promise<never> {
  journal.phase = "rollback_failed";
  await writeJournal(journalPath(path), journal);
  const manualRecoveryPath = setupTransactionPaths(path).manualRecovery;
  await atomicReplaceFile(
    manualRecoveryPath,
    `${JSON.stringify(
      {
        schemaVersion: 1,
        txnId: journal.txnId,
        resource,
        expectedTransactionValue: allDesired(journal)[resource],
        originalValue: journal.originals[resource],
        currentValue: current,
        action: "Review the concurrent edit and restore or merge the original value manually.",
      },
      null,
      2
    )}\n`
  );
  throw new SetupTransactionRollbackError(
    `Rollback CAS conflict for ${resource}; manual recovery is required`,
    manualRecoveryPath
  );
}

async function rollback(
  stateDir: string,
  journal: SetupTransactionJournal,
  adapter: SetupTransactionResourceAdapter,
  fault?: ApplySetupTransactionOptions["fault"]
): Promise<void> {
  const file = journalPath(stateDir);
  journal.phase = "rolling_back";
  await writeJournal(file, journal);
  const desired = allDesired(journal);

  while (journal.completedSteps.length > 0) {
    const resource = journal.completedSteps.at(-1)!;
    const original = journal.originals[resource]!;
    const current = await adapter.read(resource);
    if (snapshotsEqual(current, desired[resource]!)) {
      try {
        await adapter.write(resource, original);
      } catch (error) {
        await recordManualRecovery(stateDir, journal, resource, current).catch(() => undefined);
        throw error;
      }
      await fault?.(`compensation:${resource}`);
    } else if (!snapshotsEqual(current, original)) {
      await recordManualRecovery(stateDir, journal, resource, current);
    }
    journal.completedSteps.pop();
    await writeJournal(file, journal);
  }

  await fs.rm(file, { force: true });
}

async function recoverWhileLocked(
  options: RecoverSetupTransactionsOptions
): Promise<SetupTransactionRecoveryResult> {
  const paths = setupTransactionPaths(options.stateDir);
  const journal = await readJournal(paths.journal);
  if (!journal) return { state: "none" };
  if (journal.phase === "committed") return { state: "committed" };
  if (journal.phase === "rollback_failed") {
    return { state: "rollback_failed", manualRecoveryPath: paths.manualRecovery };
  }
  await rollback(options.stateDir, journal, options.adapter, options.fault);
  return { state: "recovered" };
}

/** Recover the single non-terminal transaction in a scope before continuing. */
export async function recoverSetupTransactions(
  options: RecoverSetupTransactionsOptions
): Promise<SetupTransactionRecoveryResult> {
  const release = await acquireLock(options.stateDir);
  try {
    return await recoverWhileLocked(options);
  } finally {
    await release();
  }
}

/**
 * Apply a journaled setup/reset saga. Every original is snapshotted before the
 * prepared journal is persisted; every step is journaled before its forward
 * write. Validation and a live desired-state hash precede the success receipt.
 */
export async function applySetupTransaction(
  options: ApplySetupTransactionOptions
): Promise<SetupTransactionResult> {
  const release = await acquireLock(options.stateDir);
  const file = journalPath(options.stateDir);
  try {
    const recovery = await recoverWhileLocked(options);
    if (recovery.state === "rollback_failed") {
      throw new SetupTransactionRollbackError(
        "A previous setup transaction requires manual recovery",
        recovery.manualRecoveryPath
      );
    }

    const originals: Record<string, SetupTransactionSnapshot> = {};
    const resources = [
      ...Object.keys(options.desired),
      ...(options.receipt ? [options.receipt.resource] : []),
    ];
    if (new Set(resources).size !== resources.length) {
      throw new Error("The receipt resource must be distinct from desired resources");
    }
    for (const resource of resources) {
      originals[resource] = options.originals && resource in options.originals
        ? structuredClone(options.originals[resource]!)
        : await options.adapter.read(resource);
    }

    const journal: SetupTransactionJournal = {
      schemaVersion: 1,
      txnId: randomUUID(),
      scope: options.scope,
      operation: options.operation,
      phase: "prepared",
      desiredHash: desiredHash(options.desired),
      originals,
      completedSteps: [],
      desired: structuredClone(options.desired),
      receipt: options.receipt ? structuredClone(options.receipt) : undefined,
    };
    await writeJournal(file, journal);
    try {
      await options.fault?.("journal_write");
    } catch (error) {
      await rollback(options.stateDir, journal, options.adapter, options.fault);
      throw error;
    }

    try {
      journal.phase = "applying";
      await writeJournal(file, journal);
      for (const [resource, value] of Object.entries(options.desired)) {
        if (!isResetToDefaultAction(value) && snapshotsEqual(journal.originals[resource]!, value)) {
          continue;
        }
        journal.completedSteps.push(resource);
        await writeJournal(file, journal);
        await options.adapter.write(resource, value);
        await options.fault?.(`forward:${resource}`);
      }

      journal.phase = "validating";
      await writeJournal(file, journal);
      const validation = await options.validate?.();
      await options.fault?.("validation");
      if (validation && !validation.ok) throw new Error(`Setup validation failed: ${validation.error}`);

      const live: Record<string, SetupTransactionSnapshot> = {};
      for (const resource of Object.keys(options.desired)) live[resource] = await options.adapter.read(resource);
      if (desiredHash(live) !== journal.desiredHash) {
        throw new Error("Live setup state does not match the desired hash");
      }

      if (options.receipt) {
        if (!snapshotsEqual(journal.originals[options.receipt.resource]!, options.receipt.value)) {
          journal.completedSteps.push(options.receipt.resource);
          await writeJournal(file, journal);
          await options.adapter.write(options.receipt.resource, options.receipt.value);
          await options.fault?.("receipt_write");
        }
      }

      journal.phase = "committed";
      await writeJournal(file, journal);
      await fs.rm(setupTransactionPaths(options.stateDir).manualRecovery, { force: true });
      return { txnId: journal.txnId, desiredHash: journal.desiredHash, phase: "committed" };
    } catch (error) {
      await rollback(options.stateDir, journal, options.adapter, options.fault);
      throw error;
    }
  } finally {
    await release();
  }
}

export async function inspectSetupTransaction(stateDir: string): Promise<SetupTransactionHealth> {
  const paths = setupTransactionPaths(stateDir);
  try {
    const journal = await readJournal(paths.journal);
    if (!journal || journal.phase === "committed") return { state: "healthy" };
    if (journal.phase === "rollback_failed") {
      return { state: "rollback_failed", txnId: journal.txnId, manualRecoveryPath: paths.manualRecovery };
    }
    return { state: "recovery_needed", phase: journal.phase, txnId: journal.txnId };
  } catch (error) {
    return { state: "corrupt", error: error instanceof Error ? error.message : String(error) };
  }
}

/** Recover project and global non-terminal journals at setup/status/doctor entry. */
export async function recoverSetupTransactionsOnStartup(options: {
  cwd?: string;
  homeDir?: string;
  spawnFn?: ConfigYmlOpts["spawnFn"];
} = {}): Promise<SetupTransactionScopeHealth[]> {
  const adapter = createSetupTransactionResourceAdapter({ spawnFn: options.spawnFn });
  const scopes = ["project", "global"] as const;
  const result: SetupTransactionScopeHealth[] = [];
  for (const scope of scopes) {
    const stateDir = resolveSetupTransactionStateDir({
      scope,
      cwd: options.cwd,
      homeDir: options.homeDir,
    });
    const before = await inspectSetupTransaction(stateDir);
    let recovered = false;
    if (before.state === "recovery_needed") {
      try {
        const recovery = await recoverSetupTransactions({ stateDir, adapter });
        recovered = recovery.state === "recovered";
      } catch {
        // The post-attempt health below exposes rollback_failed/corrupt state.
      }
    }
    result.push({ scope, stateDir, health: await inspectSetupTransaction(stateDir), recovered });
  }
  return result;
}

export function formatSetupTransactionHealth(
  scopes: readonly SetupTransactionScopeHealth[]
): string[] {
  return scopes.map(({ scope, health, recovered }) => {
    if (recovered) return `Setup transaction (${scope}): RECOVERED — original state restored.`;
    if (health.state === "healthy") return `Setup transaction (${scope}): HEALTHY`;
    if (health.state === "rollback_failed") {
      return `Setup transaction (${scope}): ROLLBACK_FAILED — manual diff: ${health.manualRecoveryPath}`;
    }
    if (health.state === "recovery_needed") {
      return `Setup transaction (${scope}): RECOVERY_NEEDED — ${health.phase} (${health.txnId})`;
    }
    return `Setup transaction (${scope}): CORRUPT — ${health.error}`;
  });
}
