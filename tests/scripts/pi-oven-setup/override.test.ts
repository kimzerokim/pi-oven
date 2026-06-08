/**
 * Tests for scripts/pi-oven-setup/override.ts
 * TDD red phase — written before implementation.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { runOverride } from "../../../scripts/pi-oven-setup/override";
import {
  projectSettingsPath,
  readProjectAgentModelOverrides,
} from "../../../scripts/pi-oven-setup/project-settings";

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

/** Minimal `omp --list-models` fixture that includes two resolvable models. */
const LIST_MODELS_FIXTURE = [
  "Canonical models",
  "  canonical  selected                              provider",
  "  1          opencode-zen/gpt-5.3-codex            opencode-zen",
  "  2          openai-codex/gpt-5.3-codex            openai-codex",
  "  3          anthropic/claude-opus-4-8             anthropic",
  "  4          opencode-zen/claude-opus-4-8          opencode-zen",
  "",
].join("\n");

/**
 * Build a spawnFn that:
 *  - returns a valid empty-record get response for `omp config get ...`
 *  - captures `omp config set ...` args into `setCalls`
 *  - returns exit 0 for `omp --list-models` (should not be called; spawnFn is NOT used for list-models when listModelsOutput is injected)
 */
function makeSpawnFn(opts: {
  getRecord?: Record<string, string>;
  setExitCode?: number;
  setCalls?: Array<{ args: string[] }>;
}): (cmd: string, args: string[]) => { exitCode: number; stdout: Buffer; stderr: Buffer } {
  const getCalls = opts.setCalls ?? [];
  return (cmd: string, args: string[]) => {
    if (args[0] === "config" && args[1] === "get") {
      const record = opts.getRecord ?? {};
      const payload = JSON.stringify({
        key: args[2],
        value: record,
        type: "record",
        description: "",
      });
      return { exitCode: 0, stdout: Buffer.from(payload), stderr: Buffer.from("") };
    }
    if (args[0] === "config" && args[1] === "set") {
      getCalls.push({ args: [cmd, ...args] });
      return {
        exitCode: opts.setExitCode ?? 0,
        stdout: Buffer.from(""),
        stderr: Buffer.from(""),
      };
    }
    // fallback
    return { exitCode: 0, stdout: Buffer.from(""), stderr: Buffer.from("") };
  };
}

// ---------------------------------------------------------------------------
// Happy path
// ---------------------------------------------------------------------------

