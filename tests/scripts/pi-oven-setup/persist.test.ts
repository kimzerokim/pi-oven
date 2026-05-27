import { describe, it, expect } from "bun:test";
import { readPluginConfig, writePluginConfig, deletePluginConfig } from "../../../scripts/pi-oven-setup/persist";
import { mkdirSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTempDir(): string {
  const dir = join(
    tmpdir(),
    `persist-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
  mkdirSync(dir, { recursive: true });
  return dir;
}

function makeLockFile(dir: string, settings: Record<string, unknown>): string {
  const lockPath = join(dir, "omp-plugins.lock.json");
  writeFileSync(lockPath, JSON.stringify({ settings }), "utf-8");
  return lockPath;
}

// ---------------------------------------------------------------------------
// readPluginConfig
// ---------------------------------------------------------------------------

describe("readPluginConfig", () => {
  it("returns pi-oven settings object from lock file", async () => {
    const dir = makeTempDir();
    try {
      makeLockFile(dir, {
        pi-oven: { "pi-oven.profile": "B", "pi-oven.models.executor.primary": "anthropic/claude-sonnet-4-6" },
      });
      const result = await readPluginConfig({ lockFilePath: join(dir, "omp-plugins.lock.json") });
      expect(result["pi-oven.profile"]).toBe("B");
      expect(result["pi-oven.models.executor.primary"]).toBe("anthropic/claude-sonnet-4-6");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("returns {} when lock file does not exist", async () => {
    const result = await readPluginConfig({
      lockFilePath: "/nonexistent/path/omp-plugins.lock.json",
    });
    expect(result).toEqual({});
  });

  it("returns {} when lock file has invalid JSON", async () => {
    const dir = makeTempDir();
    try {
      const lockPath = join(dir, "omp-plugins.lock.json");
      writeFileSync(lockPath, "not valid json{{{", "utf-8");
      const result = await readPluginConfig({ lockFilePath: lockPath });
      expect(result).toEqual({});
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("returns {} when settings.pi-oven is missing", async () => {
    const dir = makeTempDir();
    try {
      makeLockFile(dir, { other: { foo: "bar" } });
      const result = await readPluginConfig({ lockFilePath: join(dir, "omp-plugins.lock.json") });
      expect(result).toEqual({});
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("returns {} when settings.pi-oven is not an object", async () => {
    const dir = makeTempDir();
    try {
      makeLockFile(dir, { pi-oven: "not-an-object" });
      const result = await readPluginConfig({ lockFilePath: join(dir, "omp-plugins.lock.json") });
      expect(result).toEqual({});
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// writePluginConfig
// ---------------------------------------------------------------------------

describe("writePluginConfig", () => {
  it("calls omp plugin config set pi-oven <key> <value> with correct args", async () => {
    const calls: string[][] = [];
    const mockSpawnFn = (cmd: string, args: string[]) => {
      calls.push([cmd, ...args]);
      return { exitCode: 0, stdout: Buffer.from(""), stderr: Buffer.from("") } as any;
    };

    const result = await writePluginConfig("pi-oven.profile", "B", { spawnFn: mockSpawnFn });
    expect(result.ok).toBe(true);
    expect(calls.length).toBe(1);
    expect(calls[0]).toEqual(["omp", "plugin", "config", "set", "pi-oven", "pi-oven.profile", "B"]);
  });

  it("includes pi-oven as plugin name (bare, not pi-oven@pi-oven)", async () => {
    const calls: string[][] = [];
    const mockSpawnFn = (cmd: string, args: string[]) => {
      calls.push([cmd, ...args]);
      return { exitCode: 0, stdout: Buffer.from(""), stderr: Buffer.from("") } as any;
    };

    await writePluginConfig("pi-oven.models.executor.primary", "anthropic/claude-sonnet-4-6", {
      spawnFn: mockSpawnFn,
    });

    // "pi-oven" must appear as bare plugin name (index 4 after plugin config set)
    expect(calls[0][4]).toBe("pi-oven");
    // NOT "pi-oven@pi-oven"
    expect(calls[0].join(" ")).not.toContain("pi-oven@pi-oven");
  });

  it("returns ok=false and stderr on non-zero exit", async () => {
    const mockSpawnFn = (_cmd: string, _args: string[]) =>
      ({ exitCode: 1, stdout: Buffer.from(""), stderr: Buffer.from("Plugin not found") } as any);

    const result = await writePluginConfig("pi-oven.profile", "B", { spawnFn: mockSpawnFn });
    expect(result.ok).toBe(false);
    expect(result.stderr).toContain("Plugin not found");
  });
});

// ---------------------------------------------------------------------------
// deletePluginConfig
// ---------------------------------------------------------------------------

describe("deletePluginConfig", () => {
  it("calls omp plugin config delete pi-oven <key> with correct args", async () => {
    const calls: string[][] = [];
    const mockSpawnFn = (cmd: string, args: string[]) => {
      calls.push([cmd, ...args]);
      return { exitCode: 0, stdout: Buffer.from(""), stderr: Buffer.from("") } as any;
    };

    const result = await deletePluginConfig("pi-oven.profile", { spawnFn: mockSpawnFn });
    expect(result.ok).toBe(true);
    expect(calls[0]).toEqual(["omp", "plugin", "config", "delete", "pi-oven", "pi-oven.profile"]);
  });

  it("returns ok=false on non-zero exit", async () => {
    const mockSpawnFn = (_cmd: string, _args: string[]) =>
      ({ exitCode: 1, stdout: Buffer.from(""), stderr: Buffer.from("error") } as any);

    const result = await deletePluginConfig("pi-oven.profile", { spawnFn: mockSpawnFn });
    expect(result.ok).toBe(false);
  });
});
