import { Database } from "bun:sqlite";
import { existsSync, mkdirSync, statfsSync } from "fs";
import { dirname, resolve } from "path";
import { migrateRunLedger } from "./run-ledger-migrations";
import {
  RUN_LEDGER_CONTRACT_VERSION,
  RunLedgerError,
  type BeginRun,
  type EffectCompletion,
  type EffectIntent,
  type EffectReceipt,
  type EffectStatus,
  type LedgerHealth,
  type Lease,
  type ResumeDecision,
  type RunLedger,
  type RunRecord,
  type RunStatus,
  type TransitionInput,
} from "./run-ledger";

export interface SqliteRunLedgerOptions {
  now?: () => number;
  /** Deterministic doctor/test override. True is rejected because WAL is same-host only. */
  networkFilesystem?: boolean;
}

interface RunRow {
  run_id: string;
  repo_root: string;
  branch: string;
  status: RunStatus;
  created_at: number;
  updated_at: number;
  contract_version: number;
}

interface LeaseRow {
  run_id: string;
  owner_id: string;
  fence_token: number;
  heartbeat_at: number;
  expires_at: number;
}

interface EffectRow {
  id: number;
  run_id: string;
  idempotency_key: string;
  kind: string;
  target: string;
  status: EffectStatus;
  intent_json: string | null;
  result_json: string | null;
  created_at: number;
  updated_at: number;
}

const LEGAL_TRANSITIONS: Readonly<Record<RunStatus, readonly RunStatus[]>> = {
  running: ["blocked", "completed", "failed", "cancelled"],
  blocked: ["running", "failed", "cancelled"],
  completed: [],
  failed: [],
  cancelled: [],
};

// Linux statfs magic numbers for the network filesystems where SQLite WAL's
// same-host shared-memory assumptions are not sound. Unknown filesystems are
// reported as local rather than guessed unhealthy.
const NETWORK_FS_MAGIC = new Set([
  0x00006969, // NFS
  0x517b, // SMB
  0xff534d42, // CIFS
  0x5346414f, // AFS
  0x73757245, // Coda
]);

export function detectRunLedgerFilesystem(
  databasePath: string
): "memory" | "local" | "network-suspected" | "unknown" {
  if (databasePath === ":memory:") return "memory";
  let probe = resolve(dirname(databasePath));
  while (!existsSync(probe)) {
    const parent = dirname(probe);
    if (parent === probe) return "unknown";
    probe = parent;
  }
  try {
    const type = Number(statfsSync(probe).type);
    return NETWORK_FS_MAGIC.has(type >>> 0) || NETWORK_FS_MAGIC.has(type)
      ? "network-suspected"
      : "local";
  } catch {
    return "unknown";
  }
}

function encode(value: unknown): string | null {
  return value === undefined ? null : JSON.stringify(value);
}

function decode(value: string | null): unknown {
  return value === null ? undefined : JSON.parse(value);
}

function runFromRow(row: RunRow): RunRecord {
  return {
    runId: row.run_id,
    repoRoot: row.repo_root,
    branch: row.branch,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    contractVersion: row.contract_version,
  };
}

function leaseFromRow(row: LeaseRow): Lease {
  return {
    runId: row.run_id,
    ownerId: row.owner_id,
    fenceToken: row.fence_token,
    heartbeatAt: row.heartbeat_at,
    expiresAt: row.expires_at,
  };
}

