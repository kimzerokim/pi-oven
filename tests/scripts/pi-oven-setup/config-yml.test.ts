import { describe, it, expect } from "bun:test";
import {
  mergeOverrideRecord,
  readOverridesStrict,
  readAgentModelOverrides,
  setAgentModelOverride,
  deletePiOvenAgentModelOverrides,
  mergeDisabledProviders,
  readDisabledProvidersStrict,
  setPiOvenDisabledProviders,
  clearPiOvenDisabledProviders,
  PI_OVEN_MANAGED_PROVIDERS,
} from "../../../scripts/pi-oven-setup/config-yml";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type SpawnResult = { exitCode: number | null; stdout?: Buffer; stderr?: Buffer };

function makeSpawnFn(
  responses: Array<SpawnResult | ((cmd: string, args: string[]) => SpawnResult)>
): { fn: (cmd: string, args: string[]) => SpawnResult; calls: string[][] } {
  const calls: string[][] = [];
  let idx = 0;
  return {
    fn: (cmd: string, args: string[]) => {
      calls.push([cmd, ...args]);
      const r = responses[idx++];
      return typeof r === "function" ? r(cmd, args) : r;
    },
    calls,
  };
}

function okGetResult(value: Record<string, string>): SpawnResult {
  return {
    exitCode: 0,
    stdout: Buffer.from(
      JSON.stringify({
        key: "task.agentModelOverrides",
        value,
        type: "record",
        description: "",
      })
    ),
    stderr: Buffer.from(""),
  };
}

function okSetResult(): SpawnResult {
  return { exitCode: 0, stdout: Buffer.from(""), stderr: Buffer.from("") };
}

function okGetArrayResult(value: string[]): SpawnResult {
  return {
    exitCode: 0,
    stdout: Buffer.from(
      JSON.stringify({
        key: "disabledProviders",
        value,
        type: "array",
        description: "",
      })
    ),
    stderr: Buffer.from(""),
  };
}

// ---------------------------------------------------------------------------
// mergeOverrideRecord — PURE, no spawn
// ---------------------------------------------------------------------------

describe("mergeOverrideRecord", () => {
  it("set adds key, preserves siblings", () => {
    const result = mergeOverrideRecord(
      { "claude-code:foo": "m", "pi-oven:executor": "e" },
      { op: "set", colonKey: "pi-oven:critic", model: "X" }
    );
    expect(result).toEqual({
      "claude-code:foo": "m",
      "pi-oven:executor": "e",
      "pi-oven:critic": "X",
    });
  });

  it("set overwrites existing same key", () => {
    const result = mergeOverrideRecord(
      { "pi-oven:critic": "old" },
      { op: "set", colonKey: "pi-oven:critic", model: "new" }
    );
    expect(result["pi-oven:critic"]).toBe("new");
  });

  it("delete-pi-oven removes only pi-oven:* keys, preserves non-pi-oven siblings", () => {
    const result = mergeOverrideRecord(
      { "pi-oven:critic": "a", "pi-oven:executor": "b", "claude-code:foo": "m" },
      { op: "delete-pi-oven" }
    );
    expect(result).toEqual({ "claude-code:foo": "m" });
  });

  it("delete-pi-oven on empty record returns empty object", () => {
    const result = mergeOverrideRecord({}, { op: "delete-pi-oven" });
    expect(result).toEqual({});
  });

  it("set on empty record returns single-key object", () => {
    const result = mergeOverrideRecord(
      {},
      { op: "set", colonKey: "pi-oven:critic", model: "anthropic/claude-opus-4-8" }
    );
    expect(result).toEqual({ "pi-oven:critic": "anthropic/claude-opus-4-8" });
  });
});

// ---------------------------------------------------------------------------
// readOverridesStrict
// ---------------------------------------------------------------------------

