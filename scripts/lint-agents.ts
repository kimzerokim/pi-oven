#!/usr/bin/env bun
/**
 * CI-time hard lint for pi-oven agent files.
 * Usage: bun scripts/lint-agents.ts [agentsDir]
 * Walks agentsDir for shipped agent markdown files (`pov-*.md` in the current
 * contract). Validates each has a non-empty model: field AND that
 * model/thinkingLevel match profiles.ts DEFAULT_PROFILE (SoT).
 * Exits 0 on success, 1 on any violation.
 */

import { readdirSync } from "fs";
import { join } from "path";
import {
  getAgentRoleFromFileName,
  isAgentMarkdownFile,
  isLegacyAgentMarkdownFile,
} from "./pi-oven-setup/agent-rewriter";
import { DEFAULT_PROFILE, type Role } from "./pi-oven-setup/profiles";

const defaultAgentsDir = join(import.meta.dir, "..", "agents");
const agentsDir = process.argv[2] ?? defaultAgentsDir;

function parseFrontmatter(content: string): Record<string, unknown> {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return {};
  return Bun.YAML.parse(match[1]) as Record<string, unknown>;
}

function extractModels(frontmatter: Record<string, unknown>): string[] {
  const raw = frontmatter["model"];
  if (Array.isArray(raw)) return raw.filter((v) => typeof v === "string") as string[];
  if (typeof raw === "string") return raw.length > 0 ? [raw] : [];
  return [];
}

function extractThinkingLevel(frontmatter: Record<string, unknown>): string | undefined {
  const raw = frontmatter["thinkingLevel"];
  return typeof raw === "string" ? raw : undefined;
}

function extractName(frontmatter: Record<string, unknown>): string | undefined {
  const raw = frontmatter["name"];
  return typeof raw === "string" ? raw : undefined;
}


/** First-class omp tool names. MCP tools (e.g. context7) are intentionally
 *  excluded — they are not governed by the agent `tools:` allowlist the same
 *  way, so we never flag them as instructed-but-not-granted. */
const KNOWN_TOOLS = new Set<string>([
  "read", "write", "edit", "apply_patch", "search", "find", "ast_grep", "ast_edit",
  "lsp", "browser", "debug", "eval", "web_search", "task", "irc", "recall",
  "retain", "reflect", "bash", "generate_image", "report_finding", "inspect_image",
  "todo_write",
]);

function extractStringList(frontmatter: Record<string, unknown>, key: string): string[] {
  const raw = frontmatter[key];
  if (Array.isArray(raw)) return raw.filter((v): v is string => typeof v === "string");
  if (typeof raw === "string") return raw.length > 0 ? [raw] : [];
  return [];
}

function bodyOf(content: string): string {
  const m = content.match(/^---\n[\s\S]*?\n---\n?([\s\S]*)$/);
  return m ? m[1] : content;
}

/** The set of tools an agent can actually call, accounting for `["*"]`,
 *  auto-injected `irc`, `spawns`→`task`, `exec`→`eval`/`bash`, minus blocked. */
function effectiveGranted(
  frontmatter: Record<string, unknown>
): { all: boolean; set: Set<string>; blocked: Set<string> } {
  const tools = extractStringList(frontmatter, "tools");
  const blocked = new Set(extractStringList(frontmatter, "blocked_tools"));
  const set = new Set<string>(tools);
  set.add("irc"); // always auto-injected by omp (task/executor.ts)
  if (frontmatter["spawns"] !== undefined) set.add("task");
  if (set.has("exec")) { set.add("eval"); set.add("bash"); }
  for (const b of blocked) set.delete(b);
  return { all: set.has("*"), set, blocked };
}

