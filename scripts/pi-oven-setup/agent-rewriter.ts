/**
 * Agent file in-place rewriter for the pi-oven setup wizard.
 * Spec B §9.6: source-of-truth rewrite of model: array + thinkingLevel in agent files.
 *
 * Design constraints:
 * - Preserve frontmatter key order verbatim.
 * - Preserve systemPrompt body verbatim (everything after the closing ---).
 * - Idempotent: rewrite then rewrite same profile = no diff.
 */

import { promises as fs } from "node:fs";
import * as path from "node:path";
import { ROLES, type Role, type ModelEntry, type ProfileMap } from "./profiles";

export interface AgentFileEntry {
  role: Role;
  filePath: string;
  currentModel: string[];
  currentThinkingLevel: string;
}

// ---------------------------------------------------------------------------
// readAgentFiles
// ---------------------------------------------------------------------------

/**
 * Reads all pi-oven-*.md files in agentsDir, parses YAML frontmatter,
 * and returns entries with role/model/thinkingLevel.
 */
export async function readAgentFiles(agentsDir: string): Promise<AgentFileEntry[]> {
  let files: string[];
  try {
    files = await fs.readdir(agentsDir);
  } catch {
    return [];
  }

  const piOvenFiles = files.filter((f) => f.startsWith("pi-oven-") && f.endsWith(".md"));
  const entries: AgentFileEntry[] = [];

  for (const filename of piOvenFiles) {
    const filePath = path.join(agentsDir, filename);
    const content = await fs.readFile(filePath, "utf-8");
    const parsed = parseAgentFile(filePath, content);
    if (parsed !== null) {
      entries.push(parsed);
    }
  }

  return entries;
}

// ---------------------------------------------------------------------------
// rewriteAgentFile
// ---------------------------------------------------------------------------

/**
 * Updates the model: array and thinkingLevel in-place for a single agent file.
 * Preserves all other frontmatter keys and the systemPrompt body verbatim.
 */
export async function rewriteAgentFile(
  filePath: string,
  entry: ModelEntry
): Promise<void> {
  const content = await fs.readFile(filePath, "utf-8");
  const rewritten = applyModelEntry(content, entry);
  await fs.writeFile(filePath, rewritten, "utf-8");
}

// ---------------------------------------------------------------------------
// rewriteAllAgents
// ---------------------------------------------------------------------------

/**
 * Iterates ROLES, rewrites each matching pi-oven-<role>.md file in agentsDir.
 * Skips roles whose files do not exist.
 * Returns a summary of rewritten and skipped roles.
 */
export async function rewriteAllAgents(
  agentsDir: string,
  profileMap: ProfileMap
): Promise<{ rewritten: Role[]; skipped: Role[] }> {
  const rewritten: Role[] = [];
  const skipped: Role[] = [];

  for (const role of ROLES) {
    const filePath = path.join(agentsDir, `pi-oven-${role}.md`);
    try {
      await fs.access(filePath);
    } catch {
      skipped.push(role);
      continue;
    }
    await rewriteAgentFile(filePath, profileMap[role]);
    rewritten.push(role);
  }

  return { rewritten, skipped };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Splits a markdown agent file into { frontmatter, body }.
 * Body includes the closing --- delimiter onwards.
 */
function splitFrontmatter(content: string): {
  frontmatterLines: string[];
  body: string;
} | null {
  if (!content.startsWith("---")) return null;
  const rest = content.slice(3);
  // Find the next `---` delimiter (closing frontmatter)
  const closeIdx = rest.indexOf("\n---");
  if (closeIdx === -1) return null;

  const frontmatterBlock = rest.slice(0, closeIdx);
  const body = rest.slice(closeIdx + 1); // includes the closing `---\n...`
  return {
    frontmatterLines: frontmatterBlock.split("\n"),
    body,
  };
}

/**
 * Parse an agent file and return an AgentFileEntry, or null if unparseable.
 */
function parseAgentFile(filePath: string, content: string): AgentFileEntry | null {
  const split = splitFrontmatter(content);
  if (!split) return null;

  const { frontmatterLines } = split;

  // Extract role from name: field (e.g. "name: pi-oven:executor" → "executor")
  const nameLine = frontmatterLines.find((l) => l.match(/^name:\s*/));
  if (!nameLine) return null;
  const nameVal = nameLine.replace(/^name:\s*/, "").trim();
  // nameVal is like "pi-oven:executor" or "pi-oven:code-reviewer"
  const rolePart = nameVal.startsWith("pi-oven:") ? nameVal.slice("pi-oven:".length) : nameVal;
  const role = rolePart as Role;
  if (!(ROLES as readonly string[]).includes(role)) return null;

  // Extract model: array — collect lines starting with `  - `
  // that follow the `model:` line
  const modelValues: string[] = [];
  let inModelBlock = false;
  for (const line of frontmatterLines) {
    if (line.match(/^model:\s*$/)) {
      inModelBlock = true;
      continue;
    }
    if (inModelBlock) {
      const itemMatch = line.match(/^\s+-\s+(.+)$/);
      if (itemMatch) {
        modelValues.push(itemMatch[1].trim());
      } else {
        inModelBlock = false;
      }
    }
  }

  // Extract thinkingLevel
  const thinkingLine = frontmatterLines.find((l) => l.match(/^thinkingLevel:\s*/));
  const thinkingLevel = thinkingLine
    ? thinkingLine.replace(/^thinkingLevel:\s*/, "").trim()
    : "";

  return {
    role,
    filePath,
    currentModel: modelValues,
    currentThinkingLevel: thinkingLevel,
  };
}

/**
 * Applies a ModelEntry to the file content, updating model: array lines
 * and thinkingLevel in the frontmatter. All other content preserved verbatim.
 */
function applyModelEntry(content: string, entry: ModelEntry): string {
  const split = splitFrontmatter(content);
  if (!split) return content;
  const { frontmatterLines, body } = split;
  const newLines: string[] = [];
  let inModelBlock = false;
  let inToolsBlock = false;
  let inBlockedToolsBlock = false;
  for (let i = 0; i < frontmatterLines.length; i++) {
    const line = frontmatterLines[i];
    // thinkingLevel
    if (line.match(/^thinkingLevel:\s*/)) {
      newLines.push(`thinkingLevel: ${entry.thinkingLevel}`);
      continue;
    }
    // model block
    if (line.match(/^model:\s*$/)) {
      inModelBlock = true;
      inToolsBlock = false;
      inBlockedToolsBlock = false;
      newLines.push("model:");
      newLines.push(`  - ${entry.primary}`);
      newLines.push(`  - ${entry.registry_alternate}`);
      continue;
    }
    // tools block
    if (line.match(/^tools:\s*/)) {
      inToolsBlock = true;
      inModelBlock = false;
      inBlockedToolsBlock = false;
      newLines.push(`tools: ${JSON.stringify(entry.tools)}`);
      continue;
    }
    // blocked_tools block
    if (line.match(/^blocked_tools:\s*/)) {
      inBlockedToolsBlock = true;
      inModelBlock = false;
      inToolsBlock = false;
      newLines.push(`blocked_tools: ${JSON.stringify(entry.blocked_tools)}`);
      continue;
    }
    if (inModelBlock) {
      if (line.match(/^\s+-\s+/)) continue;
      inModelBlock = false;
    }
    if (inToolsBlock || inBlockedToolsBlock) {
      if (line.match(/^\s+-\s+/)) continue;
      inToolsBlock = false;
      inBlockedToolsBlock = false;
    }
    newLines.push(line);
  }
  const newFrontmatter = newLines.join("\n");
  return `---${newFrontmatter}\n${body}`;
}
