import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { fileURLToPath } from "url";
import type {
  AgentFileEntry,
  SessionModelCapture,
} from "../../.omp/extensions/pi-oven";
import {
  RulesInjector,
  ORCHESTRATOR_CONDUCT_DEDUP_KEY,
} from "../../.omp/extensions/pi-oven-runtime/rules-injector";


const ext = await import("../../.omp/extensions/pi-oven");
const {
  validateAgentRegistry,
  getAllowedPrefixes,
  captureSessionModel,
  buildSetupChecklistNotice,
  readSetupComplete,
  countProjectRoutingRoles,
  applyOrchestratorConduct,
  readProjectInstructions,
} = ext;
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

describe("extension install detection", () => {
  it("resolves pluginRoot from the extension file URL, not from cwd", () => {
    const originalCwd = process.cwd();
    const isolatedProjectRoot = makeTempDir();
    const extensionUrl = new URL("../../.omp/extensions/pi-oven.ts", import.meta.url).href;
    const expectedPluginRoot = fileURLToPath(new URL("../..", import.meta.url)).replace(/\/$/, "");
    try {
      process.chdir(isolatedProjectRoot);
      expect(ext.resolvePluginRoot(extensionUrl)).toBe(expectedPluginRoot);
    } finally {
      process.chdir(originalCwd);
      rmSync(isolatedProjectRoot, { recursive: true, force: true });
    }
  });

  it("resolves pluginRoot from the bundled dist file URL", () => {
    const originalCwd = process.cwd();
    const isolatedProjectRoot = makeTempDir();
    const extensionUrl = new URL("../../dist/pi-oven.js", import.meta.url).href;
    const expectedPluginRoot = fileURLToPath(new URL("../..", import.meta.url)).replace(/\/$/, "");
    try {
      process.chdir(isolatedProjectRoot);
      expect(ext.resolvePluginRoot(extensionUrl)).toBe(expectedPluginRoot);
    } finally {
      process.chdir(originalCwd);
      rmSync(isolatedProjectRoot, { recursive: true, force: true });
    }
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
    expect(prefixes).not.toContain("anthropic");
    expect(prefixes).toContain("opencode-zen");
    expect(prefixes).not.toContain("openai-codex");
  });

  it("getAllowedPrefixes includes anthropic/ when any agent has anthropic/* model", () => {
    const entries: AgentFileEntry[] = [
      { modelArray: ["anthropic/claude-sonnet-4-6", "opencode-zen/claude-sonnet-4-6"] },
      { modelArray: ["opencode-zen/glm-5", "anthropic/claude-haiku-4-5"] },
    ];
    const prefixes = getAllowedPrefixes(entries);
    expect(prefixes).toContain("anthropic");
    expect(prefixes).toContain("opencode-zen");
    expect(prefixes).not.toContain("openai-codex");
  });
});



// ---------------------------------------------------------------------------
// applyOrchestratorConduct — parent-only standing conduct injection (Plan B2)
//
// Pure helper wired into before_agent_start AFTER injector.applyToSystemPrompt:
//   - parent only: UNSHIFTS the conduct block to index 0 so it reads first.
//   - deduped: re-applying never produces a second block.
//   - non-parent: returns the array unchanged (no conduct injection).
// ---------------------------------------------------------------------------

