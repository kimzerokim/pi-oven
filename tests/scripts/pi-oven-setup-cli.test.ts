import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { ROLES, PROFILE_A } from "../../scripts/pi-oven-setup/profiles";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTempDir(): string {
  const dir = join(
    tmpdir(),
    `cli-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
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

/**
 * Run the pi-oven-setup.ts CLI via Bun subprocess.
 * Returns { exitCode, stdout, stderr }.
 */
async function runCLI(
  args: string[],
  env?: Record<string, string>
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const cliPath = join(import.meta.dir, "../../scripts/pi-oven-setup.ts");
  const proc = Bun.spawnSync(["bun", "run", cliPath, ...args], {
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
    cwd: join(import.meta.dir, "../.."),
  });
  return {
    exitCode: proc.exitCode ?? 1,
    stdout: proc.stdout?.toString() ?? "",
    stderr: proc.stderr?.toString() ?? "",
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("pi-oven-setup CLI dispatcher", () => {
  let tempDir: string;
  let agentsDir: string;
  let lockPath: string;

  beforeEach(() => {
    tempDir = makeTempDir();
    agentsDir = join(tempDir, "agents");
    mkdirSync(agentsDir, { recursive: true });
    lockPath = join(tempDir, "omp-plugins.lock.json");
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("--status: exits 0 and outputs Profile info", async () => {
    writeFileSync(lockPath, JSON.stringify({ settings: { pi-oven: { "pi-oven.profile": "A" } } }), "utf-8");
    for (const role of ROLES) {
      makeAgentFile(agentsDir, role, PROFILE_A[role].primary, PROFILE_A[role].registry_alternate, PROFILE_A[role].thinkingLevel);
    }

    const { exitCode, stdout } = await runCLI(["--status"], {
      PI_OVEN_LOCK_FILE: lockPath,
      PI_OVEN_AGENTS_DIR: agentsDir,
    });
    expect(exitCode).toBe(0);
    expect(stdout).toMatch(/profile/i);
  });

  it("--status with no config: outputs 'Profile not configured'", async () => {
    writeFileSync(lockPath, JSON.stringify({ settings: {} }), "utf-8");

    const { exitCode, stdout } = await runCLI(["--status"], {
      PI_OVEN_LOCK_FILE: lockPath,
      PI_OVEN_AGENTS_DIR: agentsDir,
    });
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Profile not configured");
  });

  it("--reset: exits 0 and outputs success", async () => {
    writeFileSync(lockPath, JSON.stringify({ settings: { pi-oven: { "pi-oven.profile": "B" } } }), "utf-8");
    for (const role of ROLES) {
      makeAgentFile(agentsDir, role, PROFILE_A[role].primary, PROFILE_A[role].registry_alternate, PROFILE_A[role].thinkingLevel);
    }

    // Use PI_OVEN_MOCK_SPAWN=1 to bypass real omp calls
    const { exitCode, stdout } = await runCLI(["--reset"], {
      PI_OVEN_LOCK_FILE: lockPath,
      PI_OVEN_AGENTS_DIR: agentsDir,
      PI_OVEN_MOCK_SPAWN: "1",
    });
    expect(exitCode).toBe(0);
    expect(stdout).toMatch(/cleared|reset|Profile A/i);
  });

  it("--import with nonexistent file: exits 1 with error message", async () => {
    const { exitCode, stdout } = await runCLI(
      ["--import", join(tempDir, "nonexistent.json")],
      { PI_OVEN_LOCK_FILE: lockPath, PI_OVEN_AGENTS_DIR: agentsDir }
    );
    expect(exitCode).toBe(1);
    expect(stdout + "").toMatch(/not found|ENOENT|does not exist/i);
  });

  it("--import with valid JSON: exits 0 with success", async () => {
    writeFileSync(lockPath, JSON.stringify({ settings: { pi-oven: {} } }), "utf-8");
    const importFile = join(tempDir, "config.json");
    writeFileSync(
      importFile,
      JSON.stringify({
        pi-oven: {
          profile: "A",
          models: {
            executor: {
              primary: "opencode-zen/gpt-5.3-codex",
              registry_alternate: "openai-codex/gpt-5.3-codex",
              thinkingLevel: "high",
            },
          },
        },
      }),
      "utf-8"
    );
    for (const role of ROLES) {
      makeAgentFile(agentsDir, role, PROFILE_A[role].primary, PROFILE_A[role].registry_alternate, PROFILE_A[role].thinkingLevel);
    }

    const { exitCode } = await runCLI(["--import", importFile], {
      PI_OVEN_LOCK_FILE: lockPath,
      PI_OVEN_AGENTS_DIR: agentsDir,
      PI_OVEN_MOCK_SPAWN: "1",
      PI_OVEN_VALIDATE_MODE: "none",
    });
    expect(exitCode).toBe(0);
  });

  it("--reapply with pi-oven.profile=B: exits 0", async () => {
    writeFileSync(lockPath, JSON.stringify({ settings: { pi-oven: { "pi-oven.profile": "B" } } }), "utf-8");
    for (const role of ROLES) {
      makeAgentFile(agentsDir, role, PROFILE_A[role].primary, PROFILE_A[role].registry_alternate, PROFILE_A[role].thinkingLevel);
    }

    const { exitCode } = await runCLI(["--reapply"], {
      PI_OVEN_LOCK_FILE: lockPath,
      PI_OVEN_AGENTS_DIR: agentsDir,
      PI_OVEN_MOCK_SPAWN: "1",
    });
    expect(exitCode).toBe(0);
  });

  it("--profile B: exits 0 with validateMode=none", async () => {
    writeFileSync(lockPath, JSON.stringify({ settings: { pi-oven: {} } }), "utf-8");
    for (const role of ROLES) {
      makeAgentFile(agentsDir, role, PROFILE_A[role].primary, PROFILE_A[role].registry_alternate, PROFILE_A[role].thinkingLevel);
    }

    const { exitCode } = await runCLI(["--profile", "B", "--validate", "none"], {
      PI_OVEN_LOCK_FILE: lockPath,
      PI_OVEN_AGENTS_DIR: agentsDir,
      PI_OVEN_MOCK_SPAWN: "1",
    });
    expect(exitCode).toBe(0);
  });

  it("dispatch precedence: --status takes priority over --reset", async () => {
    writeFileSync(lockPath, JSON.stringify({ settings: { pi-oven: {} } }), "utf-8");

    const { exitCode, stdout } = await runCLI(["--status", "--reset"], {
      PI_OVEN_LOCK_FILE: lockPath,
      PI_OVEN_AGENTS_DIR: agentsDir,
      PI_OVEN_MOCK_SPAWN: "1",
    });
    // --status should win: output says "not configured", not "cleared"
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Profile not configured");
    expect(stdout).not.toMatch(/cleared|reset/i);
  });

  it("dispatch precedence: --reset takes priority over --import", async () => {
    writeFileSync(lockPath, JSON.stringify({ settings: { pi-oven: { "pi-oven.profile": "A" } } }), "utf-8");
    const importFile = join(tempDir, "config.json");
    writeFileSync(importFile, JSON.stringify({ pi-oven: { profile: "A", models: {} } }), "utf-8");
    for (const role of ROLES) {
      makeAgentFile(agentsDir, role, PROFILE_A[role].primary, PROFILE_A[role].registry_alternate, PROFILE_A[role].thinkingLevel);
    }

    const { stdout } = await runCLI(["--reset", "--import", importFile], {
      PI_OVEN_LOCK_FILE: lockPath,
      PI_OVEN_AGENTS_DIR: agentsDir,
      PI_OVEN_MOCK_SPAWN: "1",
    });
    expect(stdout).toMatch(/cleared|reset|Profile A/i);
  });

  it("no action flag: exits 1 with usage error", async () => {
    const { exitCode, stderr } = await runCLI([], {
      PI_OVEN_LOCK_FILE: lockPath,
      PI_OVEN_AGENTS_DIR: agentsDir,
    });
    expect(exitCode).toBe(1);
    // Should mention expected flags
    expect(stderr + stdout).toMatch(/--profile|--status|--reset|No action/i);
  });
});

// Keep reference to avoid unused import warning
const stdout = "";
