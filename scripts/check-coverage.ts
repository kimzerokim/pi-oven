#!/usr/bin/env bun
import { readFileSync } from "node:fs";
import { relative, resolve } from "node:path";

export interface CoverageThreshold {
  lines: number;
  functions: number;
  /** Enforce the threshold as soon as the file appears in LCOV. */
  whenPresent?: boolean;
}

export interface CoverageThresholdConfig {
  version: 1;
  global: CoverageThreshold;
  files: Record<string, CoverageThreshold>;
}

interface CoverageCount {
  found: number;
  hit: number;
}

export interface FileCoverage {
  lines: CoverageCount;
  functions: CoverageCount;
}

export interface CoverageReport {
  files: Map<string, FileCoverage>;
}

const REQUIRED_GLOBAL = { lines: 90, functions: 90 } as const;
const REQUIRED_FILES: Record<string, CoverageThreshold> = {
  "scripts/pi-oven-release/changelog-generator.ts": { lines: 80, functions: 80 },
  "scripts/pi-oven-release/git-ops.ts": { lines: 80, functions: 80 },
  "scripts/pi-oven-release/index.ts": { lines: 80, functions: 80 },
  "scripts/pi-oven-release/manifest-sync.ts": { lines: 80, functions: 80 },
  "scripts/pi-oven-release/release-publisher.ts": { lines: 80, functions: 80 },
  "scripts/pi-oven-release/version-bumper.ts": { lines: 80, functions: 80 },
  "scripts/run-eval.ts": { lines: 85, functions: 85 },
  ".omp/extensions/pi-oven-runtime/runtime-contract.ts": { lines: 95, functions: 95 },
  ".omp/extensions/pi-oven-runtime/gate-handler.ts": { lines: 95, functions: 95 },
  ".omp/extensions/pi-oven-runtime/gate.ts": { lines: 95, functions: 95 },
  ".omp/extensions/pi-oven-runtime/skill-selection.ts": { lines: 95, functions: 95 },
  "scripts/lib/atomic-file.ts": { lines: 90, functions: 90, whenPresent: true },
  "scripts/pi-oven-setup/setup-transaction.ts": { lines: 90, functions: 90, whenPresent: true },
};

