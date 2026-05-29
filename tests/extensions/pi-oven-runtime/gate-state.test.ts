import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync, utimesSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  GateStateStore,
  type FsmState,
} from "../../../.omp/extensions/pi-oven-runtime/gate-state";

function makeTempDir(): string {
  const dir = join(tmpdir(), `pi-oven-gs-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function statePath(dir: string): string {
  return join(dir, "state", "autonomous.json");
}

function consentPath(dir: string): string {
  return join(dir, "state", "push-consent.json");
}

describe("GateStateStore — read failure policy (AC6)", () => {
  let dir: string;
  beforeEach(() => { dir = makeTempDir(); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it("ABSENT primary → readState returns kind ABSENT", async () => {
    const store = new GateStateStore(dir);
    const view = await store.readState();
    expect(view.kind).toBe("ABSENT");
  });

  it("valid primary → readState returns kind OK with parsed state", async () => {
    const store = new GateStateStore(dir);
    mkdirSync(join(dir, "state"), { recursive: true });
    const s: FsmState = { active: true, gateCache: { commit: "PASS" }, version: 1, schemaVersion: 1 };
    writeFileSync(statePath(dir), JSON.stringify(s));
    const view = await store.readState();
    expect(view.kind).toBe("OK");
    if (view.kind === "OK") {
      expect(view.state.active).toBe(true);
      expect(view.state.gateCache.commit).toBe("PASS");
    }
  });

  it("corrupt JSON primary (truncated) → readState returns kind CORRUPT", async () => {
    const store = new GateStateStore(dir);
    mkdirSync(join(dir, "state"), { recursive: true });
    writeFileSync(statePath(dir), '{ "active": true, "gateCache":');
    const view = await store.readState();
    expect(view.kind).toBe("CORRUPT");
  });

  it("schema-invalid primary (missing gateCache) → readState returns kind CORRUPT", async () => {
    const store = new GateStateStore(dir);
    mkdirSync(join(dir, "state"), { recursive: true });
    writeFileSync(statePath(dir), JSON.stringify({ active: true }));
    const view = await store.readState();
    expect(view.kind).toBe("CORRUPT");
  });

  it("orphan .tmp + valid primary (c1) → reads the valid primary, ignores .tmp", async () => {
    const store = new GateStateStore(dir);
    mkdirSync(join(dir, "state"), { recursive: true });
    const s: FsmState = { active: true, gateCache: { commit: "PASS" }, version: 1, schemaVersion: 1 };
    writeFileSync(statePath(dir), JSON.stringify(s));
    writeFileSync(statePath(dir) + ".tmp", "{ partial");
    const view = await store.readState();
    expect(view.kind).toBe("OK");
    if (view.kind === "OK") expect(view.state.gateCache.commit).toBe("PASS");
  });

  it("orphan .tmp + NO primary (c2) → ABSENT (tmp ignored, fail-closed handled at gate layer)", async () => {
    const store = new GateStateStore(dir);
    mkdirSync(join(dir, "state"), { recursive: true });
    writeFileSync(statePath(dir) + ".tmp", "{ partial");
    const view = await store.readState();
    expect(view.kind).toBe("ABSENT");
  });
});

describe("GateStateStore — atomic write (AC6 / AC8)", () => {
  let dir: string;
  beforeEach(() => { dir = makeTempDir(); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it("writeState produces a valid readable primary and leaves no orphan .tmp", async () => {
    const store = new GateStateStore(dir);
    const s: FsmState = { active: true, gateCache: { commit: "PASS" }, version: 1, schemaVersion: 1 };
    await store.writeState(s);
    expect(existsSync(statePath(dir))).toBe(true);
    expect(existsSync(statePath(dir) + ".tmp")).toBe(false);
    const parsed = JSON.parse(readFileSync(statePath(dir), "utf-8"));
    expect(parsed.gateCache.commit).toBe("PASS");
  });

  it("creates the state dir if absent", async () => {
    const store = new GateStateStore(dir);
    const s: FsmState = { active: true, gateCache: { commit: "FAIL" }, version: 1, schemaVersion: 1 };
    await store.writeState(s);
    expect(existsSync(statePath(dir))).toBe(true);
  });
});

describe("GateStateStore — single-writer mutex (AC8a)", () => {
  let dir: string;
  beforeEach(() => { dir = makeTempDir(); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it("two parallel mutate() calls serialize with no torn read-modify-write", async () => {
    const store = new GateStateStore(dir);
    await store.writeState({ active: true, gateCache: { commit: "FAIL" }, version: 0, schemaVersion: 1 });
    // Two concurrent increments of `version`. Without the mutex these could
    // read the same base and clobber → final version 1. With the mutex → 2.
    await Promise.all([
      store.mutate((s) => ({ ...s, version: s.version + 1 })),
      store.mutate((s) => ({ ...s, version: s.version + 1 })),
    ]);
    const view = await store.readState();
    expect(view.kind).toBe("OK");
    if (view.kind === "OK") expect(view.state.version).toBe(2);
  });
});

describe("GateStateStore — mtime stale-cache invalidation (AC8c)", () => {
  let dir: string;
  beforeEach(() => { dir = makeTempDir(); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it("an out-of-band write with a bumped mtime is picked up on next read", async () => {
    const store = new GateStateStore(dir);
    await store.writeState({ active: true, gateCache: { commit: "FAIL" }, version: 1, schemaVersion: 1 });
    const v1 = await store.readState();
    expect(v1.kind === "OK" && v1.state.gateCache.commit).toBe("FAIL");

    // out-of-band write (e.g. the pre-commit suite writes PASS) + bump mtime
    mkdirSync(join(dir, "state"), { recursive: true });
    writeFileSync(statePath(dir), JSON.stringify({ active: true, gateCache: { commit: "PASS" }, version: 2, schemaVersion: 1 }));
    const future = new Date(Date.now() + 5000);
    utimesSync(statePath(dir), future, future);

    const v2 = await store.readState();
    expect(v2.kind === "OK" && v2.state.gateCache.commit).toBe("PASS");
  });

  it("repeated reads with unchanged mtime serve from cache (no re-parse error on a now-corrupt-but-cached file is not asserted; just consistency)", async () => {
    const store = new GateStateStore(dir);
    await store.writeState({ active: true, gateCache: { commit: "PASS" }, version: 1, schemaVersion: 1 });
    const a = await store.readState();
    const b = await store.readState();
    expect(a.kind).toBe("OK");
    expect(b.kind).toBe("OK");
    if (a.kind === "OK" && b.kind === "OK") {
      expect(a.state.gateCache.commit).toBe(b.state.gateCache.commit);
    }
  });
});

describe("GateStateStore — file push-consent (AC5 file source single-use)", () => {
  let dir: string;
  beforeEach(() => { dir = makeTempDir(); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it("readFileConsent returns valid for a non-expired file", async () => {
    const store = new GateStateStore(dir);
    mkdirSync(join(dir, "state"), { recursive: true });
    writeFileSync(consentPath(dir), JSON.stringify({
      grantedAt: Date.now(),
      expiresAt: Date.now() + 60_000,
      branch: "main",
    }));
    const c = await store.readFileConsent();
    expect(c.valid).toBe(true);
  });

  it("readFileConsent returns invalid for an expired file (expiresAt in the past)", async () => {
    const store = new GateStateStore(dir);
    mkdirSync(join(dir, "state"), { recursive: true });
    writeFileSync(consentPath(dir), JSON.stringify({
      grantedAt: Date.now() - 600_000,
      expiresAt: Date.now() - 60_000,
      branch: "main",
    }));
    const c = await store.readFileConsent();
    expect(c.valid).toBe(false);
  });

  it("readFileConsent returns invalid when the file is absent", async () => {
    const store = new GateStateStore(dir);
    const c = await store.readFileConsent();
    expect(c.valid).toBe(false);
  });

  it("consumeFileConsent deletes the file so a second read is invalid (single-use)", async () => {
    const store = new GateStateStore(dir);
    mkdirSync(join(dir, "state"), { recursive: true });
    writeFileSync(consentPath(dir), JSON.stringify({
      grantedAt: Date.now(),
      expiresAt: Date.now() + 60_000,
      branch: "main",
    }));
    expect((await store.readFileConsent()).valid).toBe(true);
    await store.consumeFileConsent();
    expect(existsSync(consentPath(dir))).toBe(false);
    expect((await store.readFileConsent()).valid).toBe(false);
  });
});
