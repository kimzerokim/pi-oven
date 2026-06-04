#!/usr/bin/env bun
/**
 * CI-time hard lint for pi-oven SKILL.md files.
 * Usage: bun scripts/lint-skills.ts [skillsDir]
 * Walks skillsDir for <name>/SKILL.md files.
 * Validates:
 *  - every `pi-oven:<role>` token in body resolves to a known role
 *  - role coverage across all skills
 */

import { readdirSync } from "fs";
import { join, resolve } from "path";
import { ROLES } from "./pi-oven-setup/profiles";

const defaultSkillsDir = join(import.meta.dir, "..", "skills");
const skillsDir = process.argv[2] ?? defaultSkillsDir;

const roleSet = new Set<string>(ROLES as readonly string[]);
// Match `pi-oven:<role>` but NOT `/pi-oven:<command>` — slash commands live in a
// separate namespace and are not agent references.
const PI_OVEN_TOKEN = /(?<!\/)pi-oven:([a-z][a-z0-9-]*)/g;

// Known phantom skill names removed from the tree — must never reappear as a
// bare backtick skill reference. Skill→skill references should use skill://<name>.
const PHANTOM_SKILL_DENYLIST = new Set<string>(["freshness-guard", "executing-plans"]);
// skill://<name> or skill://pi-oven/<name>/… — capture the skill name segment.
const SKILL_URI = /skill:\/\/(?:pi-oven\/)?([a-z][a-z0-9-]*)/g;
const BACKTICK_TOKEN = /`([a-z][a-z0-9-]*)`/g;

function readSkillDirs(root: string): string[] {
  try {
    return readdirSync(root, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
  } catch {
    return [];
  }
}

async function readSkillFile(skillPath: string): Promise<string | null> {
  try {
    return await Bun.file(skillPath).text();
  } catch {
    return null;
  }
}


function lintRoleTokens(skillName: string, content: string): string[] {
  const errors: string[] = [];
  const seen = new Set<string>();

  let match: RegExpExecArray | null;
  PI_OVEN_TOKEN.lastIndex = 0;
  while ((match = PI_OVEN_TOKEN.exec(content)) !== null) {
    const ref = match[1];
    if (seen.has(ref)) continue;
    seen.add(ref);
    if (!roleSet.has(ref)) {
      errors.push(
        `skills/${skillName}/SKILL.md references pi-oven:${ref} which is not in ROLES. Allowed roles: ${ROLES.join(", ")}`
      );
    }
  }

  return errors;
}

/** Validate skill→skill references: skill://<name> URIs must resolve to a
 *  shipped skill, and removed phantom skill names must not reappear. */
function lintSkillRefs(skillName: string, content: string, validSkills: Set<string>): string[] {
  const errors: string[] = [];
  let match: RegExpExecArray | null;

  SKILL_URI.lastIndex = 0;
  const seenUri = new Set<string>();
  while ((match = SKILL_URI.exec(content)) !== null) {
    const ref = match[1];
    if (seenUri.has(ref)) continue;
    seenUri.add(ref);
    if (!validSkills.has(ref)) {
      errors.push(
        `skills/${skillName}/SKILL.md references skill://${ref} which is not a shipped skill.`
      );
    }
  }

  BACKTICK_TOKEN.lastIndex = 0;
  const seenTok = new Set<string>();
  while ((match = BACKTICK_TOKEN.exec(content)) !== null) {
    const tok = match[1];
    if (seenTok.has(tok)) continue;
    seenTok.add(tok);
    if (PHANTOM_SKILL_DENYLIST.has(tok)) {
      errors.push(
        `skills/${skillName}/SKILL.md references removed phantom skill \`${tok}\` — not a shipped skill. Use inline prose or a real skill://<name>.`
      );
    }
  }

  return errors;
}

function shouldRequireRoleCoverage(skillsRoot: string): boolean {
  const env = process.env.PI_OVEN_LINT_REQUIRE_ROLE_COVERAGE;
  if (env === "1") return true;
  if (env === "0") return false;
  return resolve(skillsRoot) === resolve(defaultSkillsDir);
}

async function main(): Promise<void> {
  const dirs = readSkillDirs(skillsDir);
  const validSkills = new Set(dirs);
  const errors: string[] = [];
  const roleCoverage = new Set<string>();

  for (const dir of dirs) {
    const skillPath = join(skillsDir, dir, "SKILL.md");
    const content = await readSkillFile(skillPath);
    if (content == null) continue;

    errors.push(...lintRoleTokens(dir, content));
    errors.push(...lintSkillRefs(dir, content, validSkills));
    let match: RegExpExecArray | null;
    PI_OVEN_TOKEN.lastIndex = 0;
    while ((match = PI_OVEN_TOKEN.exec(content)) !== null) {
      const ref = match[1];
      if (roleSet.has(ref)) roleCoverage.add(ref);
    }
  }

  if (shouldRequireRoleCoverage(skillsDir)) {
    const uncovered = ROLES.filter((role) => !roleCoverage.has(role));
    if (uncovered.length > 0) {
      errors.push(
        `skills role coverage missing for: ${uncovered.join(
          ", "
        )}. Add at least one valid pi-oven:<role> reference in skills/*.`
      );
    }
  }

  for (const err of errors) {
    console.error(`lint-skills: ERROR: ${err}`);
  }

  if (errors.length > 0) {
    process.exit(1);
  }
}

await main();
