import { describe, it, expect } from "bun:test";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { ROLES } from "../../scripts/pi-oven-setup/profiles";

const SKILLS_ROOT = path.resolve(__dirname, "../../skills");
const ROLE_TOKEN = /(?<!\/)pov:([a-z][a-z0-9-]*)/g;

describe("skill role coverage", () => {
  it("all declared pov roles appear in at least one SKILL.md", async () => {
    const dirs = await readdir(SKILLS_ROOT, { withFileTypes: true });
    const seen = new Set<string>();

    for (const dirent of dirs) {
      if (!dirent.isDirectory()) continue;
      const skillPath = path.join(SKILLS_ROOT, dirent.name, "SKILL.md");
      let content: string;
      try {
        content = await readFile(skillPath, "utf-8");
      } catch {
        continue;
      }

      ROLE_TOKEN.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = ROLE_TOKEN.exec(content)) !== null) {
        seen.add(match[1]);
      }
    }

    const missing = ROLES.filter((role) => !seen.has(role));
    expect(missing).toEqual([]);
  });
});
