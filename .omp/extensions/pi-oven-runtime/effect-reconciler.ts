import type {
  EffectIntent,
  EffectReceipt,
  Lease,
  RunLedger,
} from "./run-ledger";

export interface EffectObservation {
  outcome: "applied" | "not-applied" | "ambiguous";
  result?: unknown;
}

export interface ReconcileEffectInput<T> {
  ledger: RunLedger;
  lease: Lease;
  intent: EffectIntent;
  execute: () => Promise<T> | T;
  /** Required before an intent surviving a prior attempt may be retried. */
  observe?: () => Promise<EffectObservation> | EffectObservation;
}

export interface EffectReconcileResult {
  status: "completed" | "failed" | "manual-review" | "ambiguous";
  receipt: EffectReceipt;
  executed: boolean;
  reason: string;
}

function errorResult(error: unknown): { error: string } {
  return { error: error instanceof Error ? error.message : String(error) };
}

function currentReceipt(input: ReconcileEffectInput<unknown>): EffectReceipt {
  const receipt = input.ledger.readEffect(input.intent.runId, input.intent.idempotencyKey);
  if (!receipt) throw new Error(`effect receipt disappeared: ${input.intent.idempotencyKey}`);
  return receipt;
}

function resultFromTerminal(receipt: EffectReceipt): EffectReconcileResult {
  const status = receipt.status === "completed"
    ? "completed"
    : receipt.status === "failed"
      ? "failed"
      : receipt.status === "manual-review"
        ? "manual-review"
        : "ambiguous";
  return {
    status,
    receipt,
    executed: false,
    reason: `existing effect receipt is ${receipt.status}`,
  };
}

/**
 * Runs a mutation behind a durable intent. Any pre-existing open intent is
 * treated as possibly executed and must be observed before retrying.
 */
export async function reconcileEffect<T>(
  input: ReconcileEffectInput<T>
): Promise<EffectReconcileResult> {
  const existing = input.ledger.readEffect(input.intent.runId, input.intent.idempotencyKey);
  let shouldExecute = existing === undefined;

  if (existing) {
    if (existing.status !== "intent-recorded" && existing.status !== "ambiguous") {
      return resultFromTerminal(existing);
    }
    if (!input.observe) {
      if (existing.status === "intent-recorded") {
        input.ledger.markEffectAmbiguous(
          input.intent.runId,
          input.intent.idempotencyKey,
          input.lease,
          { reason: "open intent found without an observation receipt" }
        );
      }
      return {
        status: "ambiguous",
        receipt: currentReceipt(input),
        executed: false,
        reason: "existing open intent cannot be retried without observing the target",
      };
    }

    let observation: EffectObservation;
    try {
      observation = await input.observe();
    } catch (error) {
      if (existing.status === "intent-recorded") {
        input.ledger.markEffectAmbiguous(
          input.intent.runId,
          input.intent.idempotencyKey,
          input.lease,
          { reason: "effect observation failed", ...errorResult(error) }
        );
      }
      return {
        status: "ambiguous",
        receipt: currentReceipt(input),
        executed: false,
        reason: "effect target observation failed",
      };
    }

    if (observation.outcome === "applied") {
      input.ledger.completeEffect(
        {
          runId: input.intent.runId,
          idempotencyKey: input.intent.idempotencyKey,
          status: "completed",
          result: observation.result,
        },
        input.lease
      );
      return {
        status: "completed",
        receipt: currentReceipt(input),
        executed: false,
        reason: "live target already matches the intended effect",
      };
    }
    if (observation.outcome === "ambiguous") {
      if (existing.status === "intent-recorded") {
        input.ledger.markEffectAmbiguous(
          input.intent.runId,
          input.intent.idempotencyKey,
          input.lease,
          observation.result
        );
      }
      return {
        status: "ambiguous",
        receipt: currentReceipt(input),
        executed: false,
        reason: "live target diverged from both before and desired state",
      };
    }
    shouldExecute = true;
  }

  if (shouldExecute && !existing) input.ledger.beginEffect(input.intent, input.lease);

  try {
    const result = await input.execute();
    input.ledger.completeEffect(
      {
        runId: input.intent.runId,
        idempotencyKey: input.intent.idempotencyKey,
        status: "completed",
        result,
      },
      input.lease
    );
    return {
      status: "completed",
      receipt: currentReceipt(input),
      executed: true,
      reason: existing
        ? "observation proved the prior attempt was not applied; retry completed"
        : "intent, execution, and completion were durably ordered",
    };
  } catch (error) {
    // The executor may have mutated the outside world before throwing. There
    // is no safe generic distinction, so preserve ambiguity for observation.
    const receipt = currentReceipt(input);
    if (receipt.status === "intent-recorded") {
      input.ledger.markEffectAmbiguous(
        input.intent.runId,
        input.intent.idempotencyKey,
        input.lease,
        { reason: "executor failed after durable intent", ...errorResult(error) }
      );
    }
    return {
      status: "ambiguous",
      receipt: currentReceipt(input),
      executed: true,
      reason: "executor outcome is ambiguous and must be reconciled",
    };
  }
}

export interface GitRefObservationInput {
  beforeOid: string | null;
  desiredOid: string | null;
  readOid: () => Promise<string | null> | string | null;
}

/** Compare a live repo/ref receipt to both sides of the intended mutation. */
export async function observeGitRef(input: GitRefObservationInput): Promise<EffectObservation> {
  const oid = await input.readOid();
  if (oid === input.desiredOid) return { outcome: "applied", result: { oid } };
  if (oid === input.beforeOid) return { outcome: "not-applied", result: { oid } };
  return { outcome: "ambiguous", result: { oid } };
}
