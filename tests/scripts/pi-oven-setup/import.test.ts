import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { validateImport, runImport } from "../../../scripts/pi-oven-setup/import";
import { ROLES } from "../../../scripts/pi-oven-setup/profiles";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTempDir(): string {
  const dir = join(
    tmpdir(),
    `import-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
  mkdirSync(dir, { recursive: true });
  return dir;
}

function writeJson(dir: string, name: string, obj: unknown): string {
  const p = join(dir, name);
  writeFileSync(p, JSON.stringify(obj, null, 2), "utf-8");
  return p;
}

/**
 * Build a minimal `omp models` fixture containing the given model ids
 * in the "Canonical models" section format expected by parseCanonicalModelIds.
 */
function makeListModelsFixture(ids: string[]): string {
  const rows = ids.map((id) => `  * ${id}  true`).join("\n");
  return `
Canonical models
canonical  selected  enabled
${rows}

`;
}

// ---------------------------------------------------------------------------
// validateImport — 9 existing tests (whitelist logic unchanged)
// ---------------------------------------------------------------------------

describe("validateImport", () => {
  it("accepts a valid Profile A import with opencode-zen prefix", () => {
    const input = {
      "pi-oven": {
        models: {
          executor: {
            primary: "opencode-zen/gpt-5.3-codex",
            registry_alternate: "openai-codex/gpt-5.3-codex",
            thinkingLevel: "high",
          },
        },
      },
    };
    const result = validateImport(input);
    expect(result.ok).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("accepts a valid Profile B import with anthropic prefix when allowAnthropic=true", () => {
    const input = {
      "pi-oven": {
        models: {
          executor: {
            primary: "anthropic/claude-sonnet-4-6",
            registry_alternate: "opencode-zen/claude-sonnet-4-6",
            thinkingLevel: "high",
          },
        },
        provider: { anthropic: { enabled: true } },
      },
    };
    const result = validateImport(input, { allowAnthropic: true });
    expect(result.ok).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("rejects anthropic/* prefix when allowAnthropic=false", () => {
    const input = {
      "pi-oven": {
        profile: "B",
        models: {
          executor: {
            primary: "anthropic/claude-sonnet-4-6",
            registry_alternate: "opencode-zen/claude-sonnet-4-6",
            thinkingLevel: "high",
          },
        },
      },
    };
    const result = validateImport(input, { allowAnthropic: false });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes("anthropic"))).toBe(true);
  });

  it("rejects non-whitelisted prefix (e.g. gpt-4o)", () => {
    const input = {
      "pi-oven": {
        profile: "A",
        models: {
          executor: {
            primary: "gpt-4o",
            registry_alternate: "opencode-zen/claude-sonnet-4-6",
            thinkingLevel: "high",
          },
        },
      },
    };
    const result = validateImport(input);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes("gpt-4o"))).toBe(true);
  });

  it("rejects unknown role name", () => {
    const input = {
      "pi-oven": {
        models: {
          "my-role": {
            primary: "opencode-zen/gpt-5.3-codex",
            registry_alternate: "opencode-zen/claude-haiku-4-5",
            thinkingLevel: "medium",
          },
        },
      },
    };
    const result = validateImport(input);
    expect(result.ok).toBe(false);
    expect(result.errors).toContain("pi-oven.models.my-role: unknown role");
  });

  it("rejects any profile field because baseline profiles are setup-only", () => {
    const input = {
      "pi-oven": {
        profile: "X",
        models: {},
      },
    };
    const result = validateImport(input);
    expect(result.ok).toBe(false);
    expect(result.errors).toContain(
      "profile is not importable; use /pi-oven:setup --profile for baseline routing"
    );
  });

  it("rejects 'custom' profile value for the same setup-only reason", () => {
    const input = {
      "pi-oven": {
        profile: "custom",
        models: {},
      },
    };
    const result = validateImport(input);
    expect(result.ok).toBe(false);
    expect(result.errors).toContain(
      "profile is not importable; use /pi-oven:setup --profile for baseline routing"
    );
  });

  it("rejects invalid thinkingLevel value", () => {
    const input = {
      "pi-oven": {
        profile: "A",
        models: {
          executor: {
            primary: "opencode-zen/gpt-5.3-codex",
            registry_alternate: "opencode-zen/claude-haiku-4-5",
            thinkingLevel: "ultra",
          },
        },
      },
    };
    const result = validateImport(input);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes("thinkingLevel"))).toBe(true);
  });

  it("accepts partial models (only some roles specified)", () => {
    const input = {
      "pi-oven": {
        models: {
          executor: {
            primary: "opencode-zen/gpt-5.3-codex",
            registry_alternate: "openai-codex/gpt-5.3-codex",
            thinkingLevel: "high",
          },
        },
      },
    };
    const result = validateImport(input);
    expect(result.ok).toBe(true);
  });

  it("rejects non-object input", () => {
    const result = validateImport("not an object");
    expect(result.ok).toBe(false);
  });

  it("rejects null input", () => {
    const result = validateImport(null);
    expect(result.ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// runImport
// ---------------------------------------------------------------------------

describe("runImport", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = makeTempDir();
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("returns exitCode 1 and error message when file does not exist", async () => {
    const result = await runImport(join(tempDir, "nonexistent.json"));
    expect(result.exitCode).toBe(1);
    expect(result.output).toMatch(/not found|ENOENT|does not exist/i);
  });

  it("returns exitCode 1 on invalid JSON", async () => {
    const p = join(tempDir, "bad.json");
    writeFileSync(p, "{ not valid json", "utf-8");
    const result = await runImport(p);
    expect(result.exitCode).toBe(1);
    expect(result.output).toMatch(/JSON|parse/i);
  });

  it("returns exitCode 1 on validation failure (unknown role)", async () => {
    const p = writeJson(tempDir, "config.json", {
      "pi-oven": {
        profile: "A",
        models: {
          "unknown-role": {
            primary: "opencode-zen/gpt-5.3-codex",
            registry_alternate: "opencode-zen/claude-haiku-4-5",
            thinkingLevel: "medium",
          },
        },
      },
    });
    const result = await runImport(p);
    expect(result.exitCode).toBe(1);
    expect(result.output).toContain("unknown-role");
  });

  it("returns exitCode 1 on validation failure (non-whitelisted prefix)", async () => {
    const p = writeJson(tempDir, "config.json", {
      "pi-oven": {
        profile: "A",
        models: {
          executor: {
            primary: "gpt-4o",
            registry_alternate: "opencode-zen/claude-haiku-4-5",
            thinkingLevel: "high",
          },
        },
      },
    });
    const result = await runImport(p);
    expect(result.exitCode).toBe(1);
    expect(result.output).toContain("gpt-4o");
  });

  // -------------------------------------------------------------------------
  // New tests: colon-key writes + validation
  // -------------------------------------------------------------------------

  it("valid import sets canonical global pov:executor via omp config set", async () => {
    const primary = "opencode-zen/gpt-5.3-codex";
    const p = writeJson(tempDir, "config.json", {
      "pi-oven": {
        models: {
          executor: {
            primary,
            registry_alternate: "openai-codex/gpt-5.3-codex",
            thinkingLevel: "high",
          },
        },
      },
    });

    const spawned: Array<{ cmd: string; args: string[] }> = [];
    // get returns current empty record; set succeeds
    const mockSpawnFn = (_cmd: string, args: string[]) => {
      spawned.push({ cmd: _cmd, args });
      const isGet = args.includes("get");
      if (isGet) {
        return {
          exitCode: 0,
          stdout: Buffer.from(
            JSON.stringify({ type: "record", value: {} })
          ),
          stderr: Buffer.from(""),
        };
      }
      return { exitCode: 0, stdout: Buffer.from(""), stderr: Buffer.from("") };
    };

    const result = await runImport(p, {
      allowAnthropic: false,
      spawnFn: mockSpawnFn,
      listModelsOutput: makeListModelsFixture([primary]),
    });

    expect(result.exitCode).toBe(0);

    // A config set call must carry both the canonical global pov:executor override and the
    // canonical workflow-skill include filter.
    const setCalls = spawned.filter(
      (s) => s.args[0] === "config" && s.args[1] === "set"
    );
    expect(setCalls.length).toBeGreaterThan(1);

    const hasExecutorKey = setCalls.some((s) => {
      const payload = s.args[3] ?? s.args[2];
      try {
        const parsed = JSON.parse(payload ?? "{}") as Record<string, string>;
        return parsed["pov:executor"] === primary && parsed["pi-oven:executor"] === undefined;
      } catch {
        return false;
      }
    });
    expect(hasExecutorKey).toBe(true);
    const includeSkillsCall = setCalls.find((s) => s.args[2] === "skills.includeSkills");
    expect(includeSkillsCall).toBeDefined();
    expect(JSON.parse(includeSkillsCall!.args[3])).toEqual(["pov:*"]);
  });


  it("migrates old-only global pi-oven:* state during import and removes the legacy key", async () => {
    const primary = "opencode-zen/gpt-5.3-codex";
    const p = writeJson(tempDir, "config.json", {
      "pi-oven": {
        models: {
          executor: {
            primary,
            registry_alternate: "openai-codex/gpt-5.3-codex",
            thinkingLevel: "high",
          },
        },
      },
    });

    const spawned: Array<{ cmd: string; args: string[] }> = [];
    const mockSpawnFn = (_cmd: string, args: string[]) => {
      spawned.push({ cmd: _cmd, args });
      if (args.includes("get")) {
        return {
          exitCode: 0,
          stdout: Buffer.from(JSON.stringify({ type: "record", value: { "pi-oven:critic": "legacy-model" } })),
          stderr: Buffer.from(""),
        };
      }
      return { exitCode: 0, stdout: Buffer.from(""), stderr: Buffer.from("") };
    };

    const result = await runImport(p, {
      spawnFn: mockSpawnFn,
      listModelsOutput: makeListModelsFixture([primary]),
    });

    expect(result.exitCode).toBe(0);
    const overrideWrite = spawned.find(
      (s) => s.args[0] === "config" && s.args[1] === "set" && s.args[2] === "task.agentModelOverrides"
    );
    expect(overrideWrite).toBeDefined();
    const parsed = JSON.parse(overrideWrite!.args[3]);
    expect(parsed["pov:critic"]).toBe("legacy-model");
    expect(parsed["pi-oven:critic"]).toBeUndefined();
    expect(parsed["pov:executor"]).toBe(primary);
  });

  it("rejects same-scope dual-key conflicts during global import", async () => {
    const primary = "opencode-zen/gpt-5.3-codex";
    const p = writeJson(tempDir, "config.json", {
      "pi-oven": {
        models: {
          executor: {
            primary,
            registry_alternate: "openai-codex/gpt-5.3-codex",
            thinkingLevel: "high",
          },
        },
      },
    });

    const spawned: Array<{ cmd: string; args: string[] }> = [];
    const mockSpawnFn = (_cmd: string, args: string[]) => {
      spawned.push({ cmd: _cmd, args });
      if (args.includes("get")) {
        return {
          exitCode: 0,
          stdout: Buffer.from(JSON.stringify({ type: "record", value: { "pov:critic": "canonical-model", "pi-oven:critic": "legacy-model" } })),
          stderr: Buffer.from(""),
        };
      }
      return { exitCode: 0, stdout: Buffer.from(""), stderr: Buffer.from("") };
    };

    await expect(
      runImport(p, {
        spawnFn: mockSpawnFn,
        listModelsOutput: makeListModelsFixture([primary]),
      })
    ).rejects.toThrow(/dual-key conflict/i);

    const overrideWriteCount = spawned.filter(
      (s) => s.args[0] === "config" && s.args[1] === "set" && s.args[2] === "task.agentModelOverrides"
    ).length;
    expect(overrideWriteCount).toBe(0);
  });


  it("multi-role import batches all canonical global overrides into one write", async () => {
    const executorPrimary = "opencode-zen/gpt-5.3-codex";
    const criticPrimary = "openai-codex/gpt-5.5";
    const p = writeJson(tempDir, "config.json", {
      "pi-oven": {
        models: {
          executor: { primary: executorPrimary, registry_alternate: "openai-codex/gpt-5.3-codex", thinkingLevel: "high" },
          critic: { primary: criticPrimary, registry_alternate: "opencode-zen/gpt-5.3-codex", thinkingLevel: "xhigh" },
        },
      },
    });

    const spawned: Array<{ cmd: string; args: string[] }> = [];
    const mockSpawnFn = (_cmd: string, args: string[]) => {
      spawned.push({ cmd: _cmd, args });
      if (args.includes("get")) {
        return {
          exitCode: 0,
          stdout: Buffer.from(JSON.stringify({ type: "record", value: {} })),
          stderr: Buffer.from(""),
        };
      }
      return { exitCode: 0, stdout: Buffer.from(""), stderr: Buffer.from("") };
    };

    const result = await runImport(p, {
      spawnFn: mockSpawnFn,
      listModelsOutput: makeListModelsFixture([executorPrimary, criticPrimary]),
    });

    expect(result.exitCode).toBe(0);
    const overrideSetCalls = spawned.filter(
      (s) => s.args[0] === "config" && s.args[1] === "set" && s.args[2] === "task.agentModelOverrides"
    );
    expect(overrideSetCalls).toHaveLength(1);
    const parsed = JSON.parse(overrideSetCalls[0].args[3]);
    expect(parsed["pov:executor"]).toBe(executorPrimary);
    expect(parsed["pov:critic"]).toBe(criticPrimary);
  });

  it("import failure leaves the stored override record unchanged", async () => {
    const executorPrimary = "opencode-zen/gpt-5.3-codex";
    const criticPrimary = "openai-codex/gpt-5.5";
    const p = writeJson(tempDir, "config.json", {
      "pi-oven": {
        models: {
          executor: { primary: executorPrimary, registry_alternate: "openai-codex/gpt-5.3-codex", thinkingLevel: "high" },
          critic: { primary: criticPrimary, registry_alternate: "opencode-zen/gpt-5.3-codex", thinkingLevel: "xhigh" },
        },
      },
    });

    let storedRecord: Record<string, string> = { "claude-code:foo": "existingmodel" };
    const spawned: Array<{ cmd: string; args: string[] }> = [];
    const mockSpawnFn = (_cmd: string, args: string[]) => {
      spawned.push({ cmd: _cmd, args });
      if (args.includes("get")) {
        return {
          exitCode: 0,
          stdout: Buffer.from(JSON.stringify({ type: "record", value: storedRecord })),
          stderr: Buffer.from(""),
        };
      }
      if (args[0] === "config" && args[1] === "set" && args[2] === "task.agentModelOverrides") {
        return { exitCode: 1, stdout: Buffer.from(""), stderr: Buffer.from("set failed") };
      }
      return { exitCode: 0, stdout: Buffer.from(""), stderr: Buffer.from("") };
    };

    await expect(
      runImport(p, {
        spawnFn: mockSpawnFn,
        listModelsOutput: makeListModelsFixture([executorPrimary, criticPrimary]),
      })
    ).rejects.toThrow(/set failed/i);

    expect(storedRecord).toEqual({ "claude-code:foo": "existingmodel" });
    const overrideSetCalls = spawned.filter(
      (s) => s.args[0] === "config" && s.args[1] === "set" && s.args[2] === "task.agentModelOverrides"
    );
    expect(overrideSetCalls).toHaveLength(1);
  });

  it("import does NOT touch agents/ files (no agent-rewriter call)", async () => {
    const primary = "opencode-zen/gpt-5.3-codex";
    const p = writeJson(tempDir, "config.json", {
      "pi-oven": {
        models: {
          executor: { primary, registry_alternate: "openai-codex/x", thinkingLevel: "low" },
        },
      },
    });

    // Create a sentinel agent file — must remain unchanged
    const agentsDir = join(tempDir, "agents");
    mkdirSync(agentsDir, { recursive: true });
    const agentFile = join(agentsDir, "pi-oven-executor.md");
    const originalContent = "---\nname: pi-oven:executor\nmodel: original-model\n---\n";
    writeFileSync(agentFile, originalContent, "utf-8");

    const mockSpawnFn = (_cmd: string, args: string[]) => {
      const isGet = args.includes("get");
      if (isGet) {
        return {
          exitCode: 0,
          stdout: Buffer.from(JSON.stringify({ type: "record", value: {} })),
          stderr: Buffer.from(""),
        };
      }
      return { exitCode: 0, stdout: Buffer.from(""), stderr: Buffer.from("") };
    };

    await runImport(p, {
      spawnFn: mockSpawnFn,
      listModelsOutput: makeListModelsFixture([primary]),
    });

    // Agent file content must be unchanged
    const { readFileSync } = await import("fs");
    const after = readFileSync(agentFile, "utf-8");
    expect(after).toBe(originalContent);
  });

  it("import rejects whitelisted-but-unresolvable primary (exit 1, no config set)", async () => {
    const primary = "opencode-zen/nonexistent-model";
    const p = writeJson(tempDir, "config.json", {
      "pi-oven": {
        models: {
          executor: { primary, registry_alternate: "openai-codex/x", thinkingLevel: "low" },
        },
      },
    });

    const setCalls: Array<string[]> = [];
    const mockSpawnFn = (_cmd: string, args: string[]) => {
      const isGet = args.includes("get");
      if (isGet) {
        return {
          exitCode: 0,
          stdout: Buffer.from(JSON.stringify({ type: "record", value: {} })),
          stderr: Buffer.from(""),
        };
      }
      if (args[0] === "config" && args[1] === "set") {
        setCalls.push(args);
      }
      return { exitCode: 0, stdout: Buffer.from(""), stderr: Buffer.from("") };
    };

    // Fixture has NO nonexistent-model
    const result = await runImport(p, {
      spawnFn: mockSpawnFn,
      listModelsOutput: makeListModelsFixture(["opencode-zen/some-other-model"]),
    });

    expect(result.exitCode).toBe(1);
    expect(result.output).toMatch(/unresolvable|not found|invalid|rejected/i);
    // No config set must have been called
    expect(setCalls).toHaveLength(0);
  });

  it("import with no models block still applies the workflow-skill filter and exits 0", async () => {
    const p = writeJson(tempDir, "config.json", {
      "pi-oven": {
      },
    });

    const setCalls: Array<string[]> = [];
    const mockSpawnFn = (_cmd: string, args: string[]) => {
      if (args[0] === "config" && args[1] === "set") {
        setCalls.push(args);
      }
      return { exitCode: 0, stdout: Buffer.from(""), stderr: Buffer.from("") };
    };

    const result = await runImport(p, {
      spawnFn: mockSpawnFn,
      listModelsOutput: makeListModelsFixture([]),
    });

    expect(result.exitCode).toBe(0);
    expect(result.output).toContain('skills.includeSkills = ["pov:*"]');
    expect(setCalls).toHaveLength(1);
    expect(setCalls[0][2]).toBe("skills.includeSkills");
    expect(JSON.parse(setCalls[0][3])).toEqual(["pov:*"]);
  });

  it("import does NOT write plugin-config namespace (no pi-oven.profile or pi-oven.models.* in args)", async () => {
    const primary = "opencode-zen/gpt-5.3-codex";
    const p = writeJson(tempDir, "config.json", {
      "pi-oven": {
        models: {
          executor: { primary, registry_alternate: "openai-codex/x", thinkingLevel: "low" },
        },
      },
    });

    const allArgs: string[][] = [];
    const mockSpawnFn = (_cmd: string, args: string[]) => {
      allArgs.push(args);
      const isGet = args.includes("get");
      if (isGet) {
        return {
          exitCode: 0,
          stdout: Buffer.from(JSON.stringify({ type: "record", value: {} })),
          stderr: Buffer.from(""),
        };
      }
      return { exitCode: 0, stdout: Buffer.from(""), stderr: Buffer.from("") };
    };

    await runImport(p, {
      spawnFn: mockSpawnFn,
      listModelsOutput: makeListModelsFixture([primary]),
    });

    // No call must reference the dead plugin-config namespace
    const pluginConfigCalls = allArgs.filter((a) =>
      a.some((token) => token.startsWith("pi-oven.profile") || token.startsWith("pi-oven.models."))
    );
    expect(pluginConfigCalls).toHaveLength(0);
  });

  it("partial write rejected: multiple roles, one unresolvable → exit 1, no set calls", async () => {
    const goodPrimary = "opencode-zen/gpt-5.3-codex";
    const badPrimary = "opencode-zen/does-not-exist";
    const p = writeJson(tempDir, "config.json", {
      "pi-oven": {
        models: {
          executor: { primary: goodPrimary, registry_alternate: "openai-codex/x", thinkingLevel: "low" },
          planner: { primary: badPrimary, registry_alternate: "openai-codex/x", thinkingLevel: "low" },
        },
      },
    });

    const setCalls: Array<string[]> = [];
    const mockSpawnFn = (_cmd: string, args: string[]) => {
      const isGet = args.includes("get");
      if (isGet) {
        return {
          exitCode: 0,
          stdout: Buffer.from(JSON.stringify({ type: "record", value: {} })),
          stderr: Buffer.from(""),
        };
      }
      if (args[0] === "config" && args[1] === "set") {
        setCalls.push(args);
      }
      return { exitCode: 0, stdout: Buffer.from(""), stderr: Buffer.from("") };
    };

    const result = await runImport(p, {
      spawnFn: mockSpawnFn,
      // only goodPrimary is in the fixture
      listModelsOutput: makeListModelsFixture([goodPrimary]),
    });

    expect(result.exitCode).toBe(1);
    expect(setCalls).toHaveLength(0);
  });
});
