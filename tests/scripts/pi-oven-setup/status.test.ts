import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { runStatus } from "../../../scripts/pi-oven-setup/status";
import { PROFILE_A, PROFILE_B, ROLES } from "../../../scripts/pi-oven-setup/profiles";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTempDir(): string {
  const dir = join(
    tmpdir(),
    `status-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
  mkdirSync(dir, { recursive: true });
  return dir;
}

function makeLockFile(dir: string, piOvenSettings: Record<string, unknown>): string {
  const lockPath = join(dir, "omp-plugins.lock.json");
  writeFileSync(lockPath, JSON.stringify({ settings: { pi-oven: piOvenSettings } }), "utf-8");
  return lockPath;
}

function makeAgentFile(agentsDir: string, role: string, primary: string, alternate: string, thinkingLevel: string): void {
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

describe("runStatus", () => {
  let tempDir: string;
  let lockPath: string;
  let agentsDir: string;

  beforeEach(() => {
    tempDir = makeTempDir();
    agentsDir = join(tempDir, "agents");
    mkdirSync(agentsDir, { recursive: true });
    lockPath = join(tempDir, "omp-plugins.lock.json");
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("outputs 'Profile not configured' when no pi-oven settings exist", async () => {
    // Empty lock file
    writeFileSync(lockPath, JSON.stringify({ settings: {} }), "utf-8");

    const result = await runStatus({ lockFilePath: lockPath, agentsDir });
    expect(result.exitCode).toBe(0);
    expect(result.output).toContain("Profile not configured");
  });

  it("shows Profile A when pi-oven.profile = A", async () => {
    makeLockFile(tempDir, { "pi-oven.profile": "A" });
    // Populate agents with Profile A
    for (const role of ROLES) {
      makeAgentFile(agentsDir, role, PROFILE_A[role].primary, PROFILE_A[role].registry_alternate, PROFILE_A[role].thinkingLevel);
    }

    const result = await runStatus({ lockFilePath: lockPath, agentsDir });
    expect(result.exitCode).toBe(0);
    expect(result.output).toContain("Profile A");
  });

  it("shows Profile B when pi-oven.profile = B", async () => {
    makeLockFile(tempDir, { "pi-oven.profile": "B", "pi-oven.provider.anthropic.enabled": "true" });
    for (const role of ROLES) {
      makeAgentFile(agentsDir, role, PROFILE_B[role].primary, PROFILE_B[role].registry_alternate, PROFILE_B[role].thinkingLevel);
    }

    const result = await runStatus({ lockFilePath: lockPath, agentsDir });
    expect(result.exitCode).toBe(0);
    expect(result.output).toContain("Profile B");
  });

  it("shows drift warning when agent files differ from plugin config", async () => {
    // Plugin config says Profile B but agent files are Profile A
    makeLockFile(tempDir, {
      "pi-oven.profile": "B",
      "pi-oven.models.executor.primary": PROFILE_B.executor.primary,
      "pi-oven.models.executor.registry_alternate": PROFILE_B.executor.registry_alternate,
    });
    // Agent file has Profile A values
    makeAgentFile(agentsDir, "executor", PROFILE_A.executor.primary, PROFILE_A.executor.registry_alternate, PROFILE_A.executor.thinkingLevel);

    const result = await runStatus({ lockFilePath: lockPath, agentsDir });
    expect(result.output).toContain("drift");
  });

  it("lists executor model in output", async () => {
    makeLockFile(tempDir, {
      "pi-oven.profile": "A",
      "pi-oven.models.executor.primary": PROFILE_A.executor.primary,
      "pi-oven.models.executor.registry_alternate": PROFILE_A.executor.registry_alternate,
      "pi-oven.models.executor.thinkingLevel": PROFILE_A.executor.thinkingLevel,
    });
    makeAgentFile(agentsDir, "executor", PROFILE_A.executor.primary, PROFILE_A.executor.registry_alternate, PROFILE_A.executor.thinkingLevel);

    const result = await runStatus({ lockFilePath: lockPath, agentsDir });
    expect(result.output).toContain("executor");
    expect(result.output).toContain(PROFILE_A.executor.primary);
  });

  it("handles missing lock file gracefully (Profile not configured)", async () => {
    // lockPath does not exist
    const result = await runStatus({
      lockFilePath: join(tempDir, "nonexistent.json"),
      agentsDir,
    });
    expect(result.exitCode).toBe(0);
    expect(result.output).toContain("Profile not configured");
  });
});