const NEGATION_NEARBY = /\b(no|not|never|without|cannot|don't|avoid|forbidden|disallow|disallowed)\b/i;

/** Tools the body instructs the agent to use: leading identifier of the first
 *  token inside each backtick span, restricted to KNOWN_TOOLS. A span preceded
 *  by a negation word ("no `eval`") is a prohibition, not an instruction. */
function instructedTools(body: string): Set<string> {
  const found = new Set<string>();
  const re = /`[^`]+`/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    const before = body.slice(Math.max(0, m.index - 48), m.index);
    if (NEGATION_NEARBY.test(before)) continue;
    const lead = m[0].slice(1, -1).trim().match(/^[a-z_]+/)?.[0];
    if (lead && KNOWN_TOOLS.has(lead)) found.add(lead);
  }
  return found;
}

let files: string[];
try {
  files = readdirSync(agentsDir).filter(isAgentMarkdownFile);
} catch {
  // Directory does not exist — treat as empty (no violations)
  files = [];
}

let violations = 0;

for (const file of files) {
  const content = await Bun.file(join(agentsDir, file)).text();
  const frontmatter = parseFrontmatter(content);
  const models = extractModels(frontmatter);

  if (models.length === 0) {
    console.error(
      `lint-agents: ERROR: ${file} has no non-empty model: field. ` +
        `All agent markdown files must declare model: <provider>/<name>.`
    );
    violations++;
  }

  const role = getAgentRoleFromFileName(file);
  if (isLegacyAgentMarkdownFile(file)) {
    console.error(
      `lint-agents: ERROR: ${file} uses the legacy pi-oven filename prefix. Rename it to pov-<role>.md.`
    );
    violations++;
  }
  // Instructed-but-not-granted: every first-class tool named in the body must
  // be callable — i.e. in frontmatter tools: (or ["*"]), accounting for the
  // auto-injected irc, spawns→task, exec→eval/bash, minus blocked_tools.
  // Otherwise the agent is told to use a tool it cannot call (e.g. a body that
  // says `web_search` while tools: omits it).
  const granted = effectiveGranted(frontmatter);
  if (!granted.all) {
    for (const tool of instructedTools(bodyOf(content))) {
      // A blocked tool named in the body is a prohibition, not an instruction.
      if (granted.blocked.has(tool)) continue;
      if (!granted.set.has(tool)) {
        console.error(
          `lint-agents: ERROR: ${file} body instructs \`${tool}\` but it is not granted by frontmatter tools: (add it, or use ["*"]).`
        );
        violations++;
      }
    }
  }

  // Contradiction checks:
  // 1. tools: ["*"] and non-empty blocked_tools is a contradiction (block is ignored).
  const rawTools = extractStringList(frontmatter, "tools");
  const rawBlocked = extractStringList(frontmatter, "blocked_tools");
  if (rawTools.includes("*") && role !== null) {
    console.error(
      `lint-agents: ERROR: ${file} uses \`tools: ["*"]\`, but shipped pov agents must declare an explicit allowlist. Update profiles.ts and the agent frontmatter in lockstep.`
    );
    violations++;
  } else if (rawTools.includes("*") && rawBlocked.length > 0) {
    console.error(
      `lint-agents: ERROR: ${file} contains \`tools: ["*"]\` AND non-empty \`blocked_tools: ${JSON.stringify(rawBlocked)}\`. ` +
        `The \`*\` grant ignores blocks, making the block list misleading. Remove the blocks or use an explicit allowlist.`
    );
    violations++;
  }

  // 2. Intersection of tools and blocked_tools must be empty.
  const toolSet = new Set(rawTools);
  const overlap = rawBlocked.filter((b) => toolSet.has(b));
  if (overlap.length > 0) {
    console.error(
      `lint-agents: ERROR: ${file} has overlapping tools in both \`tools\` and \`blocked_tools\`: ${JSON.stringify(overlap)}.`
    );
    violations++;
  }

  // SoT alignment: agent file model + thinkingLevel must match DEFAULT_PROFILE.
  // profiles.ts is the source of truth; agent files are derived artifacts.
  if (role === null) continue;

  const expectedName = `pov:${role}`;
  const name = extractName(frontmatter);
  if (name !== expectedName) {
    console.error(
      `lint-agents: ERROR: ${file} name="${name ?? "(missing)"}" must equal "${expectedName}".`
    );
    violations++;
  }

  const expected = DEFAULT_PROFILE[role as Role];
  const toolViolations = (key: "tools" | "blocked_tools") => {
    const actual = extractStringList(frontmatter, key);
    const exp = expected[key];
    if (JSON.stringify(actual) !== JSON.stringify(exp)) {
      console.error(
        `lint-agents: ERROR: ${file} ${key} drift from profiles.ts DEFAULT_PROFILE. ` +
          `file=${JSON.stringify(actual)} expected=${JSON.stringify(exp)}`
      );
      violations++;
    }
  };
  toolViolations("tools");
  toolViolations("blocked_tools");

  const expectedModels = [expected.primary];
  if (models.length !== 1 || models[0] !== expectedModels[0]) {
    console.error(
      `lint-agents: ERROR: ${file} model drift from profiles.ts DEFAULT_PROFILE. ` +
        `file=[${models.join(", ")}] expected=[${expectedModels.join(", ")}]`
    );
    violations++;
  }

  const thinking = extractThinkingLevel(frontmatter);
  if (thinking !== expected.thinkingLevel) {
    console.error(
      `lint-agents: ERROR: ${file} thinkingLevel="${thinking ?? "(missing)"}" ` +
        `does not match profiles.ts DEFAULT_PROFILE.${role}.thinkingLevel="${expected.thinkingLevel}".`
    );
    violations++;
  }
}

if (violations > 0) {
  process.exit(1);
}
