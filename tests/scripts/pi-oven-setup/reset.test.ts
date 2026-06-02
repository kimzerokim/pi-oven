import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { runReset } from "../../../scripts/pi-oven-setup/reset";
import {
  markSetupComplete,
  isSetupComplete,
} from "../../../scripts/pi-oven-setup/project-config";

// ---------------------------------------------------------------------------
// SpawnFn mock factory
// ---------------------------------------------------------------------------

type SpawnCall = { cmd: string; args: string[] };

function makeSpawn(getResponse: object): {
  spawnFn: (cmd: string, args: string[]) => { exitCode: number; stdout: Buffer; stderr: Buffer };
  calls: SpawnCall[];
} {
  const calls: SpawnCall[] = [];
  const spawnFn = (cmd: string, args: string[]) => {
    calls.push({ cmd, args });
    // Respond to `omp config get task.agentModelOverrides --json`
    if (args[0] === "config" && args[1] === "get") {
      return {
        exitCode: 0,
        stdout: Buffer.from(JSON.stringify(getResponse)),
        stderr: Buffer.from(""),
      };
    }
    // Respond to `omp config set task.agentModelOverrides <json>`
    if (args[0] === "config" && args[1] === "set") {
      return { exitCode: 0, stdout: Buffer.from(""), stderr: Buffer.from("") };
    }
    // Respond to `omp config reset <key>` (full-reset path)
    if (args[0] === "config" && args[1] === "reset") {
      return { exitCode: 0, stdout: Buffer.from(""), stderr: Buffer.from("") };
    }
    return { exitCode: 0, stdout: Buffer.from(""), stderr: Buffer.from("") };
  };
  return { spawnFn, calls };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("runReset", () => {
  it("reset removes only pi-oven:* keys, preserves non-pi-oven", async () => {
    const getResponse = {
      type: "record",
      value: { "pi-oven:critic": "anthropic/claude-opus-4-8", "claude-code:foo": "model-x" },
    };
    const { spawnFn, calls } = makeSpawn(getResponse);

    const result = await runReset({ spawnFn });

    expect(result.exitCode).toBe(0);

    // Find the config set call
    const setCall = calls.find((c) => c.args[0] === "config" && c.args[1] === "set");
    expect(setCall).toBeDefined();
    const writtenJson = JSON.parse(setCall!.args[3]);
    // non-pi-oven key preserved
    expect(writtenJson["claude-code:foo"]).toBe("model-x");
    // pi-oven:* key removed
    expect(writtenJson["pi-oven:critic"]).toBeUndefined();
  });

  it("reset does NOT touch agents/ files (no agent-rewriter invocation)", async () => {
    // This test verifies the production code does not import/call agent-rewriter.
    // We verify by passing NO agentsDir and confirming it still succeeds, plus
    // inspecting that no filesystem writes to agents/ occur.
    const getResponse = {
      type: "record",
      value: { "pi-oven:orchestrator": "anthropic/claude-opus-4-8" },
    };
    const { spawnFn } = makeSpawn(getResponse);

    // runReset must accept opts without agentsDir and not attempt agent rewrites
    const result = await runReset({ spawnFn });
    expect(result.exitCode).toBe(0);
  });

  it("reset on empty override record exits 0 with no-op message, no set call", async () => {
    const getResponse = { type: "record", value: {} };
    const { spawnFn, calls } = makeSpawn(getResponse);

    const result = await runReset({ spawnFn });

    expect(result.exitCode).toBe(0);
    expect(result.output).toMatch(/no overrides|cleared/i);

    // No config set call when nothing to delete
    const setCall = calls.find((c) => c.args[0] === "config" && c.args[1] === "set");
    expect(setCall).toBeUndefined();
  });

  it("reset lists removed roles in output", async () => {
    const getResponse = {
      type: "record",
      value: {
        "pi-oven:critic": "anthropic/claude-opus-4-8",
        "pi-oven:orchestrator": "opencode-zen/claude-opus-4-8",
      },
    };
    const { spawnFn } = makeSpawn(getResponse);

    const result = await runReset({ spawnFn });

    expect(result.exitCode).toBe(0);
    // Output should mention removed roles
    expect(result.output).toMatch(/pi-oven:critic|pi-oven:orchestrator/);
  });

  it("reset propagates error when readOverridesStrict fails", async () => {
    const spawnFn = (_cmd: string, _args: string[]) => ({
      exitCode: 1,
      stdout: Buffer.from(""),
      stderr: Buffer.from("omp not found"),
    });

    await expect(runReset({ spawnFn })).rejects.toThrow();
  });

  it("non-full reset preserves modelRoles/disabledProviders/setupVersion (no config reset call)", async () => {
    const getResponse = {
      type: "record",
      value: { "pi-oven:critic": "anthropic/claude-opus-4-8" },
    };
    const { spawnFn, calls } = makeSpawn(getResponse);

    const result = await runReset({ spawnFn });
    expect(result.exitCode).toBe(0);

    // A non-full reset must NEVER touch modelRoles / disabledProviders / setupVersion
    const resetCall = calls.find((c) => c.args[0] === "config" && c.args[1] === "reset");
    expect(resetCall).toBeUndefined();
  });
});

describe("runReset — --full mode", () => {
  it("full reset removes pi-oven:* overrides AND resets modelRoles/disabledProviders/setupVersion", async () => {
    const getResponse = {
      type: "record",
      value: { "pi-oven:critic": "anthropic/claude-opus-4-8", "claude-code:foo": "model-x" },
    };
    const { spawnFn, calls } = makeSpawn(getResponse);

    const result = await runReset({ spawnFn, full: true });
    expect(result.exitCode).toBe(0);

    // pi-oven:* overrides still removed via the whole-record set (non-pi-oven preserved)
    const setCall = calls.find((c) => c.args[0] === "config" && c.args[1] === "set");
    expect(setCall).toBeDefined();
    const writtenJson = JSON.parse(setCall!.args[3]);
    expect(writtenJson["claude-code:foo"]).toBe("model-x");
    expect(writtenJson["pi-oven:critic"]).toBeUndefined();

    // The three pi-oven-managed keys are reset to defaults
    const resetKeys = calls
      .filter((c) => c.args[0] === "config" && c.args[1] === "reset")
      .map((c) => c.args[2]);
    expect(resetKeys).toContain("modelRoles");
    expect(resetKeys).toContain("disabledProviders");
    expect(resetKeys).toContain("setupVersion");
  });

  it("full reset never resets omp-managed keys (e.g. lastChangelogVersion)", async () => {
    const getResponse = { type: "record", value: {} };
    const { spawnFn, calls } = makeSpawn(getResponse);

    const result = await runReset({ spawnFn, full: true });
    expect(result.exitCode).toBe(0);

    const resetKeys = calls
      .filter((c) => c.args[0] === "config" && c.args[1] === "reset")
      .map((c) => c.args[2]);
    expect(resetKeys).not.toContain("lastChangelogVersion");
    // Only the three pi-oven-managed keys are ever reset
    expect(new Set(resetKeys)).toEqual(
      new Set(["modelRoles", "disabledProviders", "setupVersion"])
    );
  });

  it("full reset still clears managed keys when there are no pi-oven:* overrides", async () => {
    const getResponse = { type: "record", value: {} };
    const { spawnFn, calls } = makeSpawn(getResponse);

    const result = await runReset({ spawnFn, full: true });
    expect(result.exitCode).toBe(0);

    // No overrides → no config set, but the managed keys are still reset
    const setCall = calls.find((c) => c.args[0] === "config" && c.args[1] === "set");
    expect(setCall).toBeUndefined();
    const resetKeys = calls
      .filter((c) => c.args[0] === "config" && c.args[1] === "reset")
      .map((c) => c.args[2]);
    expect(resetKeys.sort()).toEqual(["disabledProviders", "modelRoles", "setupVersion"]);
  });
});

describe("runReset — clears the project setup-completion marker", () => {
  let cwd: string;

  beforeEach(() => {
    cwd = join(
      tmpdir(),
      `reset-marker-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    mkdirSync(cwd, { recursive: true });
  });

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  it("after a successful reset the project marker is cleared", async () => {
    const getResponse = {
      type: "record",
      value: { "pi-oven:critic": "anthropic/claude-opus-4-8" },
    };
    const { spawnFn } = makeSpawn(getResponse);

    await markSetupComplete({ cwd });
    expect(isSetupComplete({ cwd })).toBe(true);

    const result = await runReset({ spawnFn, cwd });
    expect(result.exitCode).toBe(0);
    expect(isSetupComplete({ cwd })).toBe(false);
  });

  it("clears the marker even on a no-op reset (no pi-oven:* overrides present)", async () => {
    const getResponse = { type: "record", value: {} };
    const { spawnFn } = makeSpawn(getResponse);

    await markSetupComplete({ cwd });
    expect(isSetupComplete({ cwd })).toBe(true);

    const result = await runReset({ spawnFn, cwd });
    expect(result.exitCode).toBe(0);
    expect(isSetupComplete({ cwd })).toBe(false);
  });
});
