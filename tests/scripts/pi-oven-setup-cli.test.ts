import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from "fs";
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
  const proc = Bun.spawnSync([process.execPath, "run", cliPath, ...args], {
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

  it("--status: exits 0 and outputs effective model summary", async () => {
    for (const role of ROLES) {
      makeAgentFile(agentsDir, role, PROFILE_A[role].primary, PROFILE_A[role].registry_alternate, PROFILE_A[role].thinkingLevel);
    }

    const { exitCode, stdout } = await runCLI(["--status"], {
      PI_OVEN_AGENTS_DIR: agentsDir,
      PI_OVEN_MOCK_SPAWN: "1",
    });
    expect(exitCode).toBe(0);
    expect(stdout).toContain("machine-global");
    expect(stdout).toContain("default(frontmatter)");
  });

  it("--status with no agent files: shows (no agent file) for all roles", async () => {
    const { exitCode, stdout } = await runCLI(["--status"], {
      PI_OVEN_AGENTS_DIR: agentsDir,
      PI_OVEN_MOCK_SPAWN: "1",
    });
    expect(exitCode).toBe(0);
    expect(stdout).toContain("machine-global");
    expect(stdout).toContain("no agent file");
  });

  it("--reset: exits 0 and outputs cleared/no-overrides message", async () => {
    // Use PI_OVEN_MOCK_SPAWN=1: mock omp returns empty overrides record, so no keys to clear
    const { exitCode, stdout } = await runCLI(["--reset"], {
      PI_OVEN_MOCK_SPAWN: "1",
    });
    expect(exitCode).toBe(0);
    expect(stdout).toMatch(/cleared|No overrides/i);
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

    const { exitCode } = await runCLI(["--import", importFile], {
      PI_OVEN_MOCK_SPAWN: "1",
      PI_OVEN_VALIDATE_MODE: "none",
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
    const { exitCode, stdout } = await runCLI(["--status", "--reset"], {
      PI_OVEN_AGENTS_DIR: agentsDir,
      PI_OVEN_MOCK_SPAWN: "1",
    });
    // --status should win: output shows machine-global scope, not cleared
    expect(exitCode).toBe(0);
    expect(stdout).toContain("machine-global");
    expect(stdout).not.toMatch(/cleared/i);
  });

  it("dispatch precedence: --reset takes priority over --import", async () => {
    const importFile = join(tempDir, "config.json");
    writeFileSync(importFile, JSON.stringify({ pi-oven: { profile: "A", models: {} } }), "utf-8");

    const { exitCode, stdout } = await runCLI(["--reset", "--import", importFile], {
      PI_OVEN_MOCK_SPAWN: "1",
    });
    expect(exitCode).toBe(0);
    expect(stdout).toMatch(/cleared|No overrides/i);
  });

  it("no action flag: exits 1 with usage error (no --reapply in message)", async () => {
    const { exitCode, stderr, stdout: out } = await runCLI([], {
      PI_OVEN_LOCK_FILE: lockPath,
      PI_OVEN_AGENTS_DIR: agentsDir,
    });
    expect(exitCode).toBe(1);
    // Should mention expected flags
    expect(stderr + out).toMatch(/--profile|--status|--reset|No action/i);
    // --reapply must NOT appear in usage message (retired)
    expect(stderr + out).not.toContain("--reapply");
  });

  it("standalone --override sets config via omp and exits 0", async () => {
    const { exitCode, stdout: out } = await runCLI(
      ["--override", "critic=anthropic/claude-opus-4-8"],
      { PI_OVEN_MOCK_SPAWN: "1" }
    );
    expect(exitCode).toBe(0);
    expect(out).not.toMatch(/No action/i);
  });

  it("standalone --override does not modify tracked baseline files", async () => {
    const repoRoot = join(import.meta.dir, "../..");

    // Capture git status BEFORE the override runs (delta baseline)
    const gitBefore = Bun.spawnSync(
      ["git", "status", "--porcelain", "--", "agents/", "scripts/"],
      { cwd: repoRoot, stdio: ["ignore", "pipe", "pipe"] }
    );
    const statusBefore = gitBefore.stdout?.toString() ?? "";

    const { exitCode } = await runCLI(
      ["--override", "critic=anthropic/claude-opus-4-8"],
      { PI_OVEN_MOCK_SPAWN: "1" }
    );
    expect(exitCode).toBe(0);

    // Capture git status AFTER — the override must introduce no new change
    const gitAfter = Bun.spawnSync(
      ["git", "status", "--porcelain", "--", "agents/", "scripts/"],
      { cwd: repoRoot, stdio: ["ignore", "pipe", "pipe"] }
    );
    const statusAfter = gitAfter.stdout?.toString() ?? "";

    // Delta must be zero: whatever was dirty before is still dirty (and nothing more)
    expect(statusAfter).toBe(statusBefore);
  });

  it("--override + --reset is mutually exclusive (exit 1)", async () => {
    const { exitCode, stderr } = await runCLI(
      ["--override", "critic=anthropic/claude-opus-4-8", "--reset"],
      { PI_OVEN_MOCK_SPAWN: "1" }
    );
    expect(exitCode).toBe(1);
    expect(stderr).toMatch(/mutual.?exclu|--override.*--reset|--reset.*--override/i);
  });

  it("--override + --apply is mutually exclusive (exit 1)", async () => {
    const { exitCode, stderr } = await runCLI(
      ["--override", "critic=anthropic/claude-opus-4-8", "--apply"],
      { PI_OVEN_MOCK_SPAWN: "1" }
    );
    expect(exitCode).toBe(1);
    expect(stderr).toMatch(/mutual.?exclu|--override.*--apply|--apply.*--override/i);
  });

  it("--override + --status applies override then shows status", async () => {
    for (const role of ROLES) {
      makeAgentFile(agentsDir, role, PROFILE_A[role].primary, PROFILE_A[role].registry_alternate, PROFILE_A[role].thinkingLevel);
    }
    const { exitCode, stdout: out } = await runCLI(
      ["--override", "critic=anthropic/claude-opus-4-8", "--status"],
      { PI_OVEN_MOCK_SPAWN: "1", PI_OVEN_AGENTS_DIR: agentsDir }
    );
    expect(exitCode).toBe(0);
    // Both override output and status output should appear
    expect(out).toMatch(/Override applied/i);
    expect(out).toContain("machine-global");
  });

  it("--override with invalid model id exits 1", async () => {
    const { exitCode, stderr } = await runCLI(
      ["--override", "critic=anthropic/claude-opus-4-7"],
      { PI_OVEN_MOCK_SPAWN: "1" }
    );
    expect(exitCode).toBe(1);
    expect(stderr + "").toMatch(/not resolvable|invalid.*override/i);
  });
});

// ---------------------------------------------------------------------------
// --language dispatch (Plan 2026-06-02 §2)
// Runs the CLI in an ISOLATED temp cwd so the per-project .pi-oven/config.json
// is written there and NEVER into the repo's own .pi-oven.
// ---------------------------------------------------------------------------

/** Run the CLI with an explicit cwd (isolated temp dir for --language tests). */
async function runCLIInCwd(
  args: string[],
  cwd: string,
  env?: Record<string, string>
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const cliPath = join(import.meta.dir, "../../scripts/pi-oven-setup.ts");
  const proc = Bun.spawnSync([process.execPath, "run", cliPath, ...args], {
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
    cwd,
  });
  return {
    exitCode: proc.exitCode ?? 1,
    stdout: proc.stdout?.toString() ?? "",
    stderr: proc.stderr?.toString() ?? "",
  };
}

describe("pi-oven-setup CLI --language dispatch", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = join(
      tmpdir(),
      `cli-lang-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    mkdirSync(tempDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("--language ko writes .pi-oven/config.json with \"ko\" and exits 0", async () => {
    const { exitCode } = await runCLIInCwd(["--language", "ko"], tempDir);
    expect(exitCode).toBe(0);

    const parsed = JSON.parse(
      readFileSync(join(tempDir, ".pi-oven", "config.json"), "utf-8")
    );
    expect(parsed.language).toBe("ko");
  });

  it("--language english normalizes and writes \"en\"", async () => {
    const { exitCode } = await runCLIInCwd(["--language", "english"], tempDir);
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(
      readFileSync(join(tempDir, ".pi-oven", "config.json"), "utf-8")
    );
    expect(parsed.language).toBe("en");
  });

  it("invalid language exits non-zero and writes no config", async () => {
    const { exitCode, stderr } = await runCLIInCwd(["--language", "fr"], tempDir);
    expect(exitCode).not.toBe(0);
    expect(stderr).toMatch(/invalid language/i);
    expect(existsSync(join(tempDir, ".pi-oven", "config.json"))).toBe(false);
  });
});

// Keep reference to avoid unused import warning
const stdout = "";
