import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { GateStateStore, type FsmState } from "../../../.omp/extensions/pi-oven-runtime/gate-state";
import { GateStateLedgerAdapter } from "../../../.omp/extensions/pi-oven-runtime/gate-state-ledger-adapter";
import { SqliteRunLedger } from "../../../.omp/extensions/pi-oven-runtime/sqlite-run-ledger";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const INITIAL: FsmState = {
  active: true,
  gateCache: {},
  version: 1,
  schemaVersion: 1,
  requiredSkills: ["pov:tdd-strict"],
  skillReads: [],
};

function rootFixture() {
  const project = mkdtempSync(join(tmpdir(), "pi-oven-gate-ledger-"));
  roots.push(project);
  const stateRoot = join(project, ".pi-oven");
  const ledger = new SqliteRunLedger(join(stateRoot, "state", "run-ledger.sqlite"), {
    now: () => 1_000,
  });
  return { project, stateRoot, ledger };
}

describe("GateStateLedgerAdapter migration", () => {
  test("shadow-writes equivalent JSON and ledger state, then reads ledger primary", async () => {
    const { project, stateRoot, ledger } = rootFixture();
    const adapter = new GateStateLedgerAdapter(stateRoot, ledger, {
      runId: "gate-main",
      ownerId: "session-a",
      repoRoot: project,
      branch: "main",
      readSource: "json",
      writeTarget: "shadow",
    });
    await adapter.writeState(INITIAL);
    expect(await adapter.inspectEquivalence()).toEqual({ equivalent: true, reason: "equivalent" });
    await adapter.mutate((current) => ({ ...current, version: current.version + 1, active: false }));
    expect((await adapter.readState())).toMatchObject({ kind: "OK", state: { active: false, version: 2 } });
    await adapter.close();

    const reopened = new SqliteRunLedger(join(stateRoot, "state", "run-ledger.sqlite"), {
      now: () => 2_000,
    });
    const primary = new GateStateLedgerAdapter(stateRoot, reopened, {
      runId: "gate-main",
      ownerId: "session-b",
      repoRoot: project,
      branch: "main",
      readSource: "ledger",
      writeTarget: "shadow",
      jsonFallbackRead: true,
    });
    expect(await primary.readState()).toMatchObject({ kind: "OK", state: { active: false, version: 2 } });
    await primary.close();
  });

  test("keeps JSON fallback and JSON-only rollback for one release", async () => {
    const { project, stateRoot, ledger } = rootFixture();
    await new GateStateStore(stateRoot).writeState(INITIAL);
    const adapter = new GateStateLedgerAdapter(stateRoot, ledger, {
      runId: "gate-main",
      ownerId: "session-a",
      repoRoot: project,
      branch: "main",
      readSource: "ledger",
      writeTarget: "json",
      jsonFallbackRead: true,
    });
    expect(await adapter.readState()).toEqual({ kind: "OK", state: INITIAL });
    await adapter.mutate((state) => ({ ...state, version: 2 }));
    expect(ledger.readGateState("gate-main")).toBeUndefined();
    expect(await new GateStateStore(stateRoot).readState()).toMatchObject({
      kind: "OK",
      state: { version: 2 },
    });
    await adapter.close();
  });

  test("fences a stale shadow writer before it can change the JSON fallback", async () => {
    const project = mkdtempSync(join(tmpdir(), "pi-oven-gate-ledger-fence-"));
    roots.push(project);
    const stateRoot = join(project, ".pi-oven");
    let now = 1_000;
    const ledger = new SqliteRunLedger(join(stateRoot, "state", "run-ledger.sqlite"), {
      now: () => now,
    });
    const base = {
      runId: "gate-main",
      repoRoot: project,
      branch: "main",
      readSource: "json" as const,
      writeTarget: "shadow" as const,
      leaseTtlMs: 100,
      closeLedger: false,
    };
    const stale = new GateStateLedgerAdapter(stateRoot, ledger, {
      ...base,
      ownerId: "session-a",
    });
    await stale.writeState(INITIAL);
    now += 101;
    const current = new GateStateLedgerAdapter(stateRoot, ledger, {
      ...base,
      ownerId: "session-b",
    });
    await current.writeState({ ...INITIAL, version: 2 });
    await expect(stale.writeState({ ...INITIAL, version: 999 })).rejects.toThrow();
    expect(await new GateStateStore(stateRoot).readState()).toMatchObject({
      kind: "OK",
      state: { version: 2 },
    });
    await stale.close();
    await current.close();
    ledger.close();
  });
});
