import path from "node:path";
const SHIPPED_SKILL_PATHS_LIST = [
  "./skills/memory-discipline/SKILL.md",
  "./skills/code-quality-discipline/SKILL.md",
  "./skills/tdd-strict/SKILL.md",
  "./skills/brainstorming/SKILL.md",
  "./skills/codebase-survey/SKILL.md",
  "./skills/fresh-verifier/SKILL.md",
  "./skills/writing-plans/SKILL.md",
  "./skills/spec-and-review/SKILL.md",
  "./skills/pre-commit-gate/SKILL.md",
  "./skills/large-task-delegation/SKILL.md",
  "./skills/subagent-driven-development/SKILL.md",
  "./skills/autonomous-loop/SKILL.md",
  "./skills/deep-init/SKILL.md",
  "./skills/deep-dive/SKILL.md",
  "./skills/systematic-debugging/SKILL.md",
  "./skills/improve-codebase-architecture/SKILL.md",
  "./skills/receiving-code-review/SKILL.md",
  "./skills/html-research-orchestrator/SKILL.md",
  "./skills/html-spec-decision-maker/SKILL.md",
  "./skills/git-workflow/SKILL.md",
  "./skills/aws/SKILL.md",
  "./skills/bitbucket-pipeline/SKILL.md",
  "./skills/cloudflare/SKILL.md",
] as const;

const SHIPPED_SKILL_PATH_PATTERN = /^\.\/skills\/([^/]+)\/SKILL\.md$/;

export const SHIPPED_SKILL_PATHS = [...SHIPPED_SKILL_PATHS_LIST];

export function shippedSkillNameFromPath(skillPath: string): string {
  const match = SHIPPED_SKILL_PATH_PATTERN.exec(skillPath);
  if (!match) {
    throw new Error(`Invalid shipped skill path: ${skillPath}`);
  }
  return match[1];
}

export function shippedSkillNamesFromPaths(skillPaths: readonly string[]): string[] {
  return skillPaths.map(shippedSkillNameFromPath);
}

export function resolveShippedSkillReadTarget(pluginRoot: string, skillPath: string): string {
  shippedSkillNameFromPath(skillPath);
  return path.resolve(pluginRoot, skillPath);
}

export const SHIPPED_SKILL_NAMES = shippedSkillNamesFromPaths(SHIPPED_SKILL_PATHS);
export const SHIPPED_SKILL_COUNT = SHIPPED_SKILL_PATHS.length;
