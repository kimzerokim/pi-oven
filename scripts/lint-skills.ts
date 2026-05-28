#!/usr/bin/env bun
/**
 * CI-time hard lint for pi-oven SKILL.md files.
 * Usage: bun scripts/lint-skills.ts [skillsDir]
 * Walks skillsDir for <name>/SKILL.md files. Validates that every
 * `pi-oven:<role>` token in the file body matches a role from profiles.ts ROLES.
 * Exits 0 on success, 1 on any violation.
 */

import { readdirSync } from "fs";
import { join } from "path";
import { ROLES } from "./pi-oven-setup/profiles";

const skillsDir = process.argv[2] ?? join(import.meta.dir, "..", "skills");

const roleSet = new Set<string>(ROLES as readonly string[]);
// Match `pi-oven:<role>` but NOT `/pi-oven:<command>` — slash commands live in a
// separate namespace and are not agent references.
const PI_OVEN_TOKEN = /(?<!\/)pi-oven:([a-z][a-z0-9-]*)/g;

let entries: string[];
try {
  entries = readdirSync(skillsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);
} catch {
  entries = [];
}

let violations = 0;

for (const dir of entries) {
  const skillPath = join(skillsDir, dir, "SKILL.md");
  let content: string;
  try {
    content = await Bun.file(skillPath).text();
  } catch {
    continue;
  }

  const seen = new Set<string>();
  let match: RegExpExecArray | null;
  PI_OVEN_TOKEN.lastIndex = 0;
  while ((match = PI_OVEN_TOKEN.exec(content)) !== null) {
    const ref = match[1];
    if (seen.has(ref)) continue;
    seen.add(ref);
    if (!roleSet.has(ref)) {
      console.error(
        `lint-skills: ERROR: skills/${dir}/SKILL.md references pi-oven:${ref} which is not in ROLES. ` +
          `Allowed roles: ${ROLES.join(", ")}`
      );
      violations++;
    }
  }
}

if (violations > 0) {
  process.exit(1);
}
