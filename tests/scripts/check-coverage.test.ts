import { describe, expect, it } from "bun:test";
import {
  checkCoverage,
  checkThresholdRegression,
  parseLcov,
  validateCoveragePolicy,
  type CoverageThresholdConfig,
} from "../../scripts/check-coverage";

const report = parseLcov(`TN:
SF:scripts/a.ts
FNF:2
FNH:2
DA:1,1
DA:2,1
LF:2
LH:2
end_of_record
TN:
SF:scripts/b.ts
FNF:2
FNH:1
DA:1,1
DA:2,0
LF:2
LH:1
end_of_record
`);

function config(overrides: Partial<CoverageThresholdConfig> = {}): CoverageThresholdConfig {
  return {
    version: 1,
    global: { lines: 75, functions: 75 },
    files: {
      "scripts/a.ts": { lines: 100, functions: 100 },
      "scripts/future.ts": { lines: 90, functions: 90, whenPresent: true },
    },
    ...overrides,
  };
}

describe("coverage ratchet", () => {
  it("parses LCOV and enforces global, exact-file, and when-present thresholds", () => {
    expect(report.files.get("scripts/a.ts")).toEqual({
      lines: { found: 2, hit: 2 },
      functions: { found: 2, hit: 2 },
    });
    expect(checkCoverage(report, config())).toEqual([]);

    const issues = checkCoverage(
      report,
      config({
        global: { lines: 80, functions: 80 },
        files: { "scripts/b.ts": { lines: 80, functions: 80 } },
      })
    );
    expect(issues).toEqual([
      "global lines coverage 75.00% is below 80.00%",
      "global functions coverage 75.00% is below 80.00%",
      "scripts/b.ts lines coverage 50.00% is below 80.00%",
      "scripts/b.ts functions coverage 50.00% is below 80.00%",
    ]);
  });

  it("rejects lowered or removed thresholds relative to the base branch", () => {
    const baseline = config({
      global: { lines: 90, functions: 91 },
      files: { "scripts/a.ts": { lines: 95, functions: 96 } },
    });
    const current = config({
      global: { lines: 89, functions: 91 },
      files: {},
    });

    expect(checkThresholdRegression(current, baseline)).toEqual([
      "global lines threshold decreased from 90.00% to 89.00%",
      "scripts/a.ts threshold was removed",
    ]);

    expect(
      checkThresholdRegression(
        config({
          global: baseline.global,
          files: { "scripts/a.ts": { lines: 95, functions: 96, whenPresent: true } },
        }),
        baseline
      )
    ).toEqual(["scripts/a.ts threshold was changed from required to when-present"]);
  });

  it("requires the remediation floors, including future setup files", () => {
    const invalid = config({ global: { lines: 89, functions: 90 }, files: {} });
    const issues = validateCoveragePolicy(invalid);
    expect(issues).toContain("global lines threshold must be at least 90.00%");
    expect(issues).toContain(
      ".omp/extensions/pi-oven-runtime/gate.ts must declare at least 95.00% lines/functions"
    );
    expect(issues).toContain(
      "scripts/pi-oven-setup/setup-transaction.ts must declare at least 90.00% lines/functions"
    );
  });
});