describe("runOverride — happy path", () => {
  it("standalone --override critic=<model> sets config via omp and exits 0", async () => {
    const setCalls: Array<{ args: string[] }> = [];
    const spawnFn = makeSpawnFn({ setCalls });

    const result = await runOverride({
      entries: ["critic=anthropic/claude-opus-4-8"],
      listModelsOutput: LIST_MODELS_FIXTURE,
      spawnFn,
    });

    expect(result.exitCode).toBe(0);
    expect(setCalls.length).toBe(1);
    const capturedJson = JSON.parse(setCalls[0].args[4]); // args: [omp, config, set, task.agentModelOverrides, <json>]
    expect(capturedJson["pi-oven:critic"]).toBe("anthropic/claude-opus-4-8");
  });

  it("two --override entries both persist (MERGE)", async () => {
    const setCalls: Array<{ args: string[] }> = [];
    const spawnFn = makeSpawnFn({ setCalls });

    const result = await runOverride({
      entries: ["critic=anthropic/claude-opus-4-8", "executor=opencode-zen/gpt-5.3-codex"],
      listModelsOutput: LIST_MODELS_FIXTURE,
      spawnFn,
    });

    expect(result.exitCode).toBe(0);
    // Two set calls (one per entry), or one merged — plan says "순차 MERGE write" → each entry writes individually
    // The final captured json must include both keys (last call wins for critic, executor added)
    const lastSetJson = JSON.parse(setCalls[setCalls.length - 1].args[4]);
    // After two sequential merges, the last set should have both keys
    // First call sets critic, second call reads updated record and sets executor
    // But in the mock, getRecord is always {}, so each set sees {}. The test verifies
    // that BOTH calls happened and that applied[] contains both entries.
    expect(result.applied.map((a) => a.colonKey)).toContain("pi-oven:critic");
    expect(result.applied.map((a) => a.colonKey)).toContain("pi-oven:executor");
    expect(setCalls.length).toBe(2);
    // Each call writes its own merged json with the key
    expect(JSON.parse(setCalls[0].args[4])["pi-oven:critic"]).toBe("anthropic/claude-opus-4-8");
    expect(JSON.parse(setCalls[1].args[4])["pi-oven:executor"]).toBe("opencode-zen/gpt-5.3-codex");
  });

  it("preserves sibling (non-pi-oven:*) keys in the record", async () => {
    const setCalls: Array<{ args: string[] }> = [];
    const spawnFn = makeSpawnFn({
      getRecord: { "claude-code:foo": "somemodel" },
      setCalls,
    });

    await runOverride({
      entries: ["critic=anthropic/claude-opus-4-8"],
      listModelsOutput: LIST_MODELS_FIXTURE,
      spawnFn,
    });

    const capturedJson = JSON.parse(setCalls[0].args[4]);
    expect(capturedJson["claude-code:foo"]).toBe("somemodel");
    expect(capturedJson["pi-oven:critic"]).toBe("anthropic/claude-opus-4-8");
  });

  it("role with hyphen (code-reviewer) maps to pi-oven:code-reviewer", async () => {
    const setCalls: Array<{ args: string[] }> = [];
    const spawnFn = makeSpawnFn({ setCalls });

    const result = await runOverride({
      entries: ["code-reviewer=opencode-zen/gpt-5.3-codex"],
      listModelsOutput: LIST_MODELS_FIXTURE,
      spawnFn,
    });

    expect(result.exitCode).toBe(0);
    const capturedJson = JSON.parse(setCalls[0].args[4]);
    expect(capturedJson["pi-oven:code-reviewer"]).toBe("opencode-zen/gpt-5.3-codex");
  });

  it("returns applied array with colonKey and model for each successful entry", async () => {
    const spawnFn = makeSpawnFn({});

    const result = await runOverride({
      entries: ["executor=opencode-zen/gpt-5.3-codex"],
      listModelsOutput: LIST_MODELS_FIXTURE,
      spawnFn,
    });

    expect(result.exitCode).toBe(0);
    expect(result.applied).toHaveLength(1);
    expect(result.applied[0].colonKey).toBe("pi-oven:executor");
    expect(result.applied[0].model).toBe("opencode-zen/gpt-5.3-codex");
  });
});

// ---------------------------------------------------------------------------
// Error: malformed entries (Bc-1) — exit 1, ZERO writes
// ---------------------------------------------------------------------------

describe("runOverride — malformed entries (exit 1, no write)", () => {
  it("entry with no '=' exits 1 and does not call config set", async () => {
    const setCalls: Array<{ args: string[] }> = [];
    const spawnFn = makeSpawnFn({ setCalls });

    const result = await runOverride({
      entries: ["critic"],
      listModelsOutput: LIST_MODELS_FIXTURE,
      spawnFn,
    });

    expect(result.exitCode).toBe(1);
    expect(result.output).toMatch(/invalid.*--override.*expected.*=.*model/i);
    expect(setCalls.length).toBe(0);
  });

  it("entry with empty role (=model) exits 1 and does not write", async () => {
    const setCalls: Array<{ args: string[] }> = [];
    const spawnFn = makeSpawnFn({ setCalls });

    const result = await runOverride({
      entries: ["=anthropic/claude-opus-4-8"],
      listModelsOutput: LIST_MODELS_FIXTURE,
      spawnFn,
    });

    expect(result.exitCode).toBe(1);
    expect(setCalls.length).toBe(0);
  });

  it("entry with empty model (critic=) exits 1 and does not write", async () => {
    const setCalls: Array<{ args: string[] }> = [];
    const spawnFn = makeSpawnFn({ setCalls });

    const result = await runOverride({
      entries: ["critic="],
      listModelsOutput: LIST_MODELS_FIXTURE,
      spawnFn,
    });

    expect(result.exitCode).toBe(1);
    expect(setCalls.length).toBe(0);
  });

  it("role not in ROLES exits 1 and does not write", async () => {
    const setCalls: Array<{ args: string[] }> = [];
    const spawnFn = makeSpawnFn({ setCalls });

    const result = await runOverride({
      entries: ["unknownrole=anthropic/claude-opus-4-8"],
      listModelsOutput: LIST_MODELS_FIXTURE,
      spawnFn,
    });

    expect(result.exitCode).toBe(1);
    expect(setCalls.length).toBe(0);
  });

  it("invalid model id exits 1 and does not call set", async () => {
    const setCalls: Array<{ args: string[] }> = [];
    const spawnFn = makeSpawnFn({ setCalls });

    const result = await runOverride({
      entries: ["critic=anthropic/claude-opus-4-7"], // not in fixture
      listModelsOutput: LIST_MODELS_FIXTURE,
      spawnFn,
    });

    expect(result.exitCode).toBe(1);
    expect(setCalls.length).toBe(0);
  });

  it("first entry valid, second malformed: exits 1, ZERO writes (validate-all-then-write-all)", async () => {
    const setCalls: Array<{ args: string[] }> = [];
    const spawnFn = makeSpawnFn({ setCalls });

    const result = await runOverride({
      entries: ["critic=anthropic/claude-opus-4-8", "unknownrole=anthropic/claude-opus-4-8"],
      listModelsOutput: LIST_MODELS_FIXTURE,
      spawnFn,
    });

    expect(result.exitCode).toBe(1);
    expect(setCalls.length).toBe(0); // partial write forbidden
  });
});