function effectFromRow(row: EffectRow): EffectReceipt {
  return {
    id: row.id,
    runId: row.run_id,
    idempotencyKey: row.idempotency_key,
    kind: row.kind,
    target: row.target,
    status: row.status,
    intent: decode(row.intent_json),
    result: decode(row.result_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function assertPositiveTtl(ttlMs: number): void {
  if (!Number.isSafeInteger(ttlMs) || ttlMs <= 0) {
    throw new RangeError("lease ttlMs must be a positive safe integer");
  }
}

export class SqliteRunLedger implements RunLedger {
  private readonly db: Database;
  private readonly now: () => number;
  private readonly filesystem: "memory" | "local";
  readonly databasePath: string;

  constructor(databasePath: string, options: SqliteRunLedgerOptions = {}) {
    this.databasePath = databasePath;
    this.now = options.now ?? Date.now;
    const detectedFilesystem = options.networkFilesystem === undefined
      ? detectRunLedgerFilesystem(databasePath)
      : options.networkFilesystem
        ? "network-suspected"
        : databasePath === ":memory:" ? "memory" : "local";
    if (detectedFilesystem === "network-suspected" || detectedFilesystem === "unknown") {
      throw new RunLedgerError(
        `run ledger WAL requires a verified local filesystem (${detectedFilesystem}): ${databasePath}`,
        "NETWORK_FILESYSTEM"
      );
    }
    this.filesystem = detectedFilesystem;
    if (databasePath !== ":memory:") mkdirSync(dirname(databasePath), { recursive: true });
    this.db = new Database(databasePath, { create: true, readwrite: true, strict: true });
    this.db.run("PRAGMA foreign_keys=ON");
    this.db.run("PRAGMA busy_timeout=5000");
    this.db.run("PRAGMA synchronous=FULL");
    const journal = this.db.query<{ journal_mode: string }, []>("PRAGMA journal_mode=WAL").get();
    if (databasePath !== ":memory:" && journal?.journal_mode.toLowerCase() !== "wal") {
      this.db.close();
      throw new Error(`run ledger failed to enable WAL at ${databasePath}`);
    }
    migrateRunLedger(this.db, this.now);
  }

  beginRun(input: BeginRun): RunRecord {
    if (!input.runId || !input.repoRoot || !input.branch) {
      throw new TypeError("runId, repoRoot, and branch are required");
    }
    const now = this.now();
    const existing = this.getRun(input.runId);
    if (existing) {
      if (
        existing.repoRoot === input.repoRoot &&
        existing.branch === input.branch &&
        existing.contractVersion === (input.contractVersion ?? RUN_LEDGER_CONTRACT_VERSION)
      ) {
        return existing;
      }
      throw new RunLedgerError(`run ${input.runId} already exists with another identity`, "RUN_CONFLICT");
    }
    this.db.run(
      `INSERT INTO runs(run_id, repo_root, branch, status, created_at, updated_at, contract_version)
       VALUES (?, ?, ?, 'running', ?, ?, ?)`,
      [
        input.runId,
        input.repoRoot,
        input.branch,
        now,
        now,
        input.contractVersion ?? RUN_LEDGER_CONTRACT_VERSION,
      ]
    );
    return this.requireRun(input.runId);
  }

  acquireLease(runId: string, owner: string, ttlMs: number): Lease {
    assertPositiveTtl(ttlMs);
    if (!owner) throw new TypeError("lease owner is required");
    return this.db.transaction(() => {
      this.requireRun(runId);
      const now = this.now();
      const current = this.getLease(runId);
      if (current && current.expiresAt > now) {
        throw new RunLedgerError(
          `run ${runId} lease held by ${current.ownerId} until ${current.expiresAt}`,
          "LEASE_HELD"
        );
      }
      const fence = this.db
        .query<{ last_fence_token: number }, [string]>(
          "SELECT last_fence_token FROM lease_fences WHERE run_id=?"
        )
        .get(runId)?.last_fence_token ?? 0;
      const nextFence = fence + 1;
      this.db.run(
        `INSERT INTO lease_fences(run_id, last_fence_token) VALUES (?, ?)
         ON CONFLICT(run_id) DO UPDATE SET last_fence_token=excluded.last_fence_token`,
        [runId, nextFence]
      );
      this.db.run(
        `INSERT INTO leases(run_id, owner_id, fence_token, heartbeat_at, expires_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(run_id) DO UPDATE SET
           owner_id=excluded.owner_id,
           fence_token=excluded.fence_token,
           heartbeat_at=excluded.heartbeat_at,
           expires_at=excluded.expires_at`,
        [runId, owner, nextFence, now, now + ttlMs]
      );
      return this.requireLease(runId);
    })();
  }

  heartbeat(runId: string, lease: Lease): Lease {
    const ttlMs = lease.expiresAt - lease.heartbeatAt;
    assertPositiveTtl(ttlMs);
    return this.db.transaction(() => {
      const now = this.now();
      this.assertLease(runId, lease, now);
      this.db.run(
        "UPDATE leases SET heartbeat_at=?, expires_at=? WHERE run_id=? AND fence_token=? AND owner_id=?",
        [now, now + ttlMs, runId, lease.fenceToken, lease.ownerId]
      );
      return this.requireLease(runId);
    })();
  }

  appendTransition(input: TransitionInput, lease: Lease): void {
    this.db.transaction(() => {
      const now = this.now();
      this.assertLease(input.runId, lease, now);
      const run = this.requireRun(input.runId);
      if (
        run.status !== input.fromState ||
        !LEGAL_TRANSITIONS[input.fromState].includes(input.toState)
      ) {
        throw new RunLedgerError(
          `invalid run transition ${input.fromState} -> ${input.toState}; current=${run.status}`,
          "INVALID_TRANSITION"
        );
      }
      this.db.run(
        `INSERT INTO transitions(run_id, from_state, to_state, payload_json, created_at)
         VALUES (?, ?, ?, ?, ?)`,
        [input.runId, input.fromState, input.toState, encode(input.payload), now]
      );
      this.db.run("UPDATE runs SET status=?, updated_at=? WHERE run_id=?", [input.toState, now, input.runId]);
    })();
  }

  beginEffect(input: EffectIntent, lease: Lease): EffectReceipt {
    if (!input.idempotencyKey || !input.kind || !input.target) {
      throw new TypeError("effect idempotencyKey, kind, and target are required");
    }
    return this.db.transaction(() => {
      const now = this.now();
      this.assertLease(input.runId, lease, now);
      const existing = this.findEffect(input.idempotencyKey);
      if (existing) {
        const same =
          existing.runId === input.runId &&
          existing.kind === input.kind &&
          existing.target === input.target &&
          encode(existing.intent) === encode(input.intent);
        if (!same) {
          throw new RunLedgerError(
            `idempotency key ${input.idempotencyKey} belongs to another logical effect`,
            "EFFECT_CONFLICT"
          );
        }
        return existing;
      }
      this.db.run(
        `INSERT INTO effects(
           run_id, idempotency_key, kind, target, status, intent_json, result_json, created_at, updated_at
         ) VALUES (?, ?, ?, ?, 'intent-recorded', ?, NULL, ?, ?)`,
        [
          input.runId,
          input.idempotencyKey,
          input.kind,
          input.target,
          encode(input.intent),
          now,
          now,
        ]
      );
      return this.requireEffect(input.idempotencyKey);
    })();
  }

  completeEffect(input: EffectCompletion, lease: Lease): void {
    this.db.transaction(() => {
      const now = this.now();
      this.assertLease(input.runId, lease, now);
      const effect = this.requireEffect(input.idempotencyKey);
      if (effect.runId !== input.runId) {
        throw new RunLedgerError("effect does not belong to run", "EFFECT_CONFLICT");
      }
      if (effect.status === input.status && encode(effect.result) === encode(input.result)) return;
      if (effect.status !== "intent-recorded" && effect.status !== "ambiguous") {
        throw new RunLedgerError(
          `effect ${input.idempotencyKey} is already ${effect.status}`,
          "EFFECT_STATE"
        );
      }
      this.db.run(
        "UPDATE effects SET status=?, result_json=?, updated_at=? WHERE idempotency_key=?",
        [input.status, encode(input.result), now, input.idempotencyKey]
      );
    })();
  }

  markEffectAmbiguous(runId: string, idempotencyKey: string, lease: Lease, detail?: unknown): void {
    this.db.transaction(() => {
      const now = this.now();
      this.assertLease(runId, lease, now);
      const effect = this.requireEffect(idempotencyKey);
      if (effect.runId !== runId) throw new RunLedgerError("effect does not belong to run", "EFFECT_CONFLICT");
      if (effect.status === "ambiguous") return;
      if (effect.status !== "intent-recorded") {
        throw new RunLedgerError(`effect ${idempotencyKey} is already ${effect.status}`, "EFFECT_STATE");
      }
      this.db.run(
        "UPDATE effects SET status='ambiguous', result_json=?, updated_at=? WHERE idempotency_key=?",
        [encode(detail), now, idempotencyKey]
      );
    })();
  }

  loadResume(runId: string, lease?: Lease): ResumeDecision {
    return this.db.transaction((): ResumeDecision => {
      const run = this.requireRun(runId);
      const now = this.now();
      // An open intent surviving process recovery has no durable proof whether
      // execution happened. A lease-owning recovery path persists ambiguity;
      // a diagnostic caller receives the same conservative decision without
      // performing an unfenced write.
      if (lease) {
        this.assertLease(runId, lease, now);
        this.db.run(
          `UPDATE effects SET status='ambiguous', updated_at=?
           WHERE run_id=? AND status='intent-recorded'`,
          [now, runId]
        );
      }
      const effects = this.listEffects(runId).map((effect) =>
        !lease && effect.status === "intent-recorded"
          ? { ...effect, status: "ambiguous" as const, updatedAt: now }
          : effect
      );
      if (effects.some((effect) => effect.status === "ambiguous" || effect.status === "manual-review")) {
        return {
          run,
          action: "manual-review",
          effects,
          reason: "unreconciled external effect requires observation before retry",
        };
      }
      if (["completed", "failed", "cancelled"].includes(run.status)) {
        return { run, action: "terminal", effects, reason: `run is ${run.status}` };
      }
      return { run, action: "resume", effects, reason: `run may resume from ${run.status}` };
    })();
  }

  releaseLease(runId: string, lease: Lease): void {
    this.db.transaction(() => {
      this.assertLease(runId, lease, this.now());
      this.db.run(
        "DELETE FROM leases WHERE run_id=? AND owner_id=? AND fence_token=?",
        [runId, lease.ownerId, lease.fenceToken]
      );
    })();
  }

  readEffect(runId: string, idempotencyKey: string): EffectReceipt | undefined {
    const effect = this.findEffect(idempotencyKey);
    return effect?.runId === runId ? effect : undefined;
  }

  writeGateState(runId: string, state: unknown, lease: Lease): void {
    this.db.transaction(() => {
      const now = this.now();
      this.assertLease(runId, lease, now);
      this.db.run(
        `INSERT INTO gate_state(run_id, state_json, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(run_id) DO UPDATE SET state_json=excluded.state_json, updated_at=excluded.updated_at`,
        [runId, JSON.stringify(state), now]
      );
    })();
  }

  readGateState<T>(runId: string): T | undefined {
    const row = this.db
      .query<{ state_json: string }, [string]>("SELECT state_json FROM gate_state WHERE run_id=?")
      .get(runId);
    return row ? JSON.parse(row.state_json) as T : undefined;
  }

  health(): LedgerHealth {
    const journalMode = this.db.query<{ journal_mode: string }, []>("PRAGMA journal_mode").get()?.journal_mode ?? "unknown";
    const foreignKeys = (this.db.query<{ foreign_keys: number }, []>("PRAGMA foreign_keys").get()?.foreign_keys ?? 0) === 1;
    const timeout = this.db.query<{ timeout: number }, []>("PRAGMA busy_timeout").get()?.timeout ?? 0;
    const synchronousValue = this.db.query<{ synchronous: number }, []>("PRAGMA synchronous").get()?.synchronous ?? -1;
    const synchronous = ["OFF", "NORMAL", "FULL", "EXTRA"][synchronousValue] ?? String(synchronousValue);
    const integrity = this.db.query<{ integrity_check: string }, []>("PRAGMA integrity_check").get()?.integrity_check ?? "unknown";
    const now = this.now();
    const counts = this.db.query<{ active: number; stale: number }, [number, number]>(
      `SELECT
         COALESCE(SUM(CASE WHEN expires_at > ? THEN 1 ELSE 0 END), 0) AS active,
         COALESCE(SUM(CASE WHEN expires_at <= ? THEN 1 ELSE 0 END), 0) AS stale
       FROM leases`
    ).get(now, now) ?? { active: 0, stale: 0 };
    const healthy =
      integrity === "ok" &&
      foreignKeys &&
      timeout === 5_000 &&
      synchronous === "FULL" &&
      (this.filesystem === "memory" || journalMode.toLowerCase() === "wal");
    return {
      healthy,
      databasePath: this.databasePath,
      journalMode: journalMode.toLowerCase(),
      foreignKeys,
      synchronous,
      busyTimeoutMs: timeout,
      integrity,
      filesystem: this.filesystem,
      activeLeases: counts.active,
      staleLeases: counts.stale,
      detail: healthy
        ? `SQLite ${journalMode.toUpperCase()} ledger healthy; ${counts.active} active / ${counts.stale} stale leases`
        : `SQLite ledger unhealthy: journal=${journalMode}, integrity=${integrity}, filesystem=${this.filesystem}`,
    };
  }

  checkpoint(mode: "PASSIVE" | "FULL" | "RESTART" | "TRUNCATE" = "PASSIVE"): void {
    this.db.run(`PRAGMA wal_checkpoint(${mode})`);
  }

  close(): void {
    this.db.close();
  }

  private getRun(runId: string): RunRecord | undefined {
    const row = this.db.query<RunRow, [string]>("SELECT * FROM runs WHERE run_id=?").get(runId);
    return row ? runFromRow(row) : undefined;
  }

  private requireRun(runId: string): RunRecord {
    const run = this.getRun(runId);
    if (!run) throw new RunLedgerError(`run ${runId} not found`, "RUN_NOT_FOUND");
    return run;
  }

  private getLease(runId: string): Lease | undefined {
    const row = this.db.query<LeaseRow, [string]>("SELECT * FROM leases WHERE run_id=?").get(runId);
    return row ? leaseFromRow(row) : undefined;
  }

  private requireLease(runId: string): Lease {
    const lease = this.getLease(runId);
    if (!lease) throw new RunLedgerError(`run ${runId} has no lease`, "STALE_FENCE");
    return lease;
  }

  private assertLease(runId: string, presented: Lease, now: number): Lease {
    const current = this.getLease(runId);
    if (
      !current ||
      presented.runId !== runId ||
      current.ownerId !== presented.ownerId ||
      current.fenceToken !== presented.fenceToken
    ) {
      throw new RunLedgerError(`stale fence for run ${runId}`, "STALE_FENCE");
    }
    if (current.expiresAt <= now) {
      throw new RunLedgerError(`lease for run ${runId} expired at ${current.expiresAt}`, "LEASE_EXPIRED");
    }
    return current;
  }

  private findEffect(idempotencyKey: string): EffectReceipt | undefined {
    const row = this.db
      .query<EffectRow, [string]>("SELECT * FROM effects WHERE idempotency_key=?")
      .get(idempotencyKey);
    return row ? effectFromRow(row) : undefined;
  }

  private requireEffect(idempotencyKey: string): EffectReceipt {
    const effect = this.findEffect(idempotencyKey);
    if (!effect) throw new RunLedgerError(`effect ${idempotencyKey} not found`, "EFFECT_STATE");
    return effect;
  }

  private listEffects(runId: string): EffectReceipt[] {
    return this.db
      .query<EffectRow, [string]>("SELECT * FROM effects WHERE run_id=? ORDER BY id")
      .all(runId)
      .map(effectFromRow);
  }
}
