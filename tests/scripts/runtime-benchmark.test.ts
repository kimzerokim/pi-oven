import { describe, expect, it } from "bun:test";
import {
  benchmarkGatePaths,
  captureRuntimeBenchmarkBaseline,
  DEFAULT_RUNTIME_BENCHMARK_FIXTURES,
  evaluateBenchmarkCorrectness,
  exitCodeForBenchmarkReport,
  hashRuntimeBenchmarkFixtures,
  measurePromptFragments,
  RUNTIME_BENCHMARK_VERSION,
  RUNTIME_CONTRACT_VERSION,
  resolveRuntimeBenchmarkSource,
  runRuntimeBenchmark,
  summarizeSelectionReceipts,
  type RuntimeBenchmarkBaseline,
  type RuntimeBenchmarkFixture,
} from "../../scripts/lib/runtime-benchmark";
import type { SkillSelectionIndexEntry } from "../../.omp/extensions/pi-oven-runtime/skill-selection";
import { loadSkillKeywordIndex } from "../../.omp/extensions/pi-oven-runtime/skill-keyword-loader";
import path from "node:path";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";

function git(cwd: string, ...args: string[]): string {
  const result = Bun.spawnSync(["git", ...args], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  if (result.exitCode !== 0) {
    throw new Error(result.stderr.toString());
  }
  return result.stdout.toString().trim();
}

function skill(name: string, phrase: string, manifestOrder: number): SkillSelectionIndexEntry {
  return {
    name: `pov:${name}`,
    description: name,
    phrases: [phrase],
    ownedReadTarget: `/plugin/skills/${name}/SKILL.md`,
    pluginRoot: "/plugin",
    manifestOrder,
  };
}

describe("runtime benchmark correctness gates", () => {
  it("uses commit provenance only for clean trees and hashes dirty worktree content", () => {
    const repo = mkdtempSync(path.join(tmpdir(), "pi-oven-benchmark-source-"));
    try {
      git(repo, "init", "--quiet");
      git(repo, "config", "user.email", "benchmark@example.test");
      git(repo, "config", "user.name", "Runtime Benchmark");
      writeFileSync(path.join(repo, "contract.txt"), "committed\n", "utf8");
      git(repo, "add", "contract.txt");
      git(repo, "commit", "--quiet", "-m", "baseline");
      const headCommitSha = git(repo, "rev-parse", "HEAD");

      expect(resolveRuntimeBenchmarkSource(repo)).toEqual({
        kind: "commit",
        commitSha: headCommitSha,
      });

      writeFileSync(path.join(repo, "contract.txt"), "corrected worktree\n", "utf8");
      const dirty = resolveRuntimeBenchmarkSource(repo);
      expect(dirty).toEqual({
        kind: "worktree",
        headCommitSha,
        contentHash: expect.stringMatching(/^sha256:[0-9a-f]{64}$/u),
      });

      writeFileSync(path.join(repo, "contract.txt"), "different correction\n", "utf8");
      expect(resolveRuntimeBenchmarkSource(repo)).not.toEqual(dirty);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  it("rejects a fixture that loses a required skill before considering performance", () => {
    const index = [skill("autonomous-loop", "full auto", 0)];
    const fixtures: RuntimeBenchmarkFixture[] = [
      {
        name: "missing-required-autonomy",
        text: "ordinary request",
        requiredSkills: ["pov:autonomous-loop"],
        forbiddenSkills: [],
      },
    ];

    const correctness = evaluateBenchmarkCorrectness({ index, fixtures });

    expect(correctness.requiredRecall).toBe(0);
    expect(correctness.failures).toContain(
      "missing-required-autonomy: missing required skill pov:autonomous-loop"
    );
  });

  it("rejects a forbidden selection instead of reporting vacuous precision", () => {
    const index = [
      skill("systematic-debugging", "debug this", 0),
      skill("cloudflare", "cloudflare", 1),
    ];
    const correctness = evaluateBenchmarkCorrectness({
      index,
      fixtures: [
        {
          name: "debug-only",
          text: "debug this cloudflare regression",
          requiredSkills: ["pov:systematic-debugging"],
          forbiddenSkills: ["pov:cloudflare"],
        },
      ],
    });

    expect(correctness.forbiddenPrecision).toBe(0);
    expect(correctness.failures).toContain(
      "debug-only: selected forbidden skill pov:cloudflare"
    );
  });

  it("fails contract validation for duplicate skill identities", () => {
    const duplicate = skill("tdd-strict", "test first", 0);
    const correctness = evaluateBenchmarkCorrectness({
      index: [duplicate, { ...duplicate, manifestOrder: 1 }],
      fixtures: [],
    });

    expect(correctness.contractValid).toBe(false);
    expect(correctness.failures).toContain(
      "contract: duplicate skill index entry pov:tdd-strict"
    );
  });

  it("proves every shipped explicit alias and stable semantic ordering", () => {
    const index = loadSkillKeywordIndex(path.resolve(__dirname, "../.."));
    const correctness = evaluateBenchmarkCorrectness({
      index,
      fixtures: [
        {
          name: "stable-autonomy",
          text: "자율 실행으로 plan, test first, fresh verify, pre commit까지 진행해",
          requiredSkills: ["pov:autonomous-loop"],
          forbiddenSkills: ["pov:aws"],
        },
      ],
    });

    expect(index).toHaveLength(23);
    expect(correctness.explicitRecall).toBe(1);
    expect(correctness.deterministic).toBe(true);
    expect(correctness.failures).toEqual([]);
  });

  it("measures real gate handler paths after warm-up", async () => {
    const measurements = await benchmarkGatePaths({
      warmupIterations: 2,
      measurementIterations: 8,
    });

    expect(measurements.map((measurement) => measurement.path)).toEqual([
      "read-only-fast-path",
      "canonical-task-validation",
      "blocked-legacy-task",
      "blocked-unknown-task",
    ]);
    expect(measurements.map((measurement) => measurement.outcome.block)).toEqual([
      false,
      false,
      true,
      true,
    ]);
    for (const measurement of measurements) {
      expect(measurement.warmupIterations).toBe(2);
      expect(measurement.measurementIterations).toBe(8);
      expect(measurement.latency.p50Ms).toBeGreaterThanOrEqual(0);
      expect(measurement.latency.p95Ms).toBeGreaterThanOrEqual(
        measurement.latency.p50Ms
      );
      expect(measurement.latency.p99Ms).toBeGreaterThanOrEqual(
        measurement.latency.p95Ms
      );
    }
  });

  it("accounts for prompt fragments by bytes, estimated tokens, and audience", () => {
    const index = [skill("autonomous-loop", "full auto", 0)];
    const measurement = measurePromptFragments({
      index,
      fixture: {
        name: "prompt-audience",
        text: "full auto",
        requiredSkills: ["pov:autonomous-loop"],
        forbiddenSkills: [],
      },
      projectInstructions: "repository-local instructions",
      language: "en",
    });

    expect(measurement.fragments.find((fragment) => fragment.id === "keyword-skills")?.audiences)
      .toEqual(["parent"]);
    expect(measurement.fragments.find((fragment) => fragment.id === "project-instructions")?.audiences)
      .toEqual(["parent"]);
    expect(measurement.fragments.find((fragment) => fragment.id === "worker-assignment")?.audiences)
      .toEqual(["worker"]);
    for (const audience of ["parent", "worker"] as const) {
      const expectedBytes = measurement.fragments
        .filter((fragment) => fragment.audiences.includes(audience))
        .reduce((total, fragment) => total + fragment.bytes, 0);
      expect(measurement.totals[audience].bytes).toBe(expectedBytes);
      expect(measurement.totals[audience].estimatedTokens).toBe(
        Math.ceil(expectedBytes / 4)
      );
    }
  });

  it("makes correctness failure reject byte savings and exit one", async () => {
    const fixture: RuntimeBenchmarkFixture = {
      name: "worst-multi-skill-autonomous",
      text: "full auto",
      requiredSkills: ["pov:autonomous-loop"],
      forbiddenSkills: [],
    };
    const environment = {
      source: {
        kind: "commit" as const,
        commitSha: "0123456789abcdef0123456789abcdef01234567",
      },
      bunVersion: "1.3.14",
      ompVersion: "15.5.3",
    };
    const baseline = await captureRuntimeBenchmarkBaseline({
      index: [skill("autonomous-loop", "full auto", 0)],
      fixtures: [fixture],
      projectInstructions: "baseline instructions",
      language: "en",
      environment,
      warmupIterations: 0,
      measurementIterations: 1,
      generatedAt: "2026-07-13T00:00:00.000Z",
    });
    baseline.performance.workerPrompt.bytes *= 100;

    const report = await runRuntimeBenchmark({
      index: [skill("autonomous-loop", "different phrase", 0)],
      fixtures: [fixture],
      projectInstructions: "small",
      language: null,
      environment,
      baseline,
      warmupIterations: 0,
      measurementIterations: 1,
      generatedAt: "2026-07-13T00:00:01.000Z",
    });

    expect(report.correctness.requiredRecall).toBe(0);
    expect(report.performance.workerPrompt.reduction).toBeGreaterThan(0.5);
    expect(report.performance.workerPrompt.accepted).toBe(false);
    expect(report.accepted).toBe(false);
    expect(exitCodeForBenchmarkReport(report)).toBe(1);
    const serialized = JSON.stringify(report);
    expect(serialized.indexOf('"correctness"')).toBeLessThan(
      serialized.indexOf('"performance"')
    );
  });

  it("keeps the checked-in baseline tied to versions, fixtures, and selection receipt", () => {
    const repoRoot = path.resolve(__dirname, "../..");
    const index = loadSkillKeywordIndex(repoRoot);
    const baseline = JSON.parse(
      readFileSync(
        path.join(repoRoot, "benchmarks", "runtime-injection-baseline.json"),
        "utf8"
      )
    ) as RuntimeBenchmarkBaseline;

    expect(baseline.benchmarkVersion).toBe(RUNTIME_BENCHMARK_VERSION);
    expect(baseline.contractVersion).toBe(RUNTIME_CONTRACT_VERSION);
    expect(baseline.source).toEqual({
      kind: "worktree",
      headCommitSha: expect.stringMatching(/^[0-9a-f]{40}$/u),
      contentHash: expect.stringMatching(/^sha256:[0-9a-f]{64}$/u),
    });
    expect("commitSha" in baseline).toBe(false);
    expect(baseline.bunVersion).toMatch(/^\d+\.\d+\.\d+/u);
    expect(baseline.ompVersion).toMatch(/^\d+\.\d+\.\d+/u);
    expect(baseline.fixtureHash).toBe(
      hashRuntimeBenchmarkFixtures(DEFAULT_RUNTIME_BENCHMARK_FIXTURES)
    );
    expect(baseline.selectionReceipt).toEqual(
      summarizeSelectionReceipts({
        index,
        fixtures: DEFAULT_RUNTIME_BENCHMARK_FIXTURES,
      })
    );
    expect(baseline.performance.workerPrompt.bytes).toBeGreaterThan(0);
    expect(baseline.performance.gateReadOnly.p95Ms).toBeGreaterThanOrEqual(0);
  });
});
