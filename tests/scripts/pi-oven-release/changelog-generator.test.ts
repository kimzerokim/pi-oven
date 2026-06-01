import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { updateChangelog, type SpawnFn } from "../../../scripts/pi-oven-release/changelog-generator";

let cwd = "";
let tempDir = "";

beforeEach(() => {
  cwd = process.cwd();
  tempDir = mkdtempSync(join(tmpdir(), "pi-oven-release-changelog-"));
  process.chdir(tempDir);
});

afterEach(() => {
  process.chdir(cwd);
  rmSync(tempDir, { recursive: true, force: true });
});

function okSpawn(stdout: string): SpawnFn {
  return () => ({ exitCode: 0, stdout, stderr: "" });
}

describe("changelog-generator", () => {
  it("collects commits without writing when disabled", () => {
    const result = updateChangelog({
      version: "0.1.0",
      dryRun: true,
      updateChangelog: false,
      spawnFn: okSpawn("feat: a\nfix: b\n"),
    });
    expect(result.updated).toBe(false);
    expect(result.commits).toEqual(["feat: a", "fix: b"]);
  });

  it("writes changelog entry when enabled", () => {
    const result = updateChangelog({
      version: "0.1.0",
      dryRun: false,
      updateChangelog: true,
      date: "2026-06-01",
      spawnFn: okSpawn("feat: release\n"),
    });

    expect(result.updated).toBe(true);
    const content = readFileSync("CHANGELOG.md", "utf8");
    expect(content).toContain("## v0.1.0 - 2026-06-01");
    expect(content).toContain("- feat: release");
  });

  it("throws when git log fails", () => {
    const spawn: SpawnFn = () => ({ exitCode: 1, stdout: "", stderr: "no repo" });
    expect(() =>
      updateChangelog({
        version: "0.1.0",
        dryRun: true,
        updateChangelog: true,
        spawnFn: spawn,
      }),
    ).toThrow("git log failed");
  });
});
