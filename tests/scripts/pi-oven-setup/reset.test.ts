import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { runReset } from "../../../scripts/pi-oven-setup/reset";
import { ROLES, PROFILE_A } from "../../../scripts/pi-oven-setup/profiles";
import { readAgentFiles } from "../../../scripts/pi-oven-setup/agent-rewriter";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTempDir(): string {
  const dir = join(
    tmpdir(),
    `reset-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("runReset", () => {
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

  it("calls deletePluginConfig exactly 71 times (23×3 + 2)", async () => {
    const deleteCalls: string[] = [];
    const mockSpawnFn = (_cmd: string, args: string[]) => {
      // spawnFn receives (cmd="omp", args=["plugin","config","delete","pi-oven",<key>])
      // args[2] === "delete", args[4] === key
      if (args[2] === "delete") {
        deleteCalls.push(args[4]); // omp plugin config delete pi-oven <key>
      }
      return { exitCode: 0, stdout: Buffer.from(""), stderr: Buffer.from("") } as any;
    };

    // Populate agents with Profile B data
    for (const role of ROLES) {
      makeAgentFile(agentsDir, role, "anthropic/claude-sonnet-4-6", "opencode-zen/claude-sonnet-4-6", "high");
    }

    await runReset({ spawnFn: mockSpawnFn, agentsDir });

    // 23 roles × 3 keys + 2 top-level keys = 71 delete calls
    expect(deleteCalls.length).toBe(71);
  });

  it("deletes pi-oven.profile and pi-oven.provider.anthropic.enabled", async () => {
    const deletedKeys: string[] = [];
    const mockSpawnFn = (_cmd: string, args: string[]) => {
      if (args[2] === "delete") {
        deletedKeys.push(args[4]);
      }
      return { exitCode: 0, stdout: Buffer.from(""), stderr: Buffer.from("") } as any;
    };

    for (const role of ROLES) {
      makeAgentFile(agentsDir, role, "anthropic/claude-sonnet-4-6", "opencode-zen/claude-sonnet-4-6", "high");
    }

    await runReset({ spawnFn: mockSpawnFn, agentsDir });

    expect(deletedKeys).toContain("pi-oven.profile");
    expect(deletedKeys).toContain("pi-oven.provider.anthropic.enabled");
  });

  it("deletes all 3 per-role keys for all 23 roles", async () => {
    const deletedKeys: string[] = [];
    const mockSpawnFn = (_cmd: string, args: string[]) => {
      // args = ["plugin","config","delete","pi-oven",<key>]
      if (args[2] === "delete") {
        deletedKeys.push(args[4]);
      }
      return { exitCode: 0, stdout: Buffer.from(""), stderr: Buffer.from("") } as any;
    };

    for (const role of ROLES) {
      makeAgentFile(agentsDir, role, "anthropic/claude-sonnet-4-6", "opencode-zen/claude-sonnet-4-6", "high");
    }

    await runReset({ spawnFn: mockSpawnFn, agentsDir });

    for (const role of ROLES) {
      expect(deletedKeys).toContain(`pi-oven.models.${role}.primary`);
      expect(deletedKeys).toContain(`pi-oven.models.${role}.registry_alternate`);
      expect(deletedKeys).toContain(`pi-oven.models.${role}.thinkingLevel`);
    }
  });

  it("rewrites all 23 agent files back to Profile A defaults", async () => {
    const mockSpawnFn = (_cmd: string, _args: string[]) =>
      ({ exitCode: 0, stdout: Buffer.from(""), stderr: Buffer.from("") } as any);

    // Start with Profile B values
    for (const role of ROLES) {
      makeAgentFile(agentsDir, role, "anthropic/claude-opus-4-7", "opencode-zen/claude-opus-4-7", "high");
    }

    await runReset({ spawnFn: mockSpawnFn, agentsDir });

    // Verify agent files are now Profile A
    const entries = await readAgentFiles(agentsDir);
    expect(entries.length).toBe(23);
    for (const entry of entries) {
      const expected = PROFILE_A[entry.role];
      expect(entry.currentModel[0]).toBe(expected.primary);
      expect(entry.currentModel[1]).toBe(expected.registry_alternate);
      expect(entry.currentThinkingLevel).toBe(expected.thinkingLevel);
    }
  });

  it("returns success output message", async () => {
    const mockSpawnFn = (_cmd: string, _args: string[]) =>
      ({ exitCode: 0, stdout: Buffer.from(""), stderr: Buffer.from("") } as any);

    for (const role of ROLES) {
      makeAgentFile(agentsDir, role, PROFILE_A[role].primary, PROFILE_A[role].registry_alternate, PROFILE_A[role].thinkingLevel);
    }

    const result = await runReset({ spawnFn: mockSpawnFn, agentsDir });
    expect(result.exitCode).toBe(0);
    expect(result.output).toMatch(/Config cleared|Profile A/i);
  });
});
