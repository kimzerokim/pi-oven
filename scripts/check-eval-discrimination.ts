import fs from "node:fs";
import path from "node:path";
import { runScenario, type SessionLike } from "./lib/eval-runner";
import type { EvidenceEvent } from "./lib/omp-eval-event-adapter";
import { ScenarioSchema, type Scenario } from "./lib/scenario-schema";

export interface EvalDiscriminationReport {
  totalScenarios: number;
  positiveScenarios: number;
  rejectedScenarios: number;
  vacuousPasses: string[];
}

export function collectEvalScenarioFiles(evalsDir: string): string[] {
  const files: string[] = [];

  const visit = (directory: string) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        visit(absolute);
      } else if (
        path.basename(path.dirname(absolute)) === "scenarios" &&
        (entry.name.endsWith(".yaml") || entry.name.endsWith(".yml"))
      ) {
        files.push(absolute);
      }
    }
  };

  visit(evalsDir);
  return files.sort();
}

/** Session-level negative control: assistant text only, with no tool or skill evidence. */
export function sessionReturningOnly(response: string): SessionLike {
  const listeners = new Set<(event: EvidenceEvent) => void>();
  let at = 0;
  const emit = (event: EvidenceEvent): void => {
    for (const listener of listeners) listener(event);
  };
  return {
    subscribe(listener): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async prompt(): Promise<void> {
      emit({ type: "assistant_end", text: response, at: at++ });
      emit({ type: "turn_end", stopReason: "stop", at: at++ });
    },
  };
}

/** Run the mandatory negative control through the production assertion engine. */
export async function vacuousResponsePasses(
  scenario: Scenario,
  response = "ok",
): Promise<boolean> {
  const verdict = await runScenario(scenario, sessionReturningOnly(response));
  return verdict.passed;
}

export async function checkEvalDiscrimination(
  evalsDir: string,
): Promise<EvalDiscriminationReport> {
  const scenarioFiles = collectEvalScenarioFiles(evalsDir);
  const vacuousPasses: string[] = [];
  let positiveScenarios = 0;

  for (const file of scenarioFiles) {
    const scenario = ScenarioSchema.parse(Bun.YAML.parse(fs.readFileSync(file, "utf-8")));
    if (scenario.kind !== "positive") continue;
    positiveScenarios += 1;
    if (await vacuousResponsePasses(scenario)) {
      vacuousPasses.push(path.relative(evalsDir, file).replaceAll(path.sep, "/"));
    }
  }

  return {
    totalScenarios: scenarioFiles.length,
    positiveScenarios,
    rejectedScenarios: positiveScenarios - vacuousPasses.length,
    vacuousPasses,
  };
}

export async function main(argv = process.argv.slice(2)): Promise<number> {
  const evalsDir = path.resolve(argv[0] ?? path.join(import.meta.dir, "../evals"));
  const report = await checkEvalDiscrimination(evalsDir);
  console.log(JSON.stringify(report, null, 2));
  return report.vacuousPasses.length === 0 && report.positiveScenarios > 0 ? 0 : 1;
}

if (import.meta.main) {
  process.exitCode = await main();
}
