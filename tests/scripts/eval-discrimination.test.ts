import { describe, expect, it } from "bun:test";
import path from "node:path";
import {
  checkEvalDiscrimination,
  sessionReturningOnly,
  vacuousResponsePasses,
} from "../../scripts/check-eval-discrimination";
import { runScenario } from "../../scripts/lib/eval-runner";
import { ScenarioSchema } from "../../scripts/lib/scenario-schema";

const ROOT = path.resolve(__dirname, "../../");

describe("eval negative control", () => {
  it("rejects every positive scenario when the session returns only ok", async () => {
    const report = await checkEvalDiscrimination(path.join(ROOT, "evals"));

    expect(report.positiveScenarios).toBeGreaterThan(0);
    expect(report.vacuousPasses).toEqual([]);
    expect(report.rejectedScenarios).toBe(report.positiveScenarios);
  });

  it("runs the ok-only negative control through the real scenario runner", async () => {
    const scenario = ScenarioSchema.parse({
      name: "vacuous-ok",
      skill: "example",
      kind: "positive",
      tag: "smoke",
      input: [{ turn: 1, user: "do something" }],
      expected: [{ response_must_contain: ["ok"] }],
    });

    const verdict = await runScenario(scenario, sessionReturningOnly("ok"), {
      turnTimeoutMs: 50,
      scenarioTimeoutMs: 100,
    });
    expect(verdict.passed).toBe(true);
    expect(await vacuousResponsePasses(scenario)).toBe(true);
  });
});
