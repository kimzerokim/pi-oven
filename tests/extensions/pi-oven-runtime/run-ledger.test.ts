import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync, statSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  SqliteRunLedger,
} from "../../../.omp/extensions/pi-oven-runtime/sqlite-run-ledger";
import { RunLedgerError } from "../../../.omp/extensions/pi-oven-runtime/run-ledger";
import { inspectRunLedgerSurface } from "../../../.omp/extensions/pi-oven-runtime/run-ledger-health";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function fixture(now = 1_000) {
  const root = mkdtempSync(join(tmpdir(), "pi-oven-run-ledger-"));
  roots.push(root);
  let clock = now;
  const path = join(root, "run-ledger.sqlite");
  const ledger = new SqliteRunLedger(path, { now: () => clock });
  ledger.beginRun({ runId: "run-1", repoRoot: root, branch: "main" });
  return { ledger, path, root, tick: (ms: number) => (clock += ms) };
}

describe("SqliteRunLedger leases", () => {
  test("renews the current owner and rejects a stale owner after monotonic-fence takeover", () => {
    const { ledger, tick } = fixture();
    const first = ledger.acquireLease("run-1", "owner-a", 100);
    expect(() => ledger.acquireLease("run-1", "owner-b", 100)).toThrow(/lease held/);
    tick(50);
    const renewed = ledger.heartbeat("run-1", first);
    expect(renewed.fenceToken).toBe(first.fenceToken);
    expect(renewed.expiresAt).toBe(1_150);

    tick(101);
    const takeover = ledger.acquireLease("run-1", "owner-b", 100);
    expect(takeover.fenceToken).toBeGreaterThan(first.fenceToken);
    expect(() =>
      ledger.appendTransition(
        { runId: "run-1", fromState: "running", toState: "blocked" },
        first
      )
    ).toThrow(RunLedgerError);
    ledger.appendTransition(
      { runId: "run-1", fromState: "running", toState: "blocked" },
      takeover
    );
    ledger.releaseLease("run-1", takeover);
    const afterRelease = ledger.acquireLease("run-1", "owner-c", 100);
    expect(afterRelease.fenceToken).toBeGreaterThan(takeover.fenceToken);
    ledger.close();
  });
});

describe("SqliteRunLedger durable configuration", () => {
  test("uses required local WAL pragmas and exposes checkpoint lifecycle", () => {
    const { ledger, path } = fixture();
    const lease = ledger.acquireLease("run-1", "owner", 1_000);
    ledger.beginEffect(
      { runId: "run-1", idempotencyKey: "effect-1", kind: "git-commit", target: "HEAD" },
      lease
    );
    expect(existsSync(`${path}-wal`)).toBe(true);
    expect(ledger.health()).toMatchObject({
      healthy: true,
      journalMode: "wal",
      foreignKeys: true,
      busyTimeoutMs: 5_000,
      integrity: "ok",
      filesystem: "local",
    });
    ledger.checkpoint("TRUNCATE");
    if (existsSync(`${path}-wal`)) expect(statSync(`${path}-wal`).size).toBe(0);
    ledger.close();
  });

  test("refuses suspected network filesystems instead of claiming WAL healthy", () => {
    const root = mkdtempSync(join(tmpdir(), "pi-oven-run-ledger-network-"));
    roots.push(root);
    expect(() =>
      new SqliteRunLedger(join(root, "ledger.sqlite"), { networkFilesystem: true })
    ).toThrow(/verified local filesystem|local filesystem/);
  });

  test("doctor/status health reopens the ledger read-only and reports schema and leases", () => {
    const { ledger, root: projectRoot } = fixture();
    ledger.acquireLease("run-1", "owner", 1_000);
    ledger.close();
    // The production path is fixed under <project>/.pi-oven/state.
    const expectedPath = join(projectRoot, ".pi-oven", "state", "run-ledger.sqlite");
    const productionLedger = new SqliteRunLedger(expectedPath);
    productionLedger.beginRun({ runId: "health-run", repoRoot: projectRoot, branch: "main" });
    productionLedger.close();
    expect(inspectRunLedgerSurface(projectRoot, "primary")).toMatchObject({
      status: "PASS",
      mode: "primary",
    });
  });
});

describe("SqliteRunLedger effect receipts", () => {
  test("records one intent for an idempotent retry and rejects key reuse for another effect", () => {
    const { ledger } = fixture();
    const lease = ledger.acquireLease("run-1", "owner", 1_000);
    const intent = {
      runId: "run-1",
      idempotencyKey: "commit:abc",
      kind: "git-commit",
      target: "refs/heads/main",
      intent: { tree: "abc" },
    };
    const first = ledger.beginEffect(intent, lease);
    const retry = ledger.beginEffect(intent, lease);
    expect(retry.id).toBe(first.id);
    expect(retry.status).toBe("intent-recorded");
    expect(() =>
      ledger.beginEffect({ ...intent, target: "refs/heads/release" }, lease)
    ).toThrow(RunLedgerError);
    ledger.close();
  });

  test("reopens deterministically and never disguises an unreceipted effect as success or retry", () => {
    const { ledger, path } = fixture();
    const lease = ledger.acquireLease("run-1", "owner-a", 1_000);
    ledger.beginEffect(
      {
        runId: "run-1",
        idempotencyKey: "push:main:abc",
        kind: "git-push",
        target: "origin/main",
        intent: { expectedOid: "abc" },
      },
      lease
    );
    ledger.close();

    const reopened = new SqliteRunLedger(path, { now: () => 2_000 });
    const decision = reopened.loadResume("run-1");
    expect(decision.action).toBe("manual-review");
    expect(decision.effects).toHaveLength(1);
    expect(decision.effects[0]?.status).toBe("ambiguous");
    expect(reopened.loadResume("run-1")).toEqual(decision);
    reopened.close();
  });
});

describe("SqliteRunLedger transitions", () => {
  test("rejects stale-from and terminal transitions without partially appending", () => {
    const { ledger } = fixture();
    const lease = ledger.acquireLease("run-1", "owner", 1_000);
    ledger.appendTransition(
      { runId: "run-1", fromState: "running", toState: "completed" },
      lease
    );
    expect(() =>
      ledger.appendTransition(
        { runId: "run-1", fromState: "running", toState: "blocked" },
        lease
      )
    ).toThrow(RunLedgerError);
    expect(ledger.loadResume("run-1").run.status).toBe("completed");
    ledger.close();
  });
});
