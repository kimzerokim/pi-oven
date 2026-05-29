import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  createGateHandler,
  type GateHandlerDeps,
} from "../../../.omp/extensions/pi-oven-runtime/gate-handler";
import { GateStateStore, type FsmState } from "../../../.omp/extensions/pi-oven-runtime/gate-state";

function makeTempDir(): string {
  const dir = join(tmpdir(), `pi-oven-gh-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function bashEvent(command: string, toolCallId = "tc1") {
  return { type: "tool_call" as const, toolCallId, toolName: "bash" as const, input: { command } };
}

function taskEvent(agent: string, toolCallId = "tc-task") {
  // a `task` dispatch tool_call (subagent spawn). Carries params.agent.
  return { type: "tool_call" as const, toolCallId, toolName: "task", input: { agent, prompt: "x" } };
}

function makeLogger() {
  const lines: { level: string; msg: string }[] = [];
  return {
    lines,
    logger: {
      info: (m: string) => lines.push({ level: "info", msg: m }),
      warn: (m: string) => lines.push({ level: "warn", msg: m }),
      error: (m: string) => lines.push({ level: "error", msg: m }),
      debug: (m: string) => lines.push({ level: "debug", msg: m }),
    },
  };
}

function writeState(dir: string, s: FsmState): void {
  mkdirSync(join(dir, "state"), { recursive: true });
  writeFileSync(join(dir, "state", "autonomous.json"), JSON.stringify(s));
}

async function deps(dir: string, env: Record<string, string | undefined> = {}): Promise<GateHandlerDeps & { _logger: ReturnType<typeof makeLogger> }> {
  const lg = makeLogger();
  return {
    store: new GateStateStore(dir),
    logger: lg.logger,
    getEnv: () => env,
    isParentSession: true,
    _logger: lg,
  };
}

// ---------------------------------------------------------------------------
// AC1 — commit gate via a synthetic ToolCallEvent
// ---------------------------------------------------------------------------

describe("gateHandler — commit gate (AC1)", () => {
  let dir: string;
  beforeEach(() => { dir = makeTempDir(); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it("blocks git commit when active and commit cache != PASS", async () => {
    writeState(dir, { active: true, gateCache: { commit: "FAIL" }, version: 1, schemaVersion: 1 });
    const h = createGateHandler(await deps(dir));
    const r = await h(bashEvent("git commit -m x"));
    expect(r?.block).toBe(true);
    expect(r?.reason).toBeDefined();
  });

  it("allows git commit when active and commit cache == PASS", async () => {
    writeState(dir, { active: true, gateCache: { commit: "PASS" }, version: 1, schemaVersion: 1 });
    const h = createGateHandler(await deps(dir));
    const r = await h(bashEvent("git commit -m x"));
    expect(r?.block ?? false).toBe(false);
  });

  it("ALLOWS git commit when the FSM file is ABSENT (normal dev session — B2 refinement)", async () => {
    const h = createGateHandler(await deps(dir));
    const r = await h(bashEvent("git commit -m x"));
    expect(r?.block ?? false).toBe(false);
  });

  it("ignores non-bash tool calls (read/edit) entirely (fail-open)", async () => {
    writeState(dir, { active: true, gateCache: { commit: "FAIL" }, version: 1, schemaVersion: 1 });
    const h = createGateHandler(await deps(dir));
    const r = await h({ type: "tool_call", toolCallId: "x", toolName: "read", input: { path: "/x" } } as never);
    expect(r?.block ?? false).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// AC6 — state failure policy at the handler level
// ---------------------------------------------------------------------------

describe("gateHandler — state failure (AC6)", () => {
  let dir: string;
  beforeEach(() => { dir = makeTempDir(); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it("corrupt primary → fail-CLOSED, blocks commit", async () => {
    mkdirSync(join(dir, "state"), { recursive: true });
    writeFileSync(join(dir, "state", "autonomous.json"), "{ corrupt");
    const h = createGateHandler(await deps(dir));
    const r = await h(bashEvent("git commit -m x"));
    expect(r?.block).toBe(true);
  });

  it("corrupt primary + PI_OVEN_GATE_BYPASS=1 → ALLOWS commit and logs a warn", async () => {
    mkdirSync(join(dir, "state"), { recursive: true });
    writeFileSync(join(dir, "state", "autonomous.json"), "{ corrupt");
    const d = await deps(dir, { PI_OVEN_GATE_BYPASS: "1" });
    const h = createGateHandler(d);
    const r = await h(bashEvent("git commit -m x"));
    expect(r?.block ?? false).toBe(false);
    expect(d._logger.lines.some((l) => l.level === "warn")).toBe(true);
  });

  it("forbidden floor blocks rm -rf / even when FSM ABSENT", async () => {
    const h = createGateHandler(await deps(dir));
    const r = await h(bashEvent("rm -rf /"));
    expect(r?.block).toBe(true);
    expect(r?.reason).toMatch(/forbidden/i);
  });

  it("forbidden floor blocks rm -rf / even under PI_OVEN_GATE_BYPASS=1", async () => {
    const h = createGateHandler(await deps(dir, { PI_OVEN_GATE_BYPASS: "1" }));
    const r = await h(bashEvent("rm -rf /"));
    expect(r?.block).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// AC5 — push consent env vs file single-use (handler integration)
// ---------------------------------------------------------------------------

describe("gateHandler — push consent (AC5)", () => {
  let dir: string;
  beforeEach(() => { dir = makeTempDir(); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it("blocks git push when active and no consent", async () => {
    writeState(dir, { active: true, gateCache: { commit: "PASS" }, version: 1, schemaVersion: 1 });
    const h = createGateHandler(await deps(dir));
    const r = await h(bashEvent("git push origin main"));
    expect(r?.block).toBe(true);
  });

  it("env source: two successive pushes both allowed (NOT consumed)", async () => {
    writeState(dir, { active: true, gateCache: { commit: "PASS" }, version: 1, schemaVersion: 1 });
    const d = await deps(dir, { PI_OVEN_PUSH_CONSENT: "ref" });
    const h = createGateHandler(d);
    const r1 = await h(bashEvent("git push origin main"));
    const r2 = await h(bashEvent("git push origin main"));
    expect(r1?.block ?? false).toBe(false);
    expect(r2?.block ?? false).toBe(false);
    // audit log records source + branch
    expect(d._logger.lines.some((l) => l.msg.includes("env") && l.msg.includes("main"))).toBe(true);
  });

  it("file source: first push allowed AND file consumed; second push blocks (single-use)", async () => {
    writeState(dir, { active: true, gateCache: { commit: "PASS" }, version: 1, schemaVersion: 1 });
    const consent = join(dir, "state", "push-consent.json");
    writeFileSync(consent, JSON.stringify({ grantedAt: Date.now(), expiresAt: Date.now() + 60_000, branch: "main" }));
    const h = createGateHandler(await deps(dir));
    const r1 = await h(bashEvent("git push origin main"));
    expect(r1?.block ?? false).toBe(false);
    expect(existsSync(consent)).toBe(false); // consumed within the mutex
    const r2 = await h(bashEvent("git push origin main"));
    expect(r2?.block).toBe(true);
  });

  it("expired file consent → blocks push (treated as absent)", async () => {
    writeState(dir, { active: true, gateCache: { commit: "PASS" }, version: 1, schemaVersion: 1 });
    const consent = join(dir, "state", "push-consent.json");
    writeFileSync(consent, JSON.stringify({ grantedAt: Date.now() - 600_000, expiresAt: Date.now() - 60_000, branch: "main" }));
    const h = createGateHandler(await deps(dir));
    const r = await h(bashEvent("git push origin main"));
    expect(r?.block).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// AC2 — self-deadline + p95 budget (B1, B6)
// ---------------------------------------------------------------------------

describe("gateHandler — self-deadline + p95 (AC2)", () => {
  let dir: string;
  beforeEach(() => { dir = makeTempDir(); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it("(a) p95 of a warm-cache lookup is < 50ms over 1000 synthetic events", async () => {
    writeState(dir, { active: true, gateCache: { commit: "PASS" }, version: 1, schemaVersion: 1 });
    const h = createGateHandler(await deps(dir));
    await h(bashEvent("git status")); // warm the cache
    const samples: number[] = [];
    for (let i = 0; i < 1000; i++) {
      const t0 = performance.now();
      await h(bashEvent("git status", `tc${i}`));
      samples.push(performance.now() - t0);
    }
    samples.sort((a, b) => a - b);
    const p95 = samples[Math.floor(samples.length * 0.95)];
    expect(p95).toBeLessThan(50);
  });

  it("(b) a fault-injected slow path overruns the 1500ms self-deadline → handler THROWS (fail-CLOSED)", async () => {
    writeState(dir, { active: true, gateCache: { commit: "FAIL" }, version: 1, schemaVersion: 1 });
    const d = await deps(dir);
    // inject a store whose readState hangs forever
    const slowStore = {
      readState: () => new Promise(() => {}), // never resolves
      readFileConsent: async () => ({ valid: false }),
      consumeFileConsent: async () => {},
    } as unknown as GateStateStore;
    const h = createGateHandler({ ...d, store: slowStore, deadlineMs: 30 });
    let threw = false;
    try {
      await h(bashEvent("git commit -m x"));
    } catch {
      threw = true;
    }
    expect(threw).toBe(true); // omp converts the throw → {block:true} = fail-CLOSED
  });
});

// ---------------------------------------------------------------------------
// AC8b — nested task-subagent is gated (read-only) but does NOT mutate the FSM
// ---------------------------------------------------------------------------

describe("gateHandler — subagent read-only (AC8b)", () => {
  let dir: string;
  beforeEach(() => { dir = makeTempDir(); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it("a subagent-session handler does not write the FSM file", async () => {
    // subagent path: isParentSession = false
    const d = await deps(dir);
    const subHandler = createGateHandler({ ...d, isParentSession: false });
    // before: no state file
    expect(existsSync(join(dir, "state", "autonomous.json"))).toBe(false);
    await subHandler(bashEvent("git status"));
    await subHandler(taskEvent("pi-oven:executor"));
    // after: still no state file written by the subagent path
    expect(existsSync(join(dir, "state", "autonomous.json"))).toBe(false);
  });

  it("a subagent commit is STILL gated (read-only lookup honored)", async () => {
    writeState(dir, { active: true, gateCache: { commit: "FAIL" }, version: 1, schemaVersion: 1 });
    const d = await deps(dir);
    const subHandler = createGateHandler({ ...d, isParentSession: false });
    const r = await subHandler(bashEvent("git commit -m x"));
    expect(r?.block).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// AC9 — real-wrapper path (UNIT-SIMULATED: no omp runtime available here).
// We simulate runner.emitToolCall semantics: a thrown handler → {block:true};
// a returned {block:true,reason} surfaces the reason to the caller.
// ---------------------------------------------------------------------------

describe("gateHandler — simulated wrapper round-trip (AC9, unit-simulated)", () => {
  let dir: string;
  beforeEach(() => { dir = makeTempDir(); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  // Mirror of extensibility/extensions/runner.ts emitToolCall: await the
  // handler; on throw, fail-closed to {block:true}; else pass the result.
  async function emitToolCall(handler: (e: never) => Promise<unknown>, event: unknown): Promise<{ block: boolean; reason?: string }> {
    try {
      const res = (await handler(event as never)) as { block?: boolean; reason?: string } | void;
      return { block: res?.block ?? false, reason: res?.reason };
    } catch (err) {
      return { block: true, reason: `handler error (fail-closed): ${String(err)}` };
    }
  }

  it("a blocked commit surfaces the reason to the caller", async () => {
    writeState(dir, { active: true, gateCache: { commit: "FAIL" }, version: 1, schemaVersion: 1 });
    const h = createGateHandler(await deps(dir));
    const out = await emitToolCall(h as never, bashEvent("git commit -m x"));
    expect(out.block).toBe(true);
    expect(out.reason).toBeTruthy();
  });

  it("an allowed status passes through with block=false", async () => {
    writeState(dir, { active: true, gateCache: { commit: "PASS" }, version: 1, schemaVersion: 1 });
    const h = createGateHandler(await deps(dir));
    const out = await emitToolCall(h as never, bashEvent("git status"));
    expect(out.block).toBe(false);
  });

  it("a thrown self-deadline overrun becomes a fail-closed block at the wrapper", async () => {
    const d = await deps(dir);
    const slowStore = { readState: () => new Promise(() => {}), readFileConsent: async () => ({ valid: false }), consumeFileConsent: async () => {} } as unknown as GateStateStore;
    writeState(dir, { active: true, gateCache: { commit: "FAIL" }, version: 1, schemaVersion: 1 });
    const h = createGateHandler({ ...d, store: slowStore, deadlineMs: 25 });
    const out = await emitToolCall(h as never, bashEvent("git commit -m x"));
    expect(out.block).toBe(true);
  });
});
