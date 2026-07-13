import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { spawnSync } from "bun";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

const LINT = join(import.meta.dir, "../../scripts/lint-agents.ts");
const SHIPPED_AGENTS_DIR = join(import.meta.dir, "../../agents");

function runLint(dir: string): { code: number; stderr: string } {
  const result = spawnSync({ cmd: [process.execPath, LINT, dir] });
  return { code: result.exitCode, stderr: result.stderr.toString() };
}

describe("lint-agents exact shipped roster", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "lint-agents-"));
    cpSync(SHIPPED_AGENTS_DIR, dir, { recursive: true });
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("passes the current exact 24-role registry", () => {
    expect(runLint(dir)).toEqual({ code: 0, stderr: "" });
  });

  it("rejects an unknown canonical filename before skipping profile checks", () => {
    cpSync(join(dir, "pov-executor.md"), join(dir, "pov-phantom.md"));
    const result = runLint(dir);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('unknown runtime role "phantom"');
  });

  it("rejects a markdown filename outside the canonical pov prefix", () => {
    cpSync(join(dir, "pov-executor.md"), join(dir, "phantom.md"));
    const result = runLint(dir);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('unknown runtime role "phantom"');
  });

  it("rejects an unknown frontmatter role on a registered filename", () => {
    const path = join(dir, "pov-executor.md");
    writeFileSync(
      path,
      readFileSync(path, "utf-8").replace(/^name:\s*.+$/m, "name: pov:phantom")
    );
    const result = runLint(dir);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('must equal "pov:executor"');
  });

  it("rejects a missing canonical role", () => {
    rmSync(join(dir, "pov-executor.md"));
    const result = runLint(dir);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("missing canonical agent file pov-executor.md");
  });

  it("rejects legacy/canonical duplicates", () => {
    cpSync(join(dir, "pov-executor.md"), join(dir, "pi-oven-executor.md"));
    const result = runLint(dir);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("legacy pi-oven filename prefix");
    expect(result.stderr).toContain('duplicate agent files for runtime role "executor"');
  });

  it("rejects tools wildcard on a shipped role", () => {
    const path = join(dir, "pov-executor.md");
    writeFileSync(
      path,
      readFileSync(path, "utf-8").replace(/^tools:\s*\[[^\n]+\]$/m, 'tools: ["*"]')
    );
    const result = runLint(dir);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("explicit allowlist");
  });

  it("rejects overlapping granted and blocked tools", () => {
    const path = join(dir, "pov-executor.md");
    writeFileSync(
      path,
      readFileSync(path, "utf-8").replace(
        /^blocked_tools:\s*\[[^\n]*\]$/m,
        'blocked_tools: ["write"]'
      )
    );
    const result = runLint(dir);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("overlapping tools");
  });

  it("rejects an agent tool that has no versioned capability-policy rule", () => {
    const path = join(dir, "pov-executor.md");
    writeFileSync(
      path,
      readFileSync(path, "utf-8").replace(
        /^tools:\s*\[([^\n]+)\]$/m,
        (_match, tools: string) => `tools: [${tools}, "unclassified_tool"]`
      )
    );

    const result = runLint(dir);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("no capability-policy rule");
  });
});
