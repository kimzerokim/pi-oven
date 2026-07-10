#!/usr/bin/env bun
/**
 * CI-time hard lint for pi-oven SKILL.md files.
 * Usage: bun scripts/lint-skills.ts [skillsDir]
 * Walks skillsDir for <name>/SKILL.md files.
 * Validates:
 *  - every canonical `pov:<role>` token in body resolves to a known role
 *  - legacy `pi-oven:<role>` agent tokens appear only in narrow shipped-skill / diagnostic migration contexts
 *  - role coverage across all skills
 */

import { readdirSync } from "fs";
import { join, resolve } from "path";
import { ROLES } from "./pi-oven-setup/profiles";

const defaultSkillsDir = join(import.meta.dir, "..", "skills");
const skillsDir = process.argv[2] ?? defaultSkillsDir;

const roleSet = new Set<string>(ROLES as readonly string[]);
const PUBLIC_SKILL_PREFIX = "pov:";
// Canonical role refs are `pov:<role>` and `agents/pov-<role>.md`. Skip
// `skill://pov:<skill>` URIs here; they are validated separately by
// lintSkillRefs. `/pi-oven:<command>` remains a command ref, not an agent
// token, so it stays excluded from legacy matching.
const POV_TOKEN = /(?<!skill:\/\/)\bpov:([a-z][a-z0-9-]*)/g;
const LEGACY_PI_OVEN_TOKEN = /(?<!\/)pi-oven:([a-z][a-z0-9-]*)/g;
const POV_AGENT_PATH = /\bagents\/pov-([a-z][a-z0-9-]*)\.md\b/g;
const LEGACY_PI_OVEN_AGENT_PATH = /\bagents\/pi-oven-([a-z][a-z0-9-]*)\.md\b/g;

// Known phantom skill names removed from the tree — must never reappear as a
// bare backtick skill reference. Skill→skill references should use skill://<name>.
const PHANTOM_SKILL_DENYLIST = new Set<string>(["freshness-guard", "executing-plans"]);
// skill://<name> or skill://pov:<name>/… — capture the skill name segment.
// The old slash form skill://pi-oven/<name> is REJECTED (matches no registered skill).
const SKILL_URI = /skill:\/\/(?:pov:)?([a-z][a-z0-9-]*)/g;
const FRONTMATTER_NAME = /^name:\s*["']?([^"'\n]+)["']?\s*$/m;
const BACKTICK_TOKEN = /`([a-z][a-z0-9-]*)`/g;

const LEGACY_AGENT_DIAGNOSTIC_CONTEXT =
  /\b(?:legacy|migration|migrate|diagnostic|compat|compatibility|temporary|exception)\b/i;
