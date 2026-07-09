import { describe, it, expect, beforeEach, afterEach, vi } from "bun:test";
import { promises as fsPromises, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync, utimesSync, readdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  GateStateStore,
  deriveAutonomyOwnershipStatus,
  fingerprintExternalExecSecret,
  type FsmState,
} from "../../../.omp/extensions/pi-oven-runtime/gate-state";
import {
  AUTONOMOUS_STATE_FILE,
  BRANCH_CONTRACT_STATE_FILE,
  PUSH_CONSENT_STATE_FILE,
  projectStatePath,
} from "../../../.omp/extensions/pi-oven-runtime/project-state";
import { createAutonomousLoopResumeMarker } from "../../../.omp/extensions/pi-oven-runtime/continuation-marker";

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

function branchContractPath(dir: string): string {
  return join(dir, "state", "branch-contract.json");
}

function localExternalConsent() {
  return {
    sourceMessageId: "u1",
    scope: "all" as const,
    remainingUses: 1,
  };
}

function temporaryExternalConsent(expiresAt = Date.now() + 60_000) {
  return {
    sourceMessageId: "u1",
    scope: "read" as const,
    remainingUses: 1,
    tempCredentials: {
      provider: "aws" as const,
      accessKeyId: "ASIAIOSFODNN7EXAMPLE",
      sessionTokenFingerprint: fingerprintExternalExecSecret("session123"),
      secretAccessKeyFingerprint: fingerprintExternalExecSecret("secret"),
      expiresAt,
    },
  };
}

