import { describe, it, expect } from "bun:test";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "../../");
const EVALS_DIR = path.join(ROOT, "evals");

function collectScenarioFiles(): string[] {
  const files: string[] = [];
  for (const evalDir of fs.readdirSync(EVALS_DIR, { withFileTypes: true })) {
    if (!evalDir.isDirectory()) continue;
    const scenariosDir = path.join(EVALS_DIR, evalDir.name, "scenarios");
    if (!fs.existsSync(scenariosDir)) continue;
    for (const f of fs.readdirSync(scenariosDir)) {
      if (f.endsWith(".yaml") || f.endsWith(".yml")) {
        files.push(path.join(scenariosDir, f));
      }
    }
  }
  return files;
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

  it("every agent_response_must_contain is a string array (or absent)", () => {
    const bad: string[] = [];
    for (const file of scenarioFiles) {
      const text = fs.readFileSync(file, "utf-8");
      const parsed = Bun.YAML.parse(text) as { expected?: Array<Record<string, unknown>> };
      if (!Array.isArray(parsed?.expected)) continue;
      for (const exp of parsed.expected) {
        if (!("agent_response_must_contain" in exp)) continue;
        const val = exp.agent_response_must_contain;
        const isStringArray =
          Array.isArray(val) && val.every((v) => typeof v === "string");
        if (!isStringArray) {
          bad.push(
            `${path.relative(ROOT, file)}: agent_response_must_contain is ${JSON.stringify(val)}`
          );
        }
      }
    }
    expect(bad).toEqual([]);
  });

  it("agent_response_must_contain_match is 'all' or 'any' when present", () => {
    const bad: string[] = [];
    for (const file of scenarioFiles) {
      const text = fs.readFileSync(file, "utf-8");
      const parsed = Bun.YAML.parse(text) as { expected?: Array<Record<string, unknown>> };
      if (!Array.isArray(parsed?.expected)) continue;
      for (const exp of parsed.expected) {
        if (!("agent_response_must_contain_match" in exp)) continue;
        const val = exp.agent_response_must_contain_match;
        if (val !== "all" && val !== "any") {
          bad.push(
            `${path.relative(ROOT, file)}: agent_response_must_contain_match="${val}" (must be 'all' or 'any')`
          );
        }
      }
    }
    expect(bad).toEqual([]);
  });
});
