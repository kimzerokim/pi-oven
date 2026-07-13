import {
  GateStateStore,
  createDefaultFsmState,
  isTemporaryCredentialWindowActive,
  isValidFsmState,
  type FsmState,
  type FsmStateView,
} from "./gate-state";
import {
  RunLedgerError,
  type EffectCompletion,
  type EffectIntent,
  type EffectReceipt,
  type Lease,
  type ResumeDecision,
  type RunLedger,
} from "./run-ledger";

export type GateStateReadSource = "json" | "ledger";
export type GateStateWriteTarget = "json" | "shadow" | "ledger";

export interface GateStateLedgerAdapterOptions {
  runId: string;
  ownerId: string;
  repoRoot: string;
  branch: string;
  readSource: GateStateReadSource;
  writeTarget: GateStateWriteTarget;
  /** One-release compatibility escape hatch when ledger-primary has no valid snapshot. */
  jsonFallbackRead?: boolean;
  leaseTtlMs?: number;
  contractVersion?: number;
  closeLedger?: boolean;
}

export interface GateStateEquivalence {
  equivalent: boolean;
  reason: "equivalent" | "json-absent" | "ledger-absent" | "json-corrupt" | "ledger-corrupt" | "diverged";
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

/**
 * Migration adapter around the existing JSON store. It intentionally keeps
 * branch-contract and consent files on their established JSON paths while the
 * autonomous FSM snapshot moves behind the fenced ledger.
 */
export class GateStateLedgerAdapter extends GateStateStore {
  private lease: Lease;
  private ledgerWriteChain: Promise<unknown> = Promise.resolve();
  private closed = false;
  private readonly ttlMs: number;

  constructor(
    root: string,
    private readonly ledger: RunLedger,
    private readonly options: GateStateLedgerAdapterOptions
  ) {
    super(root);
    if (!options.runId || !options.ownerId) throw new TypeError("gate ledger runId and ownerId are required");
    this.ttlMs = options.leaseTtlMs ?? 30_000;
    this.ledger.beginRun({
      runId: options.runId,
      repoRoot: options.repoRoot,
      branch: options.branch,
      contractVersion: options.contractVersion,
    });
    this.lease = this.ledger.acquireLease(options.runId, options.ownerId, this.ttlMs);
  }

  override async readState(): Promise<FsmStateView> {
    if (this.options.readSource === "json") return super.readState();
    const ledgerView = this.readLedgerState();
    if (ledgerView.kind === "OK" || !this.options.jsonFallbackRead) return ledgerView;
    return super.readState();
  }

  override async writeState(state: FsmState): Promise<void> {
    if (!isValidFsmState(state)) throw new TypeError("refusing invalid gate state snapshot");
    this.assertOpen();
    const writesLedger =
      this.options.writeTarget === "ledger" || this.options.writeTarget === "shadow";
    // Fence before touching either copy. Otherwise a stale shadow writer could
    // mutate JSON first and only then discover that its ledger token is stale.
    if (writesLedger) this.refreshLease();
    if (this.options.writeTarget === "json" || this.options.writeTarget === "shadow") {
      await super.writeState(state);
    }
    if (writesLedger) {
      this.ledger.writeGateState(this.options.runId, state, this.lease);
    }
  }

  override async mutate(updater: (current: FsmState) => FsmState): Promise<void> {
    return this.runExclusive(async () => {
      const view = await this.readState();
      const current = view.kind === "OK" ? view.state : createDefaultFsmState();
      await this.writeState(updater(current));
    });
  }

  override async runExclusive<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.ledgerWriteChain.then(fn);
    this.ledgerWriteChain = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  }

  override async consumeExternalExecConsent(
    expectedSourceMessageId: string
  ): Promise<"consumed" | "missing" | "source-message-mismatch"> {
    const view = await this.readState();
    if (view.kind !== "OK" || view.state.externalExecConsent === undefined) return "missing";
    const current = view.state.externalExecConsent;
    if (current.sourceMessageId !== expectedSourceMessageId) return "source-message-mismatch";
    if (current.tempCredentials && isTemporaryCredentialWindowActive(current.tempCredentials)) {
      return "consumed";
    }
    const remainingUses = current.remainingUses - 1;
    await this.writeState({
      ...view.state,
      version: view.state.version + 1,
      externalExecConsent:
        remainingUses > 0 ? { ...current, remainingUses } : undefined,
      consumedExternalExecConsentMessageId:
        remainingUses > 0 ? view.state.consumedExternalExecConsentMessageId : current.sourceMessageId,
    });
    return "consumed";
  }

  async inspectEquivalence(): Promise<GateStateEquivalence> {
    const json = await super.readState();
    const ledger = this.readLedgerState();
    if (json.kind === "ABSENT") return { equivalent: false, reason: "json-absent" };
    if (json.kind === "CORRUPT") return { equivalent: false, reason: "json-corrupt" };
    if (ledger.kind === "ABSENT") return { equivalent: false, reason: "ledger-absent" };
    if (ledger.kind === "CORRUPT") return { equivalent: false, reason: "ledger-corrupt" };
    return canonical(json.state) === canonical(ledger.state)
      ? { equivalent: true, reason: "equivalent" }
      : { equivalent: false, reason: "diverged" };
  }

  beginEffect(intent: Omit<EffectIntent, "runId">): EffectReceipt {
    this.refreshLease();
    return this.ledger.beginEffect({ ...intent, runId: this.options.runId }, this.lease);
  }

  completeEffect(completion: Omit<EffectCompletion, "runId">): void {
    this.refreshLease();
    this.ledger.completeEffect({ ...completion, runId: this.options.runId }, this.lease);
  }

  markEffectAmbiguous(idempotencyKey: string, detail?: unknown): void {
    this.refreshLease();
    this.ledger.markEffectAmbiguous(this.options.runId, idempotencyKey, this.lease, detail);
  }

  readEffect(idempotencyKey: string): EffectReceipt | undefined {
    return this.ledger.readEffect(this.options.runId, idempotencyKey);
  }

  loadResume(): ResumeDecision {
    this.refreshLease();
    return this.ledger.loadResume(this.options.runId, this.lease);
  }

  ledgerHealth() {
    return this.ledger.health();
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    try {
      this.ledger.releaseLease(this.options.runId, this.lease);
    } catch (error) {
      if (!(error instanceof RunLedgerError)) throw error;
    } finally {
      if (this.options.closeLedger !== false) this.ledger.close();
    }
  }

  private readLedgerState(): FsmStateView {
    try {
      const state = this.ledger.readGateState<unknown>(this.options.runId);
      if (state === undefined) return { kind: "ABSENT" };
      return isValidFsmState(state)
        ? { kind: "OK", state }
        : { kind: "CORRUPT" };
    } catch {
      return { kind: "CORRUPT" };
    }
  }

  private refreshLease(): void {
    try {
      this.lease = this.ledger.heartbeat(this.options.runId, this.lease);
    } catch (error) {
      if (
        error instanceof RunLedgerError &&
        (error.code === "LEASE_EXPIRED" || error.code === "STALE_FENCE")
      ) {
        this.lease = this.ledger.acquireLease(this.options.runId, this.options.ownerId, this.ttlMs);
        return;
      }
      throw error;
    }
  }

  private assertOpen(): void {
    if (this.closed) throw new Error("gate-state ledger adapter is closed");
  }
}
