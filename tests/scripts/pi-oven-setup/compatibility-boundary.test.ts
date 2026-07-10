import { describe, expect, it } from "bun:test";
import { readFile } from "node:fs/promises";
import path from "node:path";

const ROOT = path.resolve(__dirname, "../../..");
const README_PATH = path.join(ROOT, "README.md");
const SETUP_COMMAND_PATH = path.join(ROOT, "commands", "setup.md");

const TEMPORARY_BOUNDARY_BLOCK = [
  "## Temporary compatibility boundary",
  "",
  "- Scope: vendored native worker runtime under `scripts/pi-oven-team/*` only.",
  "- Owner: pi-oven maintainers.",
  "- Removal condition: remove this boundary once native worker startup/scale is owned end-to-end by the omp-native control plane and no runtime path depends on `scripts/pi-oven-team/*`.",
].join("\n");

async function read(relOrAbs: string): Promise<string> {
  return readFile(relOrAbs, "utf8");
}

describe("temporary compatibility boundary contract", () => {
  it("keeps the native-worker boundary block on owned live docs only", async () => {
    const [readme, setup] = await Promise.all([
      read(README_PATH),
      read(SETUP_COMMAND_PATH),
    ]);

    expect(readme).toContain(TEMPORARY_BOUNDARY_BLOCK);
    expect(setup).toContain(TEMPORARY_BOUNDARY_BLOCK);
  });
});
