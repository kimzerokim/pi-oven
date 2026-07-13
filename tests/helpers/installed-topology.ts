import { cpSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

export interface InstalledTopologyFixture {
  root: string;
  pluginRoot: string;
  projectRoot: string;
  cleanup(): void;
}

export function createInstalledTopologyFixture(opts: {
  prefix: string;
  pluginRootName?: string;
  projectRootName?: string;
}): InstalledTopologyFixture {
  const root = mkdtempSync(join(tmpdir(), opts.prefix));
  const pluginRoot = opts.pluginRootName ? join(root, opts.pluginRootName) : root;
  const projectRoot = join(root, opts.projectRootName ?? "separate-project");

  mkdirSync(pluginRoot, { recursive: true });
  mkdirSync(projectRoot, { recursive: true });
  mkdirSync(join(pluginRoot, ".claude-plugin"), { recursive: true });
  cpSync(join(import.meta.dir, "../../agents"), join(pluginRoot, "agents"), {
    recursive: true,
  });

  return {
    root,
    pluginRoot,
    projectRoot,
    cleanup() {
      rmSync(root, { recursive: true, force: true });
    },
  };
}

export function writePluginSkillsManifest(pluginRoot: string, skills: string[]): void {
  mkdirSync(join(pluginRoot, ".claude-plugin"), { recursive: true });
  writeFileSync(
    join(pluginRoot, ".claude-plugin", "plugin.json"),
    JSON.stringify({ skills }, null, 2) + "\n",
    "utf-8"
  );
}

export function writeShippedSkill(
  pluginRoot: string,
  skillDir: string,
  opts?: {
    frontmatterName?: string;
    description?: string;
    body?: string;
  }
): void {
  mkdirSync(join(pluginRoot, "skills", skillDir), { recursive: true });
  writeFileSync(
    join(pluginRoot, "skills", skillDir, "SKILL.md"),
    [
      "---",
      `name: ${opts?.frontmatterName ?? `pov:${skillDir}`}`,
      `description: ${opts?.description ?? "fixture"}`,
      "---",
      opts?.body ?? "",
    ].join("\n"),
    "utf-8"
  );
}
