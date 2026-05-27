import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { validateAgentRegistry } from "../../.omp/extensions/pi-oven";

function makeTempDir(): string {
  const dir = join(tmpdir(), `pi-oven-ext-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe("validateAgentRegistry", () => {
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

  it("no error logged when agent has valid whitelisted model", () => {
    writeFileSync(
      join(tempDir, "pi-oven-coder.md"),
      [
        "---",
        "model: opencode-zen/claude-haiku-4-5",
        "---",
        "# Coder",
      ].join("\n")
    );
    validateAgentRegistry(tempDir, logger);
    expect(errors).toHaveLength(0);
  });

  it("error logged when agent has no model field, message starts with 'Profile A guarantee broken'", () => {
    writeFileSync(
      join(tempDir, "pi-oven-nomodel.md"),
      [
        "---",
        "description: missing model",
        "---",
        "# Agent",
      ].join("\n")
    );
    validateAgentRegistry(tempDir, logger);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]).toMatch(/^Profile A guarantee broken/);
  });

  it("error logged when agent has non-whitelisted provider", () => {
    writeFileSync(
      join(tempDir, "pi-oven-cerebras.md"),
      [
        "---",
        "model: cerebras/foo",
        "---",
        "# Agent",
      ].join("\n")
    );
    validateAgentRegistry(tempDir, logger);
    expect(errors.length).toBeGreaterThan(0);
    const msg = errors[0];
    expect(msg).toContain("cerebras/foo");
  });

  it("no error logged when agent has anthropic/ prefix (whitelisted)", () => {
    writeFileSync(
      join(tempDir, "pi-oven-opus.md"),
      [
        "---",
        "model: anthropic/claude-opus-4-7",
        "---",
        "# Opus",
      ].join("\n")
    );
    validateAgentRegistry(tempDir, logger);
    expect(errors).toHaveLength(0);
  });

  it("empty agents dir produces no errors", () => {
    validateAgentRegistry(tempDir, logger);
    expect(errors).toHaveLength(0);
  });

  it("non-pi-oven-*.md files are ignored", () => {
    writeFileSync(
      join(tempDir, "other-agent.md"),
      [
        "---",
        "description: no model here",
        "---",
        "# Other",
      ].join("\n")
    );
    validateAgentRegistry(tempDir, logger);
    expect(errors).toHaveLength(0);
  });
});
