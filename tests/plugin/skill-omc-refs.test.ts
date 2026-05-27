import { describe, it, expect } from "bun:test";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

// Recursively collect all files under a directory
async function collectFiles(dir: string): Promise<string[]> {
  const results: string[] = [];
  const entries = await readdir(dir);
  for (const entry of entries) {
    const full = path.join(dir, entry);
    const s = await stat(full);
    if (s.isDirectory()) {
      results.push(...(await collectFiles(full)));
    } else {
      results.push(full);
    }
  }
  return results;
}

describe("skills/ omc ref sweep", () => {
  it("no oh-my-claudecode: or omo: refs in any file under skills/", async () => {
    const skillsDir = path.resolve(__dirname, "../../skills");
    const allFiles = await collectFiles(skillsDir);
    const violations: string[] = [];

    for (const filePath of allFiles) {
      try {
        const content = await readFile(filePath, "utf-8");
        const relPath = path.relative(skillsDir, filePath);
        const lines = content.split("\n");
        lines.forEach((line, i) => {
          if (line.includes("oh-my-claudecode:") || line.includes("omo:")) {
            violations.push(`skills/${relPath}:${i + 1}: ${line.trim()}`);
          }
        });
      } catch {
        // binary or unreadable file — skip
      }
    }

    expect(violations).toEqual([]);
  });
});
