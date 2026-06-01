import { describe, expect, it } from "bun:test";
import { publishRelease } from "../../../scripts/pi-oven-release/release-publisher";
import type { SpawnFn } from "../../../scripts/pi-oven-release/changelog-generator";

function makeSpawn(statusOut = "", failures: Record<string, boolean> = {}): { spawn: SpawnFn; calls: string[] } {
  const calls: string[] = [];
  const spawn: SpawnFn = (_cmd, args) => {
    const key = args.join(" ");
    calls.push(key);
    if (failures[key]) {
      return { exitCode: 1, stdout: "", stderr: "failed" };
    }
    if (key === "status --porcelain") {
      return { exitCode: 0, stdout: statusOut, stderr: "" };
    }
    return { exitCode: 0, stdout: "", stderr: "" };
  };
  return { spawn, calls };
}

describe("release-publisher", () => {
  it("skips when publish=false", () => {
    const { spawn, calls } = makeSpawn();
    const result = publishRelease({ version: "0.1.0", publish: false, dryRun: false, spawnFn: spawn });
    expect(result.performed).toBe(false);
    expect(calls.length).toBe(0);
  });

  it("publishing dry-run validates but performs no git writes", () => {
    const { spawn, calls } = makeSpawn();
    const result = publishRelease({ version: "0.1.0", publish: true, dryRun: true, spawnFn: spawn });
    expect(result.performed).toBe(true);
    expect(result.commit).toBeUndefined();
    expect(result.tag).toBeUndefined();
    expect(result.pushes).toEqual([]);
    expect(calls).toEqual(["status --porcelain"]);
  });

  it("publishing non-dry-run executes commit/tag/push", () => {
    const { spawn, calls } = makeSpawn();
    const result = publishRelease({ version: "0.1.0", publish: true, dryRun: false, spawnFn: spawn });
    expect(result.performed).toBe(true);
    expect(result.commit?.args).toEqual(["commit", "-am", "release: v0.1.0"]);
    expect(result.tag?.args).toEqual(["tag", "v0.1.0"]);
    expect(calls).toEqual([
      "status --porcelain",
      "commit -am release: v0.1.0",
      "tag v0.1.0",
      "push origin main",
      "push origin v0.1.0",
    ]);
  });

  it("fails on dirty tree", () => {
    const { spawn } = makeSpawn(" M package.json\n");
    expect(() => publishRelease({ version: "0.1.0", publish: true, dryRun: false, spawnFn: spawn })).toThrow(
      "working tree is dirty",
    );
  });
});
