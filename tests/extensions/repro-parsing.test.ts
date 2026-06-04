import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { validateAgentRegistry } from "../../.omp/extensions/pi-oven";

function makeTempDir(): string {
  const dir = join(tmpdir(), `pi-oven-repro-${Date.now()}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe("validateAgentRegistry multiline repro", () => {
  let tempDir: string;
  let errors: string[];
  let logger: { error(msg: string): void };

  beforeEach(() => {
    tempDir = makeTempDir();
    errors = [];
    logger = { error(msg: string) { errors.push(msg); } };
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("fails to catch violation when model is multiline", () => {
    // This model block uses multiline format.
    // The broken parser would see "model: " and yield an empty string or undefined.
    // If it yields undefined/missing, validateAgentRegistry might log a "Profile A guarantee broken" error
    // instead of a "WHITELIST VIOLATION" error.
    // BUT the goal is to see if it correctly identifies the provider in a multiline list.
    
    writeFileSync(
      join(tempDir, "pi-oven-bad.md"),
      [
        "---",
        "model:",
        "  - google/gemini-flash",
        "---",
        "# Agent",
      ].join("\n")
    );

    validateAgentRegistry(tempDir, logger);
    
    // If the parser is fixed, it should see google/gemini-flash and log a WHITELIST VIOLATION.
    // If it is broken, it might log "Profile A guarantee broken: model missing" (because it thinks model is empty).
    const violation = errors.find(e => e.includes("WHITELIST VIOLATION") && e.includes("google/gemini-flash"));
    expect(violation).toBeDefined();
  });
});
