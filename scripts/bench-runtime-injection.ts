#!/usr/bin/env bun

import { readFileSync } from "node:fs";
import path from "node:path";
import { loadSkillKeywordIndex } from "../.omp/extensions/pi-oven-runtime/skill-keyword-loader";
import {
  DEFAULT_RUNTIME_BENCHMARK_FIXTURES,
  RUNTIME_BENCHMARK_BASELINE_PROMPT_MODE,
  RUNTIME_BENCHMARK_CURRENT_PROMPT_MODE,
  captureRuntimeBenchmarkBaseline,
  exitCodeForBenchmarkReport,
  resolveRuntimeBenchmarkSource,
  runRuntimeBenchmark,
  type RuntimeBenchmarkBaseline,
  type RuntimeBenchmarkEnvironment,
} from "./lib/runtime-benchmark";

const EXPECTED_SHIPPED_SKILL_COUNT = 23;
const BASELINE_PATH = path.join("benchmarks", "runtime-injection-baseline.json");

function readOmpVersion(repoRoot: string): string {
  const packagePath = path.join(
    repoRoot,
    "node_modules",
    "@oh-my-pi",
    "pi-coding-agent",
    "package.json"
  );
  const packageJson = JSON.parse(readFileSync(packagePath, "utf8")) as {
    version?: unknown;
  };
  if (typeof packageJson.version !== "string" || packageJson.version.length === 0) {
    throw new Error("installed @oh-my-pi/pi-coding-agent version is unavailable");
  }
  return packageJson.version;
}

function readProjectInstructions(repoRoot: string): string | null {
  try {
    return readFileSync(path.join(repoRoot, "CLAUDE.md"), "utf8");
  } catch {
    return null;
  }
}

const repoRoot = process.cwd();
const index = loadSkillKeywordIndex(repoRoot);
const environment: RuntimeBenchmarkEnvironment = {
  source: resolveRuntimeBenchmarkSource(repoRoot, {
    excludedRelativePaths: [BASELINE_PATH],
  }),
  bunVersion: Bun.version,
  ompVersion: readOmpVersion(repoRoot),
};
const commonOptions = {
  index,
  fixtures: DEFAULT_RUNTIME_BENCHMARK_FIXTURES,
  projectInstructions: readProjectInstructions(repoRoot),
  language: null,
  environment,
  expectedSkillCount: EXPECTED_SHIPPED_SKILL_COUNT,
};

if (process.argv.includes("--capture-baseline")) {
  const baseline = await captureRuntimeBenchmarkBaseline({
    ...commonOptions,
    promptMode: RUNTIME_BENCHMARK_BASELINE_PROMPT_MODE,
  });
  process.stdout.write(`${JSON.stringify(baseline, null, 2)}\n`);
} else {
  const baseline = JSON.parse(
    readFileSync(path.join(repoRoot, BASELINE_PATH), "utf8")
  ) as RuntimeBenchmarkBaseline;
  const report = await runRuntimeBenchmark({
    ...commonOptions,
    promptMode: RUNTIME_BENCHMARK_CURRENT_PROMPT_MODE,
    baseline,
  });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  process.exitCode = exitCodeForBenchmarkReport(report);
}
