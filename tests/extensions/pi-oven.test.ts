import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { cpSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from "fs";
import { join, resolve } from "path";
import { tmpdir } from "os";
import { fileURLToPath } from "url";
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import type { SessionModelCapture } from "../../.omp/extensions/pi-oven";
import {
  RulesInjector,
  ORCHESTRATOR_CONDUCT_DEDUP_KEY,
} from "../../.omp/extensions/pi-oven-runtime/rules-injector";
import { GateStateStore, type FsmState } from "../../.omp/extensions/pi-oven-runtime/gate-state";
import { DEEP_INTERVIEW_CONTRACT_DEDUP_KEY } from "../../.omp/extensions/pi-oven-runtime/deep-interview-render";
import { SHIPPED_SKILL_PATHS } from "../../scripts/pi-oven-setup/shipped-skill-registry";


const ext = await import("../../.omp/extensions/pi-oven");
const {
  inspectAgentRegistry,
  assertAgentRegistry,
  captureSessionModel,
  resolveSessionProviderFamily,
  buildRuntimeKeywordIntegrityNotice,
  buildSetupChecklistNotice,
  readSetupComplete,
  countProjectRoutingRoles,
  applyOrchestratorConduct,
  readProjectInstructions,
  extractExternalExecConsent,
  shouldNotifySessionStartTruthSignal,
  emitSessionStartSetupNotice,
  AUTONOMOUS_LOOP_PUBLIC_SKILL_NAME,
  shouldEnableAutonomousReminder,
} = ext;
const SHIPPED_AGENTS_DIR = resolve(__dirname, "../../agents");
const PLUGIN_MANIFEST_PATH = resolve(__dirname, "../../.claude-plugin/plugin.json");
function makeTempDir(): string {
  const dir = join(tmpdir(), `pi-oven-ext-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function writeAgent(
  dir: string,
  filename: string,
  model: string | string[],
  name: string = `pov:${filename.replace(/^(?:pov|pi-oven)-/, "").replace(/\.md$/, "")}`
): void {
  const modelLines = Array.isArray(model)
    ? ["model:", ...model.map((m) => `  - ${m}`)]
    : [`model: ${model}`];
  writeFileSync(
    join(dir, filename),
    ["---", `name: ${name}`, ...modelLines, "---", "# Agent"].join("\n")
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

it("runtime keyword-integrity notice reuses the shared standalone remediation wording", () => {
  const notice = buildRuntimeKeywordIntegrityNotice(
    "/plugin",
    "/project",
    [{ skillPath: "skills/foo/SKILL.md", skillName: "foo", reason: "missing keywords" }],
    1,
    2
  );
  expect(notice.level).toBe("warning");
  expect(notice.message).toContain("Standalone truth surface:");
  expect(notice.message).toContain("runtime keyword index loaded 1/2 shipped skills from /plugin");
  expect(notice.message).toContain("Runtime keyword-matched skills are partially available.");
  expect(notice.message).toContain("Project state read from /project");
  expect(notice.message).toContain("Sync .claude-plugin/plugin.json skills[], shipped SKILL frontmatter names, and SKILL_KEYWORD_WHITELIST entries. Reinstall pi-oven@kzk if installed assets are stale.");
});

describe("workflow-skill ownership sources", () => {
  it("keeps plugin.json skills[] in exact parity with shipped-skill-registry SoT", () => {
    const plugin = JSON.parse(readFileSync(PLUGIN_MANIFEST_PATH, "utf-8")) as {
      skills?: unknown;
    };
    const skills =
      Array.isArray(plugin.skills) ? plugin.skills.filter((value): value is string => typeof value === "string") : [];
    expect(skills).toEqual(SHIPPED_SKILL_PATHS);
  });
});

describe("session-start truth-signal routing", () => {
  it("notifies only workflow ownership and bootstrap parity signals", () => {
    expect(shouldNotifySessionStartTruthSignal("workflow-skill ownership")).toBe(true);
    expect(shouldNotifySessionStartTruthSignal("bootstrap parity track")).toBe(true);
    expect(shouldNotifySessionStartTruthSignal("dual plugin surface")).toBe(false);
    expect(shouldNotifySessionStartTruthSignal("task dispatch")).toBe(false);
  });

  it("emits the session-start setup notice only once per repo/session key", () => {
    const notices: Array<{ message: string; level: string }> = [];
    const emittedKeys = new Set<string>();
    const notify = (message: string, level: "info" | "warning") => {
      notices.push({ message, level });
    };
    const readiness = {
      globalReady: true,
      projectReady: false,
      globalRoutingRoleCount: 24,
      projectRoutingRoleCount: 0,
      missingGlobalPrerequisites: [],
      unknownGlobalPrerequisites: [],
    };
    const truthSignals = [
      {
        name: "workflow-skill ownership",
        detail:
          'classification: compatibility aids only. project skills.includeSkills is not the canonical workflow-skill filter.',
        level: "WARN" as const,
      },
    ];

    emitSessionStartSetupNotice(
      notify,
      { sessionId: "same-session" },
      "/repo",
      readiness,
      truthSignals,
      emittedKeys
    );
    emitSessionStartSetupNotice(
      notify,
      { sessionId: "same-session" },
      "/repo",
      readiness,
      truthSignals,
      emittedKeys
    );

    expect(notices).toHaveLength(1);
    expect(notices[0]?.message).toContain("workflow-skill ownership: compatibility aids only");
    expect(notices[0]?.message).toContain("repo setup state: missing project routing for this repo");
  });
});


// ---------------------------------------------------------------------------
// Exact fail-closed agent registry

describe("exact agent registry contract", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = makeTempDir();
    cpSync(SHIPPED_AGENTS_DIR, tempDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("accepts exactly the 24 shipped roles", () => {
    const report = inspectAgentRegistry(tempDir);
    expect(report.ok).toBe(true);
    expect(report.roles).toHaveLength(24);
    expect(report.issues).toEqual([]);
    expect(() => assertAgentRegistry(tempDir)).not.toThrow();
  });

  it("reports a missing role", () => {
    rmSync(join(tempDir, "pov-executor.md"));
    const report = inspectAgentRegistry(tempDir);
    expect(report.ok).toBe(false);
    expect(report.issues).toContainEqual(
      expect.objectContaining({ code: "missing-role", role: "executor" })
    );
  });

  it("reports an unknown canonical filename", () => {
    writeAgent(tempDir, "pov-phantom.md", "openai-codex/gpt-5.4", "pov:phantom");
    const report = inspectAgentRegistry(tempDir);
    expect(report.ok).toBe(false);
    expect(report.issues).toContainEqual(
      expect.objectContaining({ code: "unknown-role", file: "pov-phantom.md" })
    );
  });

  it("reports a markdown filename that does not use the canonical prefix", () => {
    writeAgent(tempDir, "phantom.md", "openai-codex/gpt-5.4", "pov:phantom");
    const report = inspectAgentRegistry(tempDir);
    expect(report.ok).toBe(false);
    expect(report.issues).toContainEqual(
      expect.objectContaining({ code: "unknown-role", file: "phantom.md" })
    );
  });

  it("reports legacy and canonical files for one role as a duplicate", () => {
    cpSync(join(tempDir, "pov-executor.md"), join(tempDir, "pi-oven-executor.md"));
    const report = inspectAgentRegistry(tempDir);
    expect(report.ok).toBe(false);
    expect(report.issues).toContainEqual(
      expect.objectContaining({ code: "duplicate-role", role: "executor" })
    );
    expect(() => assertAgentRegistry(tempDir)).toThrow(/duplicate-role/);
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

  it("autonomous parent injects the autonomous conduct variant with explicit control-plane proofs", () => {
    const inj = new RulesInjector();
    const out = applyOrchestratorConduct([], inj, {
      isParentSession: true,
      autonomousActive: true,
    });
    expect(out[0].includes(ORCHESTRATOR_CONDUCT_DEDUP_KEY)).toBe(true);
    expect(out[0]).toMatch(/boundary contract|keep going/i);
    expect(out[0]).toMatch(/control-plane front door/i);
    expect(out[0]).toContain("requiredSkills");
    expect(out[0]).toContain("ownedSkillReadTargets");
    expect(out[0]).toContain("externalExecConsent");
  });

  it("parent conduct help stays provider-family symbolic and keeps automatic agent examples on pov only", () => {
    const inj = new RulesInjector();
    const out = applyOrchestratorConduct([], inj, {
      isParentSession: true,
      autonomousActive: false,
    });
    expect(out[0]).toContain("pi-oven_ask");
    expect(out[0]).toContain("deepInterview");
    expect(out[0]).toContain("pov:explorer");
    expect(out[0]).not.toContain("pi-oven:explorer");
    expect(out[0]).not.toMatch(/\bcodex\b/i);
    expect(out[0]).not.toMatch(/\bzen\b/i);
    expect(out[0]).not.toMatch(/\bopus\b/i);
    expect(out[0]).not.toMatch(/\bsonnet\b/i);
  });
});

describe("extractExplicitForeignAgents", () => {
  it("returns unique canonical foreign agent ids and excludes owned pov/pi-oven namespace entries", () => {
    expect(
      ext.extractExplicitForeignAgents(
        "Use KZK:Explorer, kzk:explorer, pov:executor, pi-oven:executor, and OH-MY-CLAUDECODE:Planner."
      )
    ).toEqual(["kzk:explorer", "oh-my-claudecode:planner"]);
  });

  it("ignores foreign agent mentions that appear only in negated or illustrative context", () => {
    expect(
      ext.extractExplicitForeignAgents(
        "Do not use kzk:explorer. For example: oh-my-claudecode:planner. Use pov:executor instead."
      )
    ).toEqual([]);
  });
});

describe("shouldEnableAutonomousReminder", () => {
  it("turns on when the FSM is inactive but the matched skill uses the public pov autonomous-loop name", () => {
    expect(shouldEnableAutonomousReminder(false, [{ name: AUTONOMOUS_LOOP_PUBLIC_SKILL_NAME }])).toBe(true);
  });

  it("does not turn on from the legacy pi-oven autonomous-loop alias alone", () => {
    expect(shouldEnableAutonomousReminder(false, [{ name: "pi-oven:autonomous-loop" }])).toBe(false);
  });
});

describe("before_agent_start autonomous reminder integration", () => {
  it("injects the autonomous conduct and persisted deep-interview contract through the real store readState path", async () => {
    const tempRepo = makeTempDir();
    const previousCwd = process.cwd();
    const handlers = new Map<string, unknown>();
    const fakePi = {
      logger: {
        debug() {},
        info() {},
        warn() {},
        error() {},
      },
      on(event: string, handler: unknown) {
        handlers.set(event, handler);
      },
      registerTool() {},
      setLabel() {},
    } as unknown as ExtensionAPI; // Minimal registration surface for this handler integration test.
    const store = new GateStateStore(join(tempRepo, ".pi-oven"));
    const persistedState: FsmState = {
      active: false,
      gateCache: {},
      version: 1,
      schemaVersion: 1,
      deepInterview: {
        version: 2,
        interviewId: "iv-autonomy",
        active: false,
        phase: "idle",
        threshold: 0.4,
        thresholdSource: "user",
        state: {
          rounds: [],
          establishedFacts: [],
          ontologySnapshots: [],
        },
      },
      approvalFlow: {
        version: 1,
        active: true,
        kind: "routing-bucket",
        source: "manual",
        decisionKey: "namespace-cutover",
        summary: "Approve the namespace cutover route",
        status: "pending",
        requestedAt: "2026-07-09T00:00:00.000Z",
        resumedFrom: {
          interviewId: "iv-autonomy",
          specPath: "local://namespace-cutover.html",
        },
      },
    };
    await store.writeState(persistedState);

    try {
      process.chdir(tempRepo);
      ext.default(fakePi, { pluginRoot: resolve(__dirname, "../..") });
      const beforeAgentStart = handlers.get("before_agent_start");
      expect(typeof beforeAgentStart).toBe("function");
      if (typeof beforeAgentStart !== "function") {
        throw new Error("before_agent_start handler missing");
      }

      const result = await beforeAgentStart({
        prompt: "/pi-oven:autonomous",
        systemPrompt: [],
      });
      const systemPrompt = (result?.systemPrompt ?? []) as string[];
      expect(systemPrompt[0]).toContain(ORCHESTRATOR_CONDUCT_DEDUP_KEY);
      expect(systemPrompt[0]).toMatch(/control-plane front door/i);

      const deepInterviewPrompt = systemPrompt.find((entry: string) =>
        entry.includes(DEEP_INTERVIEW_CONTRACT_DEDUP_KEY)
      );
      expect(deepInterviewPrompt).toBeDefined();
      expect(deepInterviewPrompt).toContain("interviewId: iv-autonomy");
      expect(deepInterviewPrompt).toContain("threshold: 0.4");
      expect(deepInterviewPrompt).toContain("approval decision: namespace-cutover");
      expect(deepInterviewPrompt).toContain("approval status: pending");
    } finally {
      process.chdir(previousCwd);
      rmSync(tempRepo, { recursive: true, force: true });
    }
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

  it("writes pi-oven-session-model.json with the governing provider family when model is provided", async () => {
    const targetPath = join(tempDir, "pi-oven-session-model.json");
    await captureSessionModel("anthropic/claude-sonnet-4-6", targetPath);

    const content = JSON.parse(readFileSync(targetPath, "utf-8")) as SessionModelCapture;
    expect(content.model).toBe("anthropic/claude-sonnet-4-6");
    expect(content.sessionProviderFamily).toBe("anthropic");
    expect(content.supportedForRouting).toBe(false);
    expect(content.diagnostic).toContain("Supported families: openai-codex");
    expect(typeof content.capturedAt).toBe("number");
    expect(content.capturedAt).toBeGreaterThan(0);
  });

  it("is idempotent — second write overwrites first", async () => {
    const targetPath = join(tempDir, "pi-oven-session-model.json");
    await captureSessionModel("anthropic/claude-sonnet-4-6", targetPath);
    await captureSessionModel("alternate-provider/gpt-5.3-codex", targetPath);

    const content = JSON.parse(readFileSync(targetPath, "utf-8")) as SessionModelCapture;
    expect(content.model).toBe("alternate-provider/gpt-5.3-codex");
  });

  it("records unsupported runtime provider families with an explicit diagnostic instead of failing open", async () => {
    const targetPath = join(tempDir, "pi-oven-session-model.json");
    await captureSessionModel("google/gemini-2.5-pro", targetPath);

    const content = JSON.parse(readFileSync(targetPath, "utf-8")) as SessionModelCapture;
    expect(content.sessionProviderFamily).toBe("google");
    expect(content.supportedForRouting).toBe(false);
    expect(content.diagnostic).toContain('Current session provider family "google" is unsupported');
  });

  it("is safe when targetPath directory does not exist — recursive:true ensures success", async () => {
    const badPath = join(tempDir, "nonexistent-subdir", "pi-oven-session-model.json");
    await captureSessionModel("anthropic/claude-sonnet-4-6", badPath);
    expect(existsSync(badPath)).toBe(true);
  });
});

describe("resolveSessionProviderFamily", () => {
  it("derives the current-session provider family from the captured parent model id", () => {
    expect(resolveSessionProviderFamily("alternate-provider/kimi-k2.6")).toEqual(
      expect.objectContaining({
        sessionProviderFamily: "alternate-provider",
        supportedForRouting: false,
      })
    );
  });

  it("returns an explicit diagnostic when the parent session model id cannot be parsed", () => {
    expect(resolveSessionProviderFamily("gpt-5.5")).toEqual(
      expect.objectContaining({
        sessionProviderFamily: null,
        supportedForRouting: false,
        diagnostic: 'Could not derive current session provider family from session model "gpt-5.5".',
      })
    );
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
    const { message, level } = buildSetupChecklistNotice({
      globalReady: false,
      projectReady: false,
      globalRoutingRoleCount: 0,
      projectRoutingRoleCount: 0,
      missingGlobalPrerequisites: ["task.enableLsp"],
      unknownGlobalPrerequisites: [],
    });
    expect(message).toContain("pi-oven setup");
    expect(message).toContain(
      "[✗] Global   (~/.omp/agent/config.yml routing + machine-global prerequisites)"
    );
    expect(message).toContain(
      "[✗] Project  (.omp/settings.json routing) — run /pi-oven:setup --scope project"
    );
    expect(message).toContain("omp plugin uninstall pi-oven@kzk");
    expect(level).toBe("warning");
  });

  it("renders the global-only state: Global ✓ / Project ✗, run hint, warning level (project incomplete)", () => {
    const { message, level } = buildSetupChecklistNotice({
      globalReady: true,
      projectReady: false,
      globalRoutingRoleCount: 24,
      projectRoutingRoleCount: 0,
      missingGlobalPrerequisites: [],
      unknownGlobalPrerequisites: [],
    });
    expect(message).toContain(
      "[✓] Global   (~/.omp/agent/config.yml routing + machine-global prerequisites)"
    );
    expect(message).toContain(
      "[✗] Project  (.omp/settings.json routing) — run /pi-oven:setup --scope project"
    );
    expect(message).not.toContain("omp plugin uninstall");
    expect(level).toBe("warning");
  });

  it("renders the project-only state: Global ✗ / Project ✓, no run hint, info level", () => {
    const { message, level } = buildSetupChecklistNotice({
      globalReady: false,
      projectReady: true,
      globalRoutingRoleCount: 0,
      projectRoutingRoleCount: 24,
      missingGlobalPrerequisites: ["memory.backend"],
      unknownGlobalPrerequisites: [],
    });
    expect(message).toContain(
      "[✗] Global   (~/.omp/agent/config.yml routing + machine-global prerequisites)"
    );
    expect(message).toContain("[✓] Project  (.omp/settings.json routing)");
    expect(message).not.toContain("run /pi-oven:setup");
    expect(message).not.toContain("omp plugin uninstall");
    expect(level).toBe("info");
  });

  it("renders the both-complete state: both ✓, no hints, info level", () => {
    const { message, level } = buildSetupChecklistNotice({
      globalReady: true,
      projectReady: true,
      globalRoutingRoleCount: 24,
      projectRoutingRoleCount: 24,
      missingGlobalPrerequisites: [],
      unknownGlobalPrerequisites: [],
    });
    expect(message).toContain(
      "[✓] Global   (~/.omp/agent/config.yml routing + machine-global prerequisites)"
    );
    expect(message).toContain("[✓] Project  (.omp/settings.json routing)");
    expect(message).not.toContain("run /pi-oven:setup");
    expect(message).not.toContain("omp plugin uninstall");
    expect(level).toBe("info");
  });

  it("level is chosen by project readiness, independent of global readiness", () => {
    expect(
      buildSetupChecklistNotice({
        globalReady: false,
        projectReady: true,
        globalRoutingRoleCount: 0,
        projectRoutingRoleCount: 1,
        missingGlobalPrerequisites: ["memory.backend"],
        unknownGlobalPrerequisites: [],
      }).level
    ).toBe("info");
    expect(
      buildSetupChecklistNotice({
        globalReady: true,
        projectReady: true,
        globalRoutingRoleCount: 1,
        projectRoutingRoleCount: 1,
        missingGlobalPrerequisites: [],
        unknownGlobalPrerequisites: [],
      }).level
    ).toBe("info");
    expect(
      buildSetupChecklistNotice({
        globalReady: false,
        projectReady: false,
        globalRoutingRoleCount: 0,
        projectRoutingRoleCount: 0,
        missingGlobalPrerequisites: ["memory.backend"],
        unknownGlobalPrerequisites: [],
      }).level
    ).toBe("warning");
    expect(
      buildSetupChecklistNotice({
        globalReady: true,
        projectReady: false,
        globalRoutingRoleCount: 1,
        projectRoutingRoleCount: 0,
        missingGlobalPrerequisites: [],
        unknownGlobalPrerequisites: [],
      }).level
    ).toBe("warning");
  });

  it("appends the project routing line when project routing is active", () => {
    const { message } = buildSetupChecklistNotice({
      globalReady: true,
      projectReady: true,
      globalRoutingRoleCount: 24,
      projectRoutingRoleCount: 24,
      missingGlobalPrerequisites: [],
      unknownGlobalPrerequisites: [],
    });
    expect(message).toContain("↳ project model routing active (24 roles)");
  });

  it("surfaces ownership classification and healthy repo state when project routing is active", () => {
    const { message } = buildSetupChecklistNotice(
      {
        globalReady: true,
        projectReady: true,
        globalRoutingRoleCount: 24,
        projectRoutingRoleCount: 24,
        missingGlobalPrerequisites: [],
        unknownGlobalPrerequisites: [],
      },
      { workflowSkillOwnershipStatus: "owned-surface active" }
    );
    expect(message).toContain("↳ workflow-skill ownership: owned-surface active");
    expect(message).toContain("↳ repo setup state: healthy setup — healthy single pov surface");
  });

  it("surfaces missing project routing separately from compatibility-only ownership", () => {
    const { message } = buildSetupChecklistNotice(
      {
        globalReady: true,
        projectReady: false,
        globalRoutingRoleCount: 24,
        projectRoutingRoleCount: 0,
        missingGlobalPrerequisites: [],
        unknownGlobalPrerequisites: [],
      },
      { workflowSkillOwnershipStatus: "compatibility aids only" }
    );
    expect(message).toContain("↳ workflow-skill ownership: compatibility aids only");
    expect(message).toContain("↳ repo setup state: missing project routing for this repo");
  });

  it("summarizes missing machine-global prerequisites when routing is present but incomplete", () => {
    const { message } = buildSetupChecklistNotice({
      globalReady: false,
      projectReady: false,
      globalRoutingRoleCount: 24,
      projectRoutingRoleCount: 0,
      missingGlobalPrerequisites: ["task.enableLsp"],
      unknownGlobalPrerequisites: [],
    });
    expect(message).toContain(
      "↳ machine-global routing is present, but required prerequisites are missing or mismatched"
    );
  });

  it("is always a 2+ line checklist (always shown, never empty)", () => {
    const { message } = buildSetupChecklistNotice({
      globalReady: true,
      projectReady: true,
      globalRoutingRoleCount: 24,
      projectRoutingRoleCount: 24,
      missingGlobalPrerequisites: [],
      unknownGlobalPrerequisites: [],
    });
    expect(message.split("\n").length).toBeGreaterThanOrEqual(3);
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

  it("counts only canonical pov:* keys in task.agentModelOverrides", () => {
    const p = join(dir, "settings.json");
    writeFileSync(
      p,
      JSON.stringify({
        task: {
          agentModelOverrides: {
            "pov:executor": "openai-codex/gpt-5.4",
            "pov:critic": "anthropic/claude-opus-4-8",
            "pi-oven:critic": "legacy-ignored",
            "other:agent": "alternate-provider/glm-5.1",
          },
        },
      })
    );
    expect(countProjectRoutingRoles(p)).toBe(2);
  });

  it("returns 0 when there are no canonical pov:* keys", () => {
    const p = join(dir, "settings.json");
    writeFileSync(p, JSON.stringify({ task: { agentModelOverrides: { "x:y": "z", "pi-oven:critic": "legacy" } } }));
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
describe("extractExternalExecConsent", () => {
  function makeBundle() {
    const expiresAt = new Date(Date.now() + 60_000).toISOString();
    return {
      expiresAt,
      text: [
        "AccessKeyId: ASIA1234567890ABCD",
        "SecretAccessKey: secret-key",
        "SessionToken: session-token",
        `ExpiresAt: ${expiresAt}`,
      ].join("\n"),
    };
  }

  it("returns no consent for bundle-only explicit denial text", () => {
    const { text } = makeBundle();
    expect(extractExternalExecConsent(`Do not use this.\n${text}`, "msg-deny")).toBeUndefined();
  });

  it("returns no consent for bundle-bearing inspect denial text", () => {
    const { text } = makeBundle();
    expect(
      extractExternalExecConsent(
        `Please do not inspect with this temporary AWS credential bundle before it expires:\n${text}`,
        "msg-deny-inspect"
      )
    ).toBeUndefined();
  });

  it("auto-authorizes read/access for a valid future-dated temporary bundle without denial", () => {
    const { text, expiresAt } = makeBundle();
    expect(extractExternalExecConsent(text, "msg-allow")).toMatchObject({
      sourceMessageId: "msg-allow",
      scope: "access",
      remainingUses: 1,
      tempCredentials: {
        provider: "aws",
        accessKeyId: "ASIA1234567890ABCD",
        expiresAt: Date.parse(expiresAt),
      },
    });
  });
});
// ---------------------------------------------------------------------------
