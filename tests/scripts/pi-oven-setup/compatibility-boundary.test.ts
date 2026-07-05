import { describe, expect, it } from "bun:test";
import { readFile } from "node:fs/promises";
import path from "node:path";

const ROOT = path.resolve(__dirname, "../../..");
const README_PATH = path.join(ROOT, "README.md");
const SETUP_COMMAND_PATH = path.join(ROOT, "commands", "setup.md");
const DOCTOR_COMMAND_PATH = path.join(ROOT, "commands", "doctor.md");
const SETUP_SCRIPT_PATH = path.join(ROOT, "scripts", "pi-oven-setup.ts");

const TEMPORARY_BOUNDARY_BLOCK = [
  "## Temporary compatibility boundary",
  "",
  "- Scope: vendored native worker runtime under `scripts/pi-oven-team/*` only.",
  "- Owner: pi-oven maintainers.",
  "- Removal condition: remove this boundary once native worker startup/scale is owned end-to-end by the omp-native control plane and no runtime path depends on `scripts/pi-oven-team/*`.",
].join("\n");

const LEGACY_FRONT_DOOR_BOUNDARY_LINE =
  "Legacy front doors (`--isolate`, `--no-isolate`, `--suppress-sibling-skills`, `--no-suppress-sibling-skills`) are global-only maintenance paths, owned by pi-oven maintainers, and must be removed once the omp-native control plane owns those surfaces end-to-end.";

async function read(relOrAbs: string): Promise<string> {
  return readFile(relOrAbs, "utf8");
}

function runSetup(args: string[]): { exitCode: number | null; stdout: string; stderr: string } {
  const proc = Bun.spawnSync({
    cmd: ["bun", SETUP_SCRIPT_PATH, ...args],
    cwd: ROOT,
    env: { ...process.env, PI_OVEN_MOCK_SPAWN: "1" },
    stdout: "pipe",
    stderr: "pipe",
  });

  return {
    exitCode: proc.exitCode,
    stdout: new TextDecoder().decode(proc.stdout),
    stderr: new TextDecoder().decode(proc.stderr),
  };
}

describe("temporary compatibility boundary contract", () => {
  it("keeps the exact same bounded boundary block and legacy front-door note in README/setup/doctor", async () => {
    const [readme, setup, doctor] = await Promise.all([
      read(README_PATH),
      read(SETUP_COMMAND_PATH),
      read(DOCTOR_COMMAND_PATH),
    ]);

    expect(readme).toContain(TEMPORARY_BOUNDARY_BLOCK);
    expect(setup).toContain(TEMPORARY_BOUNDARY_BLOCK);
    expect(doctor).toContain(TEMPORARY_BOUNDARY_BLOCK);

    expect(readme).toContain(LEGACY_FRONT_DOOR_BOUNDARY_LINE);
    expect(setup).toContain(LEGACY_FRONT_DOOR_BOUNDARY_LINE);
    expect(doctor).toContain(LEGACY_FRONT_DOOR_BOUNDARY_LINE);
  });

  it("surfaces the same bounded legacy front-door contract when setup enters those maintenance paths", () => {
    const isolate = runSetup(["--isolate"]);
    expect(isolate.exitCode).toBe(0);
    expect(isolate.stdout).toContain(LEGACY_FRONT_DOOR_BOUNDARY_LINE);

    const suppressSibling = runSetup(["--suppress-sibling-skills"]);
    expect(suppressSibling.exitCode).toBe(0);
    expect(suppressSibling.stdout).toContain(LEGACY_FRONT_DOOR_BOUNDARY_LINE);
  });
});
