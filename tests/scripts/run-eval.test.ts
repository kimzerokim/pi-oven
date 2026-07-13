import { describe, it, expect, mock } from "bun:test";
import { spawnSync } from "bun";
import { join } from "path";
import {
  computeEvalExitCode,
  main,
  makeSessionForTest,
  parseExactModelPattern,
  pickEvalModelPattern,
} from "../../scripts/run-eval";
import type { Verdict } from "../../scripts/lib/scenario-schema";

describe("run-eval CLI", () => {
  it("exits 0 when no scenarios match filter", () => {
    const result = spawnSync({
      cmd: [process.execPath, join(import.meta.dir, "../../scripts/run-eval.ts"), "--skill", "nonexistent-skill"],
      cwd: join(import.meta.dir, "../.."),
    });
    expect(result.exitCode).toBe(0);
  });

  it("exits nonzero when --require-scenarios matches nothing", () => {
    const result = spawnSync({
      cmd: [
        process.execPath,
        join(import.meta.dir, "../../scripts/run-eval.ts"),
        "--skill",
        "nonexistent-skill",
        "--require-scenarios",
      ],
      cwd: join(import.meta.dir, "../.."),
    });
    expect(result.exitCode).toBe(1);
  });

  // Removed: "loads scenario YAML and reports verdict format" —
  // CLI smoke that invoked the real LLM hangs without an API key (CI has none),
  // and the exit-code assertion `[0, 1, 2].toContain` was a tautology
  // (cycle-2 critic-review NIT 5). Real scenario evaluation lives behind
  // Plan 4 (LLM key bootstrap + CI secrets).
});

function verdict(overrides: Partial<Verdict> = {}): Verdict {
  return {
    scenario: "s",
    skill: "x",
    passed: true,
    inconclusive: false,
    failures: [],
    observations: [],
    latency_ms: 1,
    token_in: 1,
    token_out: 1,
    cache_read: 0,
    cache_write: 0,
    cost: 0,
    timed_out: false,
    infrastructure_error: false,
    model_receipts: [],
    ...overrides,
  };
}

describe("strict and exact-model release semantics", () => {
  it("makes timeout, inconclusive, and infrastructure failures nonzero in strict mode", () => {
    const special = [
      verdict({ passed: false, timed_out: true }),
      verdict({ passed: false, inconclusive: true }),
      verdict({ passed: false, infrastructure_error: true }),
    ];
    for (const item of special) {
      expect(computeEvalExitCode([item], { strict: false, requireScenarios: false })).toBe(0);
      expect(computeEvalExitCode([item], { strict: true, requireScenarios: false })).toBe(1);
    }
    const assertionBeforeTimeout = verdict({
      passed: false,
      timed_out: true,
      failures: ['response_must_not_contain: found forbidden "danger"', "turn_timeout: expired"],
    });
    expect(
      computeEvalExitCode([assertionBeforeTimeout], { strict: false, requireScenarios: false }),
    ).toBe(1);
  });

  it("accepts only exact provider/model pins", () => {
    expect(parseExactModelPattern("openai-codex/gpt-5.4")).toEqual({
      provider: "openai-codex",
      model: "gpt-5.4",
    });
    expect(parseExactModelPattern("gpt-5.4")).toBeUndefined();
    expect(parseExactModelPattern("openai/*")).toBeUndefined();
  });

  it("strict main verifies the model actually received by OMP", async () => {
    const makeSession = async (model = "") => ({
      subscribe(listener: (event: import("../../scripts/lib/omp-eval-event-adapter").EvidenceEvent) => void) {
        queueMicrotask(() => {
          listener({ type: "tool_start", name: "bash", args: {}, callId: "b1", at: 2 });
          listener({ type: "tool_end", name: "bash", callId: "b1", outcome: "success", at: 3 });
          listener({
            type: "assistant_end",
            text: "run-eval scenario",
            model: { provider: "openai-codex", model: model.split("/")[1] ?? "" },
            at: 4,
          });
          listener({ type: "turn_end", at: 5 });
        });
        return () => {};
      },
      async prompt() {},
    });
    const code = await main(
      [
        "--skill",
        "harness/eval-runner",
        "--scenario",
        "smoke",
        "--strict",
        "--model",
        "openai-codex/gpt-5.4",
      ],
      { rootDir: join(import.meta.dir, "../.."), makeSession, log: () => {} },
    );
    expect(code).toBe(0);
  });
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
    let sdkListener: ((event: Record<string, unknown>) => void) | undefined;

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
            subscribe: (listener: (event: Record<string, unknown>) => void) => {
              sdkListener = listener;
              return () => {};
            },
            prompt: async () => {},
            abort: () => {},
          },
        };
      },
    }));

    const wrapped = await makeSessionForTest();

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

    const evidence: import("../../scripts/lib/omp-eval-event-adapter").EvidenceEvent[] = [];
    wrapped.subscribe((event) => evidence.push(event));
    sdkListener?.({
      type: "tool_execution_start",
      toolName: "task",
      toolCallId: "call-1",
      args: { agent: "pov:executor" },
    });
    sdkListener?.({
      type: "tool_execution_end",
      toolName: "task",
      toolCallId: "call-1",
      result: {},
      isError: false,
    });
    expect(evidence).toContainEqual({
      type: "tool_start",
      name: "task",
      callId: "call-1",
      args: { agent: "pov:executor" },
      at: expect.any(Number),
    });
    expect(evidence).toContainEqual({
      type: "tool_end",
      name: "task",
      callId: "call-1",
      outcome: "success",
      result: {},
      at: expect.any(Number),
    });

    sdkListener?.({
      type: "tool_execution_start",
      toolName: "read",
      toolCallId: "decoy-skill-read",
      args: { path: "/tmp/decoy/skills/deep-dive/SKILL.md" },
    });
    sdkListener?.({
      type: "tool_execution_end",
      toolName: "read",
      toolCallId: "decoy-skill-read",
      result: {},
      isError: false,
    });
    expect(evidence).not.toContainEqual(
      expect.objectContaining({
        type: "skill_activation",
        skill: "pov:deep-dive",
      }),
    );

    sdkListener?.({
      type: "tool_execution_start",
      toolName: "read",
      toolCallId: "owned-skill-read",
      args: { path: join(import.meta.dir, "../../skills/deep-dive/SKILL.md") },
    });
    sdkListener?.({
      type: "tool_execution_end",
      toolName: "read",
      toolCallId: "owned-skill-read",
      result: {},
      isError: false,
    });
    expect(evidence).toContainEqual({
      type: "skill_activation",
      skill: "pov:deep-dive",
      receipt: "read",
      at: expect.any(Number),
    });
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
