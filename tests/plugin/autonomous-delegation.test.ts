import { describe, it, expect } from "bun:test";
import { readFile } from "node:fs/promises";
import path from "node:path";

const SKILL_PATH = path.resolve(__dirname, "../../skills/autonomous-loop/SKILL.md");
const PLANNER_PATH = path.resolve(__dirname, "../../agents/pov-planner.md");
const CODEBASE_SURVEY_ADVERSARIAL_PATH = path.resolve(__dirname, "../../evals/codebase-survey/scenarios/adversarial.yaml");

describe("autonomous delegation-first policy", () => {
  it("skill defines broad exploration before first spec scope", async () => {
    const content = await readFile(SKILL_PATH, "utf-8");
    expect(content).toContain("-1 — Broad exploration");
    expect(content).toContain("explorer");
    expect(content).toContain("tracer");
    expect(content).toContain("analyst");
    expect(content).toContain("at least 3 adjacent subsystems");
    expect(content).toContain("at least 2 alternative improvement directions");
  });

  it("skill enforces main as orchestrator-only", async () => {
    const content = await readFile(SKILL_PATH, "utf-8");
    expect(content).toContain("Main agent role: orchestrator only");
    expect(content).toContain("MUST NOT implement inline code");
  });

  it("planner and survey eval enforce full-sweep, no-sampling evidence", async () => {
    const plannerContent = await readFile(PLANNER_PATH, "utf-8");
    expect(plannerContent).toContain("pi-oven self-improvement or plugin-surface planning");
    expect(plannerContent).toContain("MUST require full-sweep, no-sampling survey evidence");
    expect(plannerContent).toContain("MUST reject plan generation and request a re-survey");
    expect(plannerContent).toContain("skills/");
    expect(plannerContent).toContain("commands/");
    expect(plannerContent).toContain("agents/");
    expect(plannerContent).toContain("evals/");

    const surveyAdversarialContent = await readFile(CODEBASE_SURVEY_ADVERSARIAL_PATH, "utf-8");
    expect(surveyAdversarialContent).toContain("no sampling");
    expect(surveyAdversarialContent).toContain("skills");
    expect(surveyAdversarialContent).toContain("commands");
    expect(surveyAdversarialContent).toContain("agents");
    expect(surveyAdversarialContent).toContain("evals");
    expect(surveyAdversarialContent).toContain("planning before full sweep");
  });
});
