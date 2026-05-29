import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { runStatus } from "../../../scripts/pi-oven-setup/status";
import { ROLES, PROFILE_A } from "../../../scripts/pi-oven-setup/profiles";

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

function makeAgentFile(agentsDir: string, role: string, primary: string): void {
  const content = `---
name: pi-oven:${role}
description: Test agent for ${role}
model:
  - ${primary}
  - opencode-zen/${primary.split("/").pop()}
thinkingLevel: high
mode: subagent
tools: ["*"]
blocked_tools: []
---

## Role

You are pi-oven:${role}.
`;
  writeFileSync(join(agentsDir, `pi-oven-${role}.md`), content, "utf-8");
}

/**
 * Build a spawnFn mock that returns preset responses for omp config get.
 * listModelsOutput: optional string for list-models fixture (for unresolved warning test).
 */
function makeSpawnFn(opts: {
  overrides?: Record<string, string>;
  listModelsOutput?: string;
  getExitCode?: number;
}): (cmd: string, args: string[]) => { exitCode: number | null; stdout: Buffer; stderr: Buffer } {
  return (cmd, args) => {
    const argStr = args.join(" ");
    // omp config get task.agentModelOverrides --json
    if (cmd === "omp" && argStr.includes("config get task.agentModelOverrides")) {
      if (opts.getExitCode !== undefined && opts.getExitCode !== 0) {
        return {
          exitCode: opts.getExitCode,
          stdout: Buffer.from(""),
          stderr: Buffer.from("omp not available"),
        };
      }
      const record = opts.overrides ?? {};
      const payload = JSON.stringify({ key: "task.agentModelOverrides", value: record, type: "record" });
      return { exitCode: 0, stdout: Buffer.from(payload), stderr: Buffer.from("") };
    }
    // omp list-models --json (or similar)
    if (cmd === "omp" && argStr.includes("list-models")) {
      const out = opts.listModelsOutput ?? "[]";
      return { exitCode: 0, stdout: Buffer.from(out), stderr: Buffer.from("") };
    }
    return { exitCode: 1, stdout: Buffer.from(""), stderr: Buffer.from("unexpected command") };
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("runStatus", () => {
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

  // -------------------------------------------------------------------------
  // NEW tests: effective model + source label
  // -------------------------------------------------------------------------

  it("status shows default(frontmatter) source when no override", async () => {
    // Seed agents dir with PROFILE_A frontmatter
    for (const role of ROLES) {
      makeAgentFile(agentsDir, role, PROFILE_A[role].primary);
    }
    const spawnFn = makeSpawnFn({ overrides: {} });

    const result = await runStatus({ spawnFn, agentsDir });
    expect(result.exitCode).toBe(0);
    // critic role should show default frontmatter model
    expect(result.output).toContain("critic");
    expect(result.output).toContain(PROFILE_A.critic.primary);
    expect(result.output).toContain("default");
    // must NOT contain override source for critic
    expect(result.output).not.toMatch(/critic.*override\(config\.yml\)/);
  });

  it("status shows override source when override present", async () => {
    for (const role of ROLES) {
      makeAgentFile(agentsDir, role, PROFILE_A[role].primary);
    }
    const overrideModel = "opencode-zen/claude-opus-4-8";
    const spawnFn = makeSpawnFn({ overrides: { "pi-oven:critic": overrideModel } });

    const result = await runStatus({ spawnFn, agentsDir });
    expect(result.exitCode).toBe(0);
    expect(result.output).toContain("critic");
    expect(result.output).toContain(overrideModel);
    expect(result.output).toContain("override");
  });

  it("status warns on unresolved override (미해소 fallback warning)", async () => {
    for (const role of ROLES) {
      makeAgentFile(agentsDir, role, PROFILE_A[role].primary);
    }
    // Use a retired model id that won't appear in list-models
    const retiredModel = "anthropic/claude-opus-4-7";
    const spawnFn = makeSpawnFn({
      overrides: { "pi-oven:critic": retiredModel },
      // list-models fixture that does NOT include the retired model
      listModelsOutput: JSON.stringify([
        { id: "anthropic/claude-opus-4-8" },
        { id: "opencode-zen/claude-opus-4-8" },
      ]),
    });

    const result = await runStatus({ spawnFn, agentsDir, listModelsOutput: JSON.stringify([
      { id: "anthropic/claude-opus-4-8" },
      { id: "opencode-zen/claude-opus-4-8" },
    ]) });
    expect(result.exitCode).toBe(0);
    // Should warn about unresolvable override
    expect(result.output).toMatch(/미해소|fallback|unresolved/i);
  });

  it("status shows machine-global scope header", async () => {
    const spawnFn = makeSpawnFn({ overrides: {} });
    const result = await runStatus({ spawnFn, agentsDir });
    expect(result.exitCode).toBe(0);
    expect(result.output).toContain("machine-global");
  });

  it("status has NO drift warning, NO Profile line", async () => {
    for (const role of ROLES) {
      makeAgentFile(agentsDir, role, PROFILE_A[role].primary);
    }
    const spawnFn = makeSpawnFn({ overrides: {} });

    const result = await runStatus({ spawnFn, agentsDir });
    expect(result.output).not.toMatch(/drift/i);
    expect(result.output).not.toMatch(/Profile [AB] active/);
  });

  it("status shows all ROLES in output", async () => {
    for (const role of ROLES) {
      makeAgentFile(agentsDir, role, PROFILE_A[role].primary);
    }
    const spawnFn = makeSpawnFn({ overrides: {} });

    const result = await runStatus({ spawnFn, agentsDir });
    for (const role of ROLES) {
      expect(result.output).toContain(role);
    }
  });

  it("status shows (no agent file) when agentsDir is absent", async () => {
    const missingDir = join(tempDir, "nonexistent");
    const spawnFn = makeSpawnFn({ overrides: {} });

    const result = await runStatus({ spawnFn, agentsDir: missingDir });
    expect(result.exitCode).toBe(0);
    expect(result.output).toContain("no agent file");
  });

  it("status warns on unknown role override (stray key)", async () => {
    for (const role of ROLES) {
      makeAgentFile(agentsDir, role, PROFILE_A[role].primary);
    }
    const spawnFn = makeSpawnFn({ overrides: { "pi-oven:unknown-role-xyz": "some/model" } });

    const result = await runStatus({ spawnFn, agentsDir });
    expect(result.exitCode).toBe(0);
    expect(result.output).toMatch(/unknown role|unknown-role/i);
  });

  it("status falls back gracefully when omp config get fails (returns empty overrides)", async () => {
    for (const role of ROLES) {
      makeAgentFile(agentsDir, role, PROFILE_A[role].primary);
    }
    const spawnFn = makeSpawnFn({ getExitCode: 1 });

    const result = await runStatus({ spawnFn, agentsDir });
    expect(result.exitCode).toBe(0);
    // All roles should show default source since omp failed
    expect(result.output).toContain("default");
    expect(result.output).not.toContain("override(config.yml)");
  });
});
