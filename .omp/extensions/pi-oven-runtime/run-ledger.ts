export const RUN_LEDGER_CONTRACT_VERSION = 1;

export type RunStatus =
  | "running"
  | "blocked"
  | "completed"
  | "failed"
  | "cancelled";

export interface BeginRun {
  runId: string;
  repoRoot: string;
  branch: string;
  contractVersion?: number;
}

export interface RunRecord {
  runId: string;
  repoRoot: string;
  branch: string;
  status: RunStatus;
  createdAt: number;
  updatedAt: number;
  contractVersion: number;
}

export interface Lease {
  runId: string;
  ownerId: string;
  fenceToken: number;
  heartbeatAt: number;
  expiresAt: number;
}

export interface TransitionInput {
  runId: string;
  fromState: RunStatus;
  toState: RunStatus;
  payload?: unknown;
}

export type EffectStatus =
  | "intent-recorded"
  | "ambiguous"
  | "completed"
  | "failed"
  | "manual-review";

export interface EffectIntent {
  runId: string;
  idempotencyKey: string;
  kind: string;
  target: string;
  intent?: unknown;
}

export interface EffectReceipt {
  id: number;
  runId: string;
  idempotencyKey: string;
  kind: string;
  target: string;
  status: EffectStatus;
  intent: unknown;
  result?: unknown;
  createdAt: number;
  updatedAt: number;
}

export interface EffectCompletion {
  runId: string;
  idempotencyKey: string;
  status: "completed" | "failed" | "manual-review";
  result?: unknown;
}

export interface ResumeDecision {
  run: RunRecord;
  action: "resume" | "manual-review" | "terminal";
  effects: EffectReceipt[];
  reason: string;
}

export interface LedgerHealth {
  healthy: boolean;
  databasePath: string;
  journalMode: string;
  foreignKeys: boolean;
  synchronous: string;
  busyTimeoutMs: number;
  integrity: "ok" | string;
  filesystem: "memory" | "local" | "network-suspected" | "unknown";
  activeLeases: number;
  staleLeases: number;
  detail: string;
}

export interface RunLedger {
  beginRun(input: BeginRun): RunRecord;
  acquireLease(runId: string, owner: string, ttlMs: number): Lease;
  heartbeat(runId: string, lease: Lease): Lease;
  appendTransition(input: TransitionInput, lease: Lease): void;
  beginEffect(input: EffectIntent, lease: Lease): EffectReceipt;
  completeEffect(input: EffectCompletion, lease: Lease): void;
  markEffectAmbiguous(runId: string, idempotencyKey: string, lease: Lease, detail?: unknown): void;
  loadResume(runId: string, lease?: Lease): ResumeDecision;
  releaseLease(runId: string, lease: Lease): void;
  readEffect(runId: string, idempotencyKey: string): EffectReceipt | undefined;
  writeGateState(runId: string, state: unknown, lease: Lease): void;
  readGateState<T>(runId: string): T | undefined;
  health(): LedgerHealth;
  checkpoint(mode?: "PASSIVE" | "FULL" | "RESTART" | "TRUNCATE"): void;
  close(): void;
}

export class RunLedgerError extends Error {
  constructor(
    message: string,
    readonly code:
      | "RUN_NOT_FOUND"
      | "RUN_CONFLICT"
      | "LEASE_HELD"
      | "LEASE_EXPIRED"
      | "STALE_FENCE"
      | "INVALID_TRANSITION"
      | "EFFECT_CONFLICT"
      | "EFFECT_STATE"
      | "NETWORK_FILESYSTEM"
  ) {
    super(message);
    this.name = "RunLedgerError";
  }
}
