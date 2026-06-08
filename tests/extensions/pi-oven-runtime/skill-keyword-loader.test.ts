import { describe, it, expect } from "bun:test";
import path from "node:path";
import {
  KEYWORD_SKILL_DEDUP_KEY,
  SKILL_KEYWORD_WHITELIST,
  buildKeywordMatchedSkillsPrompt,
  createSkillKeywordLoaderState,
  loadSkillKeywordIndex,
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

describe("skill-keyword-loader", () => {
  it("defines a curated whitelist for every shipped skill", () => {
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
    expect(index).toHaveLength(22);

    const autonomous = index.find((entry) => entry.name === "autonomous-loop");
    const delegation = index.find((entry) => entry.name === "large-task-delegation");

    expect(autonomous).toBeDefined();
    expect(autonomous?.phrases).toEqual(
      expect.arrayContaining(["자율 실행", "autopilot", "ralph로 돌려"])
    );
    expect(delegation?.phrases).toEqual(
      expect.arrayContaining(["큰 작업", "large task", "multi-file refactor"])
    );
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
    expect(prompt).toContain("skill://autonomous-loop");
    expect(prompt).toContain("skill://large-task-delegation");
    expect(prompt).toContain("skill://spec-and-review");
    expect(prompt).toContain("curated keyword whitelist");
  });

  it("the matched-skills prompt frames loading as a hard precondition, not a suggestion", () => {
    const prompt = buildKeywordMatchedSkillsPrompt([
      { name: "spec-and-review", matchedPhrases: ["write a spec"] },
    ]);
    expect(prompt).not.toBeNull();
    expect(prompt!).toMatch(/hard precondition/i);
    // existing MUST-load line preserved
    expect(prompt!).toContain('read("skill://<name>")');
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
