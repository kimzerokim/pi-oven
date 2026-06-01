#!/usr/bin/env bun
/**
 * CI-time hard lint for pi-oven SKILL.md files.
 * Usage: bun scripts/lint-skills.ts [skillsDir]
 * Walks skillsDir for <name>/SKILL.md files.
 * Validates:
 *  - every `pi-oven:<role>` token in body resolves to a known role
 *  - every skill trigger has Korean keyword coverage for Korean utterances
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
const KOREAN_REGEX = /[가-힣]/;

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

function parseFrontmatter(content: string): Record<string, string> {
  const lines = content.split("\n");
  if (lines[0]?.trim() !== "---") return {};

  const out: Record<string, string> = {};
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === "---") break;
    const idx = line.indexOf(":");
    if (idx <= 0) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    out[key] = value;
  }
  return out;
}

function unquote(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

function isKoreanTriggerOptional(skillName: string): boolean {
  // primarily auto-applies from tool-call context, not user utterance
  return skillName === "code-quality-discipline";
}

function lintTrigger(skillName: string, content: string): string[] {
  const errors: string[] = [];
  const frontmatter = parseFrontmatter(content);
  const trigger = frontmatter["trigger"];

  if (!trigger) {
    errors.push(`skills/${skillName}/SKILL.md missing trigger field.`);
    return errors;
  }

  if (isKoreanTriggerOptional(skillName)) {
    return errors;
  }

  if (!KOREAN_REGEX.test(unquote(trigger))) {
    errors.push(
      `skills/${skillName}/SKILL.md trigger must include at least one Korean keyword for Korean utterance activation coverage.`
    );
  }

  return errors;
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

function shouldRequireRoleCoverage(skillsRoot: string): boolean {
  const env = process.env.PI_OVEN_LINT_REQUIRE_ROLE_COVERAGE;
  if (env === "1") return true;
  if (env === "0") return false;
  return resolve(skillsRoot) === resolve(defaultSkillsDir);
}

async function main(): Promise<void> {
  const dirs = readSkillDirs(skillsDir);
  const errors: string[] = [];
  const roleCoverage = new Set<string>();

  for (const dir of dirs) {
    const skillPath = join(skillsDir, dir, "SKILL.md");
    const content = await readSkillFile(skillPath);
    if (content == null) continue;

    errors.push(...lintTrigger(dir, content));
    errors.push(...lintRoleTokens(dir, content));
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
