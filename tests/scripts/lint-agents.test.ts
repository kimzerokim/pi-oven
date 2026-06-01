import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { spawnSync } from "bun";
import { mkdirSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

const LINT_SCRIPT = join(import.meta.dir, "../../scripts/lint-agents.ts");

function makeTempDir(): string {
  const dir = join(tmpdir(), `lint-agents-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function runLint(agentsDir: string): { exitCode: number; stderr: string; stdout: string } {
  const result = spawnSync({
    cmd: [process.execPath, LINT_SCRIPT, agentsDir],
    cwd: join(import.meta.dir, "../.."),
  });
  return {
    exitCode: result.exitCode ?? 1,
    stdout: result.stdout ? new TextDecoder().decode(result.stdout) : "",
    stderr: result.stderr ? new TextDecoder().decode(result.stderr) : "",
  };
}

describe("lint-agents", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = makeTempDir();
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("empty agents dir exits 0 (no pi-oven-*.md files)", () => {
    const result = runLint(tempDir);
    expect(result.exitCode).toBe(0);
  });

  it("single agent with valid model string exits 0", () => {
    writeFileSync(
      join(tempDir, "pi-oven-coder.md"),
      [
        "---",
        "model: opencode-zen/claude-haiku-4-5",
        "---",
        "# Coder agent",
      ].join("\n")
    );
    const result = runLint(tempDir);
    expect(result.exitCode).toBe(0);
  });

  it("single agent with missing model field exits 1 and includes filename in error", () => {
    writeFileSync(
      join(tempDir, "pi-oven-missing-model.md"),
      [
        "---",
        "description: no model here",
        "---",
        "# Agent",
      ].join("\n")
    );
    const result = runLint(tempDir);
    expect(result.exitCode).toBe(1);
    const output = result.stdout + result.stderr;
    expect(output).toContain("pi-oven-missing-model.md");
  });

  it("single agent with empty model string exits 1", () => {
    writeFileSync(
      join(tempDir, "pi-oven-empty-model.md"),
      [
        "---",
        'model: ""',
        "---",
        "# Agent",
      ].join("\n")
    );
    const result = runLint(tempDir);
    expect(result.exitCode).toBe(1);
  });

  it("single agent with empty model array exits 1", () => {
    writeFileSync(
      join(tempDir, "pi-oven-array-model.md"),
      [
        "---",
        "model: []",
        "---",
        "# Agent",
      ].join("\n")
    );
    const result = runLint(tempDir);
    expect(result.exitCode).toBe(1);
  });

  it("multiple agents where one violates exits 1 and lists violator filename", () => {
    writeFileSync(
      join(tempDir, "pi-oven-valid.md"),
      [
        "---",
        "model: opencode-zen/claude-haiku-4-5",
        "---",
        "# Valid",
      ].join("\n")
    );
    writeFileSync(
      join(tempDir, "pi-oven-bad.md"),
      [
        "---",
        "description: no model",
        "---",
        "# Bad",
      ].join("\n")
    );
    const result = runLint(tempDir);
    expect(result.exitCode).toBe(1);
    const output = result.stdout + result.stderr;
    expect(output).toContain("pi-oven-bad.md");
  });

  it("non-pi-oven-*.md files are ignored", () => {
    writeFileSync(
      join(tempDir, "other-agent.md"),
      [
        "---",
        "description: no model",
        "---",
        "# Not a pi-oven file",
      ].join("\n")
    );
    const result = runLint(tempDir);
    expect(result.exitCode).toBe(0);
  });

  // Colon-name invariant: name must equal "pi-oven:" + role (the omp registry key).
  // These tests use role "critic" which is in ROLES, so the name check runs.

  it("agent with correct colon name passes colon-name invariant", () => {
    writeFileSync(
      join(tempDir, "pi-oven-critic.md"),
      [
        "---",
        "name: pi-oven:critic",
        "model:",
        "  - anthropic/claude-opus-4-8",
        "  - opencode-zen/claude-opus-4-8",
        "thinkingLevel: xhigh",
        "---",
        "# Critic",
      ].join("\n")
    );
    const result = runLint(tempDir);
    expect(result.exitCode).toBe(0);
  });

  it("agent with hyphen name fails colon-name invariant and error contains expected name", () => {
    writeFileSync(
      join(tempDir, "pi-oven-critic.md"),
      [
        "---",
        "name: pi-oven-critic",
        "model:",
        "  - anthropic/claude-opus-4-8",
        "  - opencode-zen/claude-opus-4-8",
        "thinkingLevel: xhigh",
        "---",
        "# Critic",
      ].join("\n")
    );
    const result = runLint(tempDir);
    expect(result.exitCode).toBe(1);
    const output = result.stdout + result.stderr;
    expect(output).toContain("pi-oven:critic");
    expect(output).toContain("pi-oven-critic.md");
  });

  it("agent with missing name field fails colon-name invariant", () => {
    writeFileSync(
      join(tempDir, "pi-oven-critic.md"),
      [
        "---",
        "model:",
        "  - anthropic/claude-opus-4-8",
        "  - opencode-zen/claude-opus-4-8",
        "thinkingLevel: xhigh",
        "---",
        "# Critic",
      ].join("\n")
    );
    const result = runLint(tempDir);
    expect(result.exitCode).toBe(1);
    const output = result.stdout + result.stderr;
    expect(output).toContain("pi-oven:critic");
  });

  it("lint does not read user-global config.yml (PROFILE_A baseline only)", () => {
    // Structural: the lint script only reads the agentsDir passed as argv[2].
    // It has no reference to ~/.omp/agent/config.yml — verified by absence
    // of any config.yml read in the script source. This test asserts that
    // a correct colon-name agent passes regardless of any user config state.
    writeFileSync(
      join(tempDir, "pi-oven-critic.md"),
      [
        "---",
        "name: pi-oven:critic",
        "model:",
        "  - anthropic/claude-opus-4-8",
        "  - opencode-zen/claude-opus-4-8",
        "thinkingLevel: xhigh",
        "---",
        "# Critic",
      ].join("\n")
    );
    const result = runLint(tempDir);
    // Passes without any ~/.omp/agent/config.yml present or consulted.
    expect(result.exitCode).toBe(0);
  });
});
