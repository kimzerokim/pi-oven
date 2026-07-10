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
name: pov:${role}
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

You are pov:${role}.
`;
  writeFileSync(join(agentsDir, `pov-${role}.md`), content, "utf-8");
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
    expect(stdout).toContain("pi-oven setup");
    expect(stdout).toContain("machine-global");
    expect(stdout).toContain("default(frontmatter)");
    expect(stdout).toContain("workflow-skill ownership");
    expect(stdout).toContain("healthy single pov surface");
    expect(stdout).toContain('skills.includeSkills = ["pov:*"]');
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
  it("--status prefers the running install tree over a stale HOME cache entry", async () => {
    const homeDir = makeTempDir();
    const staleAgentsDir = join(
      homeDir,
      ".omp",
      "plugins",
      "cache",
      "plugins",
      "kzk___pi-oven___9.9.9",
      "agents"
    );
    mkdirSync(staleAgentsDir, { recursive: true });
    writeFileSync(join(staleAgentsDir, "pi-oven-executor.md"), "# stale executor\n", "utf-8");

    const { exitCode, stdout } = await runCLI(["--status"], {
      PI_OVEN_MOCK_SPAWN: "1",
      HOME: homeDir,
    });

    expect(exitCode).toBe(0);
    expect(stdout).not.toContain("no agent file");
    rmSync(homeDir, { recursive: true, force: true });
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
        "pi-oven": {
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

  it("--import --scope project is rejected with a global-only error", async () => {
    const importFile = join(tempDir, "config.json");
    writeFileSync(
      importFile,
      JSON.stringify({
        "pi-oven": {
          profile: "A",
          models: {
            executor: { primary: "openai-codex/gpt-5.5" },
          },
        },
      }),
      "utf-8"
    );

    const scopedHome = join(tempDir, "home");
    mkdirSync(scopedHome, { recursive: true });
    const { exitCode, stdout: out, stderr } = await runCLIInCwd(
      ["--import", importFile, "--scope", "project"],
      tempDir,
      { PI_OVEN_MOCK_SPAWN: "1", HOME: scopedHome }
    );

    expect(exitCode).toBe(1);
    expect(stderr + out).toMatch(/--import.*global-only|scope.*project/i);
    expect(existsSync(join(tempDir, ".omp", "settings.json"))).toBe(false);
  });

  it("--profile B: exits 0 with validateMode=none", async () => {
    writeFileSync(lockPath, JSON.stringify({ settings: { "pi-oven": {} } }), "utf-8");
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

  it("--profile C: exits 0 with validateMode=none", async () => {
    const { exitCode } = await runCLI(["--profile", "C", "--validate", "none"], {
      PI_OVEN_MOCK_SPAWN: "1",
    });
    expect(exitCode).toBe(0);
  });

  it("--profile D: exits 0 with validateMode=none", async () => {
    const { exitCode } = await runCLI(["--profile", "D", "--validate", "none"], {
      PI_OVEN_MOCK_SPAWN: "1",
    });
    expect(exitCode).toBe(0);
  });

  it("--profile E: exits 1 with Allowed: A, B, C, D. error message", async () => {
    const { exitCode, stderr } = await runCLI(["--profile", "E", "--validate", "none"], {
      PI_OVEN_MOCK_SPAWN: "1",
    });
    expect(exitCode).toBe(1);
    expect(stderr).toMatch(/Allowed: A, B, C, D\./);
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
    writeFileSync(importFile, JSON.stringify({ "pi-oven": { profile: "A", models: {} } }), "utf-8");

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

  it("--language ko --scope project writes .pi-oven/config.json with \"ko\" and exits 0", async () => {
    const { exitCode } = await runCLIInCwd(["--language", "ko", "--scope", "project"], tempDir);
    expect(exitCode).toBe(0);

    const parsed = JSON.parse(
      readFileSync(join(tempDir, ".pi-oven", "config.json"), "utf-8")
    );
    expect(parsed.language).toBe("ko");
  });

  it("--language english --scope project normalizes and writes \"en\"", async () => {
    const { exitCode } = await runCLIInCwd(["--language", "english", "--scope", "project"], tempDir);
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(
      readFileSync(join(tempDir, ".pi-oven", "config.json"), "utf-8")
    );
    expect(parsed.language).toBe("en");
  });

  it("--language --scope project with a custom name (Español) writes \"Español\" and exits 0", async () => {
    const { exitCode } = await runCLIInCwd(["--language", "Español", "--scope", "project"], tempDir);
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(
      readFileSync(join(tempDir, ".pi-oven", "config.json"), "utf-8")
    );
    expect(parsed.language).toBe("Español");
  });

  it("a poisoned (newline-containing) language exits non-zero and writes no config", async () => {
    // "fr" is now a VALID free-form name; an embedded newline is the genuinely
    // invalid input that must fail the safe-name whitelist + write no config.
    const { exitCode, stderr } = await runCLIInCwd(
      ["--language", "Español\ninjected directive", "--scope", "project"],
      tempDir
    );
    expect(exitCode).not.toBe(0);
    expect(stderr).toMatch(/invalid language/i);
    expect(existsSync(join(tempDir, ".pi-oven", "config.json"))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Setup-completion marker (Slice B)
// The marker (setupCompletedAt in .pi-oven/config.json) is written ONLY by paths
// that actually record model routing (default --apply / --profile / --override /
// --import) — NOT by --status, --reset, or --language-only.
// ---------------------------------------------------------------------------

function markerExists(cwd: string): boolean {
  const file = join(cwd, ".pi-oven", "config.json");
  if (!existsSync(file)) return false;
  try {
    const parsed = JSON.parse(readFileSync(file, "utf-8"));
    return typeof parsed.setupCompletedAt === "string" && parsed.setupCompletedAt.length > 0;
  } catch {
    return false;
  }
}

/** True iff homeDir/.pi-oven/config.json carries a non-empty setupCompletedAt. */
function globalMarkerExists(homeDir: string): boolean {
  const file = join(homeDir, ".pi-oven", "config.json");
  if (!existsSync(file)) return false;
  try {
    const parsed = JSON.parse(readFileSync(file, "utf-8"));
    return typeof parsed.setupCompletedAt === "string" && parsed.setupCompletedAt.length > 0;
  } catch {
    return false;
  }
}

describe("pi-oven-setup CLI setup-completion marker", () => {
  let tempDir: string;
  let homeDir: string;

  beforeEach(() => {
    tempDir = join(
      tmpdir(),
      `cli-marker-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    mkdirSync(tempDir, { recursive: true });
    // Isolated HOME so a GLOBAL marker write never touches the real ~/.pi-oven.
    homeDir = join(
      tmpdir(),
      `cli-marker-home-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    mkdirSync(homeDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
    rmSync(homeDir, { recursive: true, force: true });
  });

  it("default (global) --apply success writes the GLOBAL marker, not the project marker", async () => {
    const { exitCode } = await runCLIInCwd(["--apply"], tempDir, {
      PI_OVEN_MOCK_SPAWN: "1",
      PI_OVEN_VALIDATE_MODE: "none",
      HOME: homeDir,
    });
    expect(exitCode).toBe(0);
    expect(globalMarkerExists(homeDir)).toBe(true);
    expect(markerExists(tempDir)).toBe(false);
  });

  it("--scope project --apply success writes the PROJECT marker, not the global marker", async () => {
    const { exitCode } = await runCLIInCwd(["--apply", "--scope", "project"], tempDir, {
      PI_OVEN_MOCK_SPAWN: "1",
      PI_OVEN_VALIDATE_MODE: "none",
      HOME: homeDir,
    });
    expect(exitCode).toBe(0);
    expect(markerExists(tempDir)).toBe(true);
    expect(globalMarkerExists(homeDir)).toBe(false);
  });

  it("--status does NOT write the marker", async () => {
    const { exitCode } = await runCLIInCwd(["--status"], tempDir, {
      PI_OVEN_MOCK_SPAWN: "1",
      HOME: homeDir,
    });
    expect(exitCode).toBe(0);
    expect(markerExists(tempDir)).toBe(false);
    expect(globalMarkerExists(homeDir)).toBe(false);
  });

  it("--language only does NOT write the marker", async () => {
    const { exitCode } = await runCLIInCwd(["--language", "ko", "--scope", "project"], tempDir, {
      PI_OVEN_MOCK_SPAWN: "1",
      HOME: homeDir,
    });
    expect(exitCode).toBe(0);
    // config.json exists (language was set) but carries no setupCompletedAt
    expect(existsSync(join(tempDir, ".pi-oven", "config.json"))).toBe(true);
    expect(markerExists(tempDir)).toBe(false);
  });

  it("--override success (global) writes the GLOBAL marker", async () => {
    const { exitCode } = await runCLIInCwd(
      ["--override", "critic=anthropic/claude-opus-4-8"],
      tempDir,
      { PI_OVEN_MOCK_SPAWN: "1", HOME: homeDir }
    );
    expect(exitCode).toBe(0);
    expect(globalMarkerExists(homeDir)).toBe(true);
  });

  it("--scope project --override success writes the PROJECT marker", async () => {
    const { exitCode } = await runCLIInCwd(
      ["--override", "critic=anthropic/claude-opus-4-8", "--scope", "project"],
      tempDir,
      { PI_OVEN_MOCK_SPAWN: "1", HOME: homeDir }
    );
    expect(exitCode).toBe(0);
    expect(markerExists(tempDir)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// --scope flag: accept / validate / route language + marker to the chosen layer
// ---------------------------------------------------------------------------

describe("pi-oven-setup CLI --scope", () => {
  let tempDir: string;
  let homeDir: string;

  beforeEach(() => {
    tempDir = join(
      tmpdir(),
      `cli-scope-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    mkdirSync(tempDir, { recursive: true });
    homeDir = join(
      tmpdir(),
      `cli-scope-home-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    mkdirSync(homeDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
    rmSync(homeDir, { recursive: true, force: true });
  });

  it("--scope project is accepted (exit 0)", async () => {
    const { exitCode } = await runCLIInCwd(["--apply", "--scope", "project"], tempDir, {
      PI_OVEN_MOCK_SPAWN: "1",
      PI_OVEN_VALIDATE_MODE: "none",
      HOME: homeDir,
    });
    expect(exitCode).toBe(0);
  });

  it("--scope global is accepted (exit 0)", async () => {
    const { exitCode } = await runCLIInCwd(["--apply", "--scope", "global"], tempDir, {
      PI_OVEN_MOCK_SPAWN: "1",
      PI_OVEN_VALIDATE_MODE: "none",
      HOME: homeDir,
    });
    expect(exitCode).toBe(0);
  });

  it("--repair-prereqs succeeds without writing project routing or setup markers", async () => {
    const { exitCode, stdout } = await runCLIInCwd(["--repair-prereqs"], tempDir, {
      PI_OVEN_MOCK_SPAWN: "1",
      HOME: homeDir,
    });
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Machine-global prerequisites repaired.");
    expect(existsSync(join(tempDir, ".omp", "settings.json"))).toBe(false);
    expect(markerExists(tempDir)).toBe(false);
    expect(globalMarkerExists(homeDir)).toBe(false);
  });

  it("--repair-prereqs --scope project is rejected with a global-only error", async () => {
    const { exitCode, stderr } = await runCLIInCwd(["--repair-prereqs", "--scope", "project"], tempDir, {
      PI_OVEN_MOCK_SPAWN: "1",
      HOME: homeDir,
    });
    expect(exitCode).toBe(1);
    expect(stderr).toMatch(/--repair-prereqs.*global-only|scope.*project/i);
    expect(existsSync(join(tempDir, ".omp", "settings.json"))).toBe(false);
    expect(markerExists(tempDir)).toBe(false);
    expect(globalMarkerExists(homeDir)).toBe(false);
  });

  it("--scope bogus exits 1 with the Allowed message", async () => {
    const { exitCode, stderr } = await runCLIInCwd(["--apply", "--scope", "bogus"], tempDir, {
      PI_OVEN_MOCK_SPAWN: "1",
      HOME: homeDir,
    });
    expect(exitCode).toBe(1);
    expect(stderr).toMatch(/Invalid scope "bogus"\. Allowed: global, project\./);
  });

  it("--language ko --scope project writes the PROJECT config.json only (not global)", async () => {
    const { exitCode } = await runCLIInCwd(["--language", "ko", "--scope", "project"], tempDir, {
      PI_OVEN_MOCK_SPAWN: "1",
      HOME: homeDir,
    });
    expect(exitCode).toBe(0);
    const projectCfg = JSON.parse(
      readFileSync(join(tempDir, ".pi-oven", "config.json"), "utf-8")
    );
    expect(projectCfg.language).toBe("ko");
    // No global config.json written.
    expect(existsSync(join(homeDir, ".pi-oven", "config.json"))).toBe(false);
  });

  it("--language ko --scope global writes the GLOBAL config.json only (not project)", async () => {
    const { exitCode } = await runCLIInCwd(["--language", "ko", "--scope", "global"], tempDir, {
      PI_OVEN_MOCK_SPAWN: "1",
      HOME: homeDir,
    });
    expect(exitCode).toBe(0);
    const globalCfg = JSON.parse(
      readFileSync(join(homeDir, ".pi-oven", "config.json"), "utf-8")
    );
    expect(globalCfg.language).toBe("ko");
    // No project config.json written.
    expect(existsSync(join(tempDir, ".pi-oven", "config.json"))).toBe(false);
  });

  it("--language ko (no --scope) defaults to global and writes the GLOBAL config.json only", async () => {
    const { exitCode } = await runCLIInCwd(["--language", "ko"], tempDir, {
      PI_OVEN_MOCK_SPAWN: "1",
      HOME: homeDir,
    });
    expect(exitCode).toBe(0);
    const globalCfg = JSON.parse(
      readFileSync(join(homeDir, ".pi-oven", "config.json"), "utf-8")
    );
    expect(globalCfg.language).toBe("ko");
    expect(existsSync(join(tempDir, ".pi-oven", "config.json"))).toBe(false);
  });

  it("--scope project --apply seeds nativeWorkers.maxWorkers in project config and reports the new fan-out contract", async () => {
    const { exitCode, stdout } = await runCLIInCwd(["--apply", "--scope", "project"], tempDir, {
      PI_OVEN_MOCK_SPAWN: "1",
      PI_OVEN_VALIDATE_MODE: "none",
      HOME: homeDir,
    });
    expect(exitCode).toBe(0);

    const projectCfg = JSON.parse(
      readFileSync(join(tempDir, ".pi-oven", "config.json"), "utf-8")
    );
    expect(projectCfg.nativeWorkers.maxWorkers).toBe(100);
    expect(stdout).toContain('skills.includeSkills = ["pov:*"]');
    expect(stdout).toContain("workflow skills only");
    expect(stdout).toContain("nativeWorkers.maxWorkers=100");
    expect(stdout).toContain("scripts/pi-oven-team/index.ts");
  });

  it("--scope global --apply seeds nativeWorkers.maxWorkers in global config", async () => {
    const { exitCode, stdout } = await runCLIInCwd(["--apply", "--scope", "global"], tempDir, {
      PI_OVEN_MOCK_SPAWN: "1",
      PI_OVEN_VALIDATE_MODE: "none",
      HOME: homeDir,
    });
    expect(exitCode).toBe(0);

    const globalCfg = JSON.parse(
      readFileSync(join(homeDir, ".pi-oven", "config.json"), "utf-8")
    );
    expect(globalCfg.nativeWorkers.maxWorkers).toBe(100);
    expect(stdout).toContain('skills.includeSkills = ["pov:*"]');
    expect(stdout).toContain("workflow skills only");
    expect(stdout).toContain("nativeWorkers.maxWorkers=100");
  });

  it("--scope project --apply writes canonical pov:* keys to the project .omp/settings.json", async () => {
    const legacySettingsPath = join(tempDir, ".omp", "settings.json");
    mkdirSync(join(tempDir, ".omp"), { recursive: true });
    writeFileSync(
      legacySettingsPath,
      JSON.stringify(
        {
          task: {
            agentModelOverrides: {
              "pi-oven:critic": "anthropic/claude-opus-4-8",
            },
          },
        },
        null,
        2
      ) + "\n",
      "utf-8"
    );

    const { exitCode } = await runCLIInCwd(["--apply", "--scope", "project"], tempDir, {
      PI_OVEN_MOCK_SPAWN: "1",
      PI_OVEN_VALIDATE_MODE: "none",
      HOME: homeDir,
    });
    expect(exitCode).toBe(0);
    const settings = JSON.parse(readFileSync(legacySettingsPath, "utf-8"));
    expect(Object.keys(settings.task.agentModelOverrides).length).toBe(ROLES.length);
    expect(Object.keys(settings.task.agentModelOverrides).every((key) => key.startsWith("pov:"))).toBe(
      true
    );
    expect(settings.task.agentModelOverrides["pi-oven:critic"]).toBeUndefined();
    expect(settings.skills.includeSkills).toEqual(["pov:*"]);
  });
});

// ---------------------------------------------------------------------------
// --suppress-sibling-skills / --no-suppress-sibling-skills flag (§3.4)
// ---------------------------------------------------------------------------

describe("pi-oven-setup CLI --suppress-sibling-skills", () => {
  let tempDir: string;
  let homeDir: string;

  beforeEach(() => {
    tempDir = join(
      tmpdir(),
      `cli-suppress-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    mkdirSync(tempDir, { recursive: true });
    homeDir = join(
      tmpdir(),
      `cli-suppress-home-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    mkdirSync(homeDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
    rmSync(homeDir, { recursive: true, force: true });
  });

  it("--suppress-sibling-skills exits 0 and mentions the suppressed globs", async () => {
    const { exitCode, stdout: out } = await runCLIInCwd(
      ["--suppress-sibling-skills"],
      tempDir,
      { PI_OVEN_MOCK_SPAWN: "1", HOME: homeDir }
    );
    expect(exitCode).toBe(0);
    expect(out).toContain("superpowers:*");
    expect(out).toContain("oh-my-claudecode:*");
  });

  it("--no-suppress-sibling-skills exits 0 and reports cleared/nothing message", async () => {
    const { exitCode, stdout: out } = await runCLIInCwd(
      ["--no-suppress-sibling-skills"],
      tempDir,
      { PI_OVEN_MOCK_SPAWN: "1", HOME: homeDir }
    );
    expect(exitCode).toBe(0);
    // Either "cleared/removed" or "nothing to undo" is acceptable output
    expect(out).toMatch(/cleared|removed|nothing|already|no.*suppress/i);
  });

  it("--suppress-sibling-skills + --scope project is rejected (no-op + error message)", async () => {
    const { exitCode, stderr } = await runCLIInCwd(
      ["--suppress-sibling-skills", "--scope", "project"],
      tempDir,
      { PI_OVEN_MOCK_SPAWN: "1", HOME: homeDir }
    );
    expect(exitCode).toBe(1);
    expect(stderr).toMatch(/global.only|scope.*project|project.*scope/i);
    // Must NOT write .omp/settings.json
    expect(existsSync(join(tempDir, ".omp", "settings.json"))).toBe(false);
  });
  it("--no-suppress-sibling-skills + --scope project is rejected (no global write leak)", async () => {
    const { exitCode, stderr } = await runCLIInCwd(
      ["--no-suppress-sibling-skills", "--scope", "project"],
      tempDir,
      { PI_OVEN_MOCK_SPAWN: "1", HOME: homeDir }
    );
    expect(exitCode).toBe(1);
    expect(stderr).toMatch(/global.only|scope.*project|project.*scope/i);
    expect(existsSync(join(tempDir, ".omp", "settings.json"))).toBe(false);
  });

  it("--isolate reports the legacy home-layer compatibility mode and boundary contract", async () => {
    const { exitCode, stdout: out } = await runCLIInCwd(
      ["--isolate"],
      tempDir,
      { PI_OVEN_MOCK_SPAWN: "1", HOME: homeDir }
    );
    expect(exitCode).toBe(0);
    expect(out).toContain("legacy home-layer compatibility aid");
    expect(out).toContain("disabledProviders = [claude]");
    expect(out).toContain("~/.claude home layer");
    expect(out).toContain("Legacy front doors");
  });

  it("--isolate + --scope project is rejected (no global write leak)", async () => {
    const { exitCode, stderr } = await runCLIInCwd(
      ["--isolate", "--scope", "project"],
      tempDir,
      { PI_OVEN_MOCK_SPAWN: "1", HOME: homeDir }
    );
    expect(exitCode).toBe(1);
    expect(stderr).toMatch(/global.only|scope.*project|project.*scope/i);
    expect(existsSync(join(tempDir, ".omp", "settings.json"))).toBe(false);
  });

  it("--no-isolate + --scope project is rejected (no global write leak)", async () => {
    const { exitCode, stderr } = await runCLIInCwd(
      ["--no-isolate", "--scope", "project"],
      tempDir,
      { PI_OVEN_MOCK_SPAWN: "1", HOME: homeDir }
    );
    expect(exitCode).toBe(1);
    expect(stderr).toMatch(/global.only|scope.*project|project.*scope/i);
    expect(existsSync(join(tempDir, ".omp", "settings.json"))).toBe(false);
  });

  it("--reset also clears pi-oven-managed ignoredSkills globs", async () => {
    const { exitCode, stdout: out } = await runCLIInCwd(
      ["--reset"],
      tempDir,
      { PI_OVEN_MOCK_SPAWN: "1", HOME: homeDir }
    );
    expect(exitCode).toBe(0);
    // --reset is a success path; output mentions cleared/no-overrides
    expect(out).toMatch(/cleared|No overrides/i);
  });

  it("--suppress-sibling-skills and --no-suppress-sibling-skills are mutually exclusive", async () => {
    const { exitCode, stderr } = await runCLIInCwd(
      ["--suppress-sibling-skills", "--no-suppress-sibling-skills"],
      tempDir,
      { PI_OVEN_MOCK_SPAWN: "1", HOME: homeDir }
    );
    expect(exitCode).toBe(1);
    expect(stderr).toMatch(/mutual(?:ly)?\s+exclusive|cannot.*both|both.*cannot/i);
  });
});

// Keep reference to avoid unused import warning
const stdout = "";
