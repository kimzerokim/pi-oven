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
 * Build a minimal omp --list-models fixture containing the given model ids
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
        profile: "A",
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
        profile: "B",
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

  it("rejects unknown role name and enumerates all 24 allowed roles in error", () => {
    const input = {
      "pi-oven": {
        profile: "A",
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
    expect(result.errors.some((e) => e.includes("my-role"))).toBe(true);
    // Error must enumerate all 24 roles
    for (const role of ROLES) {
      const allErrors = result.errors.join("\n");
      expect(allErrors).toContain(role);
    }
  });

  it("rejects invalid profile value", () => {
    const input = {
      "pi-oven": {
        profile: "X",
        models: {},
      },
    };
    const result = validateImport(input);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes("profile"))).toBe(true);
  });

  it("rejects 'custom' profile value", () => {
    const input = {
      "pi-oven": {
        profile: "custom",
        models: {},
      },
    };
    const result = validateImport(input);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes("profile"))).toBe(true);
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
        profile: "A",
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

  it("valid import sets pi-oven:executor via omp config set (colon key)", async () => {
    const primary = "opencode-zen/gpt-5.3-codex";
    const p = writeJson(tempDir, "config.json", {
      "pi-oven": {
        profile: "A",
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

    // A "config set" call must carry the pi-oven:executor key with the primary value
    const setCalls = spawned.filter(
      (s) => s.args[0] === "config" && s.args[1] === "set"
    );
    expect(setCalls.length).toBeGreaterThan(0);

    const hasExecutorKey = setCalls.some((s) => {
      const payload = s.args[3] ?? s.args[2];
      try {
        const parsed = JSON.parse(payload ?? "{}") as Record<string, string>;
        return parsed["pi-oven:executor"] === primary;
      } catch {
        return false;
      }
    });
    expect(hasExecutorKey).toBe(true);
  });

  it("import does NOT touch agents/ files (no agent-rewriter call)", async () => {
    const primary = "opencode-zen/gpt-5.3-codex";
    const p = writeJson(tempDir, "config.json", {
      "pi-oven": {
        profile: "A",
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
        profile: "A",
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

  it("import with no models block writes 0 entries and exits 0", async () => {
    const p = writeJson(tempDir, "config.json", {
      "pi-oven": {
        profile: "A",
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
    expect(setCalls).toHaveLength(0);
  });

  it("import does NOT write plugin-config namespace (no pi-oven.profile or pi-oven.models.* in args)", async () => {
    const primary = "opencode-zen/gpt-5.3-codex";
    const p = writeJson(tempDir, "config.json", {
      "pi-oven": {
        profile: "A",
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
        profile: "A",
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
