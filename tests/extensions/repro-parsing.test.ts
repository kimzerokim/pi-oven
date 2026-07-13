import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { cpSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { inspectAgentRegistry } from "../../.omp/extensions/pi-oven";

function makeTempDir(): string {
  const dir = join(tmpdir(), `pi-oven-repro-${Date.now()}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe("inspectAgentRegistry multiline repro", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = makeTempDir();
    cpSync(join(import.meta.dir, "../../agents"), tempDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("still catches the provider violation when the body mentions pov dispatch syntax", () => {
    // This model block uses multiline format.
    // The broken parser would see "model: " and yield an empty string or undefined.
    // If it yields undefined/missing, inspection reports missing-model instead of
    // the provider violation.
    // The body mention of `pov:explorer` is a regression guard for the runtime canonical namespace:
    // registry validation must remain driven by frontmatter model parsing only.

    const executorPath = join(tempDir, "pov-executor.md");
    writeFileSync(
      executorPath,
      readFileSync(executorPath, "utf8").replace(
        /^model:\s*\n(?:\s+- .+\n?)+/m,
        "model:\n  - google/gemini-flash\n"
      )
    );

    const report = inspectAgentRegistry(tempDir);
    expect(report.issues).toContainEqual(
      expect.objectContaining({
        code: "invalid-model-provider",
        file: "pov-executor.md",
        role: "executor",
      })
    );
  });
});
