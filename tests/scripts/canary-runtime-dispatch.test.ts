import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "bun";
import {
  CANONICAL_CANARY_SCENARIOS,
  parseCanaryArgs,
  runCanary,
} from "../../scripts/canary-runtime-dispatch";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function outputPath(): string {
  const root = mkdtempSync(join(tmpdir(), "pi-oven-canary-"));
  roots.push(root);
  return join(root, "receipt.json");
}

describe("canonical runtime canary", () => {
  it("keeps the default static/NOT RUN command hermetic when HOME is not writable", () => {
    const root = mkdtempSync(join(tmpdir(), "pi-oven-canary-home-"));
    roots.push(root);
    const homeSentinel = join(root, "home-is-a-file");
    writeFileSync(homeSentinel, "sentinel\n");
    const result = spawnSync({
      cmd: [process.execPath, join(import.meta.dir, "../../scripts/canary-runtime-dispatch.ts")],
      cwd: join(import.meta.dir, "../.."),
      env: {
        ...process.env,
        HOME: homeSentinel,
        PI_OVEN_LIVE_TASK_CANARY: "0",
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(result.exitCode).toBe(0);
    const output = Buffer.from(result.stdout).toString("utf8");
    expect(output).toContain('"static": "PASS"');
    expect(output).toContain('"live": "NOT RUN"');
    expect(output).toContain('"ompSchema": "NOT EXPORTED"');
    expect(output).not.toContain('"live": "PASS"');
  });

  it("pins exactly six unique scenarios and canonical agents", () => {
    expect(CANONICAL_CANARY_SCENARIOS).toHaveLength(6);
    expect(new Set(CANONICAL_CANARY_SCENARIOS.map((entry) => entry.scenario)).size).toBe(6);
    expect(CANONICAL_CANARY_SCENARIOS.map((entry) => entry.agent)).toEqual([
      "pov:executor",
      "pov:explorer",
      "pov:verifier",
      "pov:critic",
      "pov:planner",
      "pov:code-reviewer",
    ]);
  });

  it("writes NOT_RUN rather than PASS when credentials are unavailable", async () => {
    const outFile = outputPath();
    const result = await runCanary(
      parseCanaryArgs(["--out", outFile, "--not-run-reason", "credentials-unavailable"]),
    );
    expect(result.exitCode).toBe(0);
    expect(result.receipt.status).toBe("NOT_RUN");
    expect(result.receipt.status).not.toBe("PASS");
    expect(JSON.parse(readFileSync(outFile, "utf8"))).toMatchObject({
      status: "NOT_RUN",
      reason: "credentials-unavailable",
      completedScenarios: 0,
    });
  });

  it("requires strict mode, required scenarios, and an exact model for a live run", async () => {
    const outFile = outputPath();
    await expect(runCanary(parseCanaryArgs(["--out", outFile, "--model", "openai-codex/gpt-5.4"]))).rejects.toThrow(
      "--strict --require-scenarios",
    );
    await expect(
      runCanary(
        parseCanaryArgs([
          "--out",
          outFile,
          "--model",
          "openai/*",
          "--strict",
          "--require-scenarios",
        ]),
      ),
    ).rejects.toThrow("exact provider/model");
  });

  it("runs all six with strict required-scenario flags and aggregates a PASS receipt", async () => {
    const outFile = outputPath();
    const calls: string[][] = [];
    const result = await runCanary(
      parseCanaryArgs([
        "--out",
        outFile,
        "--model",
        "openai-codex/gpt-5.4",
        "--strict",
        "--require-scenarios",
      ]),
      {
        runEval: async (argv) => {
          calls.push(argv);
          const outIndex = argv.indexOf("--out");
          const skill = argv[argv.indexOf("--skill") + 1]!;
          const scenario = argv[argv.indexOf("--scenario") + 1]!;
          writeFileSync(
            argv[outIndex + 1]!,
            `${JSON.stringify({
              scenario,
              skill,
              passed: true,
              inconclusive: false,
              failures: [],
              observations: [],
              latency_ms: 1,
              token_in: 2,
              token_out: 3,
              cache_read: 0,
              cache_write: 0,
              cost: 0.01,
              timed_out: false,
              infrastructure_error: false,
              model_receipts: [{ provider: "openai-codex", model: "gpt-5.4" }],
            })}\n`,
          );
          return 0;
        },
      },
    );
    expect(result.exitCode).toBe(0);
    expect(result.receipt).toMatchObject({
      status: "PASS",
      exactModel: "openai-codex/gpt-5.4",
      completedScenarios: 6,
      tokenIn: 12,
      tokenOut: 18,
      cost: 0.06,
    });
    expect(calls).toHaveLength(6);
    for (const call of calls) {
      expect(call).toContain("--strict");
      expect(call).toContain("--require-scenarios");
      expect(call).toContain("--model");
    }
  });
});
