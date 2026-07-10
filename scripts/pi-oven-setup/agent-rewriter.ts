/**
 * Agent file in-place rewriter for the pi-oven setup wizard.
 * Source-of-truth rewrite of model + thinkingLevel in agent files.
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
export const CANONICAL_AGENT_FILENAME_PREFIX = "pov-";
const LEGACY_AGENT_FILENAME_PREFIX = "pi-oven-";
const AGENT_FILENAME_SUFFIX = ".md";

export function isCanonicalAgentMarkdownFile(name: string): boolean {
  return (
    name.startsWith(CANONICAL_AGENT_FILENAME_PREFIX) &&
    name.endsWith(AGENT_FILENAME_SUFFIX)
  );
}

export function isLegacyAgentMarkdownFile(name: string): boolean {
  return (
    name.startsWith(LEGACY_AGENT_FILENAME_PREFIX) &&
    name.endsWith(AGENT_FILENAME_SUFFIX)
  );
}

export function isAgentMarkdownFile(name: string): boolean {
  return isCanonicalAgentMarkdownFile(name) || isLegacyAgentMarkdownFile(name);
}

export function getAgentRoleFromFileName(file: string): Role | null {
  if (!isAgentMarkdownFile(file)) return null;
  const prefix = file.startsWith(CANONICAL_AGENT_FILENAME_PREFIX)
    ? CANONICAL_AGENT_FILENAME_PREFIX
    : LEGACY_AGENT_FILENAME_PREFIX;
  const role = file.slice(prefix.length, -AGENT_FILENAME_SUFFIX.length) as Role;
  return (ROLES as readonly string[]).includes(role) ? role : null;
}

export function getCanonicalAgentFileName(role: Role): string {
  return `${CANONICAL_AGENT_FILENAME_PREFIX}${role}${AGENT_FILENAME_SUFFIX}`;
}



// ---------------------------------------------------------------------------
// readAgentFiles
// ---------------------------------------------------------------------------

/**
 * Reads all canonical `pov-*.md` agent files in agentsDir, parses YAML
 * frontmatter, and returns entries with role/model/thinkingLevel.
 *
 * Legacy `pi-oven-*.md` filenames are rejected explicitly so stale installs or
 * partial renames fail visibly instead of being treated as healthy.
 */
export async function readAgentFiles(agentsDir: string): Promise<AgentFileEntry[]> {
  let files: string[];
  try {
    files = await fs.readdir(agentsDir);
  } catch {
    return [];
  }
  assertNoLegacyAgentFiles(agentsDir, files);

  const entries: AgentFileEntry[] = [];
  for (const filename of files.filter(isCanonicalAgentMarkdownFile).sort()) {
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
 * Iterates ROLES, rewrites each matching canonical `pov-<role>.md` file in
 * agentsDir. Skips roles whose canonical files do not exist.
 *
 * Legacy `pi-oven-*.md` files are rejected explicitly so maintainer rewrites do
 * not silently preserve a stale registry layout.
 */
export async function rewriteAllAgents(
  agentsDir: string,
  profileMap: ProfileMap
): Promise<{ rewritten: Role[]; skipped: Role[] }> {
  let files: string[];
  try {
    files = await fs.readdir(agentsDir);
  } catch {
    files = [];
  }
  assertNoLegacyAgentFiles(agentsDir, files);

  const rewritten: Role[] = [];
  const skipped: Role[] = [];

  for (const role of ROLES) {
    const filePath = path.join(agentsDir, getCanonicalAgentFileName(role));
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
function assertNoLegacyAgentFiles(agentsDir: string, files: string[]): void {
  const legacyFiles = files.filter(isLegacyAgentMarkdownFile).sort();
  if (legacyFiles.length === 0) return;
  throw new Error(
    `Legacy agent filenames detected in ${agentsDir}: ${legacyFiles.join(", ")}. ` +
      `Rename them to ${CANONICAL_AGENT_FILENAME_PREFIX}<role>${AGENT_FILENAME_SUFFIX}.`
  );
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

  // Extract role from name: field (e.g. "name: pov:executor" → "executor")
  const nameLine = frontmatterLines.find((l) => l.match(/^name:\s*/));
  if (!nameLine) return null;
  const rawNameVal = nameLine.replace(/^name:\s*/, "").trim();
  // Strip a single pair of surrounding double- or single-quotes (quoted YAML scalar).
  const nameVal =
    (rawNameVal.startsWith('"') && rawNameVal.endsWith('"')) ||
    (rawNameVal.startsWith("'") && rawNameVal.endsWith("'"))
      ? rawNameVal.slice(1, -1)
      : rawNameVal;
  const rolePart = nameVal.startsWith("pov:")
    ? nameVal.slice("pov:".length)
    : nameVal.startsWith("pi-oven:")
      ? nameVal.slice("pi-oven:".length)
      : nameVal;
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