const LEGACY_SHIPPED_SKILL_AGENT_TOKEN_ALLOWLIST: Record<string, readonly string[]> = {
  "autonomous-loop": [
    "pi-oven:analyst",
    "pi-oven:architect",
    "pi-oven:code-reviewer",
    "pi-oven:code-simplifier",
    "pi-oven:critic",
    "pi-oven:data-runner",
    "pi-oven:debugger",
    "pi-oven:deep-researcher",
    "pi-oven:designer",
    "pi-oven:executor",
    "pi-oven:explorer",
    "pi-oven:multimodal-looker",
    "pi-oven:oracle",
    "pi-oven:planner",
    "pi-oven:security-reviewer",
    "pi-oven:test-engineer",
    "pi-oven:tracer",
    "pi-oven:verifier",
  ],
  aws: ["pi-oven:executor", "pi-oven:security-reviewer"],
  "bitbucket-pipeline": ["pi-oven:executor"],
  brainstorming: [
    "pi-oven:architect",
    "pi-oven:document-specialist",
    "pi-oven:explorer",
    "pi-oven:librarian",
    "pi-oven:metis",
    "pi-oven:planner",
    "pi-oven:writer",
  ],
  cloudflare: ["pi-oven:executor"],
  "code-quality-discipline": [
    "pi-oven:analyst",
    "pi-oven:code-reviewer",
    "pi-oven:code-simplifier",
    "pi-oven:security-reviewer",
  ],
  "codebase-survey": [
    "pi-oven:analyst",
    "pi-oven:document-specialist",
    "pi-oven:explorer",
    "pi-oven:librarian",
    "pi-oven:tracer",
  ],
  "deep-init": [
    "pi-oven:document-specialist",
    "pi-oven:explorer",
    "pi-oven:librarian",
    "pi-oven:writer",
  ],
  "git-workflow": [
    "pi-oven:explorer",
    "pi-oven:git-master",
    "pi-oven:verifier",
  ],
  "html-research-orchestrator": [
    "pi-oven:architect",
    "pi-oven:document-specialist",
    "pi-oven:librarian",
    "pi-oven:multimodal-looker",
    "pi-oven:writer",
  ],
  "html-spec-decision-maker": [
    "pi-oven:designer",
    "pi-oven:document-specialist",
    "pi-oven:explorer",
    "pi-oven:librarian",
    "pi-oven:writer",
  ],
  "improve-codebase-architecture": [
    "pi-oven:analyst",
    "pi-oven:architect",
    "pi-oven:code-reviewer",
    "pi-oven:code-simplifier",
    "pi-oven:data-runner",
    "pi-oven:deep-researcher",
    "pi-oven:explorer",
    "pi-oven:verifier",
  ],
  "large-task-delegation": [
    "pi-oven:code-reviewer",
    "pi-oven:critic",
    "pi-oven:data-runner",
    "pi-oven:deep-researcher",
    "pi-oven:executor",
    "pi-oven:explorer",
    "pi-oven:planner",
    "pi-oven:verifier",
    "pi-oven:writer",
  ],
  "memory-discipline": [
    "pi-oven:architect",
    "pi-oven:critic",
    "pi-oven:deep-researcher",
    "pi-oven:explorer",
    "pi-oven:oracle",
    "pi-oven:planner",
  ],
  "pre-commit-gate": [
    "pi-oven:code-reviewer",
    "pi-oven:git-master",
    "pi-oven:oracle",
    "pi-oven:qa-tester",
    "pi-oven:security-reviewer",
    "pi-oven:verifier",
  ],
  "receiving-code-review": [
    "pi-oven:code-reviewer",
    "pi-oven:critic",
    "pi-oven:executor",
    "pi-oven:verifier",
  ],
  "spec-and-review": [
    "pi-oven:analyst",
    "pi-oven:architect",
    "pi-oven:critic",
    "pi-oven:data-runner",
    "pi-oven:deep-researcher",
    "pi-oven:document-specialist",
    "pi-oven:executor",
    "pi-oven:explorer",
    "pi-oven:librarian",
    "pi-oven:planner",
  ],
  "subagent-driven-development": [
    "pi-oven:code-reviewer",
    "pi-oven:executor",
    "pi-oven:planner",
    "pi-oven:verifier",
  ],
  "systematic-debugging": [
    "pi-oven:code-reviewer",
    "pi-oven:debugger",
    "pi-oven:executor",
    "pi-oven:explorer",
    "pi-oven:oracle",
    "pi-oven:test-engineer",
    "pi-oven:tracer",
    "pi-oven:verifier",
  ],
  "tdd-strict": [
    "pi-oven:debugger",
    "pi-oven:executor",
    "pi-oven:oracle",
    "pi-oven:test-engineer",
    "pi-oven:verifier",
  ],
};

function shouldAllowLegacySkillBodyAgentRef(
  skillsRoot: string,
  skillName: string,
  ref: string,
  content: string,
  matchIndex: number
): boolean {
  if (resolve(skillsRoot) === resolve(defaultSkillsDir)) {
    return LEGACY_SHIPPED_SKILL_AGENT_TOKEN_ALLOWLIST[skillName]?.includes(ref) ?? false;
  }
  const windowStart = Math.max(0, matchIndex - 120);
  const windowEnd = Math.min(content.length, matchIndex + 120);
  return LEGACY_AGENT_DIAGNOSTIC_CONTEXT.test(
    content.slice(windowStart, windowEnd)
  );
}

function bodyOf(content: string): string {
  const match = content.match(/^---\n[\s\S]*?\n---\n?/);
  return match ? content.slice(match[0].length) : content;
}

