import { describe, it, expect } from "bun:test";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { SKILL_KEYWORD_WHITELIST } from "../../.omp/extensions/pi-oven-runtime/skill-keyword-loader";

const SKILLS_ROOT = path.resolve(__dirname, "../../skills");

async function readFrontmatterDescription(skill: string): Promise<string> {
  const skillPath = path.join(SKILLS_ROOT, skill, "SKILL.md");
  const content = await readFile(skillPath, "utf-8");
  const match = content.match(/^description:\s*"(.+)"$/m);
  expect(match).not.toBeNull();
  return match![1];
}

describe("skill activation metadata contract", () => {
  it("keeps trigger lists out of frontmatter descriptions", async () => {
    const dirents = await readdir(SKILLS_ROOT, { withFileTypes: true });
    for (const dirent of dirents) {
      if (!dirent.isDirectory()) continue;
      const description = await readFrontmatterDescription(dirent.name);
      expect(description.includes("triggers:")).toBe(false);
      expect(description.includes("user says ")).toBe(false);
      expect(description.includes("asks to ")).toBe(false);
    }
  });

  it("defines a non-empty curated keyword whitelist for every shipped skill", async () => {
    const dirents = await readdir(SKILLS_ROOT, { withFileTypes: true });
    for (const dirent of dirents) {
      if (!dirent.isDirectory()) continue;
      const phrases = SKILL_KEYWORD_WHITELIST[dirent.name];
      expect(Array.isArray(phrases)).toBe(true);
      expect(phrases.length).toBeGreaterThan(0);
    }
  });
});
