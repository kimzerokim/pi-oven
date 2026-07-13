import { describe, it, expect } from "bun:test";
import { readFile } from "node:fs/promises";
import path from "node:path";

const SKILL_PATH = path.resolve(__dirname, "../../skills/deep-dive/SKILL.md");

describe("deep-dive skill: parallel dispatch (AC#10)", () => {
  it("batches same-role trace lanes and separates heterogeneous agents", async () => {
    const content = await readFile(SKILL_PATH, "utf-8");

    expect(content).toContain('one `task` call with `agent: "pov:tracer"`');
    expect(content).toContain('a separate `task` call with `agent: "pov:deep-researcher"`');
    expect(content).toContain("A single call cannot mix heterogeneous agents");
  });

  it("uses native async semantics without the deprecated background flag", async () => {
    const content = await readFile(SKILL_PATH, "utf-8");
    expect(content).not.toContain("run_in_background");
    expect(content).toContain("OMP may execute the calls concurrently when async is enabled");
    expect(content).toContain("concurrency is not guaranteed when it is disabled");
  });
});
