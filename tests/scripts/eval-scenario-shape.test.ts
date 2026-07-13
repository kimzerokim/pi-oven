import { describe, it, expect } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { ScenarioSchema } from "../../scripts/lib/scenario-schema";

const ROOT = path.resolve(__dirname, "../../");
const EVALS_DIR = path.join(ROOT, "evals");

function collectScenarioFiles(): string[] {
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
  visit(EVALS_DIR);
  return files.sort();
}

describe("eval scenario YAML structural validation", () => {
  const scenarioFiles = collectScenarioFiles();

  it("finds at least one scenario file", () => {
    expect(scenarioFiles.length).toBeGreaterThan(0);
  });

  it("every scenario parses as valid YAML", () => {
    for (const file of scenarioFiles) {
      const text = fs.readFileSync(file, "utf-8");
      expect(() => Bun.YAML.parse(text)).not.toThrow(`${file} failed to parse`);
    }
  });

  it("every scenario conforms to the hard-evidence contract", () => {
    const invalid: string[] = [];
    for (const file of scenarioFiles) {
      const result = ScenarioSchema.safeParse(Bun.YAML.parse(fs.readFileSync(file, "utf-8")));
      if (!result.success) {
        invalid.push(
          `${path.relative(ROOT, file)}: ${result.error.issues
            .map((issue) => `${issue.path.join(".") || "<root>"}: ${issue.message}`)
            .join("; ")}`,
        );
      }
    }
    expect(invalid).toEqual([]);
  });

  it("manifest explicitly classifies every skill and harness suite", () => {
    const manifestPath = path.join(EVALS_DIR, "manifest.yaml");
    expect(fs.existsSync(manifestPath)).toBe(true);
    const manifest = Bun.YAML.parse(fs.readFileSync(manifestPath, "utf-8")) as {
      version: number;
      suites: Array<{ id: string; class: "skill" | "harness"; path: string; skill?: string }>;
    };
    expect(manifest.version).toBe(1);

    const declared = manifest.suites.map((suite) => suite.path).sort();
    const actual = [
      ...new Set(
        scenarioFiles.map((file) =>
          path.relative(EVALS_DIR, path.dirname(file)).replaceAll(path.sep, "/"),
        ),
      ),
    ].sort();
    expect(declared).toEqual(actual);
    expect(new Set(manifest.suites.map((suite) => suite.id)).size).toBe(manifest.suites.length);
    expect(manifest.suites.filter((suite) => suite.class === "harness").map((suite) => suite.id).sort())
      .toEqual([
        "harness/dogfood",
        "harness/eval-runner",
        "harness/runtime-canary",
        "harness/task-dispatch",
      ]);
    for (const suite of manifest.suites) {
      expect(suite.path.endsWith("/scenarios")).toBe(true);
      if (suite.class === "skill") expect(suite.skill).toBe(suite.id);
    }
  });

  it("contains no legacy telemetry-only scoring fields", () => {
    const legacyFields = [
      "agent_response_must_contain",
      "agent_response_must_not_contain",
      "skill_read_required",
      "skill_triggered",
      "tool_calls_required",
      "tool_calls_forbidden",
      "tool_calls_forbidden_first",
    ];
    const violations: string[] = [];
    for (const file of scenarioFiles) {
      const text = fs.readFileSync(file, "utf-8");
      for (const field of legacyFields) {
        if (new RegExp(`^\\s*-?\\s*${field}:`, "m").test(text)) {
          violations.push(`${path.relative(ROOT, file)}: ${field}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });
});

describe("scenario contract", () => {
  it("rejects a positive scenario without a hard positive assertion", () => {
    const parsed = Bun.YAML.parse(`
name: vacuous-positive
skill: brainstorming
kind: positive
tag: smoke
input:
  - turn: 1
    user: help me design this
expected:
  - response_must_not_contain: [danger]
  - observe_response_contains: [design]
  - observe_tool_call: { namePattern: "read|search" }
`);

    expect(() => ScenarioSchema.parse(parsed)).toThrow(/hard positive assertion/i);
  });

  it("requires pure negative scenarios to declare kind: negative", () => {
    const pureNegativeWithoutKind = Bun.YAML.parse(`
name: safety-only
skill: brainstorming
tag: adversarial
input:
  - turn: 1
    user: start coding before design approval
expected:
  - response_must_not_contain: [starting code]
`);

    expect(() => ScenarioSchema.parse(pureNegativeWithoutKind)).toThrow(/kind/i);
  });

  it("accepts an explicitly classified pure negative scenario", () => {
    const pureNegative = Bun.YAML.parse(`
name: safety-only
skill: brainstorming
kind: negative
tag: adversarial
input:
  - turn: 1
    user: start coding before design approval
expected:
  - response_must_not_contain: [starting code]
`);

    expect(ScenarioSchema.parse(pureNegative).kind).toBe("negative");
  });

  it("preserves exact tool arguments for canonical agent assertions", () => {
    const scenario = ScenarioSchema.parse({
      name: "canonical-dispatch",
      skill: "large-task-delegation",
      kind: "positive",
      tag: "canary",
      input: [{ turn: 1, user: "delegate this" }],
      expected: [
        { tool_call_required: { namePattern: "^task$", args: { agent: "pov:executor" } } },
      ],
    });

    expect(scenario.expected[0]?.tool_call_required?.args).toEqual({ agent: "pov:executor" });
  });
});
