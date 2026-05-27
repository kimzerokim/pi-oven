#!/usr/bin/env bun
/**
 * CI-time hard lint for pi-oven agent files.
 * Usage: bun scripts/lint-agents.ts [agentsDir]
 * Walks agentsDir for pi-oven-*.md files and validates each has a non-empty model: field.
 * Exits 0 on success, 1 on any violation.
 */

import { readdirSync } from "fs";
import { join } from "path";

const agentsDir = process.argv[2] ?? join(import.meta.dir, "..", "agents");

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

let files: string[];
try {
  files = readdirSync(agentsDir).filter(
    (f) => f.startsWith("pi-oven-") && f.endsWith(".md")
  );
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
        `All pi-oven-*.md files must declare model: <provider>/<name>.`
    );
    violations++;
  }
}

if (violations > 0) {
  process.exit(1);
}
