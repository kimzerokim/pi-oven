import { describe, it, expect } from "bun:test";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { SKILL_KEYWORD_WHITELIST } from "../../.omp/extensions/pi-oven-runtime/skill-keyword-loader";
import {
  SHIPPED_SKILL_NAMES,
  shippedSkillNamesFromPaths,
} from "../../scripts/pi-oven-setup/shipped-skill-registry";

const ROOT = path.resolve(__dirname, "../../");
const SKILLS_ROOT = path.join(ROOT, "skills");
const AGENTS_ROOT = path.join(ROOT, "agents");
const README_PATH = path.join(ROOT, "README.md");
const SETUP_COMMAND_PATH = path.join(ROOT, "commands", "setup.md");
const ROOT_CLAUDE_PATH = path.join(ROOT, "CLAUDE.md");

const RELEASE_DEFAULT_AGENT_MODELS = {
  critic: "openai-codex/gpt-5.5",
  planner: "openai-codex/gpt-5.5",
  "document-specialist": "openai-codex/gpt-5.4",
  designer: "openai-codex/gpt-5.4",
  "code-reviewer": "openai-codex/gpt-5.5",
  "git-master": "openai-codex/gpt-5.4",
  "multimodal-looker": "openai-codex/gpt-5.4",
  oracle: "openai-codex/gpt-5.5",
  analyst: "openai-codex/gpt-5.5",
} as const;

const T11_SKILL_EXAMPLE_CONTRACT = {
  "deep-dive": {
    povRefs: [
      "pov:tracer",
      "pov:deep-researcher",
      "pov:analyst",
      "pov:data-runner",
      "pov:explorer",
    ],
    agentPaths: ["agents/pov-tracer.md"],
  },
  "fresh-verifier": {
    povRefs: ["pov:verifier", "pov:oracle"],
    agentPaths: ["agents/pov-verifier.md"],
  },
  "writing-plans": {
    povRefs: [
      "pov:planner",
      "pov:architect",
      "pov:metis",
      "pov:explorer",
      "pov:librarian",
      "pov:document-specialist",
    ],
    agentPaths: [],
  },
} as const;

async function readFrontmatterDescription(skill: string): Promise<string> {
  const skillPath = path.join(SKILLS_ROOT, skill, "SKILL.md");
  const content = await readFile(skillPath, "utf-8");
  const match = content.match(/^description:\s*"(.+)"$/m);
  expect(match).not.toBeNull();
  return match![1];
}

async function readFrontmatterName(skill: string): Promise<string> {
  const skillPath = path.join(SKILLS_ROOT, skill, "SKILL.md");
  const content = await readFile(skillPath, "utf-8");
  const match = content.match(/^name:\s*(.+)$/m);
  expect(match).not.toBeNull();
  return match![1].trim();
}


async function readAgentPrimaryModel(role: string): Promise<string> {
  const agentPath = path.join(AGENTS_ROOT, `pov-${role}.md`);
  const content = await readFile(agentPath, "utf-8");
  const match = content.match(/^model:\s*\n\s*-\s*(.+)$/m);
  expect(match).not.toBeNull();
  return match![1].trim();
}

async function readPluginSkillNames(): Promise<string[]> {
  const plugin = (await Bun.file(path.join(ROOT, ".claude-plugin/plugin.json")).json()) as {
    skills?: unknown;
  };
  const skillPaths = Array.isArray(plugin.skills)
    ? plugin.skills.filter((skill): skill is string => typeof skill === "string")
    : [];
  return shippedSkillNamesFromPaths(skillPaths);
}

describe("skill activation metadata contract", () => {
  it("keeps trigger lists out of shipped skill frontmatter descriptions", async () => {
    for (const skill of SHIPPED_SKILL_NAMES) {
      const description = await readFrontmatterDescription(skill);
      expect(description.includes("triggers:")).toBe(false);
      expect(description.includes("user says ")).toBe(false);
      expect(description.includes("asks to ")).toBe(false);
    }
  });

  it("keeps shipped skill frontmatter names on the public pov: namespace", async () => {
    for (const skill of SHIPPED_SKILL_NAMES) {
      expect(await readFrontmatterName(skill)).toBe(`pov:${skill}`);
    }
  });

  it("keeps plugin.json, the shipped-skill registry, and keyword whitelist keys in exact parity", async () => {
    expect(await readPluginSkillNames()).toEqual(SHIPPED_SKILL_NAMES);
    expect(Object.keys(SKILL_KEYWORD_WHITELIST).sort()).toEqual([...SHIPPED_SKILL_NAMES].sort());
  });

  it("defines a non-empty curated keyword whitelist for every shipped skill", () => {
    for (const skill of SHIPPED_SKILL_NAMES) {
      const phrases = SKILL_KEYWORD_WHITELIST[skill];
      expect(Array.isArray(phrases)).toBe(true);
      expect(phrases.length).toBeGreaterThan(0);
    }
  });

  it("keeps the T11 skill live agent examples on pov namespace and pov agent paths", async () => {
    for (const [skill, contract] of Object.entries(T11_SKILL_EXAMPLE_CONTRACT)) {
      const content = await readFile(path.join(SKILLS_ROOT, skill, "SKILL.md"), "utf-8");
      expect(content).not.toContain("pi-oven:");
      expect(content).not.toContain("agents/pi-oven-");
      for (const ref of contract.povRefs) {
        expect(content).toContain(ref);
      }
      for (const agentPath of contract.agentPaths) {
        expect(content).toContain(agentPath);
      }
    }
  });
});

describe("release-default routing public contract", () => {
  it("advertises Profile A as the openai-codex-only release default across README/setup/CLAUDE", async () => {
    const [readme, setup, claude] = await Promise.all([
      readFile(README_PATH, "utf-8"),
      readFile(SETUP_COMMAND_PATH, "utf-8"),
      readFile(ROOT_CLAUDE_PATH, "utf-8"),
    ]);

    expect(readme).toContain("Profile A (release default, openai-codex-only)");
    expect(readme).not.toContain("Profile A (release default, heterogeneous");

    expect(setup).toContain("Profile A (release default, openai-codex-only)");
    expect(setup).not.toContain(
      "Profile A (release default, opencode-zen + openai-codex + anthropic advisory roles)"
    );

    expect(claude).toContain("Profile A writes all 24 per-role `task.agentModelOverrides`");
    expect(claude).not.toContain("Profile A remains orchestrator-only");
  });

  it("ships the selected release-default agents on codex-family primaries", async () => {
    for (const [role, expectedModel] of Object.entries(RELEASE_DEFAULT_AGENT_MODELS)) {
      expect(await readAgentPrimaryModel(role)).toBe(expectedModel);
    }
  });
});
