import { describe, it, expect } from "bun:test";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { SKILL_KEYWORD_WHITELIST } from "../../.omp/extensions/pi-oven-runtime/skill-keyword-loader";
import {
  SHIPPED_SKILL_NAMES,
  shippedSkillNamesFromPaths,
} from "../../scripts/pi-oven-setup/shipped-skill-registry";

const ROOT = path.resolve(__dirname, "../../");
const SKILLS_ROOT = path.join(ROOT, "skills");

async function readFrontmatterDescription(skill: string): Promise<string> {
  const skillPath = path.join(SKILLS_ROOT, skill, "SKILL.md");
  const content = await readFile(skillPath, "utf-8");
  const match = content.match(/^description:\s*"(.+)"$/m);
  expect(match).not.toBeNull();
  return match![1];
}

async function readPluginSkillNames(): Promise<string[]> {
  const plugin = (await Bun.file(path.join(ROOT, ".claude-plugin/plugin.json")).json()) as {
    skills?: unknown;
  };
  const skillPaths = Array.isArray(plugin.skills)
    ? plugin.skills.filter((skill): skill is string => typeof skill === "string")
    : [];
  return shippedSkillNamesFromPaths(skillPaths);
}

describe("skill activation metadata contract", () => {
  it("keeps trigger lists out of shipped skill frontmatter descriptions", async () => {
    for (const skill of SHIPPED_SKILL_NAMES) {
      const description = await readFrontmatterDescription(skill);
      expect(description.includes("triggers:")).toBe(false);
      expect(description.includes("user says ")).toBe(false);
      expect(description.includes("asks to ")).toBe(false);
    }
  });

  it("keeps plugin.json, the shipped-skill registry, and keyword whitelist keys in exact parity", async () => {
    expect(await readPluginSkillNames()).toEqual(SHIPPED_SKILL_NAMES);
    expect(Object.keys(SKILL_KEYWORD_WHITELIST).sort()).toEqual([...SHIPPED_SKILL_NAMES].sort());
  });

  it("defines a non-empty curated keyword whitelist for every shipped skill", () => {
    for (const skill of SHIPPED_SKILL_NAMES) {
      const phrases = SKILL_KEYWORD_WHITELIST[skill];
      expect(Array.isArray(phrases)).toBe(true);
      expect(phrases.length).toBeGreaterThan(0);
    }
  });
});
