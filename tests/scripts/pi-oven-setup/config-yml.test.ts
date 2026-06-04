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
  readModelRolesStrict,
  setModelRoles,
  readRetryFallbackChains,
  setRetryFallbackChains,
  PI_OVEN_MANAGED_PROVIDERS,
  PI_OVEN_DEPRECATED_PROVIDERS,
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

function okGetModelRolesResult(value: Record<string, string>): SpawnResult {
  return {
    exitCode: 0,
    stdout: Buffer.from(
      JSON.stringify({
        key: "modelRoles",
        value,
        type: "record",
        description: "",
      })
    ),
    stderr: Buffer.from(""),
  };
}

function okGetFallbackChainsResult(value: Record<string, string[]>): SpawnResult {
  return {
    exitCode: 0,
    stdout: Buffer.from(
      JSON.stringify({
        key: "retry.fallbackChains",
        value,
        type: "record",
        description: "",
      })
    ),
    stderr: Buffer.from(""),
  };
}

// ---------------------------------------------------------------------------
// PI_OVEN_MANAGED_PROVIDERS / PI_OVEN_DEPRECATED_PROVIDERS — the isolate provider sets
// ---------------------------------------------------------------------------

describe("PI_OVEN provider constants", () => {
  it("PI_OVEN_MANAGED_PROVIDERS is claude ONLY (never claude-plugins)", () => {
    expect([...PI_OVEN_MANAGED_PROVIDERS]).toEqual(["claude"]);
  });

  it("PI_OVEN_DEPRECATED_PROVIDERS is the legacy claude-plugins entry to purge", () => {
    expect([...PI_OVEN_DEPRECATED_PROVIDERS]).toEqual(["claude-plugins"]);
  });
});

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
    expect(out).toEqual(["claude"]);
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
    expect(result).toEqual(["codex", "claude"]);

    expect(calls[0]).toEqual(["omp", "config", "get", "disabledProviders", "--json"]);
    expect(calls[1].slice(0, 4)).toEqual(["omp", "config", "set", "disabledProviders"]);
    expect(JSON.parse(calls[1][4])).toEqual(["codex", "claude"]);
  });

  it("idempotent — already-isolated config sets claude only", async () => {
    const { fn, calls } = makeSpawnFn([okGetArrayResult(["claude"]), okSetResult()]);
    const result = await setPiOvenDisabledProviders({ spawnFn: fn });
    expect(result).toEqual(["claude"]);
    expect(JSON.parse(calls[1][4])).toEqual(["claude"]);
  });

  it("migrates a buggy pre-0.5.3 [claude, claude-plugins] config to [claude]", async () => {
    const { fn, calls } = makeSpawnFn([okGetArrayResult(["claude", "claude-plugins"]), okSetResult()]);
    const result = await setPiOvenDisabledProviders({ spawnFn: fn });
    expect(result).toEqual(["claude"]);
    expect(JSON.parse(calls[1][4])).toEqual(["claude"]);
  });

  it("migrates [codex, claude-plugins] to [codex, claude] (purge legacy, add managed)", async () => {
    const { fn, calls } = makeSpawnFn([okGetArrayResult(["codex", "claude-plugins"]), okSetResult()]);
    const result = await setPiOvenDisabledProviders({ spawnFn: fn });
    expect(result).toEqual(["codex", "claude"]);
    expect(JSON.parse(calls[1][4])).toEqual(["codex", "claude"]);
  });

  it("adds claude onto a fresh empty config", async () => {
    const { fn, calls } = makeSpawnFn([okGetArrayResult([]), okSetResult()]);
    const result = await setPiOvenDisabledProviders({ spawnFn: fn });
    expect(result).toEqual(["claude"]);
    expect(JSON.parse(calls[1][4])).toEqual(["claude"]);
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

// ---------------------------------------------------------------------------
// readModelRolesStrict — fail-closed strict read of the modelRoles record
// ---------------------------------------------------------------------------

describe("readModelRolesStrict", () => {
  it("ok:true on record shape, spawns `omp config get modelRoles --json`", async () => {
    const { fn, calls } = makeSpawnFn([
      okGetModelRolesResult({ default: "m", title: "t" }),
    ]);
    const result = await readModelRolesStrict({ spawnFn: fn });
    expect(calls[0]).toEqual(["omp", "config", "get", "modelRoles", "--json"]);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.record).toEqual({ default: "m", title: "t" });
  });

  it("ok:true record:{} on fresh empty value", async () => {
    const { fn } = makeSpawnFn([okGetModelRolesResult({})]);
    const result = await readModelRolesStrict({ spawnFn: fn });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.record).toEqual({});
  });

  it("ok:false on malformed JSON (fail-closed)", async () => {
    const { fn } = makeSpawnFn([
      { exitCode: 0, stdout: Buffer.from("not json{{{"), stderr: Buffer.from("") },
    ]);
    const result = await readModelRolesStrict({ spawnFn: fn });
    expect(result.ok).toBe(false);
  });

  it("ok:false on get non-zero exit", async () => {
    const { fn } = makeSpawnFn([
      { exitCode: 1, stdout: Buffer.from(""), stderr: Buffer.from("err") },
    ]);
    const result = await readModelRolesStrict({ spawnFn: fn });
    expect(result.ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// setModelRoles — atomic whole-record merge-write of modelRoles
// ---------------------------------------------------------------------------

describe("setModelRoles", () => {
  it("read-merge-writes the WHOLE modelRoles record (key is exactly `modelRoles`, NOT dotted) and PRESERVES siblings", async () => {
    const { fn, calls } = makeSpawnFn([
      okGetModelRolesResult({ default: "old", title: "old", someSibling: "keep" }),
      okSetResult(),
    ]);
    await setModelRoles(
      { default: "openai-codex/gpt-5.4:high", title: "openai-codex/gpt-5.4-mini:low" },
      { spawnFn: fn }
    );

    // get call
    expect(calls[0]).toEqual(["omp", "config", "get", "modelRoles", "--json"]);

    // exactly ONE set call, whole-record (NOT modelRoles.default / modelRoles.title)
    const setCalls = calls.filter((c) => c[2] === "set");
    expect(setCalls.length).toBe(1);
    expect(setCalls[0][3]).toBe("modelRoles");
    expect(setCalls[0][3]).not.toBe("modelRoles.default");
    expect(setCalls[0][3]).not.toBe("modelRoles.title");

    // value is the MERGED whole-record JSON: new default+title AND preserved sibling
    const merged = JSON.parse(setCalls[0][4]);
    expect(merged).toEqual({
      default: "openai-codex/gpt-5.4:high",
      title: "openai-codex/gpt-5.4-mini:low",
      someSibling: "keep",
    });
  });

  it("ABORTS on corrupt get — set NOT called (never merge-into-{})", async () => {
    const { fn, calls } = makeSpawnFn([
      { exitCode: 0, stdout: Buffer.from("not json{{{"), stderr: Buffer.from("") },
    ]);
    await expect(
      setModelRoles({ default: "x", title: "y" }, { spawnFn: fn })
    ).rejects.toThrow();
    expect(calls.filter((c) => c[2] === "set").length).toBe(0);
  });

  it("throws when get exits non-zero — set NOT called", async () => {
    const { fn, calls } = makeSpawnFn([
      { exitCode: 1, stdout: Buffer.from(""), stderr: Buffer.from("err") },
    ]);
    await expect(
      setModelRoles({ default: "x", title: "y" }, { spawnFn: fn })
    ).rejects.toThrow();
    expect(calls.filter((c) => c[2] === "set").length).toBe(0);
  });

  it("throws (including stderr) when omp config set exits non-zero", async () => {
    const { fn } = makeSpawnFn([
      okGetModelRolesResult({}),
      { exitCode: 1, stdout: Buffer.from(""), stderr: Buffer.from("boom") },
    ]);
    await expect(
      setModelRoles({ default: "x", title: "y" }, { spawnFn: fn })
    ).rejects.toThrow(/boom/);
  });

  it("writes onto a fresh empty modelRoles record", async () => {
    const { fn, calls } = makeSpawnFn([okGetModelRolesResult({}), okSetResult()]);
    await setModelRoles({ default: "d", title: "t" }, { spawnFn: fn });
    const setCalls = calls.filter((c) => c[2] === "set");
    expect(setCalls[0][3]).toBe("modelRoles");
    expect(JSON.parse(setCalls[0][4])).toEqual({ default: "d", title: "t" });
  });
});

// ---------------------------------------------------------------------------
// readRetryFallbackChains (fail-soft)
// ---------------------------------------------------------------------------

describe("readRetryFallbackChains", () => {
  it("returns the record on success", async () => {
    const { fn } = makeSpawnFn([
      okGetFallbackChainsResult({ default: ["fallback-1"] }),
    ]);
    const record = await readRetryFallbackChains({ spawnFn: fn });
    expect(record.default).toEqual(["fallback-1"]);
  });

  it("fail-soft returns {} on non-zero exit", async () => {
    const { fn } = makeSpawnFn([{ exitCode: 1, stderr: Buffer.from("fail") }]);
    const record = await readRetryFallbackChains({ spawnFn: fn });
    expect(record).toEqual({});
  });

  it("fail-soft returns {} on a non-record shape", async () => {
    const { fn } = makeSpawnFn([
      { exitCode: 0, stdout: Buffer.from("not json"), stderr: Buffer.from("") },
    ]);
    const record = await readRetryFallbackChains({ spawnFn: fn });
    expect(record).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// setRetryFallbackChains
// ---------------------------------------------------------------------------

describe("setRetryFallbackChains", () => {
  it("merges and writes the record", async () => {
    const { fn, calls } = makeSpawnFn([
      okGetFallbackChainsResult({ existing: ["old"] }),
      okSetResult(),
    ]);
    await setRetryFallbackChains({ new: ["val"] }, { spawnFn: fn });

    expect(calls).toHaveLength(2);
    expect(calls[0]).toEqual(["omp", "config", "get", "retry.fallbackChains", "--json"]);
    expect(calls[1]).toEqual([
      "omp",
      "config",
      "set",
      "retry.fallbackChains",
      JSON.stringify({ existing: ["old"], new: ["val"] }),
    ]);
  });

  it("tolerates a read failure (fail-soft) and still writes the provided chains", async () => {
    const { fn, calls } = makeSpawnFn([
      { exitCode: 1, stderr: Buffer.from("fail") },
      okSetResult(),
    ]);
    await setRetryFallbackChains({ default: ["x"] }, { spawnFn: fn });
    expect(calls).toHaveLength(2);
    expect(calls[1]).toEqual([
      "omp",
      "config",
      "set",
      "retry.fallbackChains",
      JSON.stringify({ default: ["x"] }),
    ]);
  });

  it("throws if set fails", async () => {
    const { fn } = makeSpawnFn([
      okGetFallbackChainsResult({}),
      { exitCode: 1, stderr: Buffer.from("set-fail") },
    ]);
    await expect(setRetryFallbackChains({}, { spawnFn: fn })).rejects.toThrow(
      /omp config set retry.fallbackChains failed/
    );
  });
});

describe("clearPiOvenDisabledProviders", () => {
  it("removes managed + legacy providers, preserves siblings, returns removed sorted", async () => {
    const { fn, calls } = makeSpawnFn([okGetArrayResult(["codex", "claude", "claude-plugins"]), okSetResult()]);
    const removed = await clearPiOvenDisabledProviders({ spawnFn: fn });
    expect(removed).toEqual(["claude", "claude-plugins"]);
    expect(JSON.parse(calls[1][4])).toEqual(["codex"]);
  });

  it("removes a buggy pre-0.5.3 [claude, claude-plugins] config to []", async () => {
    const { fn, calls } = makeSpawnFn([okGetArrayResult(["claude", "claude-plugins"]), okSetResult()]);
    const removed = await clearPiOvenDisabledProviders({ spawnFn: fn });
    expect(removed).toEqual(["claude", "claude-plugins"]);
    expect(JSON.parse(calls[1][4])).toEqual([]);
  });

  it("removes only claude when claude-plugins absent (preserves siblings)", async () => {
    const { fn, calls } = makeSpawnFn([okGetArrayResult(["codex", "claude"]), okSetResult()]);
    const removed = await clearPiOvenDisabledProviders({ spawnFn: fn });
    expect(removed).toEqual(["claude"]);
    expect(JSON.parse(calls[1][4])).toEqual(["codex"]);
  });

  it("removes a lone legacy claude-plugins entry", async () => {
    const { fn, calls } = makeSpawnFn([okGetArrayResult(["claude-plugins"]), okSetResult()]);
    const removed = await clearPiOvenDisabledProviders({ spawnFn: fn });
    expect(removed).toEqual(["claude-plugins"]);
    expect(JSON.parse(calls[1][4])).toEqual([]);
  });

  it("no-op (no set call) when no managed/legacy providers present", async () => {
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
