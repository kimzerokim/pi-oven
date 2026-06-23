import { describe, it, expect } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import {
  SHIPPED_SKILL_COUNT,
  SHIPPED_SKILL_PATHS,
} from "../../scripts/pi-oven-setup/shipped-skill-registry";

const ROOT = path.resolve(__dirname, "../../");

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

  it("loads exactly the shipped-skill registry paths", async () => {
    const plugin = await Bun.file(path.join(ROOT, ".claude-plugin/plugin.json")).json();
    expect(plugin.skills).toEqual(SHIPPED_SKILL_PATHS);
  });

  it("plugin.skills length matches the registry and the number of skill dirs on disk", async () => {
    const plugin = await Bun.file(path.join(ROOT, ".claude-plugin/plugin.json")).json();
    expect(plugin.skills.length).toBe(countSkillDirsOnDisk());
    expect(plugin.skills.length).toBe(SHIPPED_SKILL_COUNT);
  });

  it("loads exactly the 3 SoT commands", async () => {
    const plugin = await Bun.file(path.join(ROOT, ".claude-plugin/plugin.json")).json();
    expect(plugin.commands).toEqual(EXPECTED_COMMANDS);
  });
});
