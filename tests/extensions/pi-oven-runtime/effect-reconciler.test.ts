import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { SqliteRunLedger } from "../../../.omp/extensions/pi-oven-runtime/sqlite-run-ledger";
import {
  reconcileEffect,
  observeGitRef,
} from "../../../.omp/extensions/pi-oven-runtime/effect-reconciler";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "pi-oven-effect-reconciler-"));
  roots.push(root);
  const ledger = new SqliteRunLedger(join(root, "ledger.sqlite"), { now: () => 1_000 });
  ledger.beginRun({ runId: "run-1", repoRoot: root, branch: "main" });
  const lease = ledger.acquireLease("run-1", "owner", 10_000);
  return { ledger, lease };
}

describe("reconcileEffect", () => {
  test("a crash after intent but before execution leaves no invented execution receipt", () => {
    const { ledger, lease } = fixture();
    let executions = 0;
    ledger.beginEffect(
      {
        runId: "run-1",
        idempotencyKey: "commit:not-executed",
        kind: "git-commit",
        target: "HEAD",
      },
      lease
    );
    expect(executions).toBe(0);
    expect(ledger.readEffect("run-1", "commit:not-executed")?.status).toBe("intent-recorded");
    expect(ledger.loadResume("run-1")).toMatchObject({
      action: "manual-review",
      effects: [{ status: "ambiguous" }],
    });
    expect(executions).toBe(0);
    ledger.close();
  });

  test("persists intent before execution and completion after it", async () => {
    const { ledger, lease } = fixture();
    const observed: string[] = [];
    const result = await reconcileEffect({
      ledger,
      lease,
      intent: {
        runId: "run-1",
        idempotencyKey: "commit:abc",
        kind: "git-commit",
        target: "HEAD",
      },
      execute: async () => {
        observed.push(ledger.readEffect("run-1", "commit:abc")?.status ?? "missing");
        return { oid: "abc" };
      },
    });
    expect(observed).toEqual(["intent-recorded"]);
    expect(result.status).toBe("completed");
    expect(result.executed).toBe(true);
    expect(ledger.readEffect("run-1", "commit:abc")).toMatchObject({
      status: "completed",
      result: { oid: "abc" },
    });
    ledger.close();
  });

  test("marks an executor crash ambiguous and does not blind-retry on the next call", async () => {
    const { ledger, lease } = fixture();
    let executions = 0;
    const intent = {
      runId: "run-1",
      idempotencyKey: "push:abc",
      kind: "git-push",
      target: "origin/main",
    };
    const crashed = await reconcileEffect({
      ledger,
      lease,
      intent,
      execute: async () => {
        executions++;
        throw new Error("connection dropped after server accepted push");
      },
    });
    expect(crashed.status).toBe("ambiguous");
    expect(crashed.receipt.status).toBe("ambiguous");

    const retried = await reconcileEffect({
      ledger,
      lease,
      intent,
      execute: async () => {
        executions++;
        return "should-not-run";
      },
    });
    expect(retried.status).toBe("ambiguous");
    expect(retried.executed).toBe(false);
    expect(executions).toBe(1);
    ledger.close();
  });

  test("uses live observation to complete or safely retry an ambiguous effect", async () => {
    const { ledger, lease } = fixture();
    const appliedIntent = {
      runId: "run-1",
      idempotencyKey: "commit:applied",
      kind: "git-commit",
      target: "HEAD",
    };
    ledger.beginEffect(appliedIntent, lease);
    ledger.markEffectAmbiguous("run-1", appliedIntent.idempotencyKey, lease);
    let appliedExecutions = 0;
    const applied = await reconcileEffect({
      ledger,
      lease,
      intent: appliedIntent,
      observe: () => ({ outcome: "applied", result: { oid: "desired" } }),
      execute: () => ++appliedExecutions,
    });
    expect(applied).toMatchObject({ status: "completed", executed: false });
    expect(appliedExecutions).toBe(0);

    const absentIntent = { ...appliedIntent, idempotencyKey: "commit:absent" };
    ledger.beginEffect(absentIntent, lease);
    ledger.markEffectAmbiguous("run-1", absentIntent.idempotencyKey, lease);
    const absent = await reconcileEffect({
      ledger,
      lease,
      intent: absentIntent,
      observe: () => ({ outcome: "not-applied", result: { oid: "before" } }),
      execute: () => ({ oid: "desired" }),
    });
    expect(absent).toMatchObject({ status: "completed", executed: true });
    ledger.close();
  });
});

describe("git ref observation", () => {
  test("only calls a ref applied when live state equals the desired oid", async () => {
    await expect(observeGitRef({ beforeOid: "old", desiredOid: "new", readOid: async () => "new" }))
      .resolves.toEqual({ outcome: "applied", result: { oid: "new" } });
    await expect(observeGitRef({ beforeOid: "old", desiredOid: "new", readOid: async () => "old" }))
      .resolves.toEqual({ outcome: "not-applied", result: { oid: "old" } });
    await expect(observeGitRef({ beforeOid: "old", desiredOid: "new", readOid: async () => "other" }))
      .resolves.toEqual({ outcome: "ambiguous", result: { oid: "other" } });
  });
});
