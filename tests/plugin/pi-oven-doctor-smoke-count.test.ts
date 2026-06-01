import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { countSmokeScenarios } from "../../scripts/pi-oven-doctor";

let tempDir = "";

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "pi-oven-doctor-smoke-"));
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

function writeScenario(relPath: string, body: string) {
  const abs = join(tempDir, relPath);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, body, "utf8");
}

describe("countSmokeScenarios", () => {
  it("returns 0 when evals directory is missing", async () => {
    const count = await countSmokeScenarios(join(tempDir, "evals"));
    expect(count).toBe(0);
  });

  it("counts only .yaml scenarios tagged smoke", async () => {
    writeScenario("evals/skill-a/scenarios/a.yaml", "name: a\ntag: smoke\n");
    writeScenario("evals/skill-a/scenarios/b.yaml", "name: b\ntag: regression\n");
    writeScenario("evals/skill-b/scenarios/c.yaml", "name: c\ntag: smoke\n");
    writeScenario("evals/skill-b/scenarios/d.yml", "name: d\ntag: smoke\n");
    writeScenario("evals/skill-c/README.md", "tag: smoke\n");

    const count = await countSmokeScenarios(join(tempDir, "evals"));
    expect(count).toBe(2);
  });

  it("counts smoke tag even when preceded by other fields", async () => {
    writeScenario("evals/skill-x/scenarios/x.yaml", "description: x\nversion: 1\ntag: smoke\n");
    const count = await countSmokeScenarios(join(tempDir, "evals"));
    expect(count).toBe(1);
  });
});
