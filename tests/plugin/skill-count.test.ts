import { describe, it, expect } from "bun:test";
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
  "./skills/git-workflow/SKILL.md",
  "./skills/aws/SKILL.md",
  "./skills/bitbucket-pipeline/SKILL.md",
  "./skills/cloudflare/SKILL.md",
] as const;

const EXPECTED_COMMANDS = [
  "./commands/pi-oven-setup.md",
  "./commands/pi-oven-doctor.md",
  "./commands/pi-oven-autonomous.md",
] as const;

describe("plugin.json manifest SoT alignment", () => {
  it("plugin.json version is 0.1.0", async () => {
    const plugin = await Bun.file(path.join(ROOT, ".claude-plugin/plugin.json")).json();
    expect(plugin.version).toBe("0.1.0");
  });

  it("loads exactly the 20 SoT skills", async () => {
    const plugin = await Bun.file(path.join(ROOT, ".claude-plugin/plugin.json")).json();
    expect(plugin.skills).toEqual(EXPECTED_SKILLS);
  });

  it("loads exactly the 3 SoT commands", async () => {
    const plugin = await Bun.file(path.join(ROOT, ".claude-plugin/plugin.json")).json();
    expect(plugin.commands).toEqual(EXPECTED_COMMANDS);
  });

  it("marketplace.json plugins[0].version is 0.1.0", async () => {
    const marketplace = await Bun.file(path.join(ROOT, ".claude-plugin/marketplace.json")).json();
    expect(marketplace.plugins[0].version).toBe("0.1.0");
  });
});