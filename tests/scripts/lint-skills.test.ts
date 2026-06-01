import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { spawnSync } from "bun";
import { mkdirSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

const LINT_SCRIPT = "/Users/kimzerokim/work/personal/pi-oven/scripts/lint-skills.ts";

function makeTempDir(): string {
  const dir = join(tmpdir(), `lint-skills-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function runLint(
  skillsDir: string,
  env: Record<string, string> = {}
): { exitCode: number; stderr: string; stdout: string } {
  const result = spawnSync({
    cmd: ["bun", LINT_SCRIPT, skillsDir],
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, ...env },
  });

  return {
    exitCode: result.exitCode ?? 1,
    stdout: Buffer.from(result.stdout).toString("utf8"),
    stderr: Buffer.from(result.stderr).toString("utf8"),
  };
}

function writeSkill(skillsRoot: string, skillName: string, triggerLine: string): void {
  const skillDir = join(skillsRoot, skillName);
  mkdirSync(skillDir, { recursive: true });
  writeFileSync(
    join(skillDir, "SKILL.md"),
    `---
name: ${skillName}
version: 0.1.0
description: test skill
trigger: ${triggerLine}
alwaysApply: false
---

# ${skillName}
`
  );
}

describe("lint-skills", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = makeTempDir();
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("passes when trigger includes Korean keyword", () => {
    writeSkill(tempDir, "demo", '"design, 설계"');

    const out = runLint(tempDir);
    expect(out.exitCode).toBe(0);
  });

  it("fails when trigger lacks Korean keyword", () => {
    writeSkill(tempDir, "demo", '"design, planning"');

    const out = runLint(tempDir);
    expect(out.exitCode).toBe(1);
    expect(out.stderr).toContain("trigger must include at least one Korean keyword");
  });

  it("allows code-quality-discipline without Korean trigger", () => {
    writeSkill(
      tempDir,
      "code-quality-discipline",
      '"tool_call.toolName in (Edit, Write, MultiEdit, ast_grep_replace)"'
    );

    const out = runLint(tempDir);
    expect(out.exitCode).toBe(0);
  });

  it("fails role coverage when explicitly required and roles are missing", () => {
    writeSkill(tempDir, "demo", '"design, 설계"');

    const out = runLint(tempDir, { PI_OVEN_LINT_REQUIRE_ROLE_COVERAGE: "1" });
    expect(out.exitCode).toBe(1);
    expect(out.stderr).toContain("skills role coverage missing for");
  });
});
