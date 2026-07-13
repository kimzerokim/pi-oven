import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "../..");
const ci = readFileSync(join(ROOT, ".github/workflows/ci.yml"), "utf8");
const release = readFileSync(join(ROOT, ".github/workflows/release.yml"), "utf8");
const gitignore = readFileSync(join(ROOT, ".gitignore"), "utf8");

describe("eval CI tiers", () => {
  it("hard-gates offline contracts and fake-ok discrimination on every PR/push", () => {
    expect(ci).toContain("pull_request:");
    expect(ci).toContain("push:");
    expect(ci).not.toContain("branches: [main]");
    expect(ci).toContain("check-eval-discrimination.ts");
    expect(ci).toContain("eval-scenario-shape.test.ts");
    expect(ci).toContain("task-dispatch-canary.test.ts");
    expect(ci).not.toMatch(/continue-on-error:\s*true/);
    const benchmark = ci.indexOf("bun run bench:runtime");
    const discrimination = ci.indexOf("bun scripts/check-eval-discrimination.ts");
    const rehearsal = ci.indexOf("bun scripts/rehearse-release.ts");
    expect(benchmark).toBeGreaterThan(0);
    expect(discrimination).toBeGreaterThan(benchmark);
    expect(rehearsal).toBeGreaterThan(discrimination);
  });

  it("guards trusted canary credentials and records NOT_RUN for forks or missing secrets", () => {
    expect(ci).toContain("workflow_dispatch:");
    expect(ci).toContain("github.event.pull_request.head.repo.full_name");
    expect(ci).toContain("github.ref == 'refs/heads/main'");
    expect(ci).toContain("PI_OVEN_EVAL_AGENT_DB_B64");
    expect(ci).toContain("--not-run-reason");
    expect(ci).toContain("NOT RUN");
    expect(ci).toContain("openai-codex/gpt-5.4");
    expect(ci).toContain("--strict --require-scenarios");
    expect(ci).toContain("timeout --signal=TERM 12m");
  });

  it("runs the full strict eval nightly and uploads a receipt artifact", () => {
    expect(ci).toContain("schedule:");
    expect(ci).toContain("cron:");
    expect(ci).toContain("nightly-full-eval");
    expect(ci).toContain("scripts/run-eval.ts --strict --require-scenarios");
    expect(ci).toContain("nightly-eval.jsonl");
    expect(ci).toContain("actions/upload-artifact@");
  });

  it("keeps generated machine-local receipts out of the source tree", () => {
    expect(gitignore.split(/\r?\n/)).toContain("artifacts/");
    expect(ci).toContain("path: artifacts/runtime-contract-rehearsal.json");
  });

  it("blocks tag publishing on strict canonical canary and regression evals", () => {
    const benchmarkIndex = release.indexOf("bun run bench:runtime");
    const discriminationIndex = release.indexOf("bun scripts/check-eval-discrimination.ts");
    const rehearsalIndex = release.indexOf("bun scripts/rehearse-release.ts");
    const canaryIndex = release.indexOf("canary-runtime-dispatch.ts");
    const regressionIndex = release.indexOf("scripts/run-eval.ts --tag regression");
    const publishIndex = release.indexOf("gh release create");
    expect(benchmarkIndex).toBeGreaterThan(0);
    expect(discriminationIndex).toBeGreaterThan(benchmarkIndex);
    expect(rehearsalIndex).toBeGreaterThan(discriminationIndex);
    expect(canaryIndex).toBeGreaterThan(rehearsalIndex);
    expect(canaryIndex).toBeGreaterThan(0);
    expect(regressionIndex).toBeGreaterThan(canaryIndex);
    expect(publishIndex).toBeGreaterThan(regressionIndex);
    expect(release).toContain("--strict --require-scenarios");
    expect(release).toContain("NOT_RUN");
  });
});