describe("applyOrchestratorConduct", () => {
  it("injects conduct for parent only, deduped, placed first", () => {
    const inj = new RulesInjector();
    const out = applyOrchestratorConduct([], inj, {
      isParentSession: true,
      autonomousActive: false,
    });
    expect(out.some((s) => s.includes(ORCHESTRATOR_CONDUCT_DEDUP_KEY))).toBe(true);
    // conduct block must be FIRST (unshifted into the post-applyToSystemPrompt array)
    expect(out[0].includes(ORCHESTRATOR_CONDUCT_DEDUP_KEY)).toBe(true);

    const twice = applyOrchestratorConduct(out, inj, {
      isParentSession: true,
      autonomousActive: false,
    });
    expect(twice.filter((s) => s.includes(ORCHESTRATOR_CONDUCT_DEDUP_KEY)).length).toBe(1);

    const sub = applyOrchestratorConduct([], inj, {
      isParentSession: false,
      autonomousActive: false,
    });
    expect(sub.some((s) => s.includes(ORCHESTRATOR_CONDUCT_DEDUP_KEY))).toBe(false);
  });

  it("places the conduct block at index 0 ahead of existing prompt entries", () => {
    const inj = new RulesInjector();
    const out = applyOrchestratorConduct(["existing-entry"], inj, {
      isParentSession: true,
      autonomousActive: false,
    });
    expect(out[0].includes(ORCHESTRATOR_CONDUCT_DEDUP_KEY)).toBe(true);
    expect(out).toContain("existing-entry");
  });

  it("non-parent returns the input array unchanged", () => {
    const inj = new RulesInjector();
    const input = ["a", "b"];
    const out = applyOrchestratorConduct(input, inj, {
      isParentSession: false,
      autonomousActive: false,
    });
    expect(out).toEqual(["a", "b"]);
  });

  it("autonomous parent injects the autonomous conduct variant", () => {
    const inj = new RulesInjector();
    const out = applyOrchestratorConduct([], inj, {
      isParentSession: true,
      autonomousActive: true,
    });
    expect(out[0].includes(ORCHESTRATOR_CONDUCT_DEDUP_KEY)).toBe(true);
    expect(out[0]).toMatch(/boundary contract|keep going/i);
  });
});

describe("extractExplicitForeignAgents", () => {
  it("returns unique canonical foreign agent ids and excludes pi-oven namespace entries", () => {
    expect(
      ext.extractExplicitForeignAgents(
        "Use KZK:Explorer, kzk:explorer, pi-oven:executor, and OH-MY-CLAUDECODE:Planner."
      )
    ).toEqual(["kzk:explorer", "oh-my-claudecode:planner"]);
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

    const content = JSON.parse(readFileSync(targetPath, "utf-8")) as SessionModelCapture;
    expect(content.model).toBe("anthropic/claude-sonnet-4-6");
    expect(typeof content.capturedAt).toBe("number");
    expect(content.capturedAt).toBeGreaterThan(0);
  });

  it("is idempotent — second write overwrites first", async () => {
    const targetPath = join(tempDir, "pi-oven-session-model.json");
    await captureSessionModel("anthropic/claude-sonnet-4-6", targetPath);
    await captureSessionModel("opencode-zen/gpt-5.3-codex", targetPath);

    const content = JSON.parse(readFileSync(targetPath, "utf-8")) as SessionModelCapture;
    expect(content.model).toBe("opencode-zen/gpt-5.3-codex");
  });

  it("is safe when targetPath directory does not exist — recursive:true ensures success", async () => {
    const badPath = join(tempDir, "nonexistent-subdir", "pi-oven-session-model.json");
    await captureSessionModel("anthropic/claude-sonnet-4-6", badPath);
    expect(existsSync(badPath)).toBe(true);
  });
});


// ---------------------------------------------------------------------------
// readProjectInstructions — repo-root CLAUDE.md reader (project-local only)
//
// omp does not natively read the repo-root CLAUDE.md (its claude provider reads
// .claude/CLAUDE.md + ~/.claude/CLAUDE.md only). This pure reader feeds the repo
// root CLAUDE.md to the RulesInjector so the main+sub agents honor it. It is
// project-LOCAL by construction (reads <repoRoot>/CLAUDE.md), never the global
// ~/.claude one. Fail-open: any absence/oversize/error => null (inject nothing).
// ---------------------------------------------------------------------------

