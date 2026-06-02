import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  compareSemver,
  resolveCacheAgentsDir,
  checkAgentsCachePopulated,
} from "../../../scripts/pi-oven-setup/cache-resolver";

function makeTempDir(): string {
  const dir = join(
    tmpdir(),
    `cache-resolver-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
  mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Creates a fake kzk___pi-oven___<version>/agents/ directory
 * inside cacheRoot and populates it with N fake pi-oven-*.md files.
 */
function makeFakeCacheEntry(
  cacheRoot: string,
  version: string,
  agentCount: number
): string {
  const agentsDir = join(cacheRoot, `kzk___pi-oven___${version}`, "agents");
  mkdirSync(agentsDir, { recursive: true });
  for (let i = 0; i < agentCount; i++) {
    writeFileSync(join(agentsDir, `pi-oven-agent-${i}.md`), `# agent ${i}\n`);
  }
  return agentsDir;
}

describe("compareSemver", () => {
  it("0.1.0 < 0.10.0", () => {
    expect(compareSemver("0.1.0", "0.10.0")).toBeLessThan(0);
  });

  it("0.10.0 < 0.20.0", () => {
    expect(compareSemver("0.10.0", "0.20.0")).toBeLessThan(0);
  });

  it("1.0.0 > 0.99.99", () => {
    expect(compareSemver("1.0.0", "0.99.99")).toBeGreaterThan(0);
  });

  it("0.1 == 0.1.0 (missing patch treated as 0)", () => {
    expect(compareSemver("0.1", "0.1.0")).toBe(0);
  });

  it("0.1.0 == 0.1.0", () => {
    expect(compareSemver("0.1.0", "0.1.0")).toBe(0);
  });
});

describe("resolveCacheAgentsDir", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = makeTempDir();
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("returns null when cache root is empty (no pi-oven install)", async () => {
    const result = await resolveCacheAgentsDir(tempDir);
    expect(result).toBeNull();
  });

  it("returns agents/ subdir of the single pi-oven cache entry", async () => {
    const agentsDir = makeFakeCacheEntry(tempDir, "0.1.0", 1);
    const result = await resolveCacheAgentsDir(tempDir);
    expect(result).toBe(agentsDir);
  });

  it("picks the highest semver when multiple versions exist (0.1.0, 0.2.0, 0.10.0)", async () => {
    makeFakeCacheEntry(tempDir, "0.1.0", 1);
    makeFakeCacheEntry(tempDir, "0.2.0", 1);
    const latestAgentsDir = makeFakeCacheEntry(tempDir, "0.10.0", 1);
    const result = await resolveCacheAgentsDir(tempDir);
    expect(result).toBe(latestAgentsDir);
  });
});

describe("checkAgentsCachePopulated", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = makeTempDir();
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("ok: false and cachePath includes '(no pi-oven install cache)' when no pi-oven dirs exist", async () => {
    const result = await checkAgentsCachePopulated({ cacheRoot: tempDir });
    expect(result.ok).toBe(false);
    expect(result.cachePath).toContain("(no pi-oven install cache)");
  });

  it("ok: false and foundCount = 0 when agents dir is empty", async () => {
    makeFakeCacheEntry(tempDir, "0.1.0", 0);
    const result = await checkAgentsCachePopulated({
      cacheRoot: tempDir,
      expected: 1,
    });
    expect(result.ok).toBe(false);
    expect(result.foundCount).toBe(0);
  });

  it("ok: true when agents dir has enough pi-oven-*.md files", async () => {
    makeFakeCacheEntry(tempDir, "0.1.0", 5);
    const result = await checkAgentsCachePopulated({
      cacheRoot: tempDir,
      expected: 5,
    });
    expect(result.ok).toBe(true);
    expect(result.foundCount).toBe(5);
  });

  it("ok: false when foundCount is below expected threshold", async () => {
    makeFakeCacheEntry(tempDir, "0.1.0", 3);
    const result = await checkAgentsCachePopulated({
      cacheRoot: tempDir,
      expected: 5,
    });
    expect(result.ok).toBe(false);
    expect(result.foundCount).toBe(3);
    expect(result.expectedCount).toBe(5);
  });
});
