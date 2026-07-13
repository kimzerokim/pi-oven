import { afterEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { main, parseReleaseArgs, runRelease } from "../../../scripts/pi-oven-release/index";

const originalCwd = process.cwd();
const roots: string[] = [];

afterEach(() => {
  process.chdir(originalCwd);
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function git(cwd: string, ...args: string[]): void {
  const result = Bun.spawnSync(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe" });
  if (result.exitCode !== 0) {
    throw new Error(Buffer.from(result.stderr).toString("utf8"));
  }
}

function createReleaseRepo(): string {
  const root = mkdtempSync(join(tmpdir(), "pi-oven-release-cli-"));
  roots.push(root);
  mkdirSync(join(root, ".claude-plugin"), { recursive: true });
  mkdirSync(join(root, ".omp", "extensions"), { recursive: true });
  writeFileSync(join(root, "package.json"), '{"name":"fixture","version":"0.4.0"}\n');
  writeFileSync(join(root, ".claude-plugin", "plugin.json"), '{"version":"0.4.0"}\n');
  writeFileSync(
    join(root, ".claude-plugin", "marketplace.json"),
    '{"plugins":[{"version":"0.4.0","source":{"ref":"v0.4.0"}}]}\n'
  );
  writeFileSync(join(root, ".omp", "extensions", "pi-oven.ts"), 'pi.setLabel("pi-oven v0.4.0");\n');
  writeFileSync(join(root, "CHANGELOG.md"), "# Changelog\n\n");
  git(root, "init", "-b", "main");
  git(root, "config", "user.email", "test@example.com");
  git(root, "config", "user.name", "Test");
  git(root, "add", ".");
  git(root, "commit", "-m", "initial fixture");
  return root;
}

describe("release CLI orchestration", () => {
  it("runs the default dependency stack as a non-mutating dry run", () => {
    const root = createReleaseRepo();
    const packageBefore = readFileSync(join(root, "package.json"), "utf8");
    process.chdir(root);

    const result = runRelease({
      bump: "patch",
      "dry-run": true,
      "update-changelog": true,
    });

    expect(result.safeByDefault).toBe(true);
    expect(result.currentVersion).toBe("0.4.0");
    expect(result.targetVersion).toBe("0.4.1");
    expect(result.boundary.sourceRepo.currentBranch).toBe("main");
    expect(result.boundary.sourceRepo.root).toEndWith(root.split("/").at(-1)!);
    expect(result.sync.filesUpdated).toEqual([
      "package.json",
      ".claude-plugin/plugin.json",
      ".claude-plugin/marketplace.json",
    ]);
    expect(result.changelog.updated).toBe(true);
    expect(result.changelog.contentPreview).toContain("## v0.4.1");
    expect(result.prepareResult.prepared).toBe(false);
    expect(readFileSync(join(root, "package.json"), "utf8")).toBe(packageBefore);
  });

  it("exercises the clean-tree prepare path without committing during dry run", () => {
    const root = createReleaseRepo();
    process.chdir(root);
    const headBefore = Bun.spawnSync(["git", "rev-parse", "HEAD"], { cwd: root }).stdout.toString().trim();

    const result = runRelease({ version: "0.4.0", prepare: true, "dry-run": true });

    expect(result.prepare).toBe(true);
    expect(result.safeByDefault).toBe(true);
    expect(result.prepareResult.prepared).toBe(true);
    expect(Bun.spawnSync(["git", "rev-parse", "HEAD"], { cwd: root }).stdout.toString().trim()).toBe(headBefore);
  });

  it("rejects missing and invalid target selectors before release side effects", () => {
    const root = createReleaseRepo();
    process.chdir(root);

    expect(() => runRelease({ "dry-run": true })).toThrow("One of --version or --bump");
    expect(() => runRelease({ bump: "banana", "dry-run": true })).toThrow("Invalid --bump");
    expect(() => runRelease({ version: "not-semver", "dry-run": true })).toThrow();
  });

  it("parses the documented CLI flags without mutating process arguments", () => {
    expect(
      parseReleaseArgs([
        "--version",
        "1.2.3",
        "--from-tag",
        "v1.2.2",
        "--dry-run",
        "--sync-label",
        "--prepare",
      ])
    ).toEqual({
      version: "1.2.3",
      "from-tag": "v1.2.2",
      "dry-run": true,
      "sync-label": true,
      prepare: true,
    });
  });

  it("serializes the observable dry-run CLI result without mutating manifests", async () => {
    const root = createReleaseRepo();
    process.chdir(root);
    const before = readFileSync(join(root, "package.json"), "utf8");
    const writes: string[] = [];
    const originalWrite = process.stdout.write;
    process.stdout.write = ((chunk: string | Uint8Array) => {
      writes.push(String(chunk));
      return true;
    }) as typeof process.stdout.write;

    try {
      await main(["--version", "0.4.0", "--dry-run"]);
    } finally {
      process.stdout.write = originalWrite;
    }

    const output = JSON.parse(writes.join("")) as {
      safeByDefault: boolean;
      targetVersion: string;
      prepareResult: { prepared: boolean };
    };
    expect(output).toMatchObject({
      safeByDefault: true,
      targetVersion: "0.4.0",
      prepareResult: { prepared: false },
    });
    expect(readFileSync(join(root, "package.json"), "utf8")).toBe(before);
  });
});
