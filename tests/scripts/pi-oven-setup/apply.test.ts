import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { runApply } from "../../../scripts/pi-oven-setup/apply";
import { ROLES, PROFILE_A, PROFILE_B } from "../../../scripts/pi-oven-setup/profiles";
import { readAgentFiles } from "../../../scripts/pi-oven-setup/agent-rewriter";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTempDir(): string {
  const dir = join(
    tmpdir(),
    `apply-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
  mkdirSync(dir, { recursive: true });
  return dir;
}

function makeAgentFile(
  agentsDir: string,
  role: string,
  primary: string,
  alternate: string,
  thinkingLevel: string
): void {
  const content = `---
name: pi-oven:${role}
description: Test agent for ${role}
model:
  - ${primary}
  - ${alternate}
thinkingLevel: ${thinkingLevel}
mode: subagent
tools: ["*"]
blocked_tools: []
---

## Role

You are pi-oven:${role}.
`;
  writeFileSync(join(agentsDir, `pi-oven-${role}.md`), content, "utf-8");
}

function populateAgents(agentsDir: string, profile: typeof PROFILE_A): void {
  for (const role of ROLES) {
    makeAgentFile(
      agentsDir,
      role,
      profile[role].primary,
      profile[role].registry_alternate,
      profile[role].thinkingLevel
    );
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("runApply", () => {
  let tempDir: string;
  let agentsDir: string;
  let lockPath: string;

  beforeEach(() => {
    tempDir = makeTempDir();
    agentsDir = join(tempDir, "agents");
    lockPath = join(tempDir, "omp-plugins.lock.json");
    mkdirSync(agentsDir, { recursive: true });
    writeFileSync(lockPath, JSON.stringify({ settings: { pi-oven: {} } }), "utf-8");
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("Profile B apply calls writePluginConfig for pi-oven.profile = B", async () => {
    const setCalls: Array<{ key: string; value: string }> = [];
    const mockSpawnFn = (_cmd: string, args: string[]) => {
      // args = ["plugin","config","set","pi-oven",<key>,<value>]
      if (args[2] === "set") {
        setCalls.push({ key: args[4], value: args[5] });
      }
      return { exitCode: 0, stdout: Buffer.from("ok"), stderr: Buffer.from("") } as any;
    };

    populateAgents(agentsDir, PROFILE_A);

    await runApply({
      profile: "B",
      validateMode: "none",
      spawnFn: mockSpawnFn,
      agentsDir,
      lockFilePath: lockPath,
    });

    const profileCall = setCalls.find((c) => c.key === "pi-oven.profile");
    expect(profileCall).toBeDefined();
    expect(profileCall!.value).toBe("B");
  });

  it("Profile B apply persists pi-oven.provider.anthropic.enabled = true", async () => {
    const setCalls: Array<{ key: string; value: string }> = [];
    const mockSpawnFn = (_cmd: string, args: string[]) => {
      // args = ["plugin","config","set","pi-oven",<key>,<value>]
      if (args[2] === "set") {
        setCalls.push({ key: args[4], value: args[5] });
      }
      return { exitCode: 0, stdout: Buffer.from("ok"), stderr: Buffer.from("") } as any;
    };

    populateAgents(agentsDir, PROFILE_A);

    await runApply({
      profile: "B",
      validateMode: "none",
      spawnFn: mockSpawnFn,
      agentsDir,
      lockFilePath: lockPath,
    });

    const anthropicCall = setCalls.find((c) => c.key === "pi-oven.provider.anthropic.enabled");
    expect(anthropicCall).toBeDefined();
    expect(anthropicCall!.value).toBe("true");
  });

  it("Profile B apply persists 71 config keys (23 roles × 3 keys + pi-oven.profile + anthropic.enabled)", async () => {
    const setCalls: Array<{ key: string; value: string }> = [];
    const mockSpawnFn = (_cmd: string, args: string[]) => {
      // args = ["plugin","config","set","pi-oven",<key>,<value>]
      if (args[2] === "set") {
        setCalls.push({ key: args[4], value: args[5] });
      }
      return { exitCode: 0, stdout: Buffer.from("ok"), stderr: Buffer.from("") } as any;
    };

    populateAgents(agentsDir, PROFILE_A);

    await runApply({
      profile: "B",
      validateMode: "none",
      spawnFn: mockSpawnFn,
      agentsDir,
      lockFilePath: lockPath,
    });

    // pi-oven.profile + pi-oven.provider.anthropic.enabled + 23 × 3 = 71
    expect(setCalls.length).toBe(71);
  });

  it("Profile B apply rewrites all 23 agent files to Profile B values", async () => {
    const mockSpawnFn = (_cmd: string, _args: string[]) =>
      ({ exitCode: 0, stdout: Buffer.from("ok"), stderr: Buffer.from("") } as any);

    populateAgents(agentsDir, PROFILE_A);

    await runApply({
      profile: "B",
      validateMode: "none",
      spawnFn: mockSpawnFn,
      agentsDir,
      lockFilePath: lockPath,
    });

    const entries = await readAgentFiles(agentsDir);
    expect(entries.length).toBe(23);
    const executor = entries.find((e) => e.role === "executor")!;
    expect(executor.currentModel[0]).toBe(PROFILE_B.executor.primary);
    expect(executor.currentModel[1]).toBe(PROFILE_B.executor.registry_alternate);
  });

  it("Profile A apply does NOT persist pi-oven.provider.anthropic.enabled=true", async () => {
    const setCalls: Array<{ key: string; value: string }> = [];
    const mockSpawnFn = (_cmd: string, args: string[]) => {
      // args = ["plugin","config","set","pi-oven",<key>,<value>]
      if (args[2] === "set") {
        setCalls.push({ key: args[4], value: args[5] });
      }
      return { exitCode: 0, stdout: Buffer.from("ok"), stderr: Buffer.from("") } as any;
    };

    populateAgents(agentsDir, PROFILE_A);

    await runApply({
      profile: "A",
      validateMode: "none",
      spawnFn: mockSpawnFn,
      agentsDir,
      lockFilePath: lockPath,
    });

    const anthropicCall = setCalls.find(
      (c) => c.key === "pi-oven.provider.anthropic.enabled" && c.value === "true"
    );
    expect(anthropicCall).toBeUndefined();
  });

  it("returns exitCode 1 when validateMode=smoke and all pings fail", async () => {
    const mockSpawnFn = (_cmd: string, args: string[]) => {
      // config set calls succeed; omp -p ping calls fail
      if (args[0] === "-p") {
        return { exitCode: 1, stdout: Buffer.from(""), stderr: Buffer.from("error") } as any;
      }
      return { exitCode: 0, stdout: Buffer.from("ok"), stderr: Buffer.from("") } as any;
    };

    populateAgents(agentsDir, PROFILE_A);

    const result = await runApply({
      profile: "A",
      validateMode: "smoke",
      spawnFn: mockSpawnFn,
      agentsDir,
      lockFilePath: lockPath,
    });
    expect(result.exitCode).toBe(1);
  });

  it("applies overrides: executor primary overridden to custom model", async () => {
    const mockSpawnFn = (_cmd: string, _args: string[]) =>
      ({ exitCode: 0, stdout: Buffer.from("ok"), stderr: Buffer.from("") } as any);

    populateAgents(agentsDir, PROFILE_A);

    await runApply({
      profile: "A",
      overrides: { executor: { primary: "opencode-zen/custom-model" } },
      validateMode: "none",
      spawnFn: mockSpawnFn,
      agentsDir,
      lockFilePath: lockPath,
    });

    const entries = await readAgentFiles(agentsDir);
    const executor = entries.find((e) => e.role === "executor")!;
    expect(executor.currentModel[0]).toBe("opencode-zen/custom-model");
  });

  it("returns exitCode 0 on successful Profile B apply with validateMode=none", async () => {
    const mockSpawnFn = (_cmd: string, _args: string[]) =>
      ({ exitCode: 0, stdout: Buffer.from("ok"), stderr: Buffer.from("") } as any);

    populateAgents(agentsDir, PROFILE_A);

    const result = await runApply({
      profile: "B",
      validateMode: "none",
      spawnFn: mockSpawnFn,
      agentsDir,
      lockFilePath: lockPath,
    });
    expect(result.exitCode).toBe(0);
  });
});
