import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { runReapply } from "../../../scripts/pi-oven-setup/reapply";
import { ROLES, PROFILE_A, PROFILE_B } from "../../../scripts/pi-oven-setup/profiles";
import { readAgentFiles } from "../../../scripts/pi-oven-setup/agent-rewriter";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTempDir(): string {
  const dir = join(
    tmpdir(),
    `reapply-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
  mkdirSync(dir, { recursive: true });
  return dir;
}

function makeLockFile(dir: string, piOvenSettings: Record<string, unknown>): string {
  const lockPath = join(dir, "omp-plugins.lock.json");
  writeFileSync(lockPath, JSON.stringify({ settings: { pi-oven: piOvenSettings } }), "utf-8");
  return lockPath;
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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("runReapply", () => {
  let tempDir: string;
  let agentsDir: string;

  beforeEach(() => {
    tempDir = makeTempDir();
    agentsDir = join(tempDir, "agents");
    mkdirSync(agentsDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("reads pi-oven.profile=B from config and re-applies Profile B", async () => {
    // Plugin config says Profile B
    const lockPath = makeLockFile(tempDir, { "pi-oven.profile": "B" });

    const mockSpawnFn = (_cmd: string, _args: string[]) =>
      ({ exitCode: 0, stdout: Buffer.from("ok"), stderr: Buffer.from("") } as any);

    // Agent files currently have Profile A (simulating post-upgrade drift)
    for (const role of ROLES) {
      makeAgentFile(
        agentsDir,
        role,
        PROFILE_A[role].primary,
        PROFILE_A[role].registry_alternate,
        PROFILE_A[role].thinkingLevel
      );
    }

    await runReapply({ spawnFn: mockSpawnFn, agentsDir, lockFilePath: lockPath });

    // Verify agent files are now Profile B
    const entries = await readAgentFiles(agentsDir);
    const executor = entries.find((e) => e.role === "executor")!;
    expect(executor.currentModel[0]).toBe(PROFILE_B.executor.primary);
  });

  it("reads pi-oven.profile=A from config and re-applies Profile A", async () => {
    const lockPath = makeLockFile(tempDir, { "pi-oven.profile": "A" });

    const mockSpawnFn = (_cmd: string, _args: string[]) =>
      ({ exitCode: 0, stdout: Buffer.from("ok"), stderr: Buffer.from("") } as any);

    // Agent files currently have Profile B (simulating drift)
    for (const role of ROLES) {
      makeAgentFile(
        agentsDir,
        role,
        PROFILE_B[role].primary,
        PROFILE_B[role].registry_alternate,
        PROFILE_B[role].thinkingLevel
      );
    }

    await runReapply({ spawnFn: mockSpawnFn, agentsDir, lockFilePath: lockPath });

    const entries = await readAgentFiles(agentsDir);
    const executor = entries.find((e) => e.role === "executor")!;
    expect(executor.currentModel[0]).toBe(PROFILE_A.executor.primary);
  });

  it("returns exitCode 1 when pi-oven.profile is not set in config", async () => {
    const lockPath = makeLockFile(tempDir, {});

    const mockSpawnFn = (_cmd: string, _args: string[]) =>
      ({ exitCode: 0, stdout: Buffer.from("ok"), stderr: Buffer.from("") } as any);

    for (const role of ROLES) {
      makeAgentFile(
        agentsDir,
        role,
        PROFILE_A[role].primary,
        PROFILE_A[role].registry_alternate,
        PROFILE_A[role].thinkingLevel
      );
    }

    const result = await runReapply({ spawnFn: mockSpawnFn, agentsDir, lockFilePath: lockPath });
    expect(result.exitCode).toBe(1);
    expect(result.output).toMatch(/not configured|no profile/i);
  });

  it("returns exitCode 0 on successful reapply", async () => {
    const lockPath = makeLockFile(tempDir, { "pi-oven.profile": "B" });

    const mockSpawnFn = (_cmd: string, _args: string[]) =>
      ({ exitCode: 0, stdout: Buffer.from("ok"), stderr: Buffer.from("") } as any);

    for (const role of ROLES) {
      makeAgentFile(
        agentsDir,
        role,
        PROFILE_A[role].primary,
        PROFILE_A[role].registry_alternate,
        PROFILE_A[role].thinkingLevel
      );
    }

    const result = await runReapply({ spawnFn: mockSpawnFn, agentsDir, lockFilePath: lockPath });
    expect(result.exitCode).toBe(0);
  });
});
