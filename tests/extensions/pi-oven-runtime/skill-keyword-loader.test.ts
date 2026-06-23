import { describe, it, expect, afterEach } from "bun:test";
import path from "node:path";
import {
  createInstalledTopologyFixture,
  writePluginSkillsManifest,
  writeShippedSkill,
  type InstalledTopologyFixture,
} from "../../helpers/installed-topology";
import {
  SHIPPED_SKILL_COUNT,
  SHIPPED_SKILL_NAMES,
} from "../../../scripts/pi-oven-setup/shipped-skill-registry";
import {
  KEYWORD_SKILL_DEDUP_KEY,
  SKILL_KEYWORD_WHITELIST,
  buildKeywordMatchedSkillsPrompt,
  createSkillKeywordLoaderState,
  loadSkillKeywordIndex,
  loadSkillKeywordIndexReport,
  matchSkillsForText,
  updateSkillKeywordLoaderOnTurnStart,
} from "../../../.omp/extensions/pi-oven-runtime/skill-keyword-loader";

function userEntry(id: string, text: string) {
  return {
    id,
    type: "message",
    message: { role: "user", content: [{ type: "text", text }] },
  };
}

const fixtures: InstalledTopologyFixture[] = [];

function makeTempRepo(): string {
  const fixture = createInstalledTopologyFixture({ prefix: "pi-oven-skill-keyword-" });
  fixtures.push(fixture);
  return fixture.pluginRoot;
}

afterEach(() => {
  while (fixtures.length > 0) fixtures.pop()!.cleanup();
});


