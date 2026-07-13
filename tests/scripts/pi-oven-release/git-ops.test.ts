import { describe, expect, it } from "bun:test";
import {
  createReleaseCommit,
  ensureGitClean,
  getCurrentBranch,
  getCurrentTag,
} from "../../../scripts/pi-oven-release/git-ops";
import type { SpawnFn } from "../../../scripts/pi-oven-release/changelog-generator";

function makeSpawn(map: Record<string, { exitCode: number; stdout?: string; stderr?: string }>): SpawnFn {
  return (_cmd, args) => {
    const key = args.join(" ");
    const hit = map[key];
    if (!hit) return { exitCode: 0, stdout: "", stderr: "" };
    return { exitCode: hit.exitCode, stdout: hit.stdout ?? "", stderr: hit.stderr ?? "" };
  };
}

describe("git-ops", () => {
  it("getCurrentTag returns undefined when git describe fails", () => {
    const spawn = makeSpawn({ "describe --tags --abbrev=0": { exitCode: 1 } });
    expect(getCurrentTag(spawn)).toBeUndefined();
  });

  it("getCurrentTag trims tag output", () => {
    const spawn = makeSpawn({ "describe --tags --abbrev=0": { exitCode: 0, stdout: "v1.2.3\n" } });
    expect(getCurrentTag(spawn)).toBe("v1.2.3");
  });

  it("getCurrentBranch trims branch output", () => {
    const spawn = makeSpawn({ "branch --show-current": { exitCode: 0, stdout: "feature/harness-overhaul\n" } });
    expect(getCurrentBranch(spawn)).toBe("feature/harness-overhaul");
  });

  it("getCurrentBranch returns undefined when git branch lookup fails", () => {
    const spawn = makeSpawn({ "branch --show-current": { exitCode: 1 } });
    expect(getCurrentBranch(spawn)).toBeUndefined();
  });

  it("ensureGitClean throws when working tree is dirty", () => {
    const spawn = makeSpawn({ "status --porcelain": { exitCode: 0, stdout: " M package.json\n" } });
    expect(() => ensureGitClean(spawn)).toThrow("working tree is dirty");
  });

  it("createReleaseCommit is a no-op in dry-run", () => {
    const spawn = makeSpawn({});
    expect(createReleaseCommit("0.5.0", true, spawn)).toBeUndefined();
  });

  it("createReleaseCommit emits only the expected local git command", () => {
    const spawn = makeSpawn({});
    const commit = createReleaseCommit("0.5.0", false, spawn);

    expect(commit).toEqual({ command: "git", args: ["commit", "-am", "release: v0.5.0"] });
  });
});
