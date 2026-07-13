import { describe, it, expect } from "bun:test";
import { setMemoryAndAsyncConfig } from "../../../scripts/pi-oven-setup/config-yml";

// ---------------------------------------------------------------------------
// Helpers — mirror config-yml.test.ts style
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

function okSetResult(): SpawnResult {
  return { exitCode: 0, stdout: Buffer.from(""), stderr: Buffer.from("") };
}

// ---------------------------------------------------------------------------
// setMemoryAndAsyncConfig — writes 4 scalar keys via individual dotted-key sets
// ---------------------------------------------------------------------------

describe("setMemoryAndAsyncConfig", () => {
  it("issues exactly 4 `omp config set <dotted.key> <value>` calls for the 4 required keys", async () => {
    // 4 set calls, one per key
    const { fn, calls } = makeSpawnFn([
      okSetResult(),
      okSetResult(),
      okSetResult(),
      okSetResult(),
    ]);

    await setMemoryAndAsyncConfig({ spawnFn: fn });

    const setCalls = calls.filter((c) => c[0] === "omp" && c[1] === "config" && c[2] === "set");
    expect(setCalls.length).toBe(4);
  });

  it("writes memory.backend=mnemopi", async () => {
    const { fn, calls } = makeSpawnFn([
      okSetResult(),
      okSetResult(),
      okSetResult(),
      okSetResult(),
    ]);

    await setMemoryAndAsyncConfig({ spawnFn: fn });

    const call = calls.find((c) => c[3] === "memory.backend");
    expect(call).toBeDefined();
    expect(call![4]).toBe("mnemopi");
  });

  it("writes mnemopi.noEmbeddings=true", async () => {
    const { fn, calls } = makeSpawnFn([
      okSetResult(),
      okSetResult(),
      okSetResult(),
      okSetResult(),
    ]);

    await setMemoryAndAsyncConfig({ spawnFn: fn });

    const call = calls.find((c) => c[3] === "mnemopi.noEmbeddings");
    expect(call).toBeDefined();
    expect(call![4]).toBe("true");
  });

  it("writes mnemopi.llmMode=none", async () => {
    const { fn, calls } = makeSpawnFn([
      okSetResult(),
      okSetResult(),
      okSetResult(),
      okSetResult(),
    ]);

    await setMemoryAndAsyncConfig({ spawnFn: fn });

    const call = calls.find((c) => c[3] === "mnemopi.llmMode");
    expect(call).toBeDefined();
    expect(call![4]).toBe("none");
  });

  it("writes async.enabled=true", async () => {
    const { fn, calls } = makeSpawnFn([
      okSetResult(),
      okSetResult(),
      okSetResult(),
      okSetResult(),
    ]);

    await setMemoryAndAsyncConfig({ spawnFn: fn });

    const call = calls.find((c) => c[3] === "async.enabled");
    expect(call).toBeDefined();
    expect(call![4]).toBe("true");
  });

  it("uses `omp config set` (not omp config reset or get)", async () => {
    const { fn, calls } = makeSpawnFn([
      okSetResult(),
      okSetResult(),
      okSetResult(),
      okSetResult(),
    ]);

    await setMemoryAndAsyncConfig({ spawnFn: fn });

    for (const c of calls) {
      expect(c[0]).toBe("omp");
      expect(c[1]).toBe("config");
      expect(c[2]).toBe("set");
    }
  });

  it("throws (including stderr) when any omp config set exits non-zero", async () => {
    // First set fails
    const { fn } = makeSpawnFn([
      { exitCode: 1, stdout: Buffer.from(""), stderr: Buffer.from("set failed: memory.backend") },
    ]);

    await expect(setMemoryAndAsyncConfig({ spawnFn: fn })).rejects.toThrow(/memory.backend/);
  });

  it("does NOT touch task.agentModelOverrides (Spec E boundary)", async () => {
    const { fn, calls } = makeSpawnFn([
      okSetResult(),
      okSetResult(),
      okSetResult(),
      okSetResult(),
    ]);

    await setMemoryAndAsyncConfig({ spawnFn: fn });

    const overrideWrites = calls.filter((c) => c[3] === "task.agentModelOverrides");
    expect(overrideWrites.length).toBe(0);
  });

  it("does NOT touch modelRoles", async () => {
    const { fn, calls } = makeSpawnFn([
      okSetResult(),
      okSetResult(),
      okSetResult(),
      okSetResult(),
    ]);

    await setMemoryAndAsyncConfig({ spawnFn: fn });

    const modelRoleWrites = calls.filter((c) => c[3] === "modelRoles" || (typeof c[3] === "string" && c[3].startsWith("modelRoles.")));
    expect(modelRoleWrites.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// apply integration: user path calls setMemoryAndAsyncConfig
// ---------------------------------------------------------------------------

import { runApply } from "../../../scripts/pi-oven-setup/apply";

describe("runApply user path — memory + async keys written", () => {
  function makeUserPathSpawn() {
    const spawnCalls: Array<{ cmd: string; args: string[] }> = [];
    const values = new Map<string, unknown>();
    const mockSpawnFn = (cmd: string, args: string[]) => {
      spawnCalls.push({ cmd, args });
      // serve record-typed config gets used by runApply
      if (args[0] === "config" && args[1] === "get") {
        const key = args[2];
        const value = key === undefined ? {} : values.get(key) ?? {};
        return {
          exitCode: 0,
          stdout: Buffer.from(
            JSON.stringify({
              key,
              value,
              type: Array.isArray(value) ? "array" : typeof value === "object" ? "record" : typeof value,
              description: "",
            })
          ),
          stderr: Buffer.from(""),
        } as any;
      }
      if (args[0] === "config" && args[1] === "set" && args[2] !== undefined) {
        const raw = args[3] ?? "";
        let value: unknown = raw;
        try {
          value = JSON.parse(raw);
        } catch {
          // OMP scalar strings are transported without JSON quotes.
        }
        values.set(args[2], value);
      }
      if (args[0] === "config" && args[1] === "reset" && args[2] !== undefined) {
        values.delete(args[2]);
      }
      return { exitCode: 0, stdout: Buffer.from("ok"), stderr: Buffer.from("") } as any;
    };
    return { spawnCalls, mockSpawnFn };
  }

  it("writes memory.backend=mnemopi during user setup (no agentsDir)", async () => {
    const { spawnCalls, mockSpawnFn } = makeUserPathSpawn();

    await runApply({ profile: "A", validateMode: "none", spawnFn: mockSpawnFn });

    // spawnFn(cmd, args): cmd="omp", args=["config","set","memory.backend","mnemopi"]
    // spawnCalls stores { cmd, args } so args[0]="config", args[1]="set", args[2]=key, args[3]=value
    const call = spawnCalls.find((c) => c.args[1] === "set" && c.args[2] === "memory.backend");
    expect(call).toBeDefined();
    expect(call!.args[3]).toBe("mnemopi");
  });

  it("writes mnemopi.noEmbeddings=true during user setup", async () => {
    const { spawnCalls, mockSpawnFn } = makeUserPathSpawn();

    await runApply({ profile: "A", validateMode: "none", spawnFn: mockSpawnFn });

    const call = spawnCalls.find((c) => c.args[1] === "set" && c.args[2] === "mnemopi.noEmbeddings");
    expect(call).toBeDefined();
    expect(call!.args[3]).toBe("true");
  });

  it("writes mnemopi.llmMode=none during user setup", async () => {
    const { spawnCalls, mockSpawnFn } = makeUserPathSpawn();

    await runApply({ profile: "A", validateMode: "none", spawnFn: mockSpawnFn });

    const call = spawnCalls.find((c) => c.args[1] === "set" && c.args[2] === "mnemopi.llmMode");
    expect(call).toBeDefined();
    expect(call!.args[3]).toBe("none");
  });

  it("writes async.enabled=true during user setup", async () => {
    const { spawnCalls, mockSpawnFn } = makeUserPathSpawn();

    await runApply({ profile: "A", validateMode: "none", spawnFn: mockSpawnFn });

    const call = spawnCalls.find((c) => c.args[1] === "set" && c.args[2] === "async.enabled");
    expect(call).toBeDefined();
    expect(call!.args[3]).toBe("true");
  });

  it("does NOT write memory/async keys during maintainer path (agentsDir provided)", async () => {
    const { spawnCalls, mockSpawnFn } = makeUserPathSpawn();
    const { mkdirSync, writeFileSync, rmSync } = await import("fs");
    const { join } = await import("path");
    const { tmpdir } = await import("os");
    const { ROLES, DEFAULT_PROFILE } = await import("../../../scripts/pi-oven-setup/profiles");

    const dir = join(tmpdir(), `apply-mem-test-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    for (const role of ROLES) {
      writeFileSync(
        join(dir, `pov-${role}.md`),
        `---\nname: pov:${role}\ndescription: test\nmodel:\n  - ${DEFAULT_PROFILE[role].primary}\nthinkingLevel: ${DEFAULT_PROFILE[role].thinkingLevel}\nmode: subagent\ntools: ["*"]\nblocked_tools: []\n---\n\nBody.\n`,
        "utf-8"
      );
    }

    await runApply({ profile: "A", validateMode: "none", spawnFn: mockSpawnFn, agentsDir: dir });

    rmSync(dir, { recursive: true, force: true });

    const memoryWrites = spawnCalls.filter(
      (c) => c.args[2] === "memory.backend" || c.args[2] === "mnemopi.noEmbeddings" ||
             c.args[2] === "mnemopi.llmMode" || c.args[2] === "async.enabled"
    );
    expect(memoryWrites.length).toBe(0);
  });
});
