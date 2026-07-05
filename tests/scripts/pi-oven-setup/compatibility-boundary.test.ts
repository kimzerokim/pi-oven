import { describe, expect, it } from "bun:test";
import { readFile } from "node:fs/promises";
import path from "node:path";

const ROOT = path.resolve(__dirname, "../../..");
const README_PATH = path.join(ROOT, "README.md");
const SETUP_COMMAND_PATH = path.join(ROOT, "commands", "setup.md");
const DOCTOR_COMMAND_PATH = path.join(ROOT, "commands", "doctor.md");
const SUPPRESS_MODULE_PATH = path.join(ROOT, "scripts", "pi-oven-setup", "suppress-sibling.ts");
const TRUTH_SURFACE_PATH = path.join(ROOT, "scripts", "pi-oven-setup", "standalone-truth-surface.ts");

const TEMPORARY_BOUNDARY_BLOCK = [
  "## Temporary compatibility boundary",
  "",
  "- Scope: vendored native worker runtime under `scripts/pi-oven-team/*` only.",
  "- Owner: pi-oven maintainers.",
  "- Removal condition: remove this boundary once native worker startup/scale is owned end-to-end by the omp-native control plane and no runtime path depends on `scripts/pi-oven-team/*`.",
].join("\n");

const FORBIDDEN_LEGACY_TERMS = /--isolate|--no-isolate|--suppress-sibling-skills|--no-suppress-sibling-skills|clean-room|sibling suppression/i;

async function read(relOrAbs: string): Promise<string> {
  return readFile(relOrAbs, "utf8");
}

describe("temporary compatibility boundary contract", () => {
  it("keeps the exact same bounded boundary block in README/setup/doctor", async () => {
    const [readme, setup, doctor] = await Promise.all([
      read(README_PATH),
      read(SETUP_COMMAND_PATH),
      read(DOCTOR_COMMAND_PATH),
    ]);

    expect(readme).toContain(TEMPORARY_BOUNDARY_BLOCK);
    expect(setup).toContain(TEMPORARY_BOUNDARY_BLOCK);
    expect(doctor).toContain(TEMPORARY_BOUNDARY_BLOCK);
  });

  it("removes legacy isolation/suppression advertising from docs and truth surfaces", async () => {
    const [readme, setup, doctor, suppressModule, truthSurface] = await Promise.all([
      read(README_PATH),
      read(SETUP_COMMAND_PATH),
      read(DOCTOR_COMMAND_PATH),
      read(SUPPRESS_MODULE_PATH),
      read(TRUTH_SURFACE_PATH),
    ]);

    expect(readme).not.toMatch(FORBIDDEN_LEGACY_TERMS);
    expect(setup).not.toMatch(FORBIDDEN_LEGACY_TERMS);
    expect(doctor).not.toMatch(FORBIDDEN_LEGACY_TERMS);
    expect(suppressModule).not.toMatch(FORBIDDEN_LEGACY_TERMS);
    expect(truthSurface).not.toMatch(FORBIDDEN_LEGACY_TERMS);
  });
});
