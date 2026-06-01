import { describe, it, expect } from "bun:test";
import { spawnSync } from "bun";
import { join } from "path";

describe("run-eval CLI", () => {
  it("exits 0 when no scenarios match filter", () => {
    const result = spawnSync({
      cmd: [process.execPath, join(import.meta.dir, "../../scripts/run-eval.ts"), "--skill", "nonexistent-skill"],
      cwd: join(import.meta.dir, "../.."),
    });
    expect(result.exitCode).toBe(0);
  });

  // Removed: "loads scenario YAML and reports verdict format" —
  // CLI smoke that invoked the real LLM hangs without an API key (CI has none),
  // and the exit-code assertion `[0, 1, 2].toContain` was a tautology
  // (cycle-2 critic-review NIT 5). Real scenario evaluation lives behind
  // Plan 4 (LLM key bootstrap + CI secrets).
});
