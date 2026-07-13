import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { spawnSync } from "bun";
import { join } from "path";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "fs";
import { tmpdir } from "os";

const LINT = join(import.meta.dir, "../../scripts/lint-skills.ts");

function runLint(dir: string): { code: number; stderr: string } {
  // Pass an explicit skillsDir so role-coverage (default-dir only) is not required.
  const r = spawnSync({ cmd: [process.execPath, LINT, dir] });
  return { code: r.exitCode, stderr: r.stderr.toString() };
}

function writeSkill(root: string, name: string, body: string, frontmatterName: string = `pov:${name}`): void {
  mkdirSync(join(root, name), { recursive: true });
  writeFileSync(join(root, name, "SKILL.md"), `---\nname: ${frontmatterName}\n---\n\n${body}\n`);
}

describe("lint-skills skill→skill references", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "lint-skills-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("flags a skill:// URI that does not resolve to a shipped skill", () => {
    writeSkill(dir, "alpha", "See skill://nonexistent for details.");
    const { code, stderr } = runLint(dir);
    expect(code).toBe(1);
    expect(stderr).toContain("skill://nonexistent");
  });

  it("passes when a skill:// URI resolves to a present skill", () => {
    writeSkill(dir, "alpha", "See skill://alpha for details.");
    writeSkill(dir, "beta", "Hand off to skill://alpha when done.");
    expect(runLint(dir).code).toBe(0);
  });

  it("accepts the skill://pov:<name>/references form (colon)", () => {
    writeSkill(dir, "alpha", "Detail: skill://pov:alpha/references/x.md");
    expect(runLint(dir).code).toBe(0);
  });

  it("rejects the legacy skill://pi-oven:<name>/references form", () => {
    writeSkill(dir, "alpha", "Detail: skill://pi-oven:alpha/references/x.md");
    const { code, stderr } = runLint(dir);
    expect(code).toBe(1);
    expect(stderr).toContain("skill://pi-oven");
  });

  it("rejects the broken slash form skill://pi-oven/<name>/references", () => {
    writeSkill(dir, "alpha", "Detail: skill://pi-oven/alpha/references/x.md");
    const { code, stderr } = runLint(dir);
    expect(code).toBe(1);
    expect(stderr).toContain("pi-oven");
  });

  it("flags a removed phantom skill referenced as a bare backtick token", () => {
    writeSkill(dir, "alpha", "Run the `freshness-guard` step first.");
    const { code, stderr } = runLint(dir);
    expect(code).toBe(1);
    expect(stderr).toContain("freshness-guard");
  });

  it("flags the executing-plans phantom too", () => {
    writeSkill(dir, "alpha", "Fall back to `executing-plans` inline.");
    expect(runLint(dir).code).toBe(1);
  });

  it("flags a frontmatter name that skips the public pov: prefix", () => {
    writeSkill(dir, "alpha", "Use inline sequential execution.", "alpha");
    const { code, stderr } = runLint(dir);
    expect(code).toBe(1);
    expect(stderr).toContain("public frontmatter name pov:alpha");
  });

  it("rejects legacy pi-oven agent refs outside the shipped migration allowance", () => {
    writeSkill(dir, "alpha", "Dispatch pi-oven:explorer for survey.");
    const { code, stderr } = runLint(dir);
    expect(code).toBe(1);
    expect(stderr).toContain("canonical agent token is pov:explorer");
  });

  it("rejects legacy pi-oven agent refs even in migration or diagnostic prose", () => {
    writeSkill(
      dir,
      "alpha",
      "Migration diagnostic: legacy pi-oven:explorer remains documented here until the authored skill text is cut over."
    );
    const { code, stderr } = runLint(dir);
    expect(code).toBe(1);
    expect(stderr).toContain("canonical agent token is pov:explorer");
  });

  it("accepts canonical agents/pov-<role>.md agent paths", () => {
    writeSkill(dir, "alpha", "Read agents/pov-explorer.md before dispatch.");
    expect(runLint(dir).code).toBe(0);
  });

  it("rejects legacy agents/pi-oven-<role>.md paths outside the shipped migration allowance", () => {
    writeSkill(dir, "alpha", "Read agents/pi-oven-explorer.md before dispatch.");
    const { code, stderr } = runLint(dir);
    expect(code).toBe(1);
    expect(stderr).toContain("canonical agent path is agents/pov-explorer.md");
  });

  it("rejects legacy agents/pi-oven-<role>.md paths even in migration or diagnostic prose", () => {
    writeSkill(
      dir,
      "alpha",
      "Migration diagnostic: legacy agents/pi-oven-explorer.md remains documented here until the authored skill text is cut over."
    );
    const { code, stderr } = runLint(dir);
    expect(code).toBe(1);
    expect(stderr).toContain("canonical agent path is agents/pov-explorer.md");
  });

  it("keeps /pi-oven:* commands and pi-oven@kzk package identity valid", () => {
    writeSkill(
      dir,
      "alpha",
      "Run /pi-oven:setup, install pi-oven@kzk, then dispatch pov:explorer for survey."
    );
    expect(runLint(dir).code).toBe(0);
  });

  it("passes a clean skill with no dangling refs", () => {
    writeSkill(dir, "alpha", "Use inline sequential execution. Dispatch pov:explorer for survey.");
    expect(runLint(dir).code).toBe(0);
  });
});
