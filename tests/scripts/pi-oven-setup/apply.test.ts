import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, writeFileSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { runApply, runRepairPrereqs } from "../../../scripts/pi-oven-setup/apply";
import { ROLES, PROFILE_A, PROFILE_B, PROFILE_C, PROFILE_D, PROFILE_A_ORCHESTRATOR, PROFILE_A_FALLBACK_CHAINS, PROFILE_B_ORCHESTRATOR, PROFILE_B_FALLBACK_CHAINS, PROFILE_C_ORCHESTRATOR, PROFILE_C_FALLBACK_CHAINS, PROFILE_D_ORCHESTRATOR, PROFILE_D_FALLBACK_CHAINS } from "../../../scripts/pi-oven-setup/profiles";
import { readAgentFiles } from "../../../scripts/pi-oven-setup/agent-rewriter";
import {
  projectSettingsPath,
  readProjectSettingsSoft,
  readProjectAgentModelOverrides,
} from "../../../scripts/pi-oven-setup/project-settings";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTempDir(): string {
  const dir = join(
    tmpdir(),
    `apply-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
  mkdirSync(dir, { recursive: true });
  return dir;
}

function makeAgentFile(
  agentsDir: string,
  role: string,
  profile: typeof PROFILE_A,
  primary: string,
  alternate: string,
  thinkingLevel: string
): void {
  const content = `---
name: pi-oven:${role}
description: Test agent for ${role}
model:
  - ${primary}
  - ${alternate}
thinkingLevel: ${thinkingLevel}
mode: subagent
tools: ${JSON.stringify(profile[role as keyof typeof profile].tools)}
blocked_tools: ${JSON.stringify(profile[role as keyof typeof profile].blocked_tools)}
---

## Role

You are pi-oven:${role}.
`;
  writeFileSync(join(agentsDir, `pi-oven-${role}.md`), content, "utf-8");
}

function populateAgents(agentsDir: string, profile: typeof PROFILE_A): void {
  for (const role of ROLES) {
    makeAgentFile(
      agentsDir,
      role,
      profile,
      profile[role].primary,
      profile[role].registry_alternate,
      profile[role].thinkingLevel
    );
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("runApply", () => {
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
  // Core: no plugin-config writes
  // -------------------------------------------------------------------------

  it("runApply does NOT call any plugin-config write (no omp plugin config set)", async () => {
    const spawnCalls: Array<{ cmd: string; args: string[] }> = [];
    const mockSpawnFn = (cmd: string, args: string[]) => {
      spawnCalls.push({ cmd, args });
      return { exitCode: 0, stdout: Buffer.from("ok"), stderr: Buffer.from("") } as any;
    };

    populateAgents(agentsDir, PROFILE_A);

    await runApply({
      profile: "A",
      validateMode: "none",
      spawnFn: mockSpawnFn,
      agentsDir,
    });

    // Must not have called "plugin config set" with any args
    const pluginConfigSetCalls = spawnCalls.filter(
      (c) => c.args.includes("plugin") && c.args.includes("config") && c.args.includes("set")
    );
    expect(pluginConfigSetCalls.length).toBe(0);
  });

  it("runApply does NOT call any plugin-config write for Profile B", async () => {
    const spawnCalls: Array<{ cmd: string; args: string[] }> = [];
    const mockSpawnFn = (cmd: string, args: string[]) => {
      spawnCalls.push({ cmd, args });
      return { exitCode: 0, stdout: Buffer.from("ok"), stderr: Buffer.from("") } as any;
    };

    populateAgents(agentsDir, PROFILE_A);

    await runApply({
      profile: "B",
      validateMode: "none",
      spawnFn: mockSpawnFn,
      agentsDir,
    });

    const pluginConfigSetCalls = spawnCalls.filter(
      (c) => c.args.includes("plugin") && c.args.includes("config") && c.args.includes("set")
    );
    expect(pluginConfigSetCalls.length).toBe(0);
  });

  // -------------------------------------------------------------------------
  // Maintainer path: agentsDir provided → generates profile frontmatter
  // -------------------------------------------------------------------------

  it("runApply with agentsDir generates Profile A frontmatter (maintainer path)", async () => {
    const mockSpawnFn = (_cmd: string, _args: string[]) =>
      ({ exitCode: 0, stdout: Buffer.from("ok"), stderr: Buffer.from("") } as any);

    populateAgents(agentsDir, PROFILE_B);

    await runApply({
      profile: "A",
      validateMode: "none",
      spawnFn: mockSpawnFn,
      agentsDir,
    });

    const entries = await readAgentFiles(agentsDir);
    expect(entries.length).toBe(ROLES.length);
    const executor = entries.find((e) => e.role === "executor")!;
    expect(executor.currentModel[0]).toBe(PROFILE_A.executor.primary);
    expect(executor.currentModel[1]).toBe(PROFILE_A.executor.registry_alternate);
  });

  it("runApply with agentsDir generates Profile B frontmatter (maintainer path)", async () => {
    const mockSpawnFn = (_cmd: string, _args: string[]) =>
      ({ exitCode: 0, stdout: Buffer.from("ok"), stderr: Buffer.from("") } as any);

    populateAgents(agentsDir, PROFILE_A);

    await runApply({
      profile: "B",
      validateMode: "none",
      spawnFn: mockSpawnFn,
      agentsDir,
    });

    const entries = await readAgentFiles(agentsDir);
    expect(entries.length).toBe(ROLES.length);
    const executor = entries.find((e) => e.role === "executor")!;
    expect(executor.currentModel[0]).toBe(PROFILE_B.executor.primary);
    expect(executor.currentModel[1]).toBe(PROFILE_B.executor.registry_alternate);
  });

  // -------------------------------------------------------------------------
  // No agentsDir (user setup) → writes the MAIN ORCHESTRATOR model roles only
  // -------------------------------------------------------------------------

  // Mock that serves `omp config get modelRoles --json` as a record (with a
  // sibling key to assert preservation), `omp config get retry.fallbackChains --json`
  // as an empty record, `omp config get task.agentModelOverrides --json` as an
  // empty record, and exit-0 for every other call.
  function makeUserPathSpawn(siblings: Record<string, string> = { someSibling: "keep" }) {
    const spawnCalls: Array<{ cmd: string; args: string[] }> = [];
    const mockSpawnFn = (cmd: string, args: string[]) => {
      spawnCalls.push({ cmd, args });
      if (args[0] === "config" && args[1] === "get" && args[2] === "modelRoles") {
        return {
          exitCode: 0,
          stdout: Buffer.from(
            JSON.stringify({ key: "modelRoles", value: siblings, type: "record", description: "" })
          ),
          stderr: Buffer.from(""),
        } as any;
      }
      if (args[0] === "config" && args[1] === "get" && args[2] === "retry.fallbackChains") {
        return {
          exitCode: 0,
          stdout: Buffer.from(
            JSON.stringify({ key: "retry.fallbackChains", value: {}, type: "record", description: "" })
          ),
          stderr: Buffer.from(""),
        } as any;
      }
      if (args[0] === "config" && args[1] === "get" && args[2] === "task.agentModelOverrides") {
        return {
          exitCode: 0,
          stdout: Buffer.from(
            JSON.stringify({ key: "task.agentModelOverrides", value: {}, type: "record", description: "" })
          ),
          stderr: Buffer.from(""),
        } as any;
      }
      return { exitCode: 0, stdout: Buffer.from("ok"), stderr: Buffer.from("") } as any;
    };
    return { spawnCalls, mockSpawnFn };
  }

  it("runApply WITHOUT agentsDir writes exactly ONE whole-record `modelRoles` (default+title merged, NOT dotted) and ZERO task.agentModelOverrides", async () => {
    const { spawnCalls, mockSpawnFn } = makeUserPathSpawn();

    await runApply({
      profile: "A",
      validateMode: "none",
      spawnFn: mockSpawnFn,
      // agentsDir intentionally omitted → user setup path
    });

    // Exactly ONE atomic whole-record write, keyed `modelRoles` (NOT dotted).
    const modelRoleSets = spawnCalls.filter(
      (c) => c.args[0] === "config" && c.args[1] === "set" && c.args[2] === "modelRoles"
    );
    expect(modelRoleSets.length).toBe(1);

    // No dotted modelRoles.* write may exist (omp rejects undeclared dotted keys).
    const dottedSets = spawnCalls.filter(
      (c) =>
        c.args[0] === "config" &&
        c.args[1] === "set" &&
        typeof c.args[2] === "string" &&
        c.args[2].startsWith("modelRoles.")
    );
    expect(dottedSets.length).toBe(0);

    // Merged whole-record contains the new default+title AND preserves the sibling.
    const merged = JSON.parse(modelRoleSets[0].args[3]);
    expect(merged.default).toBe("openai-codex/gpt-5.4:high");
    expect(merged.title).toBe("gpt-5.4-mini:low");
    expect(merged.someSibling).toBe("keep");

    // Anti-Spec-E regression: NO task.agentModelOverrides may be written.
    const overrideWrites = spawnCalls.filter(
      (c) =>
        c.args[0] === "config" &&
        c.args[1] === "set" &&
        c.args[2] === "task.agentModelOverrides"
    );
    expect(overrideWrites.length).toBe(0);
  });

  it("runApply WITHOUT agentsDir writes PROFILE_A orchestrator values for profile A", async () => {
    const { spawnCalls, mockSpawnFn } = makeUserPathSpawn();

    await runApply({ profile: "A", validateMode: "none", spawnFn: mockSpawnFn });

    const setCall = spawnCalls.find(
      (c) => c.args[0] === "config" && c.args[1] === "set" && c.args[2] === "modelRoles"
    );
    const merged = JSON.parse(setCall!.args[3]);
    expect(merged.default).toBe("openai-codex/gpt-5.4:high");
    expect(merged.title).toBe("gpt-5.4-mini:low");
  });

  it("runApply WITHOUT agentsDir writes retry.fallbackChains for profile A", async () => {
    const { spawnCalls, mockSpawnFn } = makeUserPathSpawn();

    await runApply({ profile: "A", validateMode: "none", spawnFn: mockSpawnFn });

    const setCall = spawnCalls.find(
      (c) => c.args[0] === "config" && c.args[1] === "set" && c.args[2] === "retry.fallbackChains"
    );
    expect(setCall).toBeDefined();
    const merged = JSON.parse(setCall!.args[3]);
    expect(merged.default).toEqual(["opencode-zen/kimi-k2.6"]);
    expect(merged.title).toEqual(["opencode-zen/gpt-5.4-mini"]);
  });

  it("runApply WITHOUT agentsDir writes PROFILE_B orchestrator values for profile B", async () => {
    const { spawnCalls, mockSpawnFn } = makeUserPathSpawn();

    await runApply({ profile: "B", validateMode: "none", spawnFn: mockSpawnFn });

    const setCall = spawnCalls.find(
      (c) => c.args[0] === "config" && c.args[1] === "set" && c.args[2] === "modelRoles"
    );
    const merged = JSON.parse(setCall!.args[3]);
    expect(merged.default).toBe("openai-codex/gpt-5.4:high");
    expect(merged.title).toBe("openai-codex/gpt-5.4:medium");
  });

  it("runApply WITH agentsDir rewrites agent files and writes ZERO modelRoles", async () => {
    const spawnCalls: Array<{ cmd: string; args: string[] }> = [];
    const mockSpawnFn = (cmd: string, args: string[]) => {
      spawnCalls.push({ cmd, args });
      return { exitCode: 0, stdout: Buffer.from("ok"), stderr: Buffer.from("") } as any;
    };

    populateAgents(agentsDir, PROFILE_B);

    await runApply({
      profile: "A",
      validateMode: "none",
      spawnFn: mockSpawnFn,
      agentsDir,
    });

    // Maintainer path rewrote frontmatter…
    const entries = await readAgentFiles(agentsDir);
    const executor = entries.find((e) => e.role === "executor")!;
    expect(executor.currentModel[0]).toBe(PROFILE_A.executor.primary);

    // …and wrote NO modelRoles (orchestrator write is the user-setup path only),
    // neither the whole-record `modelRoles` key nor any dotted modelRoles.*.
    const modelRoleSets = spawnCalls.filter(
      (c) =>
        c.args[0] === "config" &&
        c.args[1] === "set" &&
        typeof c.args[2] === "string" &&
        (c.args[2] === "modelRoles" || c.args[2].startsWith("modelRoles."))
    );
    expect(modelRoleSets.length).toBe(0);
  });

  // -------------------------------------------------------------------------
  // No agentsDir → no file mutation
  // -------------------------------------------------------------------------

  it("runApply without agentsDir runs validate only, no file mutation", async () => {
    // User path: serve a valid modelRoles record for the get, exit-0 otherwise.
    const { mockSpawnFn } = makeUserPathSpawn();

    // Populate the dir but do NOT pass it — files must remain untouched
    populateAgents(agentsDir, PROFILE_A);

    const beforeEntries = await readAgentFiles(agentsDir);
    const beforeModels = beforeEntries.map((e) => ({
      role: e.role,
      model: e.currentModel[0],
    }));

    await runApply({
      profile: "B",
      validateMode: "none",
      spawnFn: mockSpawnFn,
      // agentsDir intentionally omitted
    });

    const afterEntries = await readAgentFiles(agentsDir);
    const afterModels = afterEntries.map((e) => ({
      role: e.role,
      model: e.currentModel[0],
    }));
    expect(afterModels).toEqual(beforeModels);
  });

  // -------------------------------------------------------------------------
  // validate integration
  // -------------------------------------------------------------------------

  it("returns exitCode 0 on successful Profile A apply with validateMode=none", async () => {
    const mockSpawnFn = (_cmd: string, _args: string[]) =>
      ({ exitCode: 0, stdout: Buffer.from("ok"), stderr: Buffer.from("") } as any);

    populateAgents(agentsDir, PROFILE_A);

    const result = await runApply({
      profile: "A",
      validateMode: "none",
      spawnFn: mockSpawnFn,
      agentsDir,
    });
    expect(result.exitCode).toBe(0);
  });

  it("returns exitCode 0 on successful Profile B apply with validateMode=none", async () => {
    const mockSpawnFn = (_cmd: string, _args: string[]) =>
      ({ exitCode: 0, stdout: Buffer.from("ok"), stderr: Buffer.from("") } as any);

    populateAgents(agentsDir, PROFILE_A);

    const result = await runApply({
      profile: "B",
      validateMode: "none",
      spawnFn: mockSpawnFn,
      agentsDir,
    });
    expect(result.exitCode).toBe(0);
  });

  it("returns exitCode 1 when validateMode=smoke and all pings fail", async () => {
    const mockSpawnFn = (_cmd: string, args: string[]) => {
      if (args[0] === "-p") {
        return { exitCode: 1, stdout: Buffer.from(""), stderr: Buffer.from("error") } as any;
      }
      return { exitCode: 0, stdout: Buffer.from("ok"), stderr: Buffer.from("") } as any;
    };

    populateAgents(agentsDir, PROFILE_A);

    const result = await runApply({
      profile: "A",
      validateMode: "smoke",
      spawnFn: mockSpawnFn,
      agentsDir,
    });
    expect(result.exitCode).toBe(1);
  });

  it("output message references profile letter on success", async () => {
    const mockSpawnFn = (_cmd: string, _args: string[]) =>
      ({ exitCode: 0, stdout: Buffer.from("ok"), stderr: Buffer.from("") } as any);

    populateAgents(agentsDir, PROFILE_A);

    const result = await runApply({
      profile: "B",
      validateMode: "none",
      spawnFn: mockSpawnFn,
      agentsDir,
    });
    expect(result.output).toContain("B");
  });

  it("output message references profile letter on validation failure", async () => {
    const mockSpawnFn = (_cmd: string, args: string[]) => {
      if (args[0] === "-p") {
        return { exitCode: 1, stdout: Buffer.from(""), stderr: Buffer.from("error") } as any;
      }
      return { exitCode: 0, stdout: Buffer.from("ok"), stderr: Buffer.from("") } as any;
    };

    populateAgents(agentsDir, PROFILE_A);

    const result = await runApply({
      profile: "A",
      validateMode: "smoke",
      spawnFn: mockSpawnFn,
      agentsDir,
    });
    expect(result.output).toContain("A");
    expect(result.exitCode).toBe(1);
  });

  // -------------------------------------------------------------------------
  // Profile C — user setup path: writes modelRoles + fallbackChains + 24 overrides
  // -------------------------------------------------------------------------

  it("runApply profile C WITHOUT agentsDir writes PROFILE_C_ORCHESTRATOR values for modelRoles", async () => {
    const { spawnCalls, mockSpawnFn } = makeUserPathSpawn();

    await runApply({ profile: "C", validateMode: "none", spawnFn: mockSpawnFn });

    const setCall = spawnCalls.find(
      (c) => c.args[0] === "config" && c.args[1] === "set" && c.args[2] === "modelRoles"
    );
    expect(setCall).toBeDefined();
    const merged = JSON.parse(setCall!.args[3]);
    expect(merged.default).toBe(PROFILE_C_ORCHESTRATOR.default);
    expect(merged.title).toBe(PROFILE_C_ORCHESTRATOR.title);
  });

  it("runApply profile C WITHOUT agentsDir writes PROFILE_C_FALLBACK_CHAINS", async () => {
    const { spawnCalls, mockSpawnFn } = makeUserPathSpawn();

    await runApply({ profile: "C", validateMode: "none", spawnFn: mockSpawnFn });

    const setCall = spawnCalls.find(
      (c) => c.args[0] === "config" && c.args[1] === "set" && c.args[2] === "retry.fallbackChains"
    );
    expect(setCall).toBeDefined();
    const merged = JSON.parse(setCall!.args[3]);
    expect(merged.default).toEqual(PROFILE_C_FALLBACK_CHAINS.default);
    expect(merged.title).toEqual(PROFILE_C_FALLBACK_CHAINS.title);
  });

  it("runApply profile C WITHOUT agentsDir writes all 24 task.agentModelOverrides entries", async () => {
    // Serve valid record for task.agentModelOverrides get calls too
    const spawnCalls: Array<{ cmd: string; args: string[] }> = [];
    const mockSpawnFn = (cmd: string, args: string[]) => {
      spawnCalls.push({ cmd, args });
      if (args[0] === "config" && args[1] === "get" && args[2] === "modelRoles") {
        return {
          exitCode: 0,
          stdout: Buffer.from(JSON.stringify({ key: "modelRoles", value: {}, type: "record", description: "" })),
          stderr: Buffer.from(""),
        } as any;
      }
      if (args[0] === "config" && args[1] === "get" && args[2] === "retry.fallbackChains") {
        return {
          exitCode: 0,
          stdout: Buffer.from(JSON.stringify({ key: "retry.fallbackChains", value: {}, type: "record", description: "" })),
          stderr: Buffer.from(""),
        } as any;
      }
      if (args[0] === "config" && args[1] === "get" && args[2] === "task.agentModelOverrides") {
        return {
          exitCode: 0,
          stdout: Buffer.from(JSON.stringify({ key: "task.agentModelOverrides", value: {}, type: "record", description: "" })),
          stderr: Buffer.from(""),
        } as any;
      }
      return { exitCode: 0, stdout: Buffer.from("ok"), stderr: Buffer.from("") } as any;
    };

    await runApply({ profile: "C", validateMode: "none", spawnFn: mockSpawnFn });

    const overrideWrites = spawnCalls.filter(
      (c) => c.args[0] === "config" && c.args[1] === "set" && c.args[2] === "task.agentModelOverrides"
    );
    // One set call for the bulk write (all 24 roles in one call)
    expect(overrideWrites.length).toBe(1);
    const written = JSON.parse(overrideWrites[0].args[3]);
    // All 24 pi-oven:* keys must be present with correct anthropic models
    for (const role of ROLES) {
      expect(written[`pi-oven:${role}`]).toBe(PROFILE_C[role].primary);
    }
  });

  it("runApply profile C WITHOUT agentsDir: specific roles have correct anthropic models", async () => {
    const spawnCalls: Array<{ cmd: string; args: string[] }> = [];
    const mockSpawnFn = (cmd: string, args: string[]) => {
      spawnCalls.push({ cmd, args });
      if (args[0] === "config" && args[1] === "get" && args[2] === "modelRoles") {
        return {
          exitCode: 0,
          stdout: Buffer.from(JSON.stringify({ key: "modelRoles", value: {}, type: "record", description: "" })),
          stderr: Buffer.from(""),
        } as any;
      }
      if (args[0] === "config" && args[1] === "get" && args[2] === "retry.fallbackChains") {
        return {
          exitCode: 0,
          stdout: Buffer.from(JSON.stringify({ key: "retry.fallbackChains", value: {}, type: "record", description: "" })),
          stderr: Buffer.from(""),
        } as any;
      }
      if (args[0] === "config" && args[1] === "get" && args[2] === "task.agentModelOverrides") {
        return {
          exitCode: 0,
          stdout: Buffer.from(JSON.stringify({ key: "task.agentModelOverrides", value: {}, type: "record", description: "" })),
          stderr: Buffer.from(""),
        } as any;
      }
      return { exitCode: 0, stdout: Buffer.from("ok"), stderr: Buffer.from("") } as any;
    };

    await runApply({ profile: "C", validateMode: "none", spawnFn: mockSpawnFn });

    const overrideWrite = spawnCalls.find(
      (c) => c.args[0] === "config" && c.args[1] === "set" && c.args[2] === "task.agentModelOverrides"
    );
    const written = JSON.parse(overrideWrite!.args[3]);
    // critic (xhigh) → opus-4-8
    expect(written["pi-oven:critic"]).toBe("anthropic/claude-opus-4-8");
    // explorer (medium) → sonnet-4-6
    expect(written["pi-oven:explorer"]).toBe("anthropic/claude-sonnet-4-6");
    // git-master (low) → sonnet-4-6 (haiku-4-5 disabled on this account)
    expect(written["pi-oven:git-master"]).toBe("anthropic/claude-sonnet-4-6");
    // qa-tester (high thinkingLevel, strict tier → opus-4-8)
    expect(written["pi-oven:qa-tester"]).toBe("anthropic/claude-opus-4-8");
  });

  it("runApply profile A still writes ZERO task.agentModelOverrides (A non-regression)", async () => {
    const { spawnCalls, mockSpawnFn } = makeUserPathSpawn();

    await runApply({ profile: "A", validateMode: "none", spawnFn: mockSpawnFn });

    const overrideWrites = spawnCalls.filter(
      (c) => c.args[0] === "config" && c.args[1] === "set" && c.args[2] === "task.agentModelOverrides"
    );
    expect(overrideWrites.length).toBe(0);
  });

  // -------------------------------------------------------------------------
  // Profile B — user setup path: writes modelRoles + fallbackChains + 24 overrides
  // -------------------------------------------------------------------------

  it("runApply profile B WITHOUT agentsDir writes all 24 task.agentModelOverrides entries with openai-codex/ models", async () => {
    const spawnCalls: Array<{ cmd: string; args: string[] }> = [];
    const mockSpawnFn = (cmd: string, args: string[]) => {
      spawnCalls.push({ cmd, args });
      if (args[0] === "config" && args[1] === "get" && args[2] === "modelRoles") {
        return {
          exitCode: 0,
          stdout: Buffer.from(JSON.stringify({ key: "modelRoles", value: {}, type: "record", description: "" })),
          stderr: Buffer.from(""),
        } as any;
      }
      if (args[0] === "config" && args[1] === "get" && args[2] === "retry.fallbackChains") {
        return {
          exitCode: 0,
          stdout: Buffer.from(JSON.stringify({ key: "retry.fallbackChains", value: {}, type: "record", description: "" })),
          stderr: Buffer.from(""),
        } as any;
      }
      if (args[0] === "config" && args[1] === "get" && args[2] === "task.agentModelOverrides") {
        return {
          exitCode: 0,
          stdout: Buffer.from(JSON.stringify({ key: "task.agentModelOverrides", value: {}, type: "record", description: "" })),
          stderr: Buffer.from(""),
        } as any;
      }
      return { exitCode: 0, stdout: Buffer.from("ok"), stderr: Buffer.from("") } as any;
    };

    await runApply({ profile: "B", validateMode: "none", spawnFn: mockSpawnFn });

    const overrideWrites = spawnCalls.filter(
      (c) => c.args[0] === "config" && c.args[1] === "set" && c.args[2] === "task.agentModelOverrides"
    );
    // One set call for the bulk write (all 24 roles in one call)
    expect(overrideWrites.length).toBe(1);
    const written = JSON.parse(overrideWrites[0].args[3]);
    // All 24 pi-oven:* keys must be present with PROFILE_B model selectors
    // including reasoning effort suffixes.
    for (const role of ROLES) {
      expect(written[`pi-oven:${role}`]).toBe(`${PROFILE_B[role].primary}:${PROFILE_B[role].thinkingLevel}`);
    }
    // All models must start with "openai-codex/"
    for (const role of ROLES) {
      expect(written[`pi-oven:${role}`]).toMatch(/^openai-codex\//);
    }
  });

  it("runApply profile B WITHOUT agentsDir writes PROFILE_B_ORCHESTRATOR + PROFILE_B_FALLBACK_CHAINS", async () => {
    const spawnCalls: Array<{ cmd: string; args: string[] }> = [];
    const mockSpawnFn = (cmd: string, args: string[]) => {
      spawnCalls.push({ cmd, args });
      if (args[0] === "config" && args[1] === "get" && args[2] === "modelRoles") {
        return {
          exitCode: 0,
          stdout: Buffer.from(JSON.stringify({ key: "modelRoles", value: {}, type: "record", description: "" })),
          stderr: Buffer.from(""),
        } as any;
      }
      if (args[0] === "config" && args[1] === "get" && args[2] === "retry.fallbackChains") {
        return {
          exitCode: 0,
          stdout: Buffer.from(JSON.stringify({ key: "retry.fallbackChains", value: {}, type: "record", description: "" })),
          stderr: Buffer.from(""),
        } as any;
      }
      if (args[0] === "config" && args[1] === "get" && args[2] === "task.agentModelOverrides") {
        return {
          exitCode: 0,
          stdout: Buffer.from(JSON.stringify({ key: "task.agentModelOverrides", value: {}, type: "record", description: "" })),
          stderr: Buffer.from(""),
        } as any;
      }
      return { exitCode: 0, stdout: Buffer.from("ok"), stderr: Buffer.from("") } as any;
    };

    await runApply({ profile: "B", validateMode: "none", spawnFn: mockSpawnFn });

    // modelRoles write
    const modelRolesCall = spawnCalls.find(
      (c) => c.args[0] === "config" && c.args[1] === "set" && c.args[2] === "modelRoles"
    );
    expect(modelRolesCall).toBeDefined();
    const mergedRoles = JSON.parse(modelRolesCall!.args[3]);
    expect(mergedRoles.default).toBe(PROFILE_B_ORCHESTRATOR.default);
    expect(mergedRoles.title).toBe(PROFILE_B_ORCHESTRATOR.title);

    // retry.fallbackChains write
    const fallbackCall = spawnCalls.find(
      (c) => c.args[0] === "config" && c.args[1] === "set" && c.args[2] === "retry.fallbackChains"
    );
    expect(fallbackCall).toBeDefined();
    const mergedChains = JSON.parse(fallbackCall!.args[3]);
    expect(mergedChains.default).toEqual(PROFILE_B_FALLBACK_CHAINS.default);
    expect(mergedChains.title).toEqual(PROFILE_B_FALLBACK_CHAINS.title);
  });

  it("runApply profile B WITHOUT agentsDir: specific roles have correct openai-codex models", async () => {
    const spawnCalls: Array<{ cmd: string; args: string[] }> = [];
    const mockSpawnFn = (cmd: string, args: string[]) => {
      spawnCalls.push({ cmd, args });
      if (args[0] === "config" && args[1] === "get" && args[2] === "modelRoles") {
        return {
          exitCode: 0,
          stdout: Buffer.from(JSON.stringify({ key: "modelRoles", value: {}, type: "record", description: "" })),
          stderr: Buffer.from(""),
        } as any;
      }
      if (args[0] === "config" && args[1] === "get" && args[2] === "retry.fallbackChains") {
        return {
          exitCode: 0,
          stdout: Buffer.from(JSON.stringify({ key: "retry.fallbackChains", value: {}, type: "record", description: "" })),
          stderr: Buffer.from(""),
        } as any;
      }
      if (args[0] === "config" && args[1] === "get" && args[2] === "task.agentModelOverrides") {
        return {
          exitCode: 0,
          stdout: Buffer.from(JSON.stringify({ key: "task.agentModelOverrides", value: {}, type: "record", description: "" })),
          stderr: Buffer.from(""),
        } as any;
      }
      return { exitCode: 0, stdout: Buffer.from("ok"), stderr: Buffer.from("") } as any;
    };

    await runApply({ profile: "B", validateMode: "none", spawnFn: mockSpawnFn });

    const overrideWrite = spawnCalls.find(
      (c) => c.args[0] === "config" && c.args[1] === "set" && c.args[2] === "task.agentModelOverrides"
    );
    const written = JSON.parse(overrideWrite!.args[3]);
    // critic (xhigh review) → gpt-5.5:xhigh
    expect(written["pi-oven:critic"]).toBe("openai-codex/gpt-5.5:xhigh");
    // explorer (medium fan-out) → gpt-5.4:medium
    expect(written["pi-oven:explorer"]).toBe("openai-codex/gpt-5.4:medium");
    // git-master (medium mechanical) → gpt-5.4:medium
    expect(written["pi-oven:git-master"]).toBe("openai-codex/gpt-5.4:medium");
    // executor (high implementation) → gpt-5.5:high
    expect(written["pi-oven:executor"]).toBe("openai-codex/gpt-5.5:high");
    // architect (xhigh architecture) → gpt-5.5:xhigh
    expect(written["pi-oven:architect"]).toBe("openai-codex/gpt-5.5:xhigh");
  });

  // -------------------------------------------------------------------------
  // Profile D — user setup path: writes modelRoles + fallbackChains + 24 overrides (all opencode-zen/)
  // -------------------------------------------------------------------------

  function makeProfileDSpawn() {
    const spawnCalls: Array<{ cmd: string; args: string[] }> = [];
    const mockSpawnFn = (cmd: string, args: string[]) => {
      spawnCalls.push({ cmd, args });
      if (args[0] === "config" && args[1] === "get" && args[2] === "modelRoles") {
        return {
          exitCode: 0,
          stdout: Buffer.from(JSON.stringify({ key: "modelRoles", value: {}, type: "record", description: "" })),
          stderr: Buffer.from(""),
        } as any;
      }
      if (args[0] === "config" && args[1] === "get" && args[2] === "retry.fallbackChains") {
        return {
          exitCode: 0,
          stdout: Buffer.from(JSON.stringify({ key: "retry.fallbackChains", value: {}, type: "record", description: "" })),
          stderr: Buffer.from(""),
        } as any;
      }
      if (args[0] === "config" && args[1] === "get" && args[2] === "task.agentModelOverrides") {
        return {
          exitCode: 0,
          stdout: Buffer.from(JSON.stringify({ key: "task.agentModelOverrides", value: {}, type: "record", description: "" })),
          stderr: Buffer.from(""),
        } as any;
      }
      return { exitCode: 0, stdout: Buffer.from("ok"), stderr: Buffer.from("") } as any;
    };
    return { spawnCalls, mockSpawnFn };
  }

  it("runApply profile D WITHOUT agentsDir writes PROFILE_D_ORCHESTRATOR values for modelRoles", async () => {
    const { spawnCalls, mockSpawnFn } = makeProfileDSpawn();

    await runApply({ profile: "D", validateMode: "none", spawnFn: mockSpawnFn });

    const setCall = spawnCalls.find(
      (c) => c.args[0] === "config" && c.args[1] === "set" && c.args[2] === "modelRoles"
    );
    expect(setCall).toBeDefined();
    const merged = JSON.parse(setCall!.args[3]);
    expect(merged.default).toBe(PROFILE_D_ORCHESTRATOR.default);
    expect(merged.title).toBe(PROFILE_D_ORCHESTRATOR.title);
  });

  it("runApply profile D WITHOUT agentsDir writes PROFILE_D_FALLBACK_CHAINS", async () => {
    const { spawnCalls, mockSpawnFn } = makeProfileDSpawn();

    await runApply({ profile: "D", validateMode: "none", spawnFn: mockSpawnFn });

    const setCall = spawnCalls.find(
      (c) => c.args[0] === "config" && c.args[1] === "set" && c.args[2] === "retry.fallbackChains"
    );
    expect(setCall).toBeDefined();
    const merged = JSON.parse(setCall!.args[3]);
    expect(merged.default).toEqual(PROFILE_D_FALLBACK_CHAINS.default);
    expect(merged.title).toEqual(PROFILE_D_FALLBACK_CHAINS.title);
  });

  it("runApply profile D WITHOUT agentsDir writes all 24 task.agentModelOverrides all startsWith opencode-zen/", async () => {
    const { spawnCalls, mockSpawnFn } = makeProfileDSpawn();

    await runApply({ profile: "D", validateMode: "none", spawnFn: mockSpawnFn });

    const overrideWrites = spawnCalls.filter(
      (c) => c.args[0] === "config" && c.args[1] === "set" && c.args[2] === "task.agentModelOverrides"
    );
    expect(overrideWrites.length).toBe(1);
    const written = JSON.parse(overrideWrites[0].args[3]);
    for (const role of ROLES) {
      expect(written[`pi-oven:${role}`]).toBe(PROFILE_D[role].primary);
      expect(written[`pi-oven:${role}`]).toMatch(/^opencode-zen\//);
    }
  });

  it("runApply profile A still writes ZERO task.agentModelOverrides after D support added (non-regression)", async () => {
    const { spawnCalls, mockSpawnFn } = makeUserPathSpawn();

    await runApply({ profile: "A", validateMode: "none", spawnFn: mockSpawnFn });

    const overrideWrites = spawnCalls.filter(
      (c) => c.args[0] === "config" && c.args[1] === "set" && c.args[2] === "task.agentModelOverrides"
    );
    expect(overrideWrites.length).toBe(0);
  });

  // -------------------------------------------------------------------------
  // Prong 2 — global scope enables gated tools; project scope does NOT
  // -------------------------------------------------------------------------

  it("global scope enables tools (inspect_image etc); project scope does not", async () => {
    const calls: string[][] = [];
    const spawnFn = (_c: string, a: string[]) => {
      calls.push(a);
      if (a[0] === "config" && a[1] === "get") {
        return { exitCode: 0, stdout: Buffer.from(JSON.stringify({ key: a[2], value: {}, type: "record" })) };
      }
      return { exitCode: 0, stdout: Buffer.from("") };
    };
    const result = await runApply({ profile: "A", validateMode: "none", spawnFn }); // global default
    expect(calls).toContainEqual(["config", "set", "task.enableLsp", "true"]);
    expect(result.output).toContain("✓ tools enabled:");

    const projectCwd = makeTempDir();
    const calls2: string[][] = [];
    const spawnFn2 = (_c: string, a: string[]) => {
      calls2.push(a);
      return { exitCode: 0, stdout: Buffer.from("") };
    };
    await runApply({ profile: "A", validateMode: "none", scope: "project", cwd: projectCwd, spawnFn: spawnFn2 });
    expect(calls2.some((a) => a[0] === "config" && a[1] === "set")).toBe(false);
  });
});

describe("runRepairPrereqs", () => {
  it("writes only machine-global prerequisites and no routing keys", async () => {
    const spawnCalls: Array<{ cmd: string; args: string[] }> = [];
    const spawnFn = (cmd: string, args: string[]) => {
      spawnCalls.push({ cmd, args });
      return { exitCode: 0, stdout: Buffer.from("ok"), stderr: Buffer.from("") } as any;
    };

    const result = await runRepairPrereqs({ spawnFn });

    expect(result.exitCode).toBe(0);
    const configSetKeys = spawnCalls
      .filter((call) => call.args[0] === "config" && call.args[1] === "set")
      .map((call) => call.args[2])
      .sort();
    expect(configSetKeys).toEqual([
      "astGrep.enabled",
      "async.enabled",
      "browser.enabled",
      "debug.enabled",
      "inspect_image.enabled",
      "lsp.enabled",
      "memory.backend",
      "mnemopi.llmMode",
      "mnemopi.noEmbeddings",
      "task.enableLsp",
      "web_search.enabled",
    ]);
    expect(configSetKeys).not.toContain("modelRoles");
    expect(configSetKeys).not.toContain("retry.fallbackChains");
    expect(configSetKeys).not.toContain("task.agentModelOverrides");
  });
});

// ---------------------------------------------------------------------------
// scope:"project" — writes to <cwd>/.omp/settings.json, ZERO omp config calls
// ---------------------------------------------------------------------------

describe("runApply — scope:project (writes .omp/settings.json)", () => {
  let cwd: string;

  beforeEach(() => {
    cwd = join(
      tmpdir(),
      `apply-project-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    mkdirSync(cwd, { recursive: true });
  });

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  // A spawnFn that records EVERY call so we can assert project scope does not
  // mutate the global config even if it performs read-only truth-surface probes.
  function makeRecordingSpawn() {
    const spawnCalls: Array<{ cmd: string; args: string[] }> = [];
    const mockSpawnFn = (cmd: string, args: string[]) => {
      spawnCalls.push({ cmd, args });
      // Validation pings (-p) succeed; read-only display probes may call
      // `omp config get`, but project scope must never call `omp config set`.
      return { exitCode: 0, stdout: Buffer.from("ok"), stderr: Buffer.from("") } as any;
    };
    return { spawnCalls, mockSpawnFn };
  }

  it("profile A writes all 24 overrides to the project file (NOT global), with NO omp config set", async () => {
    const { spawnCalls, mockSpawnFn } = makeRecordingSpawn();

    const result = await runApply({
      profile: "A",
      validateMode: "none",
      spawnFn: mockSpawnFn,
      scope: "project",
      cwd,
    });
    expect(result.exitCode).toBe(0);

    // All 24 per-role overrides land in the project file for Profile A.
    const overrides = await readProjectAgentModelOverrides({ cwd });
    for (const role of ROLES) {
      expect(overrides[`pi-oven:${role}`]).toBe(PROFILE_A[role].primary);
    }

    const configSetCalls = spawnCalls.filter((c) => c.args[0] === "config" && c.args[1] === "set");
    expect(configSetCalls.length).toBe(0);
  });

  it("profile B writes model selectors with thinkingLevel suffixes to the project file", async () => {
    const { spawnCalls, mockSpawnFn } = makeRecordingSpawn();

    await runApply({
      profile: "B",
      validateMode: "none",
      spawnFn: mockSpawnFn,
      scope: "project",
      cwd,
    });

    const overrides = await readProjectAgentModelOverrides({ cwd });
    expect(overrides["pi-oven:critic"]).toBe("openai-codex/gpt-5.5:xhigh");
    expect(overrides["pi-oven:executor"]).toBe("openai-codex/gpt-5.5:high");
    expect(overrides["pi-oven:architect"]).toBe("openai-codex/gpt-5.5:xhigh");
    expect(overrides["pi-oven:explorer"]).toBe("openai-codex/gpt-5.4:medium");

    const configSetCalls = spawnCalls.filter((c) => c.args[0] === "config" && c.args[1] === "set");
    expect(configSetCalls.length).toBe(0);
  });

  it("profile A writes modelRoles + retry.fallbackChains to the project file", async () => {
    const { mockSpawnFn } = makeRecordingSpawn();

    await runApply({
      profile: "A",
      validateMode: "none",
      spawnFn: mockSpawnFn,
      scope: "project",
      cwd,
    });

    const data = (await readProjectSettingsSoft({ cwd })) as any;
    expect(data.modelRoles.default).toBe(PROFILE_A_ORCHESTRATOR.default);
    expect(data.modelRoles.title).toBe(PROFILE_A_ORCHESTRATOR.title);
    expect(data.retry.fallbackChains.default).toEqual(PROFILE_A_FALLBACK_CHAINS.default);
    expect(data.retry.fallbackChains.title).toEqual(PROFILE_A_FALLBACK_CHAINS.title);
  });

  it("profile D writes all 24 overrides + modelRoles + retry to the project file, ZERO omp config set", async () => {
    const { spawnCalls, mockSpawnFn } = makeRecordingSpawn();

    await runApply({
      profile: "D",
      validateMode: "none",
      spawnFn: mockSpawnFn,
      scope: "project",
      cwd,
    });

    const overrides = await readProjectAgentModelOverrides({ cwd });
    for (const role of ROLES) {
      expect(overrides[`pi-oven:${role}`]).toBe(PROFILE_D[role].primary);
      expect(overrides[`pi-oven:${role}`]).toMatch(/^opencode-zen\//);
    }
    const data = (await readProjectSettingsSoft({ cwd })) as any;
    expect(data.modelRoles.default).toBe(PROFILE_D_ORCHESTRATOR.default);
    expect(data.retry.fallbackChains.default).toEqual(PROFILE_D_FALLBACK_CHAINS.default);

    const configSetCalls = spawnCalls.filter((c) => c.args[0] === "config" && c.args[1] === "set");
    expect(configSetCalls.length).toBe(0);
  });

  it("project scope does NOT write the memory/async infra (no config set memory.backend)", async () => {
    const { spawnCalls, mockSpawnFn } = makeRecordingSpawn();

    await runApply({
      profile: "A",
      validateMode: "none",
      spawnFn: mockSpawnFn,
      scope: "project",
      cwd,
    });

    const memoryCalls = spawnCalls.filter(
      (c) => c.args[0] === "config" && c.args[1] === "set" && typeof c.args[2] === "string" && c.args[2].startsWith("memory.")
    );
    expect(memoryCalls.length).toBe(0);
  });

  it("preserves a hand-authored sibling top-level key in the project file", async () => {
    mkdirSync(join(cwd, ".omp"), { recursive: true });
    writeFileSync(
      projectSettingsPath(cwd),
      JSON.stringify({ extensions: ["keep-me"] }, null, 2) + "\n",
      "utf-8"
    );
    const { mockSpawnFn } = makeRecordingSpawn();

    await runApply({
      profile: "A",
      validateMode: "none",
      spawnFn: mockSpawnFn,
      scope: "project",
      cwd,
    });

    const data = (await readProjectSettingsSoft({ cwd })) as any;
    expect(data.extensions).toEqual(["keep-me"]);
  });

  it("output names the project file + scope", async () => {
    const { mockSpawnFn } = makeRecordingSpawn();
    const result = await runApply({
      profile: "A",
      validateMode: "none",
      spawnFn: mockSpawnFn,
      scope: "project",
      cwd,
    });
    expect(result.output).toContain(projectSettingsPath(cwd));
  });

  it("project-scope output tells the user that global prerequisites still need a separate global step and shows the explicit control-plane contract", async () => {
    const { mockSpawnFn } = makeRecordingSpawn();
    const result = await runApply({
      profile: "A",
      validateMode: "none",
      spawnFn: mockSpawnFn,
      scope: "project",
      cwd,
    });

    expect(result.output).toContain("Project scope kept ~/.omp/agent/config.yml untouched.");
    expect(result.output).toContain("Standalone truth surface:");
    expect(result.output).toContain("project-scope remediation");
    expect(result.output).toContain("memory.backend");
    expect(result.output).toContain("async.enabled");
    expect(result.output).toContain("/pi-oven:setup --repair-prereqs");
    expect(result.output).toContain("control-plane front door");
    expect(result.output).toContain("Only temporary adapter boundary remains");
  });

  it("scope:global (default) still writes via omp config and does NOT create a project file", async () => {
    const spawnCalls: Array<{ cmd: string; args: string[] }> = [];
    const mockSpawnFn = (cmd: string, args: string[]) => {
      spawnCalls.push({ cmd, args });
      if (args[0] === "config" && args[1] === "get") {
        return {
          exitCode: 0,
          stdout: Buffer.from(JSON.stringify({ key: args[2], value: {}, type: "record", description: "" })),
          stderr: Buffer.from(""),
        } as any;
      }
      return { exitCode: 0, stdout: Buffer.from("ok"), stderr: Buffer.from("") } as any;
    };

    await runApply({ profile: "A", validateMode: "none", spawnFn: mockSpawnFn, cwd });

    // Global path writes modelRoles via omp config set…
    const modelRoleSets = spawnCalls.filter(
      (c) => c.args[0] === "config" && c.args[1] === "set" && c.args[2] === "modelRoles"
    );
    expect(modelRoleSets.length).toBe(1);
    // …and creates NO project settings file.
    expect(existsSync(projectSettingsPath(cwd))).toBe(false);
  });
});
