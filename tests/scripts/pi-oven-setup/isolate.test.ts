import { describe, it, expect } from "bun:test";
import { runIsolate } from "../../../scripts/pi-oven-setup/isolate";

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

function okGetArrayResult(value: string[]): SpawnResult {
  return {
    exitCode: 0,
    stdout: Buffer.from(JSON.stringify({ key: "disabledProviders", value, type: "array", description: "" })),
    stderr: Buffer.from(""),
  };
}

function okSetResult(): SpawnResult {
  return { exitCode: 0, stdout: Buffer.from(""), stderr: Buffer.from("") };
}

describe("runIsolate — enable", () => {
  it("writes disabledProviders = [claude] and reports the ignored layer", async () => {
    const { fn, calls } = makeSpawnFn([okGetArrayResult([]), okSetResult()]);
    const result = await runIsolate({ enable: true, spawnFn: fn });
    expect(result.exitCode).toBe(0);
    expect(result.output).toContain("IGNORE the ~/.claude");
    expect(result.output).toContain("claude");
    // claude-plugins must NOT be disabled — pi-oven's own /pi-oven:* commands load through it
    expect(result.output).toContain("claude-plugins");
    expect(JSON.parse(calls[1][4])).toEqual(["claude"]);
  });

  it("preserves a pre-existing sibling provider", async () => {
    const { fn, calls } = makeSpawnFn([okGetArrayResult(["codex"]), okSetResult()]);
    const result = await runIsolate({ enable: true, spawnFn: fn });
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(calls[1][4])).toEqual(["codex", "claude"]);
  });

  it("migrates a buggy pre-0.5.3 [claude, claude-plugins] config to [claude]", async () => {
    const { fn, calls } = makeSpawnFn([okGetArrayResult(["claude", "claude-plugins"]), okSetResult()]);
    const result = await runIsolate({ enable: true, spawnFn: fn });
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(calls[1][4])).toEqual(["claude"]);
  });

  it("exit 1 with a failure message when the read fails (no set)", async () => {
    const { fn, calls } = makeSpawnFn([{ exitCode: 1, stdout: Buffer.from(""), stderr: Buffer.from("err") }]);
    const result = await runIsolate({ enable: true, spawnFn: fn });
    expect(result.exitCode).toBe(1);
    expect(result.output).toContain("Isolation toggle failed");
    expect(calls.filter((c) => c[2] === "set").length).toBe(0);
  });
});

describe("runIsolate — disable (--no-isolate)", () => {
  it("removes managed + legacy providers and reports re-enable", async () => {
    const { fn, calls } = makeSpawnFn([okGetArrayResult(["claude", "claude-plugins"]), okSetResult()]);
    const result = await runIsolate({ enable: false, spawnFn: fn });
    expect(result.exitCode).toBe(0);
    expect(result.output).toContain("Re-enabled the ~/.claude layer");
    expect(JSON.parse(calls[1][4])).toEqual([]);
  });

  it("removes only claude when the config has no legacy claude-plugins", async () => {
    const { fn, calls } = makeSpawnFn([okGetArrayResult(["codex", "claude"]), okSetResult()]);
    const result = await runIsolate({ enable: false, spawnFn: fn });
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(calls[1][4])).toEqual(["codex"]);
  });

  it("reports nothing-to-undo when not isolated (no set call)", async () => {
    const { fn, calls } = makeSpawnFn([okGetArrayResult([])]);
    const result = await runIsolate({ enable: false, spawnFn: fn });
    expect(result.exitCode).toBe(0);
    expect(result.output).toContain("nothing to undo");
    expect(calls.filter((c) => c[2] === "set").length).toBe(0);
  });
});
