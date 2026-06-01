import { describe, expect, it } from "bun:test";
import {
  createReleaseCommit,
  createReleaseTag,
  ensureGitClean,
  getCurrentTag,
  pushRelease,
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

  it("ensureGitClean throws when working tree is dirty", () => {
    const spawn = makeSpawn({ "status --porcelain": { exitCode: 0, stdout: " M package.json\n" } });
    expect(() => ensureGitClean(spawn)).toThrow("working tree is dirty");
  });

  it("createReleaseCommit and createReleaseTag are no-ops in dry-run", () => {
    const spawn = makeSpawn({});
    expect(createReleaseCommit("0.1.0", true, spawn)).toBeUndefined();
    expect(createReleaseTag("0.1.0", true, spawn)).toBeUndefined();
    expect(pushRelease("0.1.0", true, spawn)).toEqual([]);
  });

  it("createReleaseCommit/createReleaseTag/pushRelease emit expected git commands", () => {
    const spawn = makeSpawn({});
    const commit = createReleaseCommit("0.1.0", false, spawn);
    const tag = createReleaseTag("0.1.0", false, spawn);
    const pushes = pushRelease("0.1.0", false, spawn);

    expect(commit).toEqual({ command: "git", args: ["commit", "-am", "release: v0.1.0"] });
    expect(tag).toEqual({ command: "git", args: ["tag", "v0.1.0"] });
    expect(pushes).toEqual([
      { command: "git", args: ["push", "origin", "main"] },
      { command: "git", args: ["push", "origin", "v0.1.0"] },
    ]);
  });
});