// ---------------------------------------------------------------------------
// standalone --override does not touch agents/ or lock file
// ---------------------------------------------------------------------------

describe("runOverride — no agents/ or plugin-config write", () => {
  it("does not spawn omp plugin config set", async () => {
    const allCalls: Array<string[]> = [];
    const spawnFn = (cmd: string, args: string[]) => {
      allCalls.push([cmd, ...args]);
      if (args[0] === "config" && args[1] === "get") {
        return {
          exitCode: 0,
          stdout: Buffer.from(JSON.stringify({ key: args[2], value: {}, type: "record", description: "" })),
          stderr: Buffer.from(""),
        };
      }
      return { exitCode: 0, stdout: Buffer.from(""), stderr: Buffer.from("") };
    };

    await runOverride({
      entries: ["executor=opencode-zen/gpt-5.3-codex"],
      listModelsOutput: LIST_MODELS_FIXTURE,
      spawnFn,
    });

    const pluginConfigCalls = allCalls.filter((c) => c.includes("plugin") && c.includes("config") && c.includes("set"));
    expect(pluginConfigCalls.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// AC#2 integration: stateful get→merge→set round-trip preserves siblings
// ---------------------------------------------------------------------------

describe("runOverride — stateful merge round-trip (AC#2)", () => {
  it("two entries: each set reflects previous write; non-pi-oven sibling survives all writes", async () => {
    // Seed with a pre-existing non-pi-oven sibling key
    let storedRecord: Record<string, string> = { "claude-code:foo": "existingmodel" };

    const spawnFn = (cmd: string, args: string[]) => {
      if (args[0] === "config" && args[1] === "get") {
        const payload = JSON.stringify({
          key: args[2],
          value: storedRecord,
          type: "record",
          description: "",
        });
        return { exitCode: 0, stdout: Buffer.from(payload), stderr: Buffer.from("") };
      }
      if (args[0] === "config" && args[1] === "set") {
        // args: ["config", "set", "task.agentModelOverrides", "<json>"]
        storedRecord = JSON.parse(args[3]) as Record<string, string>;
        return { exitCode: 0, stdout: Buffer.from(""), stderr: Buffer.from("") };
      }
      return { exitCode: 0, stdout: Buffer.from(""), stderr: Buffer.from("") };
    };

    const result = await runOverride({
      entries: ["critic=anthropic/claude-opus-4-8", "executor=openai-codex/gpt-5.3-codex"],
      listModelsOutput: LIST_MODELS_FIXTURE,
      spawnFn,
    });

    expect(result.exitCode).toBe(0);
    // Both pi-oven keys persisted in the final stored record
    expect(storedRecord["pi-oven:critic"]).toBe("anthropic/claude-opus-4-8");
    expect(storedRecord["pi-oven:executor"]).toBe("openai-codex/gpt-5.3-codex");
    // Pre-existing non-pi-oven sibling survived all writes
    expect(storedRecord["claude-code:foo"]).toBe("existingmodel");
  });
});

// ---------------------------------------------------------------------------
// scope:"project" — batches all entries into ONE .omp/settings.json write,
// leaves the global config.yml untouched.
// ---------------------------------------------------------------------------

describe("runOverride — scope:project", () => {
  let cwd: string;

  beforeEach(() => {
    cwd = join(
      tmpdir(),
      `override-project-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    mkdirSync(cwd, { recursive: true });
  });

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  it("writes the project file and makes ZERO omp config set/get calls", async () => {
    const calls: string[][] = [];
    const spawnFn = (cmd: string, args: string[]) => {
      calls.push([cmd, ...args]);
      return { exitCode: 0, stdout: Buffer.from(""), stderr: Buffer.from("") };
    };

    const result = await runOverride({
      entries: ["critic=anthropic/claude-opus-4-8", "executor=opencode-zen/gpt-5.3-codex"],
      listModelsOutput: LIST_MODELS_FIXTURE,
      spawnFn,
      scope: "project",
      cwd,
    });

    expect(result.exitCode).toBe(0);

    // Both entries land in the project file in ONE write.
    const overrides = await readProjectAgentModelOverrides({ cwd });
    expect(overrides["pi-oven:critic"]).toBe("anthropic/claude-opus-4-8");
    expect(overrides["pi-oven:executor"]).toBe("opencode-zen/gpt-5.3-codex");

    // The validator may spawn `omp --list-models` only when no listModelsOutput is
    // injected; here it is injected, so no `config` spawn must occur at all.
    const configCalls = calls.filter((c) => c.includes("config"));
    expect(configCalls.length).toBe(0);
  });

  it("applied[] reflects every batched entry", async () => {
    const spawnFn = (_cmd: string, _args: string[]) =>
      ({ exitCode: 0, stdout: Buffer.from(""), stderr: Buffer.from("") });

    const result = await runOverride({
      entries: ["critic=anthropic/claude-opus-4-8", "executor=opencode-zen/gpt-5.3-codex"],
      listModelsOutput: LIST_MODELS_FIXTURE,
      spawnFn,
      scope: "project",
      cwd,
    });

    expect(result.applied.map((a) => a.colonKey).sort()).toEqual([
      "pi-oven:critic",
      "pi-oven:executor",
    ]);
  });

  it("a validation failure writes NO project file (validate-all-then-write-all)", async () => {
    const spawnFn = (_cmd: string, _args: string[]) =>
      ({ exitCode: 0, stdout: Buffer.from(""), stderr: Buffer.from("") });

    const result = await runOverride({
      entries: ["critic=anthropic/claude-opus-4-8", "unknownrole=anthropic/claude-opus-4-8"],
      listModelsOutput: LIST_MODELS_FIXTURE,
      spawnFn,
      scope: "project",
      cwd,
    });

    expect(result.exitCode).toBe(1);
    expect(existsSync(projectSettingsPath(cwd))).toBe(false);
  });

  it("preserves a hand-authored sibling key in the project file", async () => {
    mkdirSync(join(cwd, ".omp"), { recursive: true });
    writeFileSync(
      projectSettingsPath(cwd),
      JSON.stringify({ extensions: ["keep"] }, null, 2) + "\n",
      "utf-8"
    );

    const spawnFn = (_cmd: string, _args: string[]) =>
      ({ exitCode: 0, stdout: Buffer.from(""), stderr: Buffer.from("") });

    await runOverride({
      entries: ["critic=anthropic/claude-opus-4-8"],
      listModelsOutput: LIST_MODELS_FIXTURE,
      spawnFn,
      scope: "project",
      cwd,
    });

    const parsed = JSON.parse(readFileSync(projectSettingsPath(cwd), "utf-8"));
    expect(parsed.extensions).toEqual(["keep"]);
    expect(parsed.task.agentModelOverrides["pi-oven:critic"]).toBe("anthropic/claude-opus-4-8");
  });
});
