import { describe, expect, it } from "bun:test";
import { readFile } from "node:fs/promises";
import path from "node:path";

const ROOT = path.resolve(__dirname, "../../..");
const README_PATH = path.join(ROOT, "README.md");
const SETUP_COMMAND_PATH = path.join(ROOT, "commands", "setup.md");

async function read(relOrAbs: string): Promise<string> {
  return readFile(relOrAbs, "utf8");
}

describe("OMP task dispatch boundary contract", () => {
  it("keeps live docs aligned on OMP task concurrency ownership", async () => {
    const [readme, setup] = await Promise.all([
      read(README_PATH),
      read(SETUP_COMMAND_PATH),
    ]);

    for (const source of [readme, setup]) {
      expect(source).toContain("OMP `task`");
      expect(source).toContain("task.maxConcurrency");
      expect(source).toContain("provider/runtime admission");
    }
  });
});
