import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "fs";
import { join, resolve } from "path";
import { tmpdir } from "os";
import {
  writePluginSkillsManifest,
  writeShippedSkill,
} from "../../helpers/installed-topology";
import { runStatus } from "../../../scripts/pi-oven-setup/status";
import { ROLES, DEFAULT_PROFILE } from "../../../scripts/pi-oven-setup/profiles";
import { SETUP_GLOBAL_PREREQUISITES } from "../../../scripts/pi-oven-setup/project-config";

const REPO_AGENTS_DIR = resolve(__dirname, "../../../agents");

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
name: pov:${role}
description: Test agent for ${role}
model:
  - ${primary}
  - alternate-provider/${primary.split("/").pop()}
thinkingLevel: ${DEFAULT_PROFILE[role as keyof typeof DEFAULT_PROFILE].thinkingLevel}
mode: subagent
tools: ${JSON.stringify(DEFAULT_PROFILE[role as keyof typeof DEFAULT_PROFILE].tools)}
blocked_tools: ${JSON.stringify(DEFAULT_PROFILE[role as keyof typeof DEFAULT_PROFILE].blocked_tools)}
---

## Role

You are pov:${role}.
`;
  writeFileSync(join(agentsDir, `pov-${role}.md`), content, "utf-8");
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
  includedSkills?: string[] | null;
  ignoredSkills?: string[] | null;
  disabledProviders?: string[] | null;
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
    if (cmd === "omp" && args[0] === "config" && args[1] === "get" && args[2] === "skills.includeSkills") {
      if (opts.includedSkills === null) {
        return { exitCode: 1, stdout: Buffer.from(""), stderr: Buffer.from("missing key") };
      }
      const payload = JSON.stringify({
        key: "skills.includeSkills",
        value: opts.includedSkills ?? ["pov:*"],
        type: "array",
      });
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
    if (cmd === "omp" && args[0] === "config" && args[1] === "get" && args[2] === "disabledProviders") {
      if (opts.disabledProviders === null) {
        return { exitCode: 1, stdout: Buffer.from(""), stderr: Buffer.from("missing key") };
      }
      const payload = JSON.stringify({
        key: "disabledProviders",
        value: opts.disabledProviders ?? [],
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

const configuredSetupScalars = Object.fromEntries(
  SETUP_GLOBAL_PREREQUISITES.map(({ key, expected }) => [key, expected])
);

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
    // Seed agents dir with DEFAULT_PROFILE frontmatter
    for (const role of ROLES) {
      makeAgentFile(agentsDir, role, DEFAULT_PROFILE[role].primary);
    }
    const spawnFn = makeSpawnFn({ overrides: {} });

    const result = await runStatus({ spawnFn, agentsDir });
    expect(result.exitCode).toBe(0);
    // critic role should show default frontmatter model
    expect(result.output).toContain("critic");
    expect(result.output).toContain(DEFAULT_PROFILE.critic.primary);
    expect(result.output).toContain("default");
    // must NOT contain override source for critic
    expect(result.output).not.toMatch(/critic.*override\(config\.yml\)/);
  });

  it("status shows override source when override present", async () => {
    for (const role of ROLES) {
      makeAgentFile(agentsDir, role, DEFAULT_PROFILE[role].primary);
    }
    const overrideModel = "alternate-provider/claude-opus-4-8";
    const spawnFn = makeSpawnFn({ overrides: { "pov:critic": overrideModel } });

    const result = await runStatus({ spawnFn, agentsDir });
    expect(result.exitCode).toBe(0);
    expect(result.output).toContain("critic");
    expect(result.output).toContain(overrideModel);
    expect(result.output).toContain("override");
  });

  it("status warns on unresolved override without claiming runtime fallback", async () => {
    for (const role of ROLES) {
      makeAgentFile(agentsDir, role, DEFAULT_PROFILE[role].primary);
    }
    // Use a retired model id that won't appear in list-models
    const retiredModel = "anthropic/claude-opus-4-7";
    const spawnFn = makeSpawnFn({
      overrides: { "pov:critic": retiredModel },
      // list-models fixture that does NOT include the retired model
      listModelsOutput: JSON.stringify([
        { id: "anthropic/claude-opus-4-8" },
        { id: "alternate-provider/claude-opus-4-8" },
      ]),
    });

    const result = await runStatus({ spawnFn, agentsDir, listModelsOutput: JSON.stringify([
      { id: "anthropic/claude-opus-4-8" },
      { id: "alternate-provider/claude-opus-4-8" },
    ]) });
    expect(result.exitCode).toBe(0);
    expect(result.output).toMatch(/미해소|unresolved/i);
    expect(result.output).toMatch(/runtime.*(refuse|diagnose)|거부|진단/i);
    expect(result.output).not.toMatch(/session default.*fallback/i);
  });

  it("status resolves model selectors with reasoning effort suffixes by base model id", async () => {
    for (const role of ROLES) {
      makeAgentFile(agentsDir, role, DEFAULT_PROFILE[role].primary);
    }
    const spawnFn = makeSpawnFn({
      overrides: { "pov:critic": "openai-codex/gpt-5.5:xhigh" },
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

  it("status has no dual-plugin-surface warning under an isolated empty HOME cache, and no Profile line", async () => {
    for (const role of ROLES) {
      makeAgentFile(agentsDir, role, DEFAULT_PROFILE[role].primary);
    }
    const spawnFn = makeSpawnFn({ overrides: {} });
    const homeDir = makeTempDir();

    const result = await runStatus({ spawnFn, agentsDir, homeDir });
    expect(result.output).not.toContain("[WARN] dual plugin surface:");
    expect(result.output).not.toMatch(/Profile [AB] active/);

    rmSync(homeDir, { recursive: true, force: true });
  });

  it("status shows all ROLES in output", async () => {
    for (const role of ROLES) {
      makeAgentFile(agentsDir, role, DEFAULT_PROFILE[role].primary);
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

  it("status surfaces agent namespace drift when the agents dir still contains legacy filenames", async () => {
    writeFileSync(
      join(agentsDir, "pi-oven-executor.md"),
      [
        "---",
        "name: pi-oven:executor",
        "model:",
        "  - openai-codex/gpt-5.5",
        "---",
      ].join("\n"),
      "utf-8"
    );
    const spawnFn = makeSpawnFn({ overrides: {} });

    const result = await runStatus({ spawnFn, agentsDir });
    expect(result.output).toContain("agent namespace drift");
    expect(result.output).toContain("Legacy agent filenames detected");
    expect(result.output).toContain("pov-<role>.md");
  });

  it("status warns on unknown role override (stray key)", async () => {
    for (const role of ROLES) {
      makeAgentFile(agentsDir, role, DEFAULT_PROFILE[role].primary);
    }
    const spawnFn = makeSpawnFn({ overrides: { "pov:unknown-role-xyz": "some/model" } });

    const result = await runStatus({ spawnFn, agentsDir });
    expect(result.exitCode).toBe(0);
    expect(result.output).toMatch(/unknown role|unknown-role/i);
  });

  it("status falls back gracefully when omp config get fails (returns empty overrides)", async () => {
    for (const role of ROLES) {
      makeAgentFile(agentsDir, role, DEFAULT_PROFILE[role].primary);
    }
    const spawnFn = makeSpawnFn({ getExitCode: 1 });

    const result = await runStatus({ spawnFn, agentsDir });
    expect(result.exitCode).toBe(0);
    // All roles should show default source since omp failed
    expect(result.output).toContain("default");
    expect(result.output).not.toContain("override(config.yml)");
  });
  it("status truth surface reflects the codex-only release-default shipped baseline", async () => {
    const spawnFn = makeSpawnFn({ overrides: {} });
    const result = await runStatus({ spawnFn, agentsDir: REPO_AGENTS_DIR });

    expect(result.exitCode).toBe(0);

    const criticLine = result.output.split("\n").find((line) => /^\s*critic\s/.test(line))!;
    const plannerLine = result.output.split("\n").find((line) => /^\s*planner\s/.test(line))!;

    expect(criticLine).toContain("openai-codex/gpt-5.5");
    expect(criticLine).toContain("default(frontmatter)");
    expect(plannerLine).toContain("openai-codex/gpt-5.5");
    expect(plannerLine).toContain("default(frontmatter)");
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
      makeAgentFile(agentsDir, role, DEFAULT_PROFILE[role].primary);
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

  it("header names both files + precedence note + visibility-layer ownership boundary", async () => {
    seedProject({ task: { agentModelOverrides: { "pi-oven:critic": "anthropic/claude-opus-4-8" } } });
    const spawnFn = makeSpawnFn({ overrides: {} });

    const result = await runStatus({ spawnFn, agentsDir, cwd });
    expect(result.output).toContain(".omp/settings.json");
    expect(result.output).toContain("config.yml");
    expect(result.output).toMatch(/project wins per role/i);
    expect(result.output).toMatch(/present/i);
    expect(result.output).toMatch(/visibility\/guard only/i);
    expect(result.output).toMatch(/runtime owns current-session provider-family choice/i);
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

  it("summary marks the global layer ready from live routing + prerequisites even without a setup receipt", async () => {
    const spawnFn = makeSpawnFn({
      overrides: Object.fromEntries(
        ROLES.map((role) => [`pov:${role}`, "openai-codex/gpt-5.5:high"])
      ),
      scalarValues: configuredSetupScalars,
    });

    const result = await runStatus({ spawnFn, agentsDir, cwd });
    expect(result.output).toContain(
      "[✓] Global   (~/.omp/agent/config.yml routing + machine-global prerequisites)"
    );
    expect(result.output).toContain(
      "[✗] Project  (.omp/settings.json routing) — run /pi-oven:setup --scope project"
    );
  });

  it("summary marks both layers ready when global prerequisites and project routing are configured", async () => {
    seedProject({
      task: {
        agentModelOverrides: Object.fromEntries(
          ROLES.map((role) => [`pov:${role}`, "openai-codex/gpt-5.5:high"])
        ),
      },
    });
    const spawnFn = makeSpawnFn({
      overrides: Object.fromEntries(
        ROLES.map((role) => [`pov:${role}`, "openai-codex/gpt-5.5:high"])
      ),
      scalarValues: configuredSetupScalars,
    });

    const result = await runStatus({ spawnFn, agentsDir, cwd });
    expect(result.output).toContain(
      "[✓] Global   (~/.omp/agent/config.yml routing + machine-global prerequisites)"
    );
    expect(result.output).toContain("[✓] Project  (.omp/settings.json routing)");
    expect(result.output).toContain("↳ project model routing active (24 roles)");
  });

  it("does not treat stray pi-oven:* keys as active routing in the readiness summary", async () => {
    seedProject({
      task: {
        agentModelOverrides: { "pi-oven:stale-role": "openai-codex/gpt-5.5:high" },
      },
    });
    const spawnFn = makeSpawnFn({
      overrides: { "pov:stale-role": "openai-codex/gpt-5.5:high" },
      scalarValues: configuredSetupScalars,
    });

    const result = await runStatus({ spawnFn, agentsDir, cwd });
    expect(result.output).toContain(
      "[✗] Global   (~/.omp/agent/config.yml routing + machine-global prerequisites)"
    );
    expect(result.output).toContain(
      "[✗] Project  (.omp/settings.json routing) — run /pi-oven:setup --scope project"
    );
    expect(result.output).not.toContain("project model routing active");
    expect(result.output).toContain('WARNING: unknown role override key "pov:stale-role"');
  });

  it("ignores non-string project override payloads for both readiness and role display", async () => {
    seedProject({
      task: {
        agentModelOverrides: {
          "pi-oven:critic": { model: "openai-codex/gpt-5.5:high" },
        },
      },
    });
    const spawnFn = makeSpawnFn({ overrides: {}, scalarValues: configuredSetupScalars });

    const result = await runStatus({ spawnFn, agentsDir, cwd });
    const criticLine = result.output.split("\n").find((l) => /^\s*critic\s/.test(l))!;

    expect(result.output).toContain(
      "[✗] Project  (.omp/settings.json routing) — run /pi-oven:setup --scope project"
    );
    expect(result.output).not.toContain("project model routing active");
    expect(result.output).toContain("no pi-oven project routing detected");
    expect(criticLine).not.toContain("[object Object]");
    expect(criticLine).toContain("default(frontmatter)");
  });


  it("status labels a project canonical role as the healthy single pov surface", async () => {
    seedProject({ task: { agentModelOverrides: { "pov:critic": "alternate-provider/kimi-k2.6" } } });
    const spawnFn = makeSpawnFn({ overrides: {} });

    const result = await runStatus({ spawnFn, agentsDir, cwd });
    const criticLine = result.output.split("\n").find((l) => /^\s*critic\s/.test(l))!;
    expect(criticLine).toContain("alternate-provider/kimi-k2.6");
    expect(criticLine).toContain("project(.omp/settings.json healthy single pov surface)");
  });

  it("flags partial project apply when routing exists without the setup-owned companion keys", async () => {
    seedProject({ task: { agentModelOverrides: { "pov:critic": "alternate-provider/kimi-k2.6" } } });
    const spawnFn = makeSpawnFn({ overrides: {} });

    const result = await runStatus({ spawnFn, agentsDir, cwd });
    expect(result.output).toContain(
      'PARTIAL: project routing is present but setup-owned companion keys are missing or malformed: skills.includeSkills=["pov:*"], modelRoles.default/title, retry.fallbackChains'
    );
  });
  it("status distinguishes project old-only state when no machine-global override exists", async () => {
    seedProject({ task: { agentModelOverrides: { "pi-oven:critic": "alternate-provider/kimi-k2.6" } } });
    const spawnFn = makeSpawnFn({ overrides: {} });

    const result = await runStatus({ spawnFn, agentsDir, cwd });
    const criticLine = result.output.split("\n").find((l) => /^\s*critic\s/.test(l))!;
    expect(criticLine).toContain("alternate-provider/kimi-k2.6");
    expect(criticLine).toContain("project(.omp/settings.json old config keys)");
    expect(result.output).toContain(
      "old config keys: project override pi-oven:critic=alternate-provider/kimi-k2.6 still uses pi-oven:* in .omp/settings.json"
    );
  });

  it("status distinguishes global new + project old for the same role", async () => {
    seedProject({ task: { agentModelOverrides: { "pi-oven:critic": "alternate-provider/kimi-k2.6" } } });
    const spawnFn = makeSpawnFn({ overrides: { "pov:critic": "anthropic/claude-opus-4-8" } });

    const result = await runStatus({ spawnFn, agentsDir, cwd });
    const criticLine = result.output.split("\n").find((l) => /^\s*critic\s/.test(l))!;
    expect(criticLine).toContain("alternate-provider/kimi-k2.6");
    expect(criticLine).toContain("project(.omp/settings.json old config keys)");
    expect(criticLine).not.toContain("override(config.yml healthy single pov surface)");
    expect(result.output).toContain(
      "mixed migration state: project pi-oven:critic=alternate-provider/kimi-k2.6 still uses old config keys while machine-global pov:critic=anthropic/claude-opus-4-8 is already on the healthy single pov surface; project still wins for critic"
    );
  });

  it("legacy-only global overrides are shown as migration candidates when no project override exists", async () => {
    const spawnFn = makeSpawnFn({ overrides: { "pi-oven:executor": "openai-codex/gpt-5.3-codex" } });

    const result = await runStatus({ spawnFn, agentsDir, cwd });
    const executorLine = result.output.split("\n").find((l) => /^\s*executor\s/.test(l))!;
    expect(executorLine).toContain("openai-codex/gpt-5.3-codex");
    expect(executorLine).toContain("override(config.yml old config keys)");
    expect(result.output).toContain(
      "old config keys: machine-global pi-oven:executor=openai-codex/gpt-5.3-codex is legacy-only; next successful global write rewrites it to pov:executor"
    );
  });
  it("status distinguishes global old + project new for the same role", async () => {
    seedProject({ task: { agentModelOverrides: { "pov:critic": "alternate-provider/kimi-k2.6" } } });
    const spawnFn = makeSpawnFn({ overrides: { "pi-oven:critic": "anthropic/claude-opus-4-8" } });

    const result = await runStatus({ spawnFn, agentsDir, cwd });
    const criticLine = result.output.split("\n").find((l) => /^\s*critic\s/.test(l))!;
    expect(criticLine).toContain("alternate-provider/kimi-k2.6");
    expect(criticLine).toContain("project(.omp/settings.json healthy single pov surface)");
    expect(result.output).toContain(
      "mixed migration state: machine-global pi-oven:critic=anthropic/claude-opus-4-8 still uses old config keys while project pov:critic=alternate-provider/kimi-k2.6 is already on the healthy single pov surface; project still wins for critic"
    );
  });

  it("surfaces a same-scope project dual-key conflict and prefers pov:* for display", async () => {
    seedProject({
      task: {
        agentModelOverrides: {
          "pov:critic": "alternate-provider/kimi-k2.6",
          "pi-oven:critic": "anthropic/claude-opus-4-8",
        },
      },
    });
    const spawnFn = makeSpawnFn({ overrides: {} });

    const result = await runStatus({ spawnFn, agentsDir, cwd });
    const criticLine = result.output.split("\n").find((l) => /^\s*critic\s/.test(l))!;
    expect(criticLine).toContain("alternate-provider/kimi-k2.6");
    expect(criticLine).toContain("project(.omp/settings.json mixed migration state; preferring pov:*)");
    expect(result.output).toContain(
      "mixed migration state: project scope has both pov:critic=alternate-provider/kimi-k2.6 and pi-oven:critic=anthropic/claude-opus-4-8; status prefers pov:*"
    );
  });

  it("surfaces a same-scope global dual-key conflict and prefers pov:* for display", async () => {
    const spawnFn = makeSpawnFn({
      overrides: {
        "pov:critic": "openai-codex/gpt-5.5:xhigh",
        "pi-oven:critic": "anthropic/claude-opus-4-8",
      },
    });

    const result = await runStatus({ spawnFn, agentsDir, cwd });
    const criticLine = result.output.split("\n").find((l) => /^\s*critic\s/.test(l))!;
    expect(criticLine).toContain("openai-codex/gpt-5.5:xhigh");
    expect(criticLine).toContain("override(config.yml mixed migration state; preferring pov:*)");
    expect(result.output).toContain(
      "mixed migration state: global scope has both pov:critic=openai-codex/gpt-5.5:xhigh and pi-oven:critic=anthropic/claude-opus-4-8; status prefers pov:* and global write paths refuse this mixed state"
    );
  });
  it("reports the healthy all-pov state when no live pi-oven:* keys remain in either scope", async () => {
    seedProject({
      task: { agentModelOverrides: { "pov:critic": "alternate-provider/kimi-k2.6" } },
      skills: { includeSkills: ["pov:*"] },
      modelRoles: { default: "openai-codex/gpt-5.5", title: "openai/gpt-5" },
      retry: { fallbackChains: { default: ["openai/gpt-5"] } },
    });
    const spawnFn = makeSpawnFn({ overrides: { "pov:executor": "openai-codex/gpt-5.5:xhigh" } });

    const result = await runStatus({ spawnFn, agentsDir, cwd });
    expect(result.output).toContain(
      "healthy single pov surface: all live managed overrides use canonical pov:* keys across project and machine-global scopes"
    );
    expect(result.output).not.toContain("old config keys:");
    expect(result.output).not.toContain("mixed migration state:");
    expect(result.output).not.toContain("PARTIAL:");
  });
  it("a role in neither layer shows default(frontmatter)", async () => {
    seedProject({ task: { agentModelOverrides: { "pi-oven:critic": "alternate-provider/kimi-k2.6" } } });
    const spawnFn = makeSpawnFn({ overrides: {} });

    const result = await runStatus({ spawnFn, agentsDir, cwd });
    const plannerLine = result.output.split("\n").find((l) => /^\s*planner\s/.test(l))!;
    expect(plannerLine).toContain("default(frontmatter)");
  });

  it("surfaces OMP task as the dispatch seam and its actual concurrency controls", async () => {
    const spawnFn = makeSpawnFn({ overrides: {}, ignoredSkills: [] });

    const result = await runStatus({
      spawnFn,
      agentsDir,
      cwd,
      pluginAssetPath: join(import.meta.dir, "..", "..", ".."),
    });
    expect(result.output).toContain("task dispatch");
    expect(result.output).toContain("OMP task is the single dispatch seam");
    expect(result.output).toContain("8-12");
    expect(result.output).toContain("task.maxConcurrency");
    expect(result.output).toContain("provider/runtime admission");
  });

  it("surfaces missing machine-global prerequisites when project routing is active", async () => {
    seedProject({ task: { agentModelOverrides: { "pi-oven:critic": "alternate-provider/kimi-k2.6" } } });
    const spawnFn = makeSpawnFn({
      overrides: {},
      scalarValues: {
        "task.enableLsp": false,
        "inspect_image.enabled": false,
        "web_search.enabled": false,
        "lsp.enabled": false,
        "astGrep.enabled": false,
        "browser.enabled": false,
        "debug.enabled": false,
      },
    });

    const result = await runStatus({ spawnFn, agentsDir, cwd });
    expect(result.output).toContain("Runtime contract truth surface:");
    expect(result.output).toContain("project-scope remediation");
    expect(result.output).toContain("memory.backend");
    expect(result.output).toContain("async.enabled");
    expect(result.output).toContain("task.enableLsp");
    expect(result.output).toContain("inspect_image.enabled");
    expect(result.output).toContain("missing or mismatched");
    expect(result.output).toContain("/pi-oven:setup --repair-prereqs");
    expect(result.output).toContain("Project scope does not write ~/.omp/agent/config.yml");
  });

  it("surfaces unreadable prerequisite state as unknown instead of claiming the prerequisite is missing", async () => {
    seedProject({ task: { agentModelOverrides: { "pi-oven:critic": "alternate-provider/kimi-k2.6" } } });
    const baseSpawn = makeSpawnFn({
      overrides: {},
      ignoredSkills: [],
      scalarValues: {
        "mnemopi.noEmbeddings": true,
        "mnemopi.llmMode": "none",
        "async.enabled": true,
        "task.enableLsp": true,
        "inspect_image.enabled": true,
        "web_search.enabled": true,
        "lsp.enabled": true,
        "astGrep.enabled": true,
        "browser.enabled": true,
        "debug.enabled": true,
      },
    });
    const spawnFn = (cmd: string, args: string[]) => {
      if (cmd === "omp" && args[0] === "config" && args[1] === "get" && args[2] === "memory.backend") {
        return { exitCode: 0, stdout: Buffer.from("{ not json"), stderr: Buffer.from("") };
      }
      return baseSpawn(cmd, args);
    };

    const result = await runStatus({ spawnFn, agentsDir, cwd });
    expect(result.output).toContain("project-scope remediation");
    expect(result.output).toContain("could not be verified");
    expect(result.output).toContain("memory.backend");
    expect(result.output).not.toContain("missing or mismatched: memory.backend");
  });

  it("surfaces the control-plane front door as explicit capability proofs", async () => {
    const spawnFn = makeSpawnFn({ overrides: {}, ignoredSkills: [] });

    const result = await runStatus({ spawnFn, agentsDir, cwd });
    expect(result.output).toContain("control-plane front door");
    expect(result.output).toContain("requiredSkills");
    expect(result.output).toContain("branch contract");
    expect(result.output).toContain("external execution consent");
    expect(result.output).toContain("Bootstrap message injection");
    expect(result.output).toContain("tool remap");
  });

  it("reports owned-surface active workflow-skill ownership only when the visible includeSkills surface is pov-only", async () => {
    const spawnFn = makeSpawnFn({ overrides: {}, includedSkills: ["pov:*"] });

    const result = await runStatus({ spawnFn, agentsDir, cwd });
    expect(result.output).toContain("workflow-skill ownership");
    expect(result.output).toContain("classification: owned-surface active");
    expect(result.output).toContain("healthy single pov surface");
    expect(result.output).toContain('skills.includeSkills = ["pov:*"]');
    expect(result.output).toContain("workflow skills — not commands, agents, hooks, or MCP");
  });

  it("warns with ownership-not-established when no effective workflow-skill include policy is present", async () => {
    const spawnFn = makeSpawnFn({ overrides: {}, includedSkills: null });

    const result = await runStatus({ spawnFn, agentsDir, cwd });
    expect(result.output).toContain("workflow-skill ownership");
    expect(result.output).toContain("classification: ownership not established");
    expect(result.output).toContain("This is not the healthy single pov surface");
    expect(result.output).toContain("no effective skills.includeSkills workflow-skill policy");
    expect(result.output).toContain('skills.includeSkills = ["pov:*"]');
    expect(result.output).toContain("Empty ~/.claude/skills is not the target state");
  });

  it("treats legacy aids as compatibility-only when ownership mainline is still missing", async () => {
    const spawnFn = makeSpawnFn({
      overrides: {},
      includedSkills: null,
      ignoredSkills: ["superpowers:*"],
      disabledProviders: ["claude"],
    });

    const result = await runStatus({ spawnFn, agentsDir, cwd });
    expect(result.output).toContain("workflow-skill ownership");
    expect(result.output).toContain("classification: compatibility aids only");
    expect(result.output).toContain("This is not the healthy single pov surface");
    expect(result.output).toContain('disabledProviders = ["claude"]');
    expect(result.output).toContain('skills.ignoredSkills = ["superpowers:*"]');
    expect(result.output).toContain("do not by themselves stop claude-plugins");
  });

  it("treats a malformed project skills block as unknown instead of falling through to healthy global ownership", async () => {
    seedProject({ skills: "broken" });
    const spawnFn = makeSpawnFn({ overrides: {}, includedSkills: ["pov:*"] });

    const result = await runStatus({ spawnFn, agentsDir, cwd });
    expect(result.output).toContain("workflow-skill ownership");
    expect(result.output).toContain("classification: ownership not established");
    expect(result.output).toContain("effective workflow-skill ownership is unknown");
    expect(result.output).toContain("healthy single pov surface could not be verified yet");
    expect(result.output).toContain("present but malformed skills block");
  });

  it("treats the project includeSkills layer as authoritative when it conflicts with a healthy global filter", async () => {
    seedProject({ skills: { includeSkills: ["other:*"] } });
    const spawnFn = makeSpawnFn({ overrides: {}, includedSkills: ["pov:*"] });

    const result = await runStatus({ spawnFn, agentsDir, cwd });
    expect(result.output).toContain("workflow-skill ownership");
    expect(result.output).toContain('project skills.includeSkills');
    expect(result.output).toContain('["other:*"]');
    expect(result.output).toContain('canonical workflow-skill filter ["pov:*"]');
    expect(result.output).not.toContain("workflow-skill surface is on the healthy single pov surface via skills.includeSkills");
  });

  it("does not advertise legacy skill-visibility config even when skills.ignoredSkills is unreadable", async () => {
    const baseSpawn = makeSpawnFn({ overrides: {} });
    const spawnFn = (cmd: string, args: string[]) => {
      if (cmd === "omp" && args[0] == "config" && args[1] == "get" && args[2] == "skills.ignoredSkills") {
        return { exitCode: 0, stdout: Buffer.from("{ not json"), stderr: Buffer.from("") };
      }
      return baseSpawn(cmd, args);
    };

    const result = await runStatus({ spawnFn, agentsDir, cwd });
    expect(result.output).toContain("control-plane front door");
    expect(result.output).toContain("task dispatch");
    expect(result.output).not.toContain("sibling-skill suppression");
  });

  it("does not advertise legacy skill-visibility config even when managed globs are present", async () => {
    const spawnFn = makeSpawnFn({
      overrides: {},
      ignoredSkills: ["superpowers:*", "oh-my-claudecode:*"],
    });

    const result = await runStatus({ spawnFn, agentsDir, cwd });
    expect(result.output).toContain("control-plane front door");
    expect(result.output).toContain("task dispatch");
    expect(result.output).not.toContain("sibling-skill suppression");
  });

  it("surfaces bootstrap-level gajae parity as a secondary non-blocking track", async () => {
    const spawnFn = makeSpawnFn({ overrides: {}, ignoredSkills: [] });

    const result = await runStatus({ spawnFn, agentsDir, cwd });
    expect(result.output).toContain("bootstrap parity track");
    expect(result.output).toContain("gajae parity");
    expect(result.output).toContain("not a blocker yet");
  });

  it("reports OMP task dispatch without a temporary scheduler boundary", async () => {
    const spawnFn = makeSpawnFn({
      overrides: {},
      ignoredSkills: [],
      disabledProviders: ["claude"],
    });

    const result = await runStatus({ spawnFn, agentsDir, cwd });
    expect(result.output).toContain("task dispatch");
    expect(result.output).toContain("OMP task is the single dispatch seam");
    expect(result.output).toContain("task.maxConcurrency");
    expect(result.output).not.toContain("clean-room isolation");
  });

  it("makes the installed topology explicit by naming the plugin root separately from project state", async () => {
    const spawnFn = makeSpawnFn({ overrides: {} });

    const result = await runStatus({ spawnFn, agentsDir, cwd });
    expect(result.output).toContain("installed topology");
    expect(result.output).toContain(tempDir);
    expect(result.output).toContain(cwd);
    expect(result.output).not.toContain(`pi-oven shipped assets read from ${agentsDir};`);
  });

  it("surfaces duplicate plugin surface drift with exact active and stale cache paths", async () => {
    const homeDir = makeTempDir();
    const cachePluginRoot = join(
      homeDir,
      ".omp",
      "plugins",
      "cache",
      "plugins",
      "kzk___pi-oven___0.2.2"
    );
    mkdirSync(join(cachePluginRoot, "agents"), { recursive: true });
    writeFileSync(join(cachePluginRoot, "agents", "pov-executor.md"), "# executor\n", "utf-8");
    writePluginSkillsManifest(tempDir, ["./skills/autonomous-loop/SKILL.md"]);
    writeShippedSkill(tempDir, "autonomous-loop");
    writePluginSkillsManifest(cachePluginRoot, ["./skills/autonomous-loop/SKILL.md"]);
    writeShippedSkill(cachePluginRoot, "autonomous-loop", {
      frontmatterName: "autonomous-loop",
    });

    const spawnFn = makeSpawnFn({ overrides: {} });
    const result = await runStatus({
      spawnFn,
      agentsDir,
      cwd,
      pluginAssetPath: tempDir,
      homeDir,
    });

    expect(result.output).toContain("dual plugin surface");
    expect(result.output).toContain(`active plugin root is ${tempDir}`);
    expect(result.output).toContain(cachePluginRoot);
    expect(result.output).toContain("public skill frontmatter drift");
    expect(result.output).toContain('"autonomous-loop"');
    expect(result.output).toContain('"pov:autonomous-loop"');

    rmSync(homeDir, { recursive: true, force: true });
  });

  it("surfaces keyword-skill integrity drift when plugin assets reference a missing shipped skill file", async () => {
    writePluginSkillsManifest(tempDir, ["./skills/missing-skill/SKILL.md"]);

    const spawnFn = makeSpawnFn({ overrides: {} });
    const result = await runStatus({ spawnFn, agentsDir, cwd });

    expect(result.output).toContain("keyword-skill integrity");
    expect(result.output).toContain("missing-skill");
    expect(result.output).toContain(tempDir);
    expect(result.output).toContain(cwd);
    expect(result.output).toContain("Runtime keyword-matched skills are unavailable");
  });

  it("preserves keyword-skill diagnostics by inferring the plugin root from cwd when agentsDir is unavailable", async () => {
    writePluginSkillsManifest(tempDir, ["./skills/missing-skill/SKILL.md"]);

    const spawnFn = makeSpawnFn({ overrides: {} });
    const result = await runStatus({ spawnFn, cwd: tempDir });

    expect(result.output).toContain("keyword-skill integrity");
    expect(result.output).toContain("missing-skill");
    expect(result.output).toContain(tempDir);
    expect(result.output).toContain("Runtime keyword-matched skills are unavailable");
  });

  it("explicitly degrades keyword-skill diagnostics when no plugin root can be resolved", async () => {
    const unrelatedCwd = makeTempDir();
    const isolatedHomeDir = makeTempDir();

    try {
      const spawnFn = makeSpawnFn({ overrides: {} });
      const result = await runStatus({
        spawnFn,
        cwd: unrelatedCwd,
        homeDir: isolatedHomeDir,
      });

      expect(result.output).toContain("keyword-skill integrity");
      expect(result.output).toContain("plugin root unavailable");
      expect(result.output).toContain("could not be probed");
    } finally {
      rmSync(unrelatedCwd, { recursive: true, force: true });
      rmSync(isolatedHomeDir, { recursive: true, force: true });
    }
  });

  it("surfaces keyword-skill integrity drift when plugin assets contain a shipped skill without whitelist coverage", async () => {
    writePluginSkillsManifest(tempDir, ["./skills/keyword-gap/SKILL.md"]);
    writeShippedSkill(tempDir, "keyword-gap");

    const spawnFn = makeSpawnFn({ overrides: {} });
    const result = await runStatus({ spawnFn, agentsDir, cwd });

    expect(result.output).toContain("keyword-skill integrity");
    expect(result.output).toContain("keyword-gap");
    expect(result.output).toContain(tempDir);
    expect(result.output).toContain(cwd);
    expect(result.output).toContain("Runtime keyword-matched skills are unavailable");
  });

  it("surfaces keyword-skill integrity when the installed keyword index is only partially available", async () => {
    writePluginSkillsManifest(tempDir, [
      "./skills/brainstorming/SKILL.md",
      "./skills/keyword-gap/SKILL.md",
    ]);
    writeShippedSkill(tempDir, "brainstorming");
    writeShippedSkill(tempDir, "keyword-gap");

    const spawnFn = makeSpawnFn({ overrides: {} });
    const result = await runStatus({ spawnFn, agentsDir, cwd });

    expect(result.output).toContain("keyword-skill integrity");
    expect(result.output).toContain("loaded 1/2 shipped skills");
    expect(result.output).toContain("keyword-gap");
    expect(result.output).toContain("Runtime keyword-matched skills are partially available");
  });

  it("surfaces keyword-skill integrity when plugin manifest has no shipped skills", async () => {
    writePluginSkillsManifest(tempDir, []);

    const spawnFn = makeSpawnFn({ overrides: {} });
    const result = await runStatus({ spawnFn, agentsDir, cwd });

    expect(result.output).toContain("keyword-skill integrity");
    expect(result.output).toContain("did not yield any shipped skills");
    expect(result.output).toContain("Runtime keyword-matched skills are unavailable");
  });
});