describe("readProjectInstructions", () => {
  let repoRoot: string;

  beforeEach(() => {
    repoRoot = makeTempDir();
  });

  afterEach(() => {
    rmSync(repoRoot, { recursive: true, force: true });
  });

  it("returns the content of <repoRoot>/CLAUDE.md when present", () => {
    writeFileSync(join(repoRoot, "CLAUDE.md"), "# Project\nUse bun, not npm.");
    const out = readProjectInstructions(repoRoot);
    expect(out).not.toBeNull();
    expect(out!).toContain("Use bun, not npm.");
  });

  it("returns null when <repoRoot>/CLAUDE.md is absent", () => {
    expect(readProjectInstructions(repoRoot)).toBeNull();
  });

  it("returns null when CLAUDE.md is empty", () => {
    writeFileSync(join(repoRoot, "CLAUDE.md"), "");
    expect(readProjectInstructions(repoRoot)).toBeNull();
  });

  it("returns null when CLAUDE.md exceeds the byte cap (fail-open)", () => {
    writeFileSync(join(repoRoot, "CLAUDE.md"), "x".repeat(2000));
    expect(readProjectInstructions(repoRoot, 1000)).toBeNull();
  });

  it("returns content when CLAUDE.md is within the byte cap", () => {
    writeFileSync(join(repoRoot, "CLAUDE.md"), "x".repeat(500));
    const out = readProjectInstructions(repoRoot, 1000);
    expect(out).not.toBeNull();
    expect(out!.length).toBe(500);
  });

  it("returns null on read error (nonexistent repoRoot dir) — fail-open", () => {
    const missing = join(repoRoot, "does-not-exist");
    expect(readProjectInstructions(missing)).toBeNull();
  });

  it("reads ONLY the repo-root CLAUDE.md, NOT <repoRoot>/.claude/CLAUDE.md", () => {
    // a .claude/CLAUDE.md with no root CLAUDE.md must yield null (root-only scope)
    mkdirSync(join(repoRoot, ".claude"), { recursive: true });
    writeFileSync(join(repoRoot, ".claude", "CLAUDE.md"), "scoped config — must be ignored");
    expect(readProjectInstructions(repoRoot)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// buildSetupChecklistNotice — always-shown onboarding checklist (§4)
// ---------------------------------------------------------------------------

describe("buildSetupChecklistNotice", () => {
  it("renders the neither state: both ✗, run hint, uninstall hint, warning level", () => {
    const { message, level } = buildSetupChecklistNotice(false, false);
    expect(message).toContain("pi-oven setup");
    expect(message).toContain("[✗] Global   (~/.pi-oven/config.json)");
    expect(message).toContain("[✗] Project  (.pi-oven/config.json) — run /pi-oven:setup");
    expect(message).toContain("omp plugin uninstall pi-oven@kzk");
    expect(level).toBe("warning");
  });

  it("renders the global-only state: Global ✓ / Project ✗, run hint, warning level (project incomplete)", () => {
    const { message, level } = buildSetupChecklistNotice(true, false);
    expect(message).toContain("[✓] Global   (~/.pi-oven/config.json)");
    expect(message).toContain("[✗] Project  (.pi-oven/config.json) — run /pi-oven:setup");
    // uninstall hint shown only when NEITHER is complete
    expect(message).not.toContain("omp plugin uninstall");
    expect(level).toBe("warning");
  });

  it("renders the project-only state: Global ✗ / Project ✓, no run hint, info level", () => {
    const { message, level } = buildSetupChecklistNotice(false, true);
    expect(message).toContain("[✗] Global   (~/.pi-oven/config.json)");
    expect(message).toContain("[✓] Project  (.pi-oven/config.json)");
    expect(message).not.toContain("run /pi-oven:setup");
    expect(message).not.toContain("omp plugin uninstall");
    expect(level).toBe("info");
  });

  it("renders the both-complete state: both ✓, no hints, info level", () => {
    const { message, level } = buildSetupChecklistNotice(true, true);
    expect(message).toContain("[✓] Global   (~/.pi-oven/config.json)");
    expect(message).toContain("[✓] Project  (.pi-oven/config.json)");
    expect(message).not.toContain("run /pi-oven:setup");
    expect(message).not.toContain("omp plugin uninstall");
    expect(level).toBe("info");
  });

  it("level is chosen by projectComplete, independent of globalComplete", () => {
    // project complete -> info regardless of global
    expect(buildSetupChecklistNotice(false, true).level).toBe("info");
    expect(buildSetupChecklistNotice(true, true).level).toBe("info");
    // project incomplete -> warning regardless of global
    expect(buildSetupChecklistNotice(false, false).level).toBe("warning");
    expect(buildSetupChecklistNotice(true, false).level).toBe("warning");
  });

  it("appends the project routing line when routingRoleCount > 0", () => {
    const { message } = buildSetupChecklistNotice(true, true, 24);
    expect(message).toContain("↳ project model routing active (24 roles)");
  });

  it("omits the project routing line when routingRoleCount is 0", () => {
    const { message } = buildSetupChecklistNotice(true, true, 0);
    expect(message).not.toContain("project model routing active");
  });

  it("is always a 2+ line checklist (always shown, never empty)", () => {
    const { message } = buildSetupChecklistNotice(true, true);
    expect(message.split("\n").length).toBeGreaterThanOrEqual(3); // header + 2 markers
  });
});

// ---------------------------------------------------------------------------
// readSetupComplete + countProjectRoutingRoles — fail-soft config readers
// ---------------------------------------------------------------------------

describe("readSetupComplete", () => {
  let dir: string;

  beforeEach(() => {
    dir = makeTempDir();
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns true when setupCompletedAt is a non-empty string", () => {
    const p = join(dir, "config.json");
    writeFileSync(p, JSON.stringify({ setupCompletedAt: "2026-06-05T00:00:00Z" }));
    expect(readSetupComplete(p)).toBe(true);
  });

  it("returns false when setupCompletedAt is an empty string", () => {
    const p = join(dir, "config.json");
    writeFileSync(p, JSON.stringify({ setupCompletedAt: "" }));
    expect(readSetupComplete(p)).toBe(false);
  });

  it("returns false when setupCompletedAt is absent", () => {
    const p = join(dir, "config.json");
    writeFileSync(p, JSON.stringify({ language: "ko" }));
    expect(readSetupComplete(p)).toBe(false);
  });

  it("returns false when the file is absent (fail-soft)", () => {
    expect(readSetupComplete(join(dir, "missing.json"))).toBe(false);
  });

  it("returns false when the file is malformed JSON (fail-soft)", () => {
    const p = join(dir, "config.json");
    writeFileSync(p, "{ not json");
    expect(readSetupComplete(p)).toBe(false);
  });
});

describe("countProjectRoutingRoles", () => {
  let dir: string;

  beforeEach(() => {
    dir = makeTempDir();
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("counts only pi-oven:* keys in task.agentModelOverrides", () => {
    const p = join(dir, "settings.json");
    writeFileSync(
      p,
      JSON.stringify({
        task: {
          agentModelOverrides: {
            "pi-oven:executor": "openai-codex/gpt-5.4",
            "pi-oven:critic": "anthropic/claude-opus-4-8",
            "other:agent": "opencode-zen/glm-5.1",
          },
        },
      })
    );
    expect(countProjectRoutingRoles(p)).toBe(2);
  });

  it("returns 0 when there are no pi-oven:* keys", () => {
    const p = join(dir, "settings.json");
    writeFileSync(p, JSON.stringify({ task: { agentModelOverrides: { "x:y": "z" } } }));
    expect(countProjectRoutingRoles(p)).toBe(0);
  });

  it("returns 0 when task.agentModelOverrides is absent", () => {
    const p = join(dir, "settings.json");
    writeFileSync(p, JSON.stringify({ extensions: {} }));
    expect(countProjectRoutingRoles(p)).toBe(0);
  });

  it("returns 0 when the file is absent (fail-soft)", () => {
    expect(countProjectRoutingRoles(join(dir, "missing.json"))).toBe(0);
  });

  it("returns 0 when the file is malformed JSON (fail-soft)", () => {
    const p = join(dir, "settings.json");
    writeFileSync(p, "{ not json");
    expect(countProjectRoutingRoles(p)).toBe(0);
  });
});
// ---------------------------------------------------------------------------