describe("skill-keyword-loader", () => {
  it("keeps the curated whitelist in exact parity with shipped skills", () => {
    expect(Object.keys(SKILL_KEYWORD_WHITELIST).sort()).toEqual([...SHIPPED_SKILL_NAMES].sort());
    expect(SKILL_KEYWORD_WHITELIST["autonomous-loop"]).toEqual(
      expect.arrayContaining(["자율 실행", "autopilot", "ralph로 돌려"])
    );
    expect(SKILL_KEYWORD_WHITELIST["large-task-delegation"]).toEqual(
      expect.arrayContaining(["큰 작업", "large task", "multi-file refactor"])
    );
    expect(SKILL_KEYWORD_WHITELIST["spec-and-review"]).toEqual(
      expect.arrayContaining(["spec 잡자", "plan draft", "codex review"])
    );
  });

  it("loads keyword index entries from shipped skills", () => {
    const index = loadSkillKeywordIndex(path.resolve(__dirname, "../../.."));
    expect(index).toHaveLength(SHIPPED_SKILL_COUNT);
    expect(index.map((entry) => entry.name).sort()).toEqual([...SHIPPED_SKILL_NAMES].sort());

    const autonomous = index.find((entry) => entry.name === "autonomous-loop");
    const delegation = index.find((entry) => entry.name === "large-task-delegation");
    const htmlDecision = index.find((entry) => entry.name === "html-spec-decision-maker");

    expect(autonomous).toBeDefined();
    expect(autonomous?.phrases).toEqual(
      expect.arrayContaining(["자율 실행", "autopilot", "ralph로 돌려"])
    );
    expect(delegation?.phrases).toEqual(
      expect.arrayContaining(["큰 작업", "large task", "multi-file refactor"])
    );
    expect(htmlDecision?.phrases).toEqual(
      expect.arrayContaining(["html spec", "의사결정 html", "decision worksheet"])
    );
  });

  it("loads valid shipped skills and reports missing whitelist coverage without aborting the whole index", () => {
    const repoRoot = makeTempRepo();
    writePluginSkillsManifest(repoRoot, [
      "./skills/brainstorming/SKILL.md",
      "./skills/keyword-gap/SKILL.md",
    ]);
    writeShippedSkill(repoRoot, "brainstorming");
    writeShippedSkill(repoRoot, "keyword-gap");

    const report = loadSkillKeywordIndexReport(repoRoot);

    expect(report.shippedSkillCount).toBe(2);
    expect(report.index.map((entry) => entry.name)).toEqual(["brainstorming"]);
    expect(report.issues).toHaveLength(1);
    expect(report.issues[0]?.skillName).toBe("keyword-gap");
    expect(report.issues[0]?.reason).toContain("missing keyword whitelist");
  });

  it("reports missing shipped skill files without aborting the installed keyword index", () => {
    const repoRoot = makeTempRepo();
    writePluginSkillsManifest(repoRoot, [
      "./skills/brainstorming/SKILL.md",
      "./skills/missing-skill/SKILL.md",
    ]);
    writeShippedSkill(repoRoot, "brainstorming");

    const report = loadSkillKeywordIndexReport(repoRoot);

    expect(report.shippedSkillCount).toBe(2);
    expect(report.index.map((entry) => entry.name)).toEqual(["brainstorming"]);
    expect(report.issues).toHaveLength(1);
    expect(report.issues[0]?.skillName).toBe("missing-skill");
    expect(report.issues[0]?.reason).toContain("ENOENT");
  });

  it("matches user text to multiple skills and builds a must-read prompt", () => {
    const index = loadSkillKeywordIndex(path.resolve(__dirname, "../../.."));
    const started = updateSkillKeywordLoaderOnTurnStart(
      createSkillKeywordLoaderState(),
      [userEntry("u1", "자율 실행으로 큰 작업 진행해줘. spec 잡자 before coding.")],
      index
    );

    const names = started.matchedSkills.map((skill) => skill.name);
    expect(names).toEqual(
      expect.arrayContaining(["autonomous-loop", "large-task-delegation", "spec-and-review"])
    );

    const prompt = buildKeywordMatchedSkillsPrompt(started.matchedSkills);
    expect(prompt).toContain(KEYWORD_SKILL_DEDUP_KEY);
    expect(prompt).toContain("skill://pi-oven:autonomous-loop");
    expect(prompt).toContain("skill://pi-oven:large-task-delegation");
    expect(prompt).toContain("skill://pi-oven:spec-and-review");
    expect(prompt).toContain("curated keyword whitelist");
  });

  it("the matched-skills prompt frames loading as a hard precondition, not a suggestion", () => {
    const prompt = buildKeywordMatchedSkillsPrompt([
      { name: "spec-and-review", matchedPhrases: ["write a spec"] },
    ]);
    expect(prompt).not.toBeNull();
    expect(prompt!).toMatch(/hard precondition/i);
    // body text must use the namespaced form
    expect(prompt!).toContain('read("skill://pi-oven:<name>")');
  });

  it("buildKeywordMatchedSkillsPrompt emits namespaced skill:// URIs, not bare ones", () => {
    const prompt = buildKeywordMatchedSkillsPrompt([
      { name: "brainstorming", matchedPhrases: ["brainstorm"] },
    ]);
    expect(prompt).not.toBeNull();
    // must contain the namespaced form
    expect(prompt!).toContain("skill://pi-oven:brainstorming");
    // must NOT contain a bare (non-namespaced) skill:// line entry
    // (bare skill:// in the body text example is updated too, so we check no line-item bare form)
    const lines = prompt!.split("\n");
    const skillLines = lines.filter((l) => l.startsWith("- `skill://"));
    expect(skillLines.every((l) => l.includes("skill://pi-oven:"))).toBe(true);
  });

  it("matches the broadened common phrasings for the user-triggered skills", () => {
    const index = loadSkillKeywordIndex(path.resolve(__dirname, "../../.."));
    const cases: Array<{ text: string; expect: string }> = [
      // debugging
      { text: "debug this please", expect: "systematic-debugging" },
      { text: "fix the bug in the parser", expect: "systematic-debugging" },
      { text: "why is it failing", expect: "systematic-debugging" },
      // research
      { text: "research this topic", expect: "deep-dive" },
      { text: "I need a research report", expect: "html-research-orchestrator" },
      { text: "의사결정 html로 정리해줘", expect: "html-spec-decision-maker" },
      { text: "Create a pre-decision html worksheet", expect: "html-spec-decision-maker" },
      // spec
      { text: "write a spec for this", expect: "spec-and-review" },
      { text: "let's write a design doc", expect: "spec-and-review" },
      // plan
      { text: "give me an implementation plan", expect: "writing-plans" },
      { text: "break it down into steps", expect: "writing-plans" },
      // tdd
      { text: "use test driven development", expect: "tdd-strict" },
      { text: "write tests first", expect: "tdd-strict" },
      // commit
      { text: "commit this now", expect: "pre-commit-gate" },
      { text: "ready to commit", expect: "pre-commit-gate" },
    ];
    for (const c of cases) {
      const matched = matchSkillsForText(c.text, index).map((m) => m.name);
      expect(matched).toContain(c.expect);
    }
  });
});
