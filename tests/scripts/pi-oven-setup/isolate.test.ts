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

const LEGACY_FRONT_DOOR_BOUNDARY_LINE =
  "global-only maintenance paths, owned by pi-oven maintainers, and must be removed once the omp-native control plane owns those surfaces end-to-end.";

describe("runIsolate — enable", () => {
  it("writes disabledProviders = [claude] and reports the legacy home-layer compatibility aid", async () => {
    const { fn, calls } = makeSpawnFn([okGetArrayResult([]), okSetResult()]);
    const result = await runIsolate({ enable: true, spawnFn: fn });
    expect(result.exitCode).toBe(0);
    expect(result.output).toContain("legacy home-layer compatibility aid");
    expect(result.output).toContain("compatibility helper only");
    expect(result.output).toContain("Empty ~/.claude/skills is not the target state");
    expect(result.output).toContain("claude");
    // claude-plugins must NOT be disabled — pi-oven's own /pi-oven:* commands load through it
    expect(result.output).toContain("claude-plugins");
    expect(result.output).toContain("namespaced marketplace workflow skills");
    expect(result.output).toContain(LEGACY_FRONT_DOOR_BOUNDARY_LINE);
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

  it("exit 1 with a compatibility-aid failure message when the read fails (no set)", async () => {
    const { fn, calls } = makeSpawnFn([{ exitCode: 1, stdout: Buffer.from(""), stderr: Buffer.from("err") }]);
    const result = await runIsolate({ enable: true, spawnFn: fn });
    expect(result.exitCode).toBe(1);
    expect(result.output).toContain("Legacy home-layer compatibility aid failed");
    expect(calls.filter((c) => c[2] === "set").length).toBe(0);
  });
});

describe("runIsolate — disable (--no-isolate)", () => {
  it("removes managed + legacy providers and reports compatibility-aid removal", async () => {
    const { fn, calls } = makeSpawnFn([okGetArrayResult(["claude", "claude-plugins"]), okSetResult()]);
    const result = await runIsolate({ enable: false, spawnFn: fn });
    expect(result.exitCode).toBe(0);
    expect(result.output).toContain("Cleared the legacy home-layer compatibility aid");
    expect(JSON.parse(calls[1][4])).toEqual([]);
  });

  it("removes only claude when the config has no legacy claude-plugins", async () => {
    const { fn, calls } = makeSpawnFn([okGetArrayResult(["codex", "claude"]), okSetResult()]);
    const result = await runIsolate({ enable: false, spawnFn: fn });
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(calls[1][4])).toEqual(["codex"]);
  });

  it("reports no compatibility-aid to undo when not isolated (no set call)", async () => {
    const { fn, calls } = makeSpawnFn([okGetArrayResult([])]);
    const result = await runIsolate({ enable: false, spawnFn: fn });
    expect(result.exitCode).toBe(0);
    expect(result.output).toContain("no compatibility aid to undo");
    expect(calls.filter((c) => c[2] === "set").length).toBe(0);
  });
});