function collectCoveredRoles(
  skillsRoot: string,
  skillName: string,
  content: string
): { roles: Set<string>; errors: string[] } {
  const body = bodyOf(content);
  const roles = new Set<string>();
  const errors: string[] = [];
  const seenPov = new Set<string>();
  const seenLegacy = new Set<string>();
  const seenPovPaths = new Set<string>();
  const seenLegacyPaths = new Set<string>();

  let match: RegExpExecArray | null;
  POV_TOKEN.lastIndex = 0;
  while ((match = POV_TOKEN.exec(body)) !== null) {
    const ref = match[1];
    if (seenPov.has(ref)) continue;
    seenPov.add(ref);
    if (roleSet.has(ref)) {
      roles.add(ref);
      continue;
    }
    errors.push(
      `references pov:${ref} which is not in ROLES. Allowed roles: ${ROLES.join(", ")}`
    );
  }

  POV_AGENT_PATH.lastIndex = 0;
  while ((match = POV_AGENT_PATH.exec(body)) !== null) {
    const ref = match[1];
    const agentPath = match[0];
    if (seenPovPaths.has(agentPath)) continue;
    seenPovPaths.add(agentPath);
    if (roleSet.has(ref)) {
      roles.add(ref);
      continue;
    }
    errors.push(
      `references ${agentPath} which does not map to a ROLES entry. Allowed roles: ${ROLES.join(", ")}`
    );
  }

  LEGACY_PI_OVEN_TOKEN.lastIndex = 0;
  while ((match = LEGACY_PI_OVEN_TOKEN.exec(body)) !== null) {
    const ref = match[1];
    const token = match[0];
    if (seenLegacy.has(token)) continue;
    seenLegacy.add(token);
    if (
      roleSet.has(ref) &&
      shouldAllowLegacySkillBodyAgentRef(
        skillsRoot,
        skillName,
        token,
        body,
        match.index
      )
    ) {
      roles.add(ref);
      continue;
    }
    errors.push(
      `references legacy ${token}; canonical agent token is pov:${ref}. /pi-oven:* commands remain valid.`
    );
  }

  LEGACY_PI_OVEN_AGENT_PATH.lastIndex = 0;
  while ((match = LEGACY_PI_OVEN_AGENT_PATH.exec(body)) !== null) {
    const ref = match[1];
    const agentPath = match[0];
    if (seenLegacyPaths.has(agentPath)) continue;
    seenLegacyPaths.add(agentPath);
    if (
      roleSet.has(ref) &&
      shouldAllowLegacySkillBodyAgentRef(
        skillsRoot,
        skillName,
        agentPath,
        body,
        match.index
      )
    ) {
      roles.add(ref);
      continue;
    }
    errors.push(
      `references legacy ${agentPath}; canonical agent path is agents/pov-${ref}.md. /pi-oven:* commands remain valid.`
    );
  }

  return { roles, errors };
}

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


function lintPublicSkillName(skillName: string, content: string): string[] {
  const match = content.match(FRONTMATTER_NAME);
  const expected = `${PUBLIC_SKILL_PREFIX}${skillName}`;
  if (!match) {
    return [`skills/${skillName}/SKILL.md is missing frontmatter name ${expected}.`];
  }
  const actual = match[1].trim();
  if (actual !== expected) {
    return [
      `skills/${skillName}/SKILL.md must use public frontmatter name ${expected}; found ${actual}.`,
    ];
  }
  return [];
}

function lintRoleTokens(skillName: string, content: string, skillsRoot: string): string[] {
  return collectCoveredRoles(skillsRoot, skillName, content).errors.map(
    (detail) => `skills/${skillName}/SKILL.md ${detail}`
  );
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

    errors.push(...lintPublicSkillName(dir, content));
    errors.push(...lintRoleTokens(dir, content, skillsDir));
    errors.push(...lintSkillRefs(dir, content, validSkills));
    for (const ref of collectCoveredRoles(skillsDir, dir, content).roles) {
      roleCoverage.add(ref);
    }
  }

  if (shouldRequireRoleCoverage(skillsDir)) {
    const uncovered = ROLES.filter((role) => !roleCoverage.has(role));
    if (uncovered.length > 0) {
      errors.push(
        `skills role coverage missing for: ${uncovered.join(
          ", "
        )}. Add at least one valid pov:<role> reference in skills/*.`
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
