#!/usr/bin/env bun

import { readdirSync } from "fs";
import { join, resolve } from "path";
import { ROLE_NAMES } from "../.omp/extensions/pi-oven-runtime/runtime-contract";

const defaultSkillsDir = join(import.meta.dir, "..", "skills");
const skillsDir = process.argv[2] ?? defaultSkillsDir;
const roleSet = new Set<string>(ROLE_NAMES);

const POV_TOKEN = /(?<!skill:\/\/)\bpov:([a-z][a-z0-9-]*)/g;
const LEGACY_AGENT_TOKEN = /(?<!\/)pi-oven:([a-z][a-z0-9-]*)/g;
const POV_AGENT_PATH = /\bagents\/pov-([a-z][a-z0-9-]*)\.md\b/g;
const LEGACY_AGENT_PATH = /\bagents\/pi-oven-([a-z][a-z0-9-]*)\.md\b/g;
const SKILL_URI = /skill:\/\/(?:pov:)?([a-z][a-z0-9-]*)/g;
const FRONTMATTER_NAME = /^name:\s*["']?([^"'\n]+)["']?\s*$/m;
const BACKTICK_TOKEN = /`([a-z][a-z0-9-]*)`/g;
const PHANTOM_SKILL_DENYLIST = new Set(["freshness-guard", "executing-plans"]);

function bodyOf(content: string): string {
  const match = content.match(/^---\n[\s\S]*?\n---\n?/);
  return match ? content.slice(match[0].length) : content;
}

function readSkillDirs(root: string): string[] {
  try {
    return readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
  } catch {
    return [];
  }
}

async function readSkillFile(path: string): Promise<string | null> {
  try {
    return await Bun.file(path).text();
  } catch {
    return null;
  }
}

function lintPublicSkillName(skillName: string, content: string): string[] {
  const expected = `pov:${skillName}`;
  const actual = content.match(FRONTMATTER_NAME)?.[1].trim();
  if (actual === expected) return [];
  return [
    actual === undefined
      ? `skills/${skillName}/SKILL.md is missing frontmatter name ${expected}.`
      : `skills/${skillName}/SKILL.md must use public frontmatter name ${expected}; found ${actual}.`,
  ];
}

function scanUnique(regex: RegExp, content: string): Array<{ value: string; full: string }> {
  regex.lastIndex = 0;
  const found = new Map<string, { value: string; full: string }>();
  let match: RegExpExecArray | null;
  while ((match = regex.exec(content)) !== null) {
    found.set(match[0], { value: match[1], full: match[0] });
  }
  return [...found.values()];
}

function lintAgentRefs(
  skillName: string,
  content: string
): { errors: string[]; roles: Set<string> } {
  const body = bodyOf(content);
  const errors: string[] = [];
  const roles = new Set<string>();

  for (const { value: role } of scanUnique(POV_TOKEN, body)) {
    if (roleSet.has(role)) roles.add(role);
    else {
      errors.push(
        `skills/${skillName}/SKILL.md references pov:${role} which is not in ROLE_NAMES. Allowed roles: ${ROLE_NAMES.join(", ")}`
      );
    }
  }
  for (const { value: role, full } of scanUnique(POV_AGENT_PATH, body)) {
    if (roleSet.has(role)) roles.add(role);
    else {
      errors.push(
        `skills/${skillName}/SKILL.md references ${full} which does not map to a ROLE_NAMES entry. Allowed roles: ${ROLE_NAMES.join(", ")}`
      );
    }
  }
  for (const { value: role, full } of scanUnique(LEGACY_AGENT_TOKEN, body)) {
    errors.push(
      `skills/${skillName}/SKILL.md references legacy ${full}; canonical agent token is pov:${role}. /pi-oven:* commands remain valid.`
    );
  }
  for (const { value: role, full } of scanUnique(LEGACY_AGENT_PATH, body)) {
    errors.push(
      `skills/${skillName}/SKILL.md references legacy ${full}; canonical agent path is agents/pov-${role}.md. /pi-oven:* commands remain valid.`
    );
  }
  return { errors, roles };
}

function lintSkillRefs(skillName: string, content: string, validSkills: Set<string>): string[] {
  const errors: string[] = [];
  for (const { value: ref, full } of scanUnique(SKILL_URI, content)) {
    if (!validSkills.has(ref)) {
      errors.push(
        `skills/${skillName}/SKILL.md references ${full} which is not a shipped skill.`
      );
    }
  }
  for (const { value: token } of scanUnique(BACKTICK_TOKEN, content)) {
    if (PHANTOM_SKILL_DENYLIST.has(token)) {
      errors.push(
        `skills/${skillName}/SKILL.md references removed phantom skill \`${token}\` — not a shipped skill. Use inline prose or a real skill://<name>.`
      );
    }
  }
  return errors;
}

function shouldRequireRoleCoverage(root: string): boolean {
  if (process.env.PI_OVEN_LINT_REQUIRE_ROLE_COVERAGE === "1") return true;
  if (process.env.PI_OVEN_LINT_REQUIRE_ROLE_COVERAGE === "0") return false;
  return resolve(root) === resolve(defaultSkillsDir);
}

async function main(): Promise<void> {
  const dirs = readSkillDirs(skillsDir);
  const validSkills = new Set(dirs);
  const coveredRoles = new Set<string>();
  const errors: string[] = [];

  for (const skillName of dirs) {
    const content = await readSkillFile(join(skillsDir, skillName, "SKILL.md"));
    if (content === null) continue;
    errors.push(...lintPublicSkillName(skillName, content));
    const agentRefs = lintAgentRefs(skillName, content);
    errors.push(...agentRefs.errors);
    agentRefs.roles.forEach((role) => coveredRoles.add(role));
    errors.push(...lintSkillRefs(skillName, content, validSkills));
  }

  if (shouldRequireRoleCoverage(skillsDir)) {
    const missing = ROLE_NAMES.filter((role) => !coveredRoles.has(role));
    if (missing.length > 0) {
      errors.push(
        `skills role coverage missing for: ${missing.join(", ")}. Add at least one valid pov:<role> reference in skills/*.`
      );
    }
  }

  errors.forEach((error) => console.error(`lint-skills: ERROR: ${error}`));
  if (errors.length > 0) process.exit(1);
}

await main();
