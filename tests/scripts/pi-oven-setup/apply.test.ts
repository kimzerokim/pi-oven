import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { runApply } from "../../../scripts/pi-oven-setup/apply";
import { ROLES, PROFILE_A, PROFILE_B } from "../../../scripts/pi-oven-setup/profiles";
import { readAgentFiles } from "../../../scripts/pi-oven-setup/agent-rewriter";

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
tools: ["*"]
blocked_tools: []
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
  // sibling key to assert preservation), and exit-0 for every other call.
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
    expect(merged.default).toBe("gpt-5.4:high");
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
    expect(merged.default).toBe("gpt-5.4:high");
    expect(merged.title).toBe("gpt-5.4-mini:low");
  });

  it("runApply WITHOUT agentsDir writes PROFILE_B orchestrator values for profile B", async () => {
    const { spawnCalls, mockSpawnFn } = makeUserPathSpawn();

    await runApply({ profile: "B", validateMode: "none", spawnFn: mockSpawnFn });

    const setCall = spawnCalls.find(
      (c) => c.args[0] === "config" && c.args[1] === "set" && c.args[2] === "modelRoles"
    );
    const merged = JSON.parse(setCall!.args[3]);
    expect(merged.default).toBe("anthropic/claude-opus-4-7:high");
    expect(merged.title).toBe("anthropic/claude-haiku-4-5:low");
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
});