function normalizeSourcePath(value: string): string {
  const normalized = value.replaceAll("\\", "/");
  if (!normalized.startsWith("/")) return normalized.replace(/^\.\//u, "");
  return relative(process.cwd(), resolve(normalized)).replaceAll("\\", "/");
}

export function parseLcov(input: string): CoverageReport {
  const files = new Map<string, FileCoverage>();
  let source: string | null = null;
  let functionsFound = 0;
  let functionsHit = 0;
  let linesFound = 0;
  let linesHit = 0;

  const flush = () => {
    if (source !== null) {
      files.set(normalizeSourcePath(source), {
        lines: { found: linesFound, hit: linesHit },
        functions: { found: functionsFound, hit: functionsHit },
      });
    }
    source = null;
    functionsFound = 0;
    functionsHit = 0;
    linesFound = 0;
    linesHit = 0;
  };

  for (const line of input.split(/\r?\n/u)) {
    if (line.startsWith("SF:")) source = line.slice(3);
    else if (line.startsWith("FNF:")) functionsFound = Number(line.slice(4));
    else if (line.startsWith("FNH:")) functionsHit = Number(line.slice(4));
    else if (line.startsWith("LF:")) linesFound = Number(line.slice(3));
    else if (line.startsWith("LH:")) linesHit = Number(line.slice(3));
    else if (line === "end_of_record") flush();
  }
  flush();
  return { files };
}

function percent(count: CoverageCount): number {
  return count.found === 0 ? 100 : (count.hit / count.found) * 100;
}

function aggregate(report: CoverageReport): FileCoverage {
  const result: FileCoverage = {
    lines: { found: 0, hit: 0 },
    functions: { found: 0, hit: 0 },
  };
  for (const file of report.files.values()) {
    result.lines.found += file.lines.found;
    result.lines.hit += file.lines.hit;
    result.functions.found += file.functions.found;
    result.functions.hit += file.functions.hit;
  }
  return result;
}

function coverageIssues(
  label: string,
  coverage: FileCoverage,
  threshold: CoverageThreshold
): string[] {
  const issues: string[] = [];
  for (const metric of ["lines", "functions"] as const) {
    const actual = percent(coverage[metric]);
    if (actual + Number.EPSILON < threshold[metric]) {
      issues.push(
        `${label} ${metric} coverage ${actual.toFixed(2)}% is below ${threshold[metric].toFixed(2)}%`
      );
    }
  }
  return issues;
}

export function checkCoverage(
  report: CoverageReport,
  config: CoverageThresholdConfig
): string[] {
  const issues = coverageIssues("global", aggregate(report), config.global);
  for (const [path, threshold] of Object.entries(config.files).sort(([a], [b]) =>
    a.localeCompare(b)
  )) {
    const coverage = report.files.get(path);
    if (!coverage) {
      if (!threshold.whenPresent) issues.push(`${path} is missing from the LCOV report`);
      continue;
    }
    issues.push(...coverageIssues(path, coverage, threshold));
  }
  return issues;
}

export function checkThresholdRegression(
  current: CoverageThresholdConfig,
  baseline: CoverageThresholdConfig
): string[] {
  const issues: string[] = [];
  for (const metric of ["lines", "functions"] as const) {
    if (current.global[metric] < baseline.global[metric]) {
      issues.push(
        `global ${metric} threshold decreased from ${baseline.global[metric].toFixed(2)}% to ${current.global[metric].toFixed(2)}%`
      );
    }
  }
  for (const [path, previous] of Object.entries(baseline.files).sort(([a], [b]) =>
    a.localeCompare(b)
  )) {
    const next = current.files[path];
    if (!next) {
      issues.push(`${path} threshold was removed`);
      continue;
    }
    if (previous.whenPresent !== true && next.whenPresent === true) {
      issues.push(`${path} threshold was changed from required to when-present`);
    }
    for (const metric of ["lines", "functions"] as const) {
      if (next[metric] < previous[metric]) {
        issues.push(
          `${path} ${metric} threshold decreased from ${previous[metric].toFixed(2)}% to ${next[metric].toFixed(2)}%`
        );
      }
    }
  }
  return issues;
}

export function validateCoveragePolicy(config: CoverageThresholdConfig): string[] {
  const issues: string[] = [];
  for (const metric of ["lines", "functions"] as const) {
    if (config.global[metric] < REQUIRED_GLOBAL[metric]) {
      issues.push(
        `global ${metric} threshold must be at least ${REQUIRED_GLOBAL[metric].toFixed(2)}%`
      );
    }
  }
  for (const [path, floor] of Object.entries(REQUIRED_FILES)) {
    const declared = config.files[path];
    if (!declared || declared.lines < floor.lines || declared.functions < floor.functions) {
      issues.push(
        `${path} must declare at least ${floor.lines.toFixed(2)}% lines/functions`
      );
      continue;
    }
    if (floor.whenPresent !== true && declared.whenPresent === true) {
      issues.push(`${path} must remain required in the LCOV report`);
    }
  }
  return issues;
}

function readConfig(text: string): CoverageThresholdConfig {
  const parsed = JSON.parse(text) as CoverageThresholdConfig;
  if (parsed?.version !== 1 || !parsed.global || !parsed.files) {
    throw new Error("Invalid coverage threshold config");
  }
  return parsed;
}

function readBaseline(ref: string, path: string): CoverageThresholdConfig | null {
  const relativePath = relative(process.cwd(), resolve(path)).replaceAll("\\", "/");
  const result = Bun.spawnSync(["git", "show", `${ref}:${relativePath}`], {
    stdout: "pipe",
    stderr: "pipe",
  });
  if (result.exitCode !== 0) return null;
  return readConfig(Buffer.from(result.stdout).toString("utf8"));
}

export function main(argv = Bun.argv.slice(2)): void {
  let coveragePath = "coverage/lcov.info";
  let thresholdsPath = "config/coverage-thresholds.json";
  let baselineRef: string | undefined;
  for (let index = 0; index < argv.length; index++) {
    if (argv[index] === "--coverage") coveragePath = argv[++index] ?? coveragePath;
    else if (argv[index] === "--thresholds") thresholdsPath = argv[++index] ?? thresholdsPath;
    else if (argv[index] === "--baseline-ref") baselineRef = argv[++index];
    else throw new Error(`Unknown argument: ${argv[index]}`);
  }

  const config = readConfig(readFileSync(thresholdsPath, "utf8"));
  const report = parseLcov(readFileSync(coveragePath, "utf8"));
  const issues = [...validateCoveragePolicy(config), ...checkCoverage(report, config)];
  if (baselineRef) {
    const baseline = readBaseline(baselineRef, thresholdsPath);
    if (baseline) issues.push(...checkThresholdRegression(config, baseline));
  }
  if (issues.length > 0) throw new Error(`Coverage ratchet failed:\n- ${issues.join("\n- ")}`);
  const global = aggregate(report);
  process.stdout.write(
    `Coverage ratchet passed: ${percent(global.lines).toFixed(2)}% lines, ${percent(global.functions).toFixed(2)}% functions\n`
  );
}

if (import.meta.main) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  }
}
