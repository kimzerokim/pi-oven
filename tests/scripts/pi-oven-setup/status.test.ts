import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { runStatus } from "../../../scripts/pi-oven-setup/status";
import { ROLES, PROFILE_A } from "../../../scripts/pi-oven-setup/profiles";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTempDir(): string {
  const dir = join(
    tmpdir(),
    `status-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
  mkdirSync(dir, { recursive: true });
  return dir;
}

function makeAgentFile(agentsDir: string, role: string, primary: string): void {
  const content = `---
name: pi-oven:${role}
description: Test agent for ${role}
model:
  - ${primary}
  - opencode-zen/${primary.split("/").pop()}
thinkingLevel: high
mode: subagent
tools: ["*"]
blocked_tools: []
---

## Role

You are pi-oven:${role}.
`;
  writeFileSync(join(agentsDir, `pi-oven-${role}.md`), content, "utf-8");
}

/**
 * Build a spawnFn mock that returns preset responses for omp config get.
 * listModelsOutput: optional string for list-models fixture (for unresolved warning test).
 */
function makeSpawnFn(opts: {
  overrides?: Record<string, string>;
  listModelsOutput?: string;
  getExitCode?: number;
  scalarValues?: Record<string, unknown>;
  ignoredSkills?: string[] | null;
}): (cmd: string, args: string[]) => { exitCode: number | null; stdout: Buffer; stderr: Buffer } {
  return (cmd, args) => {
    const argStr = args.join(" ");
    // omp config get task.agentModelOverrides --json
    if (cmd === "omp" && argStr.includes("config get task.agentModelOverrides")) {
      if (opts.getExitCode !== undefined && opts.getExitCode !== 0) {
        return {
          exitCode: opts.getExitCode,
          stdout: Buffer.from(""),
          stderr: Buffer.from("omp not available"),
        };
      }
      const record = opts.overrides ?? {};
      const payload = JSON.stringify({ key: "task.agentModelOverrides", value: record, type: "record" });
      return { exitCode: 0, stdout: Buffer.from(payload), stderr: Buffer.from("") };
    }
    if (cmd === "omp" && args[0] === "config" && args[1] === "get" && args[2] === "skills.ignoredSkills") {
      if (opts.ignoredSkills === null) {
        return { exitCode: 1, stdout: Buffer.from(""), stderr: Buffer.from("missing key") };
      }
      const payload = JSON.stringify({
        key: "skills.ignoredSkills",
        value: opts.ignoredSkills ?? [],
        type: "array",
      });
      return { exitCode: 0, stdout: Buffer.from(payload), stderr: Buffer.from("") };
    }
    if (cmd === "omp" && args[0] === "config" && args[1] === "get") {
      const key = args[2];
      if (key && opts.scalarValues && Object.prototype.hasOwnProperty.call(opts.scalarValues, key)) {
        const payload = JSON.stringify({ key, value: opts.scalarValues[key], type: typeof opts.scalarValues[key] });
        return { exitCode: 0, stdout: Buffer.from(payload), stderr: Buffer.from("") };
      }
      return { exitCode: 1, stdout: Buffer.from(""), stderr: Buffer.from("missing key") };
    }
    // omp list-models --json (or similar)
    if (cmd === "omp" && argStr.includes("list-models")) {
      const out = opts.listModelsOutput ?? "[]";
      return { exitCode: 0, stdout: Buffer.from(out), stderr: Buffer.from("") };
    }
    return { exitCode: 1, stdout: Buffer.from(""), stderr: Buffer.from("unexpected command") };
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("runStatus", () => {
  let tempDir: string;
  let agentsDir: string;

  beforeEach(() => {
    tempDir = makeTempDir();
    agentsDir = join(tempDir, "agents");
    mkdirSync(agentsDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  // -------------------------------------------------------------------------
  // NEW tests: effective model + source label
  // -------------------------------------------------------------------------

  it("status shows default(frontmatter) source when no override", async () => {
    // Seed agents dir with PROFILE_A frontmatter
    for (const role of ROLES) {
      makeAgentFile(agentsDir, role, PROFILE_A[role].primary);
    }
    const spawnFn = makeSpawnFn({ overrides: {} });

    const result = await runStatus({ spawnFn, agentsDir });
    expect(result.exitCode).toBe(0);
    // critic role should show default frontmatter model
    expect(result.output).toContain("critic");
    expect(result.output).toContain(PROFILE_A.critic.primary);
    expect(result.output).toContain("default");
    // must NOT contain override source for critic
    expect(result.output).not.toMatch(/critic.*override\(config\.yml\)/);
  });

  it("status shows override source when override present", async () => {
    for (const role of ROLES) {
      makeAgentFile(agentsDir, role, PROFILE_A[role].primary);
    }
    const overrideModel = "opencode-zen/claude-opus-4-8";
    const spawnFn = makeSpawnFn({ overrides: { "pi-oven:critic": overrideModel } });

    const result = await runStatus({ spawnFn, agentsDir });
    expect(result.exitCode).toBe(0);
    expect(result.output).toContain("critic");
    expect(result.output).toContain(overrideModel);
    expect(result.output).toContain("override");
  });

  it("status warns on unresolved override (미해소 fallback warning)", async () => {
    for (const role of ROLES) {
      makeAgentFile(agentsDir, role, PROFILE_A[role].primary);
    }
    // Use a retired model id that won't appear in list-models
    const retiredModel = "anthropic/claude-opus-4-7";
    const spawnFn = makeSpawnFn({
      overrides: { "pi-oven:critic": retiredModel },
      // list-models fixture that does NOT include the retired model
      listModelsOutput: JSON.stringify([
        { id: "anthropic/claude-opus-4-8" },
        { id: "opencode-zen/claude-opus-4-8" },
      ]),
    });

    const result = await runStatus({ spawnFn, agentsDir, listModelsOutput: JSON.stringify([
      { id: "anthropic/claude-opus-4-8" },
      { id: "opencode-zen/claude-opus-4-8" },
    ]) });
    expect(result.exitCode).toBe(0);
    // Should warn about unresolvable override
    expect(result.output).toMatch(/미해소|fallback|unresolved/i);
  });

  it("status resolves model selectors with reasoning effort suffixes by base model id", async () => {
    for (const role of ROLES) {
      makeAgentFile(agentsDir, role, PROFILE_A[role].primary);
    }
    const spawnFn = makeSpawnFn({
      overrides: { "pi-oven:critic": "openai-codex/gpt-5.5:xhigh" },
    });

    const result = await runStatus({
      spawnFn,
      agentsDir,
      listModelsOutput: JSON.stringify([{ id: "openai-codex/gpt-5.5" }]),
    });

    expect(result.exitCode).toBe(0);
    expect(result.output).toContain("openai-codex/gpt-5.5:xhigh");
    expect(result.output).not.toMatch(/미해소|fallback|unresolved/i);
  });

  it("status shows machine-global scope header", async () => {
    const spawnFn = makeSpawnFn({ overrides: {} });
    const result = await runStatus({ spawnFn, agentsDir });
    expect(result.exitCode).toBe(0);
    expect(result.output).toContain("machine-global");
  });

  it("status has NO drift warning, NO Profile line", async () => {
    for (const role of ROLES) {
      makeAgentFile(agentsDir, role, PROFILE_A[role].primary);
    }
    const spawnFn = makeSpawnFn({ overrides: {} });

    const result = await runStatus({ spawnFn, agentsDir });
    expect(result.output).not.toMatch(/drift/i);
    expect(result.output).not.toMatch(/Profile [AB] active/);
  });

  it("status shows all ROLES in output", async () => {
    for (const role of ROLES) {
      makeAgentFile(agentsDir, role, PROFILE_A[role].primary);
    }
    const spawnFn = makeSpawnFn({ overrides: {} });

    const result = await runStatus({ spawnFn, agentsDir });
    for (const role of ROLES) {
      expect(result.output).toContain(role);
    }
  });

  it("status shows (no agent file) when agentsDir is absent", async () => {
    const missingDir = join(tempDir, "nonexistent");
    const spawnFn = makeSpawnFn({ overrides: {} });

    const result = await runStatus({ spawnFn, agentsDir: missingDir });
    expect(result.exitCode).toBe(0);
    expect(result.output).toContain("no agent file");
  });

  it("status warns on unknown role override (stray key)", async () => {
    for (const role of ROLES) {
      makeAgentFile(agentsDir, role, PROFILE_A[role].primary);
    }
    const spawnFn = makeSpawnFn({ overrides: { "pi-oven:unknown-role-xyz": "some/model" } });

    const result = await runStatus({ spawnFn, agentsDir });
    expect(result.exitCode).toBe(0);
    expect(result.output).toMatch(/unknown role|unknown-role/i);
  });

  it("status falls back gracefully when omp config get fails (returns empty overrides)", async () => {
    for (const role of ROLES) {
      makeAgentFile(agentsDir, role, PROFILE_A[role].primary);
    }
    const spawnFn = makeSpawnFn({ getExitCode: 1 });

    const result = await runStatus({ spawnFn, agentsDir });
    expect(result.exitCode).toBe(0);
    // All roles should show default source since omp failed
    expect(result.output).toContain("default");
    expect(result.output).not.toContain("override(config.yml)");
  });
});

// ---------------------------------------------------------------------------
// Two-layer status — project(.omp/settings.json) rows win per role
// ---------------------------------------------------------------------------

describe("runStatus — project layer", () => {
  let tempDir: string;
  let agentsDir: string;
  let cwd: string;

  beforeEach(() => {
    tempDir = makeTempDir();
    agentsDir = join(tempDir, "agents");
    mkdirSync(agentsDir, { recursive: true });
    // A separate isolated cwd holding the .omp/settings.json project layer.
    cwd = join(tempDir, "proj");
    mkdirSync(cwd, { recursive: true });
    for (const role of ROLES) {
      makeAgentFile(agentsDir, role, PROFILE_A[role].primary);
    }
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  function seedProject(data: object): void {
    mkdirSync(join(cwd, ".omp"), { recursive: true });
    writeFileSync(
      join(cwd, ".omp", "settings.json"),
      JSON.stringify(data, null, 2) + "\n",
      "utf-8"
    );
  }

  it("header names both files + precedence note + project-file presence", async () => {
    seedProject({ task: { agentModelOverrides: { "pi-oven:critic": "anthropic/claude-opus-4-8" } } });
    const spawnFn = makeSpawnFn({ overrides: {} });

    const result = await runStatus({ spawnFn, agentsDir, cwd });
    expect(result.output).toContain(".omp/settings.json");
    expect(result.output).toContain("config.yml");
    expect(result.output).toMatch(/project wins per role/i);
    expect(result.output).toMatch(/present/i);
  });

  it("header reports the project file ABSENT when there is none", async () => {
    const spawnFn = makeSpawnFn({ overrides: {} });
    const result = await runStatus({ spawnFn, agentsDir, cwd });
    expect(result.output).toMatch(/absent/i);
  });
  it("header reports the project file as unreadable/corrupt when settings.json cannot be parsed", async () => {
    mkdirSync(join(cwd, ".omp"), { recursive: true });
    writeFileSync(join(cwd, ".omp", "settings.json"), "{ not json", "utf-8");
    const spawnFn = makeSpawnFn({ overrides: {}, ignoredSkills: [] });

    const result = await runStatus({ spawnFn, agentsDir, cwd });
    expect(result.output).toContain("present but unreadable/corrupt");
    expect(result.output).toContain("project routing state is unknown");
    expect(result.output).not.toContain("no pi-oven project routing detected");
  });


  it("a project-layer role is labelled project(.omp/settings.json)", async () => {
    seedProject({ task: { agentModelOverrides: { "pi-oven:critic": "opencode-zen/kimi-k2.6" } } });
    const spawnFn = makeSpawnFn({ overrides: {} });

    const result = await runStatus({ spawnFn, agentsDir, cwd });
    const criticLine = result.output.split("\n").find((l) => /^\s*critic\s/.test(l))!;
    expect(criticLine).toContain("opencode-zen/kimi-k2.6");
    expect(criticLine).toContain("project(.omp/settings.json)");
  });

  it("project layer WINS over the global override for the same role", async () => {
    seedProject({ task: { agentModelOverrides: { "pi-oven:critic": "opencode-zen/kimi-k2.6" } } });
    // Global override sets a DIFFERENT model for critic — project must win.
    const spawnFn = makeSpawnFn({ overrides: { "pi-oven:critic": "anthropic/claude-opus-4-8" } });

    const result = await runStatus({ spawnFn, agentsDir, cwd });
    const criticLine = result.output.split("\n").find((l) => /^\s*critic\s/.test(l))!;
    expect(criticLine).toContain("opencode-zen/kimi-k2.6");
    expect(criticLine).toContain("project(.omp/settings.json)");
    expect(criticLine).not.toContain("override(config.yml)");
  });

  it("a role only in the global layer still shows override(config.yml)", async () => {
    seedProject({ task: { agentModelOverrides: { "pi-oven:critic": "opencode-zen/kimi-k2.6" } } });
    const spawnFn = makeSpawnFn({ overrides: { "pi-oven:executor": "openai-codex/gpt-5.3-codex" } });

    const result = await runStatus({ spawnFn, agentsDir, cwd });
    const executorLine = result.output.split("\n").find((l) => /^\s*executor\s/.test(l))!;
    expect(executorLine).toContain("openai-codex/gpt-5.3-codex");
    expect(executorLine).toContain("override(config.yml)");
  });

  it("a role in neither layer shows default(frontmatter)", async () => {
    seedProject({ task: { agentModelOverrides: { "pi-oven:critic": "opencode-zen/kimi-k2.6" } } });
    const spawnFn = makeSpawnFn({ overrides: {} });

    const result = await runStatus({ spawnFn, agentsDir, cwd });
    const plannerLine = result.output.split("\n").find((l) => /^\s*planner\s/.test(l))!;
    expect(plannerLine).toContain("default(frontmatter)");
  });

  it("surfaces missing machine-global tool remediation when project routing is active", async () => {
    seedProject({ task: { agentModelOverrides: { "pi-oven:critic": "opencode-zen/kimi-k2.6" } } });
    const spawnFn = makeSpawnFn({
      overrides: {},
      scalarValues: {
        "inspect_image.enabled": false,
        "web_search.enabled": false,
        "lsp.enabled": false,
        "astGrep.enabled": false,
        "browser.enabled": false,
        "debug.enabled": false,
      },
    });

    const result = await runStatus({ spawnFn, agentsDir, cwd });
    expect(result.output).toContain("Standalone truth surface:");
    expect(result.output).toContain("project-scope remediation");
    expect(result.output).toContain("inspect_image.enabled");
    expect(result.output).toContain("/pi-oven:setup --scope global");
    expect(result.output).toContain("Project scope does not write ~/.omp/agent/config.yml");
  });

  it("surfaces unreadable tool-flag state as unknown instead of claiming the flag is missing", async () => {
    seedProject({ task: { agentModelOverrides: { "pi-oven:critic": "opencode-zen/kimi-k2.6" } } });
    const baseSpawn = makeSpawnFn({ overrides: {}, ignoredSkills: [] });
    const spawnFn = (cmd: string, args: string[]) => {
      if (cmd === "omp" && args[0] === "config" && args[1] === "get" && args[2] === "inspect_image.enabled") {
        return { exitCode: 0, stdout: Buffer.from("{ not json"), stderr: Buffer.from("") };
      }
      return baseSpawn(cmd, args);
    };

    const result = await runStatus({ spawnFn, agentsDir, cwd });
    expect(result.output).toContain("project-scope remediation");
    expect(result.output).toContain("could not be verified");
    expect(result.output).toContain("inspect_image.enabled");
    expect(result.output).not.toContain("tool flags are not enabled: inspect_image.enabled");
  });

  it("surfaces sibling-skill suppression as disabled with the global-only remediation", async () => {
    const spawnFn = makeSpawnFn({ overrides: {}, ignoredSkills: [] });

    const result = await runStatus({ spawnFn, agentsDir, cwd });
    expect(result.output).toContain("sibling-skill suppression");
    expect(result.output).toContain("not enabled in ~/.omp/agent/config.yml");
    expect(result.output).toContain("--suppress-sibling-skills");
  });
  it("surfaces unreadable sibling-skill suppression state as unknown instead of disabled", async () => {
    const baseSpawn = makeSpawnFn({ overrides: {} });
    const spawnFn = (cmd: string, args: string[]) => {
      if (cmd === "omp" && args[0] === "config" && args[1] === "get" && args[2] === "skills.ignoredSkills") {
        return { exitCode: 0, stdout: Buffer.from("{ not json"), stderr: Buffer.from("") };
      }
      return baseSpawn(cmd, args);
    };

    const result = await runStatus({ spawnFn, agentsDir, cwd });
    expect(result.output).toContain("sibling-skill suppression");
    expect(result.output).toContain("state unknown");
    expect(result.output).toContain("unreadable");
    expect(result.output).not.toContain("not enabled in ~/.omp/agent/config.yml");
  });


  it("shows sibling-skill suppression as enabled when the managed globs are present", async () => {
    const spawnFn = makeSpawnFn({
      overrides: {},
      ignoredSkills: ["superpowers:*", "oh-my-claudecode:*"],
    });

    const result = await runStatus({ spawnFn, agentsDir, cwd });
    expect(result.output).toContain("sibling-skill suppression");
    expect(result.output).toContain("enabled in ~/.omp/agent/config.yml");
    expect(result.output).toContain("superpowers:*");
    expect(result.output).toContain("oh-my-claudecode:*");
  });

  it("makes the installed topology explicit by naming the plugin root separately from project state", async () => {
    const spawnFn = makeSpawnFn({ overrides: {} });

    const result = await runStatus({ spawnFn, agentsDir, cwd });
    expect(result.output).toContain("installed topology");
    expect(result.output).toContain(tempDir);
    expect(result.output).toContain(cwd);
    expect(result.output).not.toContain(`pi-oven shipped assets read from ${agentsDir};`);
  });
});