function writeExternalConsentState(dir: string, externalExecConsent: NonNullable<FsmState["externalExecConsent"]>) {
  mkdirSync(join(dir, "state"), { recursive: true });
  writeFileSync(
    statePath(dir),
    JSON.stringify({
      active: true,
      gateCache: { commit: "PASS", regression: "PASS" },
      version: 1,
      schemaVersion: 1,
      externalExecConsent,
    })
  );
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
    const s: FsmState = { active: true, gateCache: { commit: "PASS", regression: "PASS" }, version: 1, schemaVersion: 1 };
    writeFileSync(statePath(dir), JSON.stringify(s));
    const view = await store.readState();
    expect(view.kind).toBe("OK");
    if (view.kind === "OK") {
      expect(view.state.active).toBe(true);
      expect(view.state.gateCache.commit).toBe("PASS");
      expect(view.state.gateCache.regression).toBe("PASS");
    }
  });

  it("schema-compatible primary (regression omitted) → readState still returns kind OK", async () => {
    const store = new GateStateStore(dir);
    mkdirSync(join(dir, "state"), { recursive: true });
    writeFileSync(statePath(dir), JSON.stringify({ active: true, gateCache: { commit: "PASS" }, version: 1, schemaVersion: 1 }));
    const view = await store.readState();
    expect(view.kind).toBe("OK");
    if (view.kind === "OK") {
      expect(view.state.gateCache.commit).toBe("PASS");
      expect(view.state.gateCache.regression).toBeUndefined();
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
    const s: FsmState = { active: true, gateCache: { commit: "PASS", regression: "PASS" }, version: 1, schemaVersion: 1 };
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
    const s: FsmState = { active: true, gateCache: { commit: "PASS", regression: "PASS" }, version: 1, schemaVersion: 1 };
    await store.writeState(s);
    expect(existsSync(statePath(dir))).toBe(true);
    expect(readdirSync(join(dir, "state")).filter((entry) => entry.endsWith(".tmp"))).toEqual([]);
    const parsed = JSON.parse(readFileSync(statePath(dir), "utf-8"));
    expect(parsed.gateCache.commit).toBe("PASS");
    expect(parsed.gateCache.regression).toBe("PASS");
  });

  it("two independent stores writing the same state dir in parallel use distinct tmp paths", async () => {
    const storeA = new GateStateStore(dir);
    const storeB = new GateStateStore(dir);
    const stateA: FsmState = { active: true, gateCache: { commit: "PASS" }, version: 1, schemaVersion: 1 };
    const stateB: FsmState = { active: true, gateCache: { commit: "FAIL" }, version: 2, schemaVersion: 1 };
    const originalRename = fsPromises.rename.bind(fsPromises);
    let releaseRename!: () => void;
    const renameGate = new Promise<void>((resolve) => {
      releaseRename = resolve;
    });
    let renameCalls = 0;
    const renameSources: string[] = [];
    const renameSpy = vi.spyOn(fsPromises, "rename").mockImplementation(async (from, to) => {
      renameCalls += 1;
      renameSources.push(String(from));
      if (renameCalls === 1) {
        await renameGate;
      } else {
        releaseRename();
      }
      return originalRename(from, to);
    });
    try {
      await Promise.all([storeA.writeState(stateA), storeB.writeState(stateB)]);
    } finally {
      renameSpy.mockRestore();
    }
    expect(renameSources).toHaveLength(2);
    expect(new Set(renameSources).size).toBe(2);
    expect(renameSources.every((source) => source.startsWith(statePath(dir) + ".") && source.endsWith(".tmp"))).toBe(true);
    expect(readdirSync(join(dir, "state")).filter((entry) => entry.endsWith(".tmp"))).toEqual([]);
    const parsed = JSON.parse(readFileSync(statePath(dir), "utf-8")) as FsmState;
    expect(
      (parsed.gateCache.commit === "PASS" && parsed.version === 1) ||
        (parsed.gateCache.commit === "FAIL" && parsed.version === 2)
    ).toBe(true);
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
  it("cache hits still purge temporary AWS consent after it expires", async () => {
    vi.useFakeTimers();
    try {
      const expiresAt = Date.now() + 5;
      writeExternalConsentState(dir, temporaryExternalConsent(expiresAt));
      const store = new GateStateStore(dir);

      const initial = await store.readState();
      expect(initial.kind).toBe("OK");
      if (initial.kind !== "OK") return;
      expect(initial.state.externalExecConsent?.tempCredentials).toBeDefined();

      vi.advanceTimersByTime(20);

      const afterExpiry = await store.readState();
      expect(afterExpiry.kind).toBe("OK");
      if (afterExpiry.kind !== "OK") return;
      expect(afterExpiry.state.externalExecConsent).toBeUndefined();

      const persisted = JSON.parse(readFileSync(statePath(dir), "utf-8")) as FsmState;
      expect(persisted.externalExecConsent).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it("cache-hit expiry purge does not overwrite a newer state written during the sanitize path", async () => {
    vi.useFakeTimers();
    try {
      writeExternalConsentState(dir, temporaryExternalConsent(Date.now() + 5));
      const store = new GateStateStore(dir);

      const initial = await store.readState();
      expect(initial.kind).toBe("OK");
      if (initial.kind !== "OK") return;

      vi.advanceTimersByTime(20);

      const originalRunExclusive = store.runExclusive.bind(store);
      const entered = Promise.withResolvers<void>();
      const release = Promise.withResolvers<void>();
      let intercepted = false;
      (
        store as GateStateStore & {
          runExclusive: <T>(fn: () => Promise<T>) => Promise<T>;
        }
      ).runExclusive = async <T>(fn: () => Promise<T>) => {
        if (!intercepted) {
          intercepted = true;
          entered.resolve();
          await release.promise;
        }
        return originalRunExclusive(fn);
      };

      const purgePromise = store.readState();
      await entered.promise;

      const concurrentState: FsmState = {
        active: true,
        gateCache: { commit: "PASS", regression: "PASS" },
        version: 2,
        schemaVersion: 1,
      };
      writeFileSync(statePath(dir), JSON.stringify(concurrentState));
      const future = new Date(Date.now() + 5_000);
      utimesSync(statePath(dir), future, future);

      release.resolve();

      const after = await purgePromise;
      expect(after).toEqual({ kind: "OK", state: concurrentState });

      const persisted = JSON.parse(readFileSync(statePath(dir), "utf-8")) as FsmState;
      expect(persisted).toEqual(concurrentState);
    } finally {
      vi.useRealTimers();
    }
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

  it("writeState refreshes the in-memory cache with the written state", async () => {
    const store = new GateStateStore(dir);
    await store.writeState({ active: true, gateCache: { commit: "PASS" }, version: 1, schemaVersion: 1 });

    const cacheValue = Reflect.get(store, "cache");
    expect(cacheValue).not.toBeNull();
    expect(cacheValue && typeof cacheValue === "object").toBe(true);
    if (!cacheValue || typeof cacheValue !== "object" || !("view" in cacheValue)) return;
    const view = cacheValue.view;
    expect(view && typeof view === "object").toBe(true);
    if (!view || typeof view !== "object" || !("kind" in view) || !("state" in view)) return;
    expect(view.kind).toBe("OK");
    expect(view.state && typeof view.state === "object" && "gateCache" in view.state).toBe(true);
  });

  it("writeState caches an immutable snapshot instead of the caller-owned object", async () => {
    const store = new GateStateStore(dir);
    const input: FsmState = {
      active: true,
      gateCache: { commit: "PASS" },
      version: 1,
      schemaVersion: 1,
      skillReads: [],
    };

    await store.writeState(input);
    input.gateCache.commit = "FAIL";
    input.skillReads?.push("/plugin/skills/autonomous-loop/SKILL.md");

    const view = await store.readState();
    expect(view.kind).toBe("OK");
    if (view.kind !== "OK") return;

    expect(view.state).not.toBe(input);
    expect(view.state.gateCache.commit).toBe("PASS");
    expect(view.state.skillReads ?? []).toEqual([]);
    expect(JSON.parse(readFileSync(statePath(dir), "utf-8"))).toMatchObject({
      gateCache: { commit: "PASS" },
      skillReads: [],
    });
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

describe("GateStateStore — external execution consent persistence", () => {
  let dir: string;
  beforeEach(() => { dir = makeTempDir(); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it("consumeExternalExecConsent preserves temporary AWS credential consent until expiry", async () => {
    writeExternalConsentState(dir, temporaryExternalConsent());
    const store = new GateStateStore(dir);

    expect(await store.consumeExternalExecConsent("u1")).toBe("consumed");

    const after = await store.readState();
    expect(after.kind).toBe("OK");
    if (after.kind !== "OK") return;
    expect(after.state.externalExecConsent).toEqual(temporaryExternalConsent(after.state.externalExecConsent?.tempCredentials?.expiresAt));
    expect(after.state.consumedExternalExecConsentMessageId).toBeUndefined();
  });

  it("consumeExternalExecConsent keeps local credential consent single-use", async () => {
    writeExternalConsentState(dir, localExternalConsent());
    const store = new GateStateStore(dir);

    expect(await store.consumeExternalExecConsent("u1")).toBe("consumed");

    const after = await store.readState();
    expect(after.kind).toBe("OK");
    if (after.kind !== "OK") return;
    expect(after.state.externalExecConsent).toBeUndefined();
    expect(after.state.consumedExternalExecConsentMessageId).toBe("u1");
  });
  it("mutate purges expired temporary AWS consent without re-entering the writer mutex", async () => {
    writeExternalConsentState(dir, temporaryExternalConsent(Date.now() - 1_000));
    const store = new GateStateStore(dir);
    const runExclusiveSpy = vi.spyOn(store, "runExclusive").mockImplementation((fn) => fn());

    try {
      await store.mutate((current) => ({ ...current, version: current.version + 1 }));
      expect(runExclusiveSpy).not.toHaveBeenCalled();

      const after = await store.readState();
      expect(after.kind).toBe("OK");
      if (after.kind !== "OK") return;
      expect(after.state.externalExecConsent).toBeUndefined();
      expect(after.state.version).toBe(2);
    } finally {
      runExclusiveSpy.mockRestore();
    }
  });


  it("readState purges expired temporary AWS consent metadata", async () => {
    writeExternalConsentState(dir, temporaryExternalConsent(Date.now() - 1_000));
    const store = new GateStateStore(dir);

    const view = await store.readState();
    expect(view.kind).toBe("OK");
    if (view.kind !== "OK") return;
    expect(view.state.externalExecConsent).toBeUndefined();

    const persisted = JSON.parse(readFileSync(statePath(dir), "utf-8")) as FsmState;
    expect(persisted.externalExecConsent).toBeUndefined();
  });
});

describe("GateStateStore — continuation marker persistence", () => {
  let dir: string;
  beforeEach(() => { dir = makeTempDir(); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it("persists continuation markers inside autonomous.json without creating a sibling marker file", async () => {
    const store = new GateStateStore(dir);
    await store.writeState({
      active: true,
      gateCache: { commit: "PASS" },
      version: 1,
      schemaVersion: 1,
    });

    await store.setContinuationMarker(createAutonomousLoopResumeMarker("explicit-continue"));

    const persisted = JSON.parse(readFileSync(statePath(dir), "utf-8")) as FsmState;
    expect(persisted.continuationMarker).toEqual(
      createAutonomousLoopResumeMarker("explicit-continue")
    );
    expect(persisted.gateCache).toEqual({ commit: "PASS" });
    expect(readdirSync(join(dir, "state")).sort()).toEqual(["autonomous.json"]);
  });

  it("serializes continuation-marker writes through the same writer mutex as mutate()", async () => {
    const store = new GateStateStore(dir);
    await store.writeState({
      active: true,
      gateCache: { commit: "PASS" },
      version: 1,
      schemaVersion: 1,
    });

    await Promise.all([
      store.setContinuationMarker(createAutonomousLoopResumeMarker("polite-stop")),
      store.mutate((current) => ({
        ...current,
        version: current.version + 1,
        gateCache: {
          ...current.gateCache,
          regression: "PASS",
        },
      })),
    ]);

    const view = await store.readState();
    expect(view.kind).toBe("OK");
    if (view.kind !== "OK") return;
    expect(view.state.continuationMarker).toEqual(
      createAutonomousLoopResumeMarker("polite-stop")
    );
    expect(view.state.gateCache).toEqual({ commit: "PASS", regression: "PASS" });
  });

  it("round-trips ownership status, blocked reason, next action, and resume target inside autonomous.json", async () => {
    const store = new GateStateStore(dir);
    const state: FsmState = {
      active: true,
      gateCache: { commit: "PASS" },
      version: 2,
      schemaVersion: 1,
      requiredSkills: ["autonomous-loop"],
      ownedSkillReadTargets: ["/plugin/skills/autonomous-loop/SKILL.md"],
      ownershipStatus: deriveAutonomyOwnershipStatus(
        ["autonomous-loop"],
        ["/plugin/skills/autonomous-loop/SKILL.md"]
      ),
      blockedReason: {
        kind: "skill-proof-incomplete",
        message: "pi-oven: code-write blocked — capability proof surface is not complete yet.",
      },
      nextAction: {
        kind: "complete-skill-proof",
        message: "Read the exact plugin-owned SKILL.md targets first, then retry the write.",
      },
      resumeTarget: {
        repoRoot: "/tmp/pi-oven",
        branch: "feature/task4",
        capturedAt: "2026-07-08T00:00:00.000Z",
      },
    };

    await store.writeState(state);

    const view = await store.readState();
    expect(view.kind).toBe("OK");
    if (view.kind !== "OK") return;
    expect(view.state.ownershipStatus).toBe("owned-surface active");
    expect(view.state.blockedReason).toEqual(state.blockedReason);
    expect(view.state.nextAction).toEqual(state.nextAction);
    expect(view.state.resumeTarget).toEqual(state.resumeTarget);
  });
});

describe("GateStateStore — branch contract marker", () => {
  let dir: string;
  beforeEach(() => { dir = makeTempDir(); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it("readBranchContract returns ABSENT when the marker file is missing", async () => {
    const store = new GateStateStore(dir);
    expect(await store.readBranchContract()).toEqual({ kind: "ABSENT" });
  });

  it("readBranchContract returns OK for a valid marker file", async () => {
    const store = new GateStateStore(dir);
    mkdirSync(join(dir, "state"), { recursive: true });
    writeFileSync(
      branchContractPath(dir),
      JSON.stringify({ destination: "worktree", branch: "feature/ws5", pr_mode: "draft" })
    );
    expect(await store.readBranchContract()).toEqual({
      kind: "OK",
      contract: { destination: "worktree", branch: "feature/ws5", pr_mode: "draft" },
    });
  });

  it("readBranchContract returns CORRUPT for invalid marker JSON", async () => {
    const store = new GateStateStore(dir);
    mkdirSync(join(dir, "state"), { recursive: true });
    writeFileSync(branchContractPath(dir), JSON.stringify({ destination: "x", branch: "" }));
    expect(await store.readBranchContract()).toEqual({ kind: "CORRUPT" });
  });
});

describe("GateStateStore — project-state migration compatibility", () => {
  let dir: string;
  beforeEach(() => { dir = makeTempDir(); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it("keeps autonomous.json, push-consent.json, and branch-contract.json on their current live paths", () => {
    expect(projectStatePath(dir, AUTONOMOUS_STATE_FILE)).toBe(statePath(dir));
    expect(projectStatePath(dir, PUSH_CONSENT_STATE_FILE)).toBe(consentPath(dir));
    expect(projectStatePath(dir, BRANCH_CONTRACT_STATE_FILE)).toBe(branchContractPath(dir));
  });

  it("writeState preserves the live autonomous.json top-level shape during the migration", async () => {
    const store = new GateStateStore(dir);
    const state: FsmState = {
      active: true,
      gateCache: { commit: "PASS", regression: "PASS" },
      version: 3,
      schemaVersion: 1,
      requiredSkills: ["autonomous-loop"],
      skillReads: ["/plugin/skills/autonomous-loop/SKILL.md"],
      ownershipStatus: "owned-surface active",
      blockedReason: {
        kind: "verifier-pending",
        message: "pi-oven: autonomous exit paused — deep verifier lane must run before completion.",
      },
      nextAction: {
        kind: "run-deep-verifier",
        message: "Run the deep verifier lane before exit.",
      },
      resumeTarget: {
        repoRoot: "/tmp/pi-oven",
        branch: "feature/task4",
        capturedAt: "2026-07-08T00:00:00.000Z",
      },
    };

    await store.writeState(state);

    expect(JSON.parse(readFileSync(statePath(dir), "utf-8"))).toEqual(state);
  });
});
