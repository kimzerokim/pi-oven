import { describe, it, expect, mock } from "bun:test";
import { spawnSync } from "bun";
import { join } from "path";
import { makeSessionForTest, pickEvalModelPattern } from "../../scripts/run-eval";

describe("run-eval CLI", () => {
  it("exits 0 when no scenarios match filter", () => {
    const result = spawnSync({
      cmd: [process.execPath, join(import.meta.dir, "../../scripts/run-eval.ts"), "--skill", "nonexistent-skill"],
      cwd: join(import.meta.dir, "../.."),
    });
    expect(result.exitCode).toBe(0);
  });

  // Removed: "loads scenario YAML and reports verdict format" —
  // CLI smoke that invoked the real LLM hangs without an API key (CI has none),
  // and the exit-code assertion `[0, 1, 2].toContain` was a tautology
  // (cycle-2 critic-review NIT 5). Real scenario evaluation lives behind
  // Plan 4 (LLM key bootstrap + CI secrets).
});

describe("makeSession config (Issue 2 — headless fixes + worktree skills)", () => {
  /**
   * RED: makeSession() must pass autoApprove:true, hasUI:false, and a skills
   * array loaded from this worktree's .claude-plugin/plugin.json to
   * createAgentSession — otherwise headless scenarios block on approval prompts
   * and skill_triggered evidence is always empty.
   *
   * Strategy: mock @oh-my-pi/pi-coding-agent and capture what createAgentSession
   * receives, then import makeSession (which is not exported, so we test via
   * the module's internal path by re-importing after mocking).
   */
  it("passes autoApprove:true, hasUI:false, and skills array to createAgentSession", async () => {
    const capturedOptions: unknown[] = [];

    // Mock the SDK module to capture options
    mock.module("@oh-my-pi/pi-coding-agent", () => ({
      discoverAuthStorage: async () => ({}),
      ModelRegistry: class {
        async refresh() {}
      },
      SessionManager: {
        inMemory: () => ({}),
      },
      discoverSkills: async (_cwd?: string) => ({
        skills: [{ name: "deep-dive", content: "# deep-dive" }],
        warnings: [],
      }),
      createAgentSession: async (opts: unknown) => {
        capturedOptions.push(opts);
        return {
          session: {
            subscribe: () => () => {},
            prompt: async () => {},
            abort: () => {},
          },
        };
      },
    }));

    await makeSessionForTest();

    expect(capturedOptions.length).toBeGreaterThanOrEqual(1);
    const opts = capturedOptions[0] as Record<string, unknown>;
    expect(opts.autoApprove).toBe(true);
    expect(opts.hasUI).toBe(false);
    // skills must be provided (worktree skills loaded)
    expect(Array.isArray(opts.skills)).toBe(true);
    expect((opts.skills as unknown[]).length).toBeGreaterThan(0);
    // The pi-oven extension is loaded so the keyword->skill-read injection path
    // is exercised; the path points at this repo's workspace extension.
    expect(Array.isArray(opts.additionalExtensionPaths)).toBe(true);
    expect(
      (opts.additionalExtensionPaths as string[]).some((p) => p.endsWith("pi-oven.ts"))
    ).toBe(true);
  });
});

describe("pickEvalModelPattern", () => {
  const list = [
    { provider: "anthropic", id: "claude-opus-4-6" },
    { provider: "openai-codex", id: "gpt-5.4" },
    { provider: "anthropic", id: "claude-haiku-4-5" },
  ];

  it("explicit --model wins over env and available list", () => {
    expect(pickEvalModelPattern("openai-codex/gpt-5.4", "anthropic/x", list)).toBe(
      "openai-codex/gpt-5.4"
    );
  });

  it("env PI_OVEN_EVAL_MODEL wins when no explicit, over available list", () => {
    expect(pickEvalModelPattern(undefined, "anthropic/claude-opus-4-6", list)).toBe(
      "anthropic/claude-opus-4-6"
    );
  });

  it("auto-picks the first fast-substring match as provider/id", () => {
    expect(pickEvalModelPattern(undefined, undefined, list)).toBe("anthropic/claude-haiku-4-5");
  });

  it("honors fast-priority order (flash before mini)", () => {
    const l = [
      { provider: "p", id: "model-mini" },
      { provider: "q", id: "model-flash" },
    ];
    expect(pickEvalModelPattern(undefined, undefined, l)).toBe("q/model-flash");
  });

  it("falls back to first available when no fast match", () => {
    const l = [
      { provider: "anthropic", id: "claude-opus-4-6" },
      { provider: "openai-codex", id: "gpt-5.4" },
    ];
    expect(pickEvalModelPattern(undefined, undefined, l)).toBe("anthropic/claude-opus-4-6");
  });

  it("returns undefined when no explicit/env and no available models", () => {
    expect(pickEvalModelPattern(undefined, undefined, undefined)).toBeUndefined();
    expect(pickEvalModelPattern(undefined, undefined, [])).toBeUndefined();
    expect(pickEvalModelPattern(undefined, "", undefined)).toBeUndefined();
  });
});
