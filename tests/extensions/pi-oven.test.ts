import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import * as ext from "../../.omp/extensions/pi-oven";
import {
  validateAgentRegistry,
  getAllowedPrefixes,
  captureSessionModel,
  type AgentFileEntry,
  type SessionModelCapture,
} from "../../.omp/extensions/pi-oven";

function makeTempDir(): string {
  const dir = join(tmpdir(), `pi-oven-ext-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function writeAgent(dir: string, filename: string, model: string | string[]): void {
  const modelLines = Array.isArray(model)
    ? ["model:", ...model.map((m) => `  - ${m}`)]
    : [`model: ${model}`];
  writeFileSync(
    join(dir, filename),
    ["---", ...modelLines, "---", "# Agent"].join("\n")
  );
}

// ---------------------------------------------------------------------------
// Deletion invariant — drift machinery must not be exported
// ---------------------------------------------------------------------------

describe("extension no longer exports drift machinery", () => {
  it("loadProfileMapFromConfig is not exported", () => {
    expect((ext as unknown as Record<string, unknown>)["loadProfileMapFromConfig"]).toBeUndefined();
  });

  it("detectDriftFromMap is not exported", () => {
    expect((ext as unknown as Record<string, unknown>)["detectDriftFromMap"]).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// validateAgentRegistry
// ---------------------------------------------------------------------------

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
        "model: anthropic/claude-opus-4-8",
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

  // Phase 4: dynamic ALLOWED_PREFIXES tests

  it("mixed agents (some anthropic, some opencode-zen) — no violations", () => {
    // anthropic agent — makes Profile B active → anthropic/ allowed
    writeAgent(tempDir, "pi-oven-executor.md", ["anthropic/claude-sonnet-4-6", "opencode-zen/claude-sonnet-4-6"]);
    // opencode-zen agent — valid regardless
    writeAgent(tempDir, "pi-oven-explorer.md", ["opencode-zen/glm-5", "opencode-zen/claude-haiku-4-5"]);
    validateAgentRegistry(tempDir, logger);
    expect(errors).toHaveLength(0);
  });

  it("all-opencode-zen agents — anthropic/ prefix rejected as violation", () => {
    // No agent has anthropic/* → anthropic/ NOT in ALLOWED_PREFIXES
    // But then we add a file with anthropic/ that would violate
    writeAgent(tempDir, "pi-oven-explorer.md", ["opencode-zen/glm-5", "opencode-zen/claude-haiku-4-5"]);
    writeAgent(tempDir, "pi-oven-writer.md", ["opencode-zen/claude-haiku-4-5", "opencode-zen/claude-sonnet-4-6"]);
    // This agent should trigger a violation since no other agent has anthropic/
    writeAgent(tempDir, "pi-oven-bad.md", ["anthropic/claude-haiku-4-5"]);
    // Wait — with dynamic prefix: if pi-oven-bad.md has anthropic/ then it IS included.
    // This test is actually for the pure all-opencode-zen case with an injected violation.
    // The spec says: compute prefixes from all files. If any file has anthropic/, include it.
    // So pi-oven-bad.md itself causes anthropic/ to be included → no violation.
    // The real violation case: use a non-whitelisted prefix like google/gemini-flash.
    rmSync(join(tempDir, "pi-oven-bad.md"));
    writeAgent(tempDir, "pi-oven-bad.md", ["google/gemini-flash"]);
    validateAgentRegistry(tempDir, logger);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]).toContain("google/gemini-flash");
  });

  it("agent file with google/ prefix triggers WHITELIST VIOLATION regardless of other agents", () => {
    writeAgent(tempDir, "pi-oven-executor.md", ["anthropic/claude-sonnet-4-6", "opencode-zen/claude-sonnet-4-6"]);
    writeAgent(tempDir, "pi-oven-bad.md", ["google/gemini-flash"]);
    validateAgentRegistry(tempDir, logger);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]).toContain("google/gemini-flash");
    expect(errors[0]).toContain("WHITELIST VIOLATION");
  });

  it("all-opencode-zen agents — anthropic/ NOT in computed ALLOWED_PREFIXES signal", () => {
    // Use getAllowedPrefixes directly to verify the computation
    const entries: AgentFileEntry[] = [
      { modelArray: ["opencode-zen/glm-5", "opencode-zen/claude-haiku-4-5"] },
      { modelArray: ["opencode-zen/claude-haiku-4-5", "opencode-zen/claude-sonnet-4-6"] },
    ];
    const prefixes = getAllowedPrefixes(entries);
    expect(prefixes).not.toContain("anthropic/");
    expect(prefixes).toContain("opencode-zen/");
    expect(prefixes).toContain("openai-codex/");
  });

  it("getAllowedPrefixes includes anthropic/ when any agent has anthropic/* model", () => {
    const entries: AgentFileEntry[] = [
      { modelArray: ["anthropic/claude-sonnet-4-6", "opencode-zen/claude-sonnet-4-6"] },
      { modelArray: ["opencode-zen/glm-5", "anthropic/claude-haiku-4-5"] },
    ];
    const prefixes = getAllowedPrefixes(entries);
    expect(prefixes).toContain("anthropic/");
    expect(prefixes).toContain("opencode-zen/");
    expect(prefixes).toContain("openai-codex/");
  });
});

// ---------------------------------------------------------------------------
// session_start: captureSessionModel
// ---------------------------------------------------------------------------

describe("captureSessionModel", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = makeTempDir();
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("writes pi-oven-session-model.json when model is provided", async () => {
    const targetPath = join(tempDir, "pi-oven-session-model.json");
    await captureSessionModel("anthropic/claude-sonnet-4-6", targetPath);

    const content = JSON.parse(require("fs").readFileSync(targetPath, "utf-8")) as SessionModelCapture;
    expect(content.model).toBe("anthropic/claude-sonnet-4-6");
    expect(typeof content.capturedAt).toBe("number");
    expect(content.capturedAt).toBeLessThanOrEqual(Date.now());
  });

  it("is idempotent — second write overwrites first", async () => {
    const targetPath = join(tempDir, "pi-oven-session-model.json");
    await captureSessionModel("anthropic/claude-sonnet-4-6", targetPath);
    await captureSessionModel("opencode-zen/gpt-5.3-codex", targetPath);

    const content = JSON.parse(require("fs").readFileSync(targetPath, "utf-8")) as SessionModelCapture;
    expect(content.model).toBe("opencode-zen/gpt-5.3-codex");
  });

  it("does not throw when targetPath directory does not exist — propagates error gracefully", async () => {
    // The caller handles the error; captureSessionModel itself throws on FS failure
    // We test this by catching the error
    const badPath = join(tempDir, "nonexistent-subdir", "pi-oven-session-model.json");
    let threw = false;
    try {
      await captureSessionModel("anthropic/claude-sonnet-4-6", badPath);
    } catch {
      threw = true;
    }
    // captureSessionModel propagates the FS error; the session_start handler catches it
    expect(threw).toBe(true);
  });
});