describe("readOverridesStrict", () => {
  it("ok:true on expected shape with record", async () => {
    const { fn } = makeSpawnFn([okGetResult({ "pi-oven:critic": "X" })]);
    const result = await readOverridesStrict({ spawnFn: fn });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.record).toEqual({ "pi-oven:critic": "X" });
    }
  });

  it("ok:true record:{} on fresh empty value", async () => {
    const { fn } = makeSpawnFn([okGetResult({})]);
    const result = await readOverridesStrict({ spawnFn: fn });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.record).toEqual({});
    }
  });

  it("ok:false on malformed JSON (Pc2-1)", async () => {
    const { fn } = makeSpawnFn([
      { exitCode: 0, stdout: Buffer.from("not json{{{"), stderr: Buffer.from("") },
    ]);
    const result = await readOverridesStrict({ spawnFn: fn });
    expect(result.ok).toBe(false);
  });

  it("ok:false on missing .value (Pc2-1)", async () => {
    const { fn } = makeSpawnFn([
      {
        exitCode: 0,
        stdout: Buffer.from(JSON.stringify({ key: "x", type: "record" })),
        stderr: Buffer.from(""),
      },
    ]);
    const result = await readOverridesStrict({ spawnFn: fn });
    expect(result.ok).toBe(false);
  });

  it("ok:false on .value not object (Pc2-1)", async () => {
    const { fn } = makeSpawnFn([
      {
        exitCode: 0,
        stdout: Buffer.from(JSON.stringify({ value: "oops", type: "record" })),
        stderr: Buffer.from(""),
      },
    ]);
    const result = await readOverridesStrict({ spawnFn: fn });
    expect(result.ok).toBe(false);
  });

  it("ok:false on .value is array (Pc2-1)", async () => {
    const { fn } = makeSpawnFn([
      {
        exitCode: 0,
        stdout: Buffer.from(JSON.stringify({ value: [], type: "record" })),
        stderr: Buffer.from(""),
      },
    ]);
    const result = await readOverridesStrict({ spawnFn: fn });
    expect(result.ok).toBe(false);
  });

  it("ok:false on .value is null (Pc2-1)", async () => {
    const { fn } = makeSpawnFn([
      {
        exitCode: 0,
        stdout: Buffer.from(JSON.stringify({ value: null, type: "record" })),
        stderr: Buffer.from(""),
      },
    ]);
    const result = await readOverridesStrict({ spawnFn: fn });
    expect(result.ok).toBe(false);
  });

  it("ok:false on type != record (Pc2-1)", async () => {
    const { fn } = makeSpawnFn([
      {
        exitCode: 0,
        stdout: Buffer.from(JSON.stringify({ value: {}, type: "string" })),
        stderr: Buffer.from(""),
      },
    ]);
    const result = await readOverridesStrict({ spawnFn: fn });
    expect(result.ok).toBe(false);
  });

  it("ok:false on get non-zero exit", async () => {
    const { fn } = makeSpawnFn([
      { exitCode: 1, stdout: Buffer.from(""), stderr: Buffer.from("error") },
    ]);
    const result = await readOverridesStrict({ spawnFn: fn });
    expect(result.ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// setAgentModelOverride
// ---------------------------------------------------------------------------

describe("setAgentModelOverride", () => {
  it("calls get then set with merged whole-json", async () => {
    const { fn, calls } = makeSpawnFn([
      okGetResult({ "claude-code:foo": "m" }),
      okSetResult(),
    ]);
    await setAgentModelOverride("pi-oven:critic", "anthropic/claude-opus-4-8", { spawnFn: fn });

    // get call
    expect(calls[0]).toEqual([
      "omp",
      "config",
      "get",
      "task.agentModelOverrides",
      "--json",
    ]);

    // set call: args[3] must be whole merged json
    expect(calls[1][0]).toBe("omp");
    expect(calls[1][1]).toBe("config");
    expect(calls[1][2]).toBe("set");
    expect(calls[1][3]).toBe("task.agentModelOverrides");
    const setJson = JSON.parse(calls[1][4]);
    expect(setJson).toEqual({
      "claude-code:foo": "m",
      "pi-oven:critic": "anthropic/claude-opus-4-8",
    });
  });

  it("ABORTS on corrupt get — set NOT called, no data-loss (Pc2-1)", async () => {
    const { fn, calls } = makeSpawnFn([
      { exitCode: 0, stdout: Buffer.from("not json{{{"), stderr: Buffer.from("") },
    ]);
    await expect(
      setAgentModelOverride("pi-oven:critic", "X", { spawnFn: fn })
    ).rejects.toThrow();
    const setCallsMade = calls.filter(
      (c) => c[0] === "omp" && c[1] === "config" && c[2] === "set"
    );
    expect(setCallsMade.length).toBe(0);
  });

  it("throws when get exits non-zero — set NOT called", async () => {
    const { fn, calls } = makeSpawnFn([
      { exitCode: 1, stdout: Buffer.from(""), stderr: Buffer.from("err") },
    ]);
    await expect(
      setAgentModelOverride("pi-oven:critic", "X", { spawnFn: fn })
    ).rejects.toThrow();
    const setCallsMade = calls.filter(
      (c) => c[0] === "omp" && c[1] === "config" && c[2] === "set"
    );
    expect(setCallsMade.length).toBe(0);
  });

  it("throws when omp config set exits non-zero", async () => {
    const { fn } = makeSpawnFn([
      okGetResult({}),
      { exitCode: 1, stdout: Buffer.from(""), stderr: Buffer.from("set failed") },
    ]);
    await expect(
      setAgentModelOverride("pi-oven:critic", "X", { spawnFn: fn })
    ).rejects.toThrow();
  });

  it("throws on non-pi-oven colonKey — set spawn never called", async () => {
    const { fn, calls } = makeSpawnFn([]);
    await expect(
      setAgentModelOverride("claude-code:x", "m", { spawnFn: fn })
    ).rejects.toThrow();
    expect(calls.length).toBe(0);
  });

  it("starts from empty record on fresh config (genuinely-absent = safe)", async () => {
    const { fn, calls } = makeSpawnFn([okGetResult({}), okSetResult()]);
    await setAgentModelOverride("pi-oven:executor", "anthropic/claude-opus-4-8", { spawnFn: fn });
    const setJson = JSON.parse(calls[1][4]);
    expect(setJson).toEqual({ "pi-oven:executor": "anthropic/claude-opus-4-8" });
  });
});

// ---------------------------------------------------------------------------
// deletePiOvenAgentModelOverrides
// ---------------------------------------------------------------------------

describe("deletePiOvenAgentModelOverrides", () => {
  it("sets merged record without pi-oven:* and returns removed keys (sorted)", async () => {
    const { fn, calls } = makeSpawnFn([
      okGetResult({
        "pi-oven:critic": "a",
        "pi-oven:executor": "b",
        "claude-code:foo": "m",
      }),
      okSetResult(),
    ]);
    const removed = await deletePiOvenAgentModelOverrides({ spawnFn: fn });
    expect(removed.sort()).toEqual(["pi-oven:critic", "pi-oven:executor"]);

    const setJson = JSON.parse(calls[1][4]);
    expect(setJson).toEqual({ "claude-code:foo": "m" });
  });

  it("ABORTS on corrupt get — set NOT called (Pc2-1)", async () => {
    const { fn, calls } = makeSpawnFn([
      { exitCode: 0, stdout: Buffer.from("not json{{{"), stderr: Buffer.from("") },
    ]);
    await expect(deletePiOvenAgentModelOverrides({ spawnFn: fn })).rejects.toThrow();
    const setCallsMade = calls.filter(
      (c) => c[0] === "omp" && c[1] === "config" && c[2] === "set"
    );
    expect(setCallsMade.length).toBe(0);
  });

  it("returns empty array and does NOT call set when no pi-oven:* keys (no-op)", async () => {
    const { fn, calls } = makeSpawnFn([
      okGetResult({ "claude-code:foo": "m" }),
    ]);
    const removed = await deletePiOvenAgentModelOverrides({ spawnFn: fn });
    expect(removed).toEqual([]);
    // No set call — nothing to remove, skip write entirely
    const setCallsMade = calls.filter(
      (c) => c[0] === "omp" && c[1] === "config" && c[2] === "set"
    );
    expect(setCallsMade.length).toBe(0);
  });

  it("returns empty array when record is empty (fresh)", async () => {
    const { fn } = makeSpawnFn([okGetResult({}), okSetResult()]);
    const removed = await deletePiOvenAgentModelOverrides({ spawnFn: fn });
    expect(removed).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// readAgentModelOverrides (graceful)
// ---------------------------------------------------------------------------

describe("readAgentModelOverrides", () => {
  it("parses .value from --json on success", async () => {
    const { fn } = makeSpawnFn([okGetResult({ "pi-oven:critic": "X" })]);
    const result = await readAgentModelOverrides({ spawnFn: fn });
    expect(result).toEqual({ "pi-oven:critic": "X" });
  });

  it("returns {} on get non-zero exit (graceful)", async () => {
    const { fn } = makeSpawnFn([
      { exitCode: 1, stdout: Buffer.from(""), stderr: Buffer.from("err") },
    ]);
    const result = await readAgentModelOverrides({ spawnFn: fn });
    expect(result).toEqual({});
  });

  it("returns {} on malformed JSON (graceful)", async () => {
    const { fn } = makeSpawnFn([
      { exitCode: 0, stdout: Buffer.from("not json{{{"), stderr: Buffer.from("") },
    ]);
    const result = await readAgentModelOverrides({ spawnFn: fn });
    expect(result).toEqual({});
  });

  it("returns {} on missing .value field (graceful)", async () => {
    const { fn } = makeSpawnFn([
      {
        exitCode: 0,
        stdout: Buffer.from(JSON.stringify({ key: "x", type: "record" })),
        stderr: Buffer.from(""),
      },
    ]);
    const result = await readAgentModelOverrides({ spawnFn: fn });
    expect(result).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// mergeDisabledProviders — PURE, no spawn
// ---------------------------------------------------------------------------

describe("mergeDisabledProviders", () => {
  it("add unions, preserves order, de-dupes", () => {
    const out = mergeDisabledProviders(["codex"], { op: "add", providers: ["claude", "claude-plugins"] });
    expect(out).toEqual(["codex", "claude", "claude-plugins"]);
  });

  it("add is idempotent when providers already present", () => {
    const out = mergeDisabledProviders(["claude", "claude-plugins"], {
      op: "add",
      providers: ["claude", "claude-plugins"],
    });
    expect(out).toEqual(["claude", "claude-plugins"]);
  });

  it("add onto empty yields the providers", () => {
    const out = mergeDisabledProviders([], { op: "add", providers: PI_OVEN_MANAGED_PROVIDERS });
    expect(out).toEqual(["claude", "claude-plugins"]);
  });

  it("remove deletes only listed providers, preserves siblings", () => {
    const out = mergeDisabledProviders(["codex", "claude", "claude-plugins"], {
      op: "remove",
      providers: ["claude", "claude-plugins"],
    });
    expect(out).toEqual(["codex"]);
  });

  it("remove when absent leaves the list unchanged", () => {
    const out = mergeDisabledProviders(["codex"], { op: "remove", providers: ["claude", "claude-plugins"] });
    expect(out).toEqual(["codex"]);
  });
});

// ---------------------------------------------------------------------------
// readDisabledProvidersStrict
// ---------------------------------------------------------------------------

describe("readDisabledProvidersStrict", () => {
  it("ok:true on array shape", async () => {
    const { fn } = makeSpawnFn([okGetArrayResult(["claude", "claude-plugins"])]);
    const result = await readDisabledProvidersStrict({ spawnFn: fn });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.list).toEqual(["claude", "claude-plugins"]);
  });

  it("ok:true list:[] on fresh empty array", async () => {
    const { fn } = makeSpawnFn([okGetArrayResult([])]);
    const result = await readDisabledProvidersStrict({ spawnFn: fn });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.list).toEqual([]);
  });

  it("ok:false when type != array (e.g. record)", async () => {
    const { fn } = makeSpawnFn([
      { exitCode: 0, stdout: Buffer.from(JSON.stringify({ value: {}, type: "record" })), stderr: Buffer.from("") },
    ]);
    const result = await readDisabledProvidersStrict({ spawnFn: fn });
    expect(result.ok).toBe(false);
  });

  it("ok:false when value is not an array", async () => {
    const { fn } = makeSpawnFn([
      { exitCode: 0, stdout: Buffer.from(JSON.stringify({ value: "oops", type: "array" })), stderr: Buffer.from("") },
    ]);
    const result = await readDisabledProvidersStrict({ spawnFn: fn });
    expect(result.ok).toBe(false);
  });

  it("ok:false on malformed JSON", async () => {
    const { fn } = makeSpawnFn([{ exitCode: 0, stdout: Buffer.from("not json{{{"), stderr: Buffer.from("") }]);
    const result = await readDisabledProvidersStrict({ spawnFn: fn });
    expect(result.ok).toBe(false);
  });

  it("ok:false on get non-zero exit", async () => {
    const { fn } = makeSpawnFn([{ exitCode: 1, stdout: Buffer.from(""), stderr: Buffer.from("err") }]);
    const result = await readDisabledProvidersStrict({ spawnFn: fn });
    expect(result.ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// setPiOvenDisabledProviders
// ---------------------------------------------------------------------------

describe("setPiOvenDisabledProviders", () => {
  it("get then set with merged array, preserves sibling providers", async () => {
    const { fn, calls } = makeSpawnFn([okGetArrayResult(["codex"]), okSetResult()]);
    const result = await setPiOvenDisabledProviders({ spawnFn: fn });
    expect(result).toEqual(["codex", "claude", "claude-plugins"]);

    expect(calls[0]).toEqual(["omp", "config", "get", "disabledProviders", "--json"]);
    expect(calls[1].slice(0, 4)).toEqual(["omp", "config", "set", "disabledProviders"]);
    expect(JSON.parse(calls[1][4])).toEqual(["codex", "claude", "claude-plugins"]);
  });

  it("idempotent — already-isolated config sets the same array", async () => {
    const { fn, calls } = makeSpawnFn([okGetArrayResult(["claude", "claude-plugins"]), okSetResult()]);
    await setPiOvenDisabledProviders({ spawnFn: fn });
    expect(JSON.parse(calls[1][4])).toEqual(["claude", "claude-plugins"]);
  });

  it("ABORTS on corrupt get — set NOT called (no sibling-wipe)", async () => {
    const { fn, calls } = makeSpawnFn([{ exitCode: 0, stdout: Buffer.from("not json{{{"), stderr: Buffer.from("") }]);
    await expect(setPiOvenDisabledProviders({ spawnFn: fn })).rejects.toThrow();
    expect(calls.filter((c) => c[2] === "set").length).toBe(0);
  });

  it("throws when get exits non-zero — set NOT called", async () => {
    const { fn, calls } = makeSpawnFn([{ exitCode: 1, stdout: Buffer.from(""), stderr: Buffer.from("err") }]);
    await expect(setPiOvenDisabledProviders({ spawnFn: fn })).rejects.toThrow();
    expect(calls.filter((c) => c[2] === "set").length).toBe(0);
  });

  it("throws when omp config set exits non-zero", async () => {
    const { fn } = makeSpawnFn([okGetArrayResult([]), { exitCode: 1, stdout: Buffer.from(""), stderr: Buffer.from("set failed") }]);
    await expect(setPiOvenDisabledProviders({ spawnFn: fn })).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// clearPiOvenDisabledProviders
// ---------------------------------------------------------------------------

describe("clearPiOvenDisabledProviders", () => {
  it("removes only managed providers, preserves siblings, returns removed sorted", async () => {
    const { fn, calls } = makeSpawnFn([okGetArrayResult(["codex", "claude", "claude-plugins"]), okSetResult()]);
    const removed = await clearPiOvenDisabledProviders({ spawnFn: fn });
    expect(removed).toEqual(["claude", "claude-plugins"]);
    expect(JSON.parse(calls[1][4])).toEqual(["codex"]);
  });

  it("no-op (no set call) when no managed providers present", async () => {
    const { fn, calls } = makeSpawnFn([okGetArrayResult(["codex"])]);
    const removed = await clearPiOvenDisabledProviders({ spawnFn: fn });
    expect(removed).toEqual([]);
    expect(calls.filter((c) => c[2] === "set").length).toBe(0);
  });

  it("no-op on empty array", async () => {
    const { fn, calls } = makeSpawnFn([okGetArrayResult([])]);
    const removed = await clearPiOvenDisabledProviders({ spawnFn: fn });
    expect(removed).toEqual([]);
    expect(calls.filter((c) => c[2] === "set").length).toBe(0);
  });

  it("ABORTS on corrupt get — set NOT called", async () => {
    const { fn, calls } = makeSpawnFn([{ exitCode: 0, stdout: Buffer.from("not json{{{"), stderr: Buffer.from("") }]);
    await expect(clearPiOvenDisabledProviders({ spawnFn: fn })).rejects.toThrow();
    expect(calls.filter((c) => c[2] === "set").length).toBe(0);
  });
});
