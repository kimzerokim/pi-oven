import { describe, it, expect } from "bun:test";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

// Detect Korean unicode range (Hangul syllables U+AC00–U+D7A3 + Jamo)
// [가-힣] is the canonical Hangul syllables block (U+AC00–U+D7A3)
const KOREAN_PROSE_REGEX = /[가-힣ᄀ-ᇿ㄰-㆏]{5,}/;

// Recursively collect all .md files under a directory
async function collectMdFiles(dir: string): Promise<string[]> {
  const results: string[] = [];
  const entries = await readdir(dir);
  for (const entry of entries) {
    const full = path.join(dir, entry);
    const s = await stat(full);
    if (s.isDirectory()) {
      results.push(...(await collectMdFiles(full)));
    } else if (entry.endsWith(".md")) {
      results.push(full);
    }
  }
  return results;
}

function scanForKoreanProse(content: string, relPath: string): string[] {
  const violations: string[] = [];
  const lines = content.split("\n");
  let inFrontmatter = false;
  let frontmatterCount = 0;
  let inFencedBlock = false;
  lines.forEach((line, i) => {
    if (line.trim() === "---" && !inFencedBlock) {
      frontmatterCount++;
      inFrontmatter = frontmatterCount <= 2;
      return;
    }
    if (inFrontmatter) return; // frontmatter: allow Korean in trigger: field
    // Track fenced code blocks (``` ... ```)
    if (line.trim().startsWith("```")) {
      inFencedBlock = !inFencedBlock;
      return;
    }
    if (inFencedBlock) return; // inside fenced block: Korean string literals allowed
    // Body text outside fenced blocks: detect Korean prose (5+ consecutive Korean chars)
    if (KOREAN_PROSE_REGEX.test(line)) {
      violations.push(`${relPath}:${i + 1}: ${line.trim()}`);
    }
  });
  return violations;
}

describe("skills/ English-only body (SKILL.md + references/*.md)", () => {
  it("no Korean prose outside trigger field and fenced code blocks in any .md file under skills/", async () => {
    // Scope: skills/**/*.md — includes SKILL.md and references/*.md per §3.3
    const skillsDir = path.resolve(__dirname, "../../skills");
    const allMdFiles = await collectMdFiles(skillsDir);
    const violations: string[] = [];

    for (const filePath of allMdFiles) {
      try {
        const content = await readFile(filePath, "utf-8");
        const relPath = path.relative(skillsDir, filePath);
        violations.push(...scanForKoreanProse(content, relPath));
      } catch {
        // unreadable file — skip
      }
    }

    expect(violations).toEqual([]);
  });
});
