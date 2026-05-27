import { describe, it, expect } from "bun:test";
import { readFile } from "node:fs/promises";
import path from "node:path";

const SKILL_PATH = path.resolve(__dirname, "../../skills/deep-dive/SKILL.md");

describe("deep-dive skill: parallel dispatch (AC#10)", () => {
  it("SKILL.md dispatch section contains both 'run_in_background' and 'parallel'", async () => {
    const content = await readFile(SKILL_PATH, "utf-8");

    // Locate the dispatch description section (Phase 3 instructions)
    // The section describes firing all 3 task() calls in parallel with run_in_background: true
    expect(content).toContain("run_in_background");
    expect(content).toContain("parallel");
  });

  it("SKILL.md references 'run_in_background: true' in the parallel dispatch instruction", async () => {
    const content = await readFile(SKILL_PATH, "utf-8");
    expect(content).toContain("run_in_background: true");
  });
});
