import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { spawnSync } from "bun";
import { mkdirSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

const LINT_SCRIPT = join(import.meta.dir, "../../scripts/lint-skills.ts");

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
    cmd: [process.execPath, LINT_SCRIPT, skillsDir],
    cwd: join(import.meta.dir, "../.."),
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

function writeSkill(skillsRoot: string, skillName: string, body: string = ""): void {
  const skillDir = join(skillsRoot, skillName);
  mkdirSync(skillDir, { recursive: true });
  writeFileSync(
    join(skillDir, "SKILL.md"),
    `---
name: ${skillName}
version: 0.1.0
description: test skill
alwaysApply: false
---

# ${skillName}
${body}
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

  it("passes for a plain skill with no pi-oven role refs", () => {
    writeSkill(tempDir, "demo");

    const out = runLint(tempDir);
    expect(out.exitCode).toBe(0);
  });

  it("passes when skill references a valid pi-oven role", () => {
    writeSkill(tempDir, "demo", "Delegate to pi-oven:executor for implementation.");

    const out = runLint(tempDir);
    expect(out.exitCode).toBe(0);
  });

  it("fails when skill references an unknown pi-oven role", () => {
    writeSkill(tempDir, "demo", "Use pi-oven:nonexistent-role here.");

    const out = runLint(tempDir);
    expect(out.exitCode).toBe(1);
    expect(out.stderr).toContain("pi-oven:nonexistent-role which is not in ROLES");
  });

  it("fails role coverage when explicitly required and roles are missing", () => {
    writeSkill(tempDir, "demo");

    const out = runLint(tempDir, { PI_OVEN_LINT_REQUIRE_ROLE_COVERAGE: "1" });
    expect(out.exitCode).toBe(1);
    expect(out.stderr).toContain("skills role coverage missing for");
  });
});
