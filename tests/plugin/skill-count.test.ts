import { describe, it, expect } from "bun:test";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "../../");

const EXPECTED_SKILLS = [
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
  "./skills/git-workflow/SKILL.md",
  "./skills/aws/SKILL.md",
  "./skills/bitbucket-pipeline/SKILL.md",
  "./skills/cloudflare/SKILL.md",
] as const;

const EXPECTED_COMMANDS = [
  "./commands/setup.md",
  "./commands/doctor.md",
  "./commands/release.md",
] as const;

// Number of skill directories on disk that contain a SKILL.md. Computed from
// disk so the count assertion tracks reality instead of a frozen literal.
function countSkillDirsOnDisk(): number {
  const skillsDir = path.join(ROOT, "skills");
  return fs
    .readdirSync(skillsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && fs.existsSync(path.join(skillsDir, d.name, "SKILL.md")))
    .length;
}

describe("plugin.json manifest SoT alignment", () => {
  // --- Dynamic version checks: package.json is canonical; both manifests must
  // --- agree with it by string equality. No hardcoded "0.4.x" literals so a
  // --- version bump can never silently drift a stale assertion.
  it("plugin.json version equals the canonical package.json version", async () => {
    const pkg = await Bun.file(path.join(ROOT, "package.json")).json();
    const plugin = await Bun.file(path.join(ROOT, ".claude-plugin/plugin.json")).json();
    expect(plugin.version).toBe(pkg.version);
  });

  it("marketplace.json plugins[0].version equals the canonical package.json version", async () => {
    const pkg = await Bun.file(path.join(ROOT, "package.json")).json();
    const marketplace = await Bun.file(path.join(ROOT, ".claude-plugin/marketplace.json")).json();
    expect(marketplace.plugins[0].version).toBe(pkg.version);
  });

  it("loads exactly the SoT skills", async () => {
    const plugin = await Bun.file(path.join(ROOT, ".claude-plugin/plugin.json")).json();
    expect(plugin.skills).toEqual(EXPECTED_SKILLS);
  });

  it("plugin.skills length matches the number of skill dirs on disk", async () => {
    const plugin = await Bun.file(path.join(ROOT, ".claude-plugin/plugin.json")).json();
    expect(plugin.skills.length).toBe(countSkillDirsOnDisk());
    expect(plugin.skills.length).toBe(21);
  });

  it("loads exactly the 3 SoT commands", async () => {
    const plugin = await Bun.file(path.join(ROOT, ".claude-plugin/plugin.json")).json();
    expect(plugin.commands).toEqual(EXPECTED_COMMANDS);
  });
});
