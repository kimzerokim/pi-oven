import { describe, expect, it } from "bun:test";
import { runRelease } from "../../../scripts/pi-oven-release/index";
import { publishRelease } from "../../../scripts/pi-oven-release/release-publisher";
import type { SpawnFn } from "../../../scripts/pi-oven-release/changelog-generator";

function makeSpawn(failures: Record<string, boolean> = {}): { spawn: SpawnFn; calls: string[] } {
  const calls: string[] = [];
  const spawn: SpawnFn = (_cmd, args) => {
    const key = args.join(" ");
    calls.push(key);
    if (failures[key]) {
      return { exitCode: 1, stdout: "", stderr: "failed" };
    }
    return { exitCode: 0, stdout: "", stderr: "" };
  };
  return { spawn, calls };
}

describe("release-publisher", () => {
  it("skips when publish=false", () => {
    const { spawn, calls } = makeSpawn();
    const result = publishRelease({
      version: "0.5.0",
      publish: false,
      dryRun: false,
      currentBranch: "feature/harness-overhaul",
      spawnFn: spawn,
    });
    expect(result.performed).toBe(false);
    expect(calls.length).toBe(0);
  });

  it("publishing dry-run performs no git writes", () => {
    const { spawn, calls } = makeSpawn();
    const result = publishRelease({
      version: "0.5.0",
      publish: true,
      dryRun: true,
      currentBranch: "feature/harness-overhaul",
      spawnFn: spawn,
    });
    expect(result.performed).toBe(true);
    expect(result.commit).toBeUndefined();
    expect(result.tag).toBeUndefined();
    expect(result.pushes).toEqual([]);
    expect(calls).toEqual([]);
  });

  it("publishing non-dry-run requires the current source branch for git pushes", () => {
    const { spawn, calls } = makeSpawn();
    const result = publishRelease({
      version: "0.5.0",
      publish: true,
      dryRun: false,
      currentBranch: "feature/harness-overhaul",
      spawnFn: spawn,
    });
    expect(result.performed).toBe(true);
    expect(result.commit?.args).toEqual(["commit", "-am", "release: v0.5.0"]);
    expect(result.tag?.args).toEqual(["tag", "v0.5.0"]);
    expect(calls).toEqual([
      "commit -am release: v0.5.0",
      "tag v0.5.0",
      "push origin feature/harness-overhaul",
      "push origin v0.5.0",
    ]);
  });

  it("publishing non-dry-run refuses to guess the git branch before any local git writes", () => {
    const { spawn, calls } = makeSpawn();
    expect(() =>
      publishRelease({
        version: "0.5.0",
        publish: true,
        dryRun: false,
        spawnFn: spawn,
      })
    ).toThrow("current git branch");
    expect(calls).toEqual([]);
  });

  it("runRelease rejects missing currentBranch before publish-mode sync or changelog work", () => {
    const calls: string[] = [];
    expect(() =>
      runRelease(
        { bump: "patch", publish: true },
        {
          readCurrentVersionFromSoT: () => "0.5.0",
          getCurrentBranch: () => undefined,
          getCurrentTag: () => "v0.5.0",
          ensureGitClean: () => {
            calls.push("ensureGitClean");
          },
          syncReleaseManifests: () => {
            calls.push("syncReleaseManifests");
            return {
              filesChecked: [],
              filesUpdated: [],
              labelUpdated: false,
              boundary: {
                sourceRepo: { root: "/tmp/pi-oven", versionFiles: [] },
                releaseArtifact: { version: "0.5.1", manifestFiles: [], labelFile: null },
                installedCache: {
                  mode: "observation-only",
                  patchTarget: false,
                  touchedByReleaseHelper: false,
                },
              },
            };
          },
          updateChangelog: () => {
            calls.push("updateChangelog");
            return { updated: false, commits: [] };
          },
          publishRelease: () => {
            calls.push("publishRelease");
            return { performed: false, pushes: [] };
          },
          buildReleaseInstallBoundary: () => {
            calls.push("buildReleaseInstallBoundary");
            return {
              sourceRepo: { root: "/tmp/pi-oven", versionFiles: [] },
              releaseArtifact: { version: "0.5.1", manifestFiles: [], labelFile: null },
              installedCache: {
                mode: "observation-only",
                patchTarget: false,
                touchedByReleaseHelper: false,
              },
            };
          },
        }
      )
    ).toThrow("current git branch");
    expect(calls).toEqual([]);
  });
});
