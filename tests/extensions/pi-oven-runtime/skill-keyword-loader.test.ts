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
  SHIPPED_SKILL_PATHS,
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

type ShippedSkillName = (typeof SHIPPED_SKILL_NAMES)[number];
type ShippedSkillPath = (typeof SHIPPED_SKILL_PATHS)[number];

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

function ownedSkillTarget(repoRoot: string, skillName: ShippedSkillName): string {
  const skillPath = `./skills/${skillName}/SKILL.md` as ShippedSkillPath;
  expect(SHIPPED_SKILL_PATHS).toContain(skillPath);
  return path.resolve(repoRoot, skillPath);
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

  it("loads keyword index entries from shipped skills with exact plugin-owned read targets", () => {
    const repoRoot = path.resolve(__dirname, "../../..");
    const index = loadSkillKeywordIndex(repoRoot);
    expect(index).toHaveLength(SHIPPED_SKILL_COUNT);
    expect(index.map((entry) => entry.name).sort()).toEqual([...SHIPPED_SKILL_NAMES].sort());

    const autonomous = index.find((entry) => entry.name === "autonomous-loop");
    const delegation = index.find((entry) => entry.name === "large-task-delegation");
    const htmlDecision = index.find((entry) => entry.name === "html-spec-decision-maker");

    expect(autonomous).toEqual(
      expect.objectContaining({
        ownedReadTarget: ownedSkillTarget(repoRoot, "autonomous-loop"),
        phrases: expect.arrayContaining(["자율 실행", "autopilot", "ralph로 돌려"]),
      })
    );
    expect(delegation).toEqual(
      expect.objectContaining({
        ownedReadTarget: ownedSkillTarget(repoRoot, "large-task-delegation"),
        phrases: expect.arrayContaining(["큰 작업", "large task", "multi-file refactor"]),
      })
    );
    expect(htmlDecision).toEqual(
      expect.objectContaining({
        ownedReadTarget: ownedSkillTarget(repoRoot, "html-spec-decision-maker"),
        phrases: expect.arrayContaining(["html spec", "의사결정 html", "decision worksheet"]),
      })
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

  it("matches user text to multiple skills and builds a plugin-owned must-read prompt", () => {
    const repoRoot = path.resolve(__dirname, "../../..");
    const index = loadSkillKeywordIndex(repoRoot);
    const started = updateSkillKeywordLoaderOnTurnStart(
      createSkillKeywordLoaderState(),
      [userEntry("u1", "자율 실행으로 큰 작업 진행해줘. spec 잡자 before coding.")],
      index
    );

    expect(started.matchedSkills).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "autonomous-loop",
          ownedReadTarget: ownedSkillTarget(repoRoot, "autonomous-loop"),
        }),
        expect.objectContaining({
          name: "large-task-delegation",
          ownedReadTarget: ownedSkillTarget(repoRoot, "large-task-delegation"),
        }),
        expect.objectContaining({
          name: "spec-and-review",
          ownedReadTarget: ownedSkillTarget(repoRoot, "spec-and-review"),
        }),
      ])
    );

    const prompt = buildKeywordMatchedSkillsPrompt(started.matchedSkills);
    expect(prompt).toContain(KEYWORD_SKILL_DEDUP_KEY);
    expect(prompt).toContain(ownedSkillTarget(repoRoot, "autonomous-loop"));
    expect(prompt).toContain(ownedSkillTarget(repoRoot, "large-task-delegation"));
    expect(prompt).toContain(ownedSkillTarget(repoRoot, "spec-and-review"));
    expect(prompt).toContain("plugin-owned");
    expect(prompt).toContain("single front door");
    expect(prompt).toContain("requiredSkills");
    expect(prompt).toContain("ownedSkillReadTargets");
    expect(prompt).toContain("skillReads");
    expect(prompt).toContain("Bootstrap message injection");
    expect(prompt).toContain("tool remap");
  });

  it("the matched-skills prompt frames exact plugin-owned reads as the explicit control-plane front door", () => {
    const prompt = buildKeywordMatchedSkillsPrompt([
      {
        name: "spec-and-review",
        rawMatchedPhrases: ["write a spec"],
        ownedReadTarget: "/plugin/skills/spec-and-review/SKILL.md",
      },
    ]);
    expect(prompt).not.toBeNull();
    expect(prompt!).toMatch(/hard precondition/i);
    expect(prompt!).toContain("/plugin/skills/spec-and-review/SKILL.md");
    expect(prompt!).toContain("plugin-owned");
    expect(prompt!).toContain("single front door");
    expect(prompt!).toContain("requiredSkills");
    expect(prompt!).toContain("ownedSkillReadTargets");
    expect(prompt!).toContain("skillReads");
    expect(prompt!).toContain("Bootstrap message injection");
    expect(prompt!).toContain("tool remap");
  });

  it("adds registry-driven deep-interview routing guidance to the matched-skills prompt", () => {
    const prompt = buildKeywordMatchedSkillsPrompt([
      {
        name: "spec-and-review",
        rawMatchedPhrases: ["design doc"],
        ownedReadTarget: "/plugin/skills/spec-and-review/SKILL.md",
      },
    ]);
    expect(prompt).not.toBeNull();
    expect(prompt!).toContain("pi-oven_ask");
    expect(prompt!).toContain("deepInterview");
    expect(prompt!).toMatch(/approval handoff|resume state|topology|milestone|threshold|spec persistence/i);
  });

  it("renders raw matched phrases while keeping provider policy symbolic", () => {
    const prompt = buildKeywordMatchedSkillsPrompt([
      {
        name: "spec-and-review",
        rawMatchedPhrases: ["codex review", "design doc"],
        ownedReadTarget: "/plugin/skills/spec-and-review/SKILL.md",
      },
      {
        name: "receiving-code-review",
        rawMatchedPhrases: ["codex review 결과 반영"],
        ownedReadTarget: "/plugin/skills/receiving-code-review/SKILL.md",
      },
    ]);
    expect(prompt).not.toBeNull();
    expect(prompt!).toContain("matched by: codex review, design doc");
    expect(prompt!).toContain("matched by: codex review 결과 반영");
    expect(prompt!).toContain("current-session-provider-family policy");
  });

  it("retains raw matched phrases for debugging while keeping injected provider policy symbolic", () => {
    const matched = matchSkillsForText("Please do a codex review before we lock this in.", [
      {
        name: "spec-and-review",
        description: "critic-gated spec loop",
        phrases: ["codex review"],
        ownedReadTarget: "/plugin/skills/spec-and-review/SKILL.md",
      },
    ]);
    expect(matched).toEqual([
      {
        name: "spec-and-review",
        rawMatchedPhrases: ["codex review"],
        ownedReadTarget: "/plugin/skills/spec-and-review/SKILL.md",
      },
    ]);
    const prompt = buildKeywordMatchedSkillsPrompt(matched);
    expect(prompt).not.toBeNull();
    expect(prompt!).toContain("matched by: codex review");
    expect(prompt!).toContain("current-session-provider-family policy");
  });
  it("buildKeywordMatchedSkillsPrompt emits exact SKILL.md file targets, not skill:// aliases", () => {
    const prompt = buildKeywordMatchedSkillsPrompt([
      {
        name: "brainstorming",
        rawMatchedPhrases: ["brainstorm"],
        ownedReadTarget: "/plugin/skills/brainstorming/SKILL.md",
      },
    ]);
    expect(prompt).not.toBeNull();
    expect(prompt!).toContain("/plugin/skills/brainstorming/SKILL.md");
    expect(prompt!).not.toContain("skill://pi-oven:brainstorming");
    const lines = prompt!.split("\n");
    const skillLines = lines.filter((l) => l.startsWith("- `") && l.includes("matched by:"));
    expect(skillLines.every((l) => l.includes("/SKILL.md"))).toBe(true);
  });
  it("keeps the exact phrase overlap matching the current skill order and owned targets", () => {
    const repoRoot = path.resolve(__dirname, "../../..");
    const index = loadSkillKeywordIndex(repoRoot);
    const matched = matchSkillsForText("자율 실행, 리팩토링 기회 찾아줘", index);
    expect(matched).toEqual([
      {
        name: "code-quality-discipline",
        rawMatchedPhrases: ["리팩토링"],
        ownedReadTarget: ownedSkillTarget(repoRoot, "code-quality-discipline"),
      },
      {
        name: "autonomous-loop",
        rawMatchedPhrases: ["자율 실행"],
        ownedReadTarget: ownedSkillTarget(repoRoot, "autonomous-loop"),
      },
      {
        name: "improve-codebase-architecture",
        rawMatchedPhrases: ["리팩토링 기회"],
        ownedReadTarget: ownedSkillTarget(repoRoot, "improve-codebase-architecture"),
      },
    ]);
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
