import { describe, expect, it } from "bun:test";
import { runRelease } from "../../../scripts/pi-oven-release/index";
import { prepareReleaseCommit } from "../../../scripts/pi-oven-release/release-publisher";
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
  it("skips when prepare=false", () => {
    const { spawn, calls } = makeSpawn();
    const result = prepareReleaseCommit({
      version: "0.5.0",
      prepare: false,
      dryRun: false,
      currentBranch: "feature/harness-overhaul",
      spawnFn: spawn,
    });
    expect(result.prepared).toBe(false);
    expect(calls.length).toBe(0);
  });

  it("prepare dry-run performs no git writes", () => {
    const { spawn, calls } = makeSpawn();
    const result = prepareReleaseCommit({
      version: "0.5.0",
      prepare: true,
      dryRun: true,
      currentBranch: "feature/harness-overhaul",
      spawnFn: spawn,
    });
    expect(result.prepared).toBe(true);
    expect(result.commit).toBeUndefined();
    expect(calls).toEqual([]);
  });

  it("prepare creates only a release commit and never tags or pushes", () => {
    const { spawn, calls } = makeSpawn();
    const result = prepareReleaseCommit({
      version: "0.5.0",
      prepare: true,
      dryRun: false,
      currentBranch: "feature/harness-overhaul",
      spawnFn: spawn,
    });
    expect(result.prepared).toBe(true);
    expect(result.commit?.args).toEqual(["commit", "-am", "release: v0.5.0"]);
    expect(calls).toEqual([
      "install --frozen-lockfile",
      "run release:contract -- --tag v0.5.0 --check-only",
      "run contract:check",
      "run check",
      "run lint:agents",
      "run lint:skills",
      "run build",
      "run test:hermetic -- --only-failures",
      "commit -am release: v0.5.0",
    ]);
  });

  it("validation failure prevents the release commit", () => {
    const { spawn, calls } = makeSpawn({ "run check": true });
    expect(() =>
      prepareReleaseCommit({
        version: "0.5.0",
        prepare: true,
        dryRun: false,
        currentBranch: "main",
        spawnFn: spawn,
      }),
    ).toThrow("release validation failed");
    expect(calls).toEqual([
      "install --frozen-lockfile",
      "run release:contract -- --tag v0.5.0 --check-only",
      "run contract:check",
      "run check",
    ]);
  });

  it("prepare non-dry-run refuses to guess the git branch before local git writes", () => {
    const { spawn, calls } = makeSpawn();
    expect(() =>
      prepareReleaseCommit({
        version: "0.5.0",
        prepare: true,
        dryRun: false,
        spawnFn: spawn,
      })
    ).toThrow("current git branch");
    expect(calls).toEqual([]);
  });

  it("runRelease rejects --publish because publishing belongs to the tag workflow", () => {
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
          prepareReleaseCommit: () => {
            calls.push("prepareReleaseCommit");
            return { prepared: false };
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
    ).toThrow("tag workflow");
    expect(calls).toEqual([]);
  });
});
