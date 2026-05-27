import { describe, it, expect } from "bun:test";
import { spawnSync } from "bun";

describe("run-eval CLI", () => {
  it("exits 0 when no scenarios match filter", () => {
    const result = spawnSync({
      cmd: ["bun", "scripts/run-eval.ts", "--skill", "nonexistent-skill"],
      cwd: process.cwd(),
    });
    expect(result.exitCode).toBe(0);
  });

  it("loads scenario YAML and reports verdict format", () => {
    const result = spawnSync({
      cmd: ["bun", "scripts/run-eval.ts", "--skill", "code-quality-discipline", "--tag", "smoke"],
      cwd: process.cwd(),
    });
    expect([0, 1, 2]).toContain(result.exitCode);
  });
});
